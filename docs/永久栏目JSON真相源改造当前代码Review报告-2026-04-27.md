# 永久栏目 JSON 真相源改造当前代码 Review 报告

日期：2026-04-27

范围：

- 对照 `docs/永久栏目JSON真相源与sourceID嵌入式存储改造计划书-2026-04-26.md`
- 对照当前 `Bookmark-Canvas` 代码
- 参考 `/Users/kk/Downloads/chrome download/Bookmark-Backup/Bookmark-Backup-3.0` 的恢复事务、中断恢复面板、后置校验设计

当前工作区状态说明：

- 本报告编写前，`Bookmark-Canvas` 功能代码工作区是干净的。
- 本报告只记录 review 结论和建议，不包含功能代码修改。

## 先讲两个关键概念

### 1. Pull 失败时，不应该简单“把旧 JSON 硬塞回去”

你指出得对。云端覆盖本地时，如果流程走到一半失败，正确方向应该是走“中断恢复面板”的事务模型，而不是在某个 catch 里临时猜测该怎么恢复。

参考 `Bookmark-Backup` 的做法：

- 开始破坏性操作前，先固化两份快照：
  - `startSnapshot`：开始前状态
  - `targetSnapshot`：目标状态
- 写入一个未完成事务锁。
- 执行期间记录阶段，例如 `snapshot_ready`、`apply_started`、`finalizing`、`completed`。
- 如果中断，下次打开 UI 时展示恢复面板。
- 面板提供：
  - 继续到目标状态
  - 回滚到开始前状态
  - 导出备份包
  - 必要时锁定故障态
- 继续或回滚后，必须做后置校验。

对应参考：

- `Bookmark-Backup-3.0/background.js:17387`：开始事务时固化 `startSnapshot` / `targetSnapshot`
- `Bookmark-Backup-3.0/background.js:18328`：继续到目标状态
- `Bookmark-Backup-3.0/background.js:18559`：回滚到开始前状态
- `Bookmark-Backup-3.0/background.js:19679`：后置校验当前树是否达到目标

放到 `Bookmark-Canvas` 里，云端覆盖本地永久栏目时，事务里不应该只保存 Chrome 书签树。还要保存我们自己的永久栏目内部 JSON：

- `bcs:perm:main`
- `bcs:perm:main:state`
- 远端目标永久 JSON
- 本次 pull 相关的远端文件 bundle / snapshot

这样失败或中断后，恢复面板才能明确回答两个问题：

- 继续：继续把远端目标永久 JSON 应用到 Chrome，并把 Chrome 新 ID 回写到 `bcs:perm:main.tree`
- 回滚：回到开始前的 Chrome 书签树和开始前的 `bcs:perm:main`

### 2. “先写本地 JSON”不是说永远绕开 Chrome API

永久栏目和浏览器原生书签树之间，应该分成两类入口理解。

第一类：我们插件自己发起的永久操作。

例如：

- 右键新增书签 / 文件夹
- 右键改名、改 URL
- 右键删除
- 右键移动
- 插件内拖拽移动
- 快速添加到永久栏

这些操作是我们主动发起的，所以我们有机会把流程做成：

1. 先在 `bcs:perm:main.tree` 里准备这次变更。
2. 新建节点时先写一个 pending 节点，并生成 `sourceID`。
3. 调 Chrome Bookmarks API。
4. Chrome 返回真实 `id` 后，把 pending 节点里的临时 ID 改成真实 Chrome ID。
5. 如果 Chrome API 失败，用准备阶段保存的旧 JSON 回滚。

这不是“拿不到 Chrome ID”。新建时 Chrome ID 确实要等 `chrome.bookmarks.create()` 返回后才能得到，所以本地 JSON 里应该先有 pending 节点，等返回后再 commit Chrome ID。

第二类：Chrome 书签管理器或其他外部入口发起的操作。

例如用户直接在 Chrome 书签管理器里拖动、改名、删除。

这种情况插件不是发起者，不能提前预写。正确流程应该是：

1. Chrome 先发生变化。
2. 插件收到 `bookmarks.onCreated/onChanged/onMoved/onRemoved/onChildrenReordered` 事件。
3. 插件把这个事件结构化同步回 `bcs:perm:main.tree`。

所以 review 里“本地永久操作 wrapper 不能 fail-open”只针对第一类，也就是我们插件自己发起的操作。它不是说所有普通 Chrome 事件都必须先写我们的 JSON。

## Findings

### [P1] Pull 失败仍可能留下半完成永久 JSON

位置：

- `history_html/sync/obsidian-git-sync.js:5261`
- `history_html/sync/obsidian-git-sync.js:5310`
- `history_html/sync/obsidian-git-sync.js:5348`

当前现象：

- pull 云端覆盖本地永久栏时，代码先把远端永久树写入 `bcs:perm:main`。
- 后面才执行 Chrome 书签树的增量应用或覆盖应用。
- 如果 Chrome API 应用失败，或者浏览器/扩展中途退出，`bcs:perm:main` 可能已经变成远端目标，但 Chrome 原生书签树还没有成功达到远端目标。

用户能感知到的效果：

- 永久栏目卡片里显示的 JSON 状态，可能和 Chrome 真实书签树不一致。
- 下一次同步可能误以为本地已经采用了远端永久树。
- 再 push 时有机会把半完成状态继续扩散。

和计划书的冲突：

- 计划书要求 pull 的事务边界是“远端 JSON 覆盖后，必须完成 Chrome API 应用并回写 ID 才算成功”。
- 计划书明确说失败时不能把半完成的无 ID 或未应用成功的永久树当成本地正常状态。

建议改法：

- 不要只做局部 catch 回滚。
- 应该按 `Bookmark-Backup` 的中断恢复事务模型做：
  - pull 开始前创建恢复事务。
  - 事务中保存开始前的 `bcs:perm:main` / `bcs:perm:main:state`。
  - 事务中保存开始前 Chrome 书签树。
  - 事务中保存远端目标永久 JSON。
  - 事务阶段至少包括 `snapshot_ready`、`apply_started`、`finalizing`、`completed`。
  - 中断后进入恢复面板。
  - 继续：继续应用远端目标。
  - 回滚：回到开始前状态。
  - 两条路径结束后都做后置校验。

后置校验建议：

- Chrome 当前树和目标树结构一致。
- `bcs:perm:main.tree` 和 Chrome 当前树一致。
- 所有用户可见永久节点都有 `sourceID`。
- 本地 Chrome `id` 已写回 `bcs:perm:main.tree`。
- 云端/导出 JSON 不含本地 Chrome `id`。
- pull 成功后 permanent state 为 clean。

### [P1] 插件自己发起的永久操作成功后，永久 JSON 同步失败可能被静默吞掉

位置：

- `history_html/bookmark_tree_context_menu.js:125`
- `history_html/bookmark_tree_context_menu.js:166`
- `history_html/bookmark_tree_context_menu.js:182`
- `history_html/bookmark_tree_context_menu.js:199`
- 同类逻辑也存在于拖拽和快速添加路径。

当前现象：

- 本地日常操作仍以 Chrome Bookmark API 为执行入口，这是当前架构允许的。
- 但 Chrome API 成功后，永久 JSON 的同步/回写失败时，部分路径只是 `console.warn`，或尝试从 Chrome 整树反灌兜底。
- 这会让用户看到 Chrome 操作已经成功，但永久栏目 JSON 是否同步成功并不明确。

用户能感知到的效果：

- 在插件 UI 里点了新增/删除/移动，Chrome 真实书签树已经成功变化，但 `bcs:perm:main.tree` 可能没有可靠同步到同一步。
- 下一次渲染、复制、拖拽、同步时，可能出现永久栏目 JSON 和 Chrome 原生树不一致。

这条不是说“改名会改 Chrome ID”或“改 URL 要删 sourceID”：

- 改名、改 URL、移动时，Chrome ID 不变，`sourceID` 也应该跟着原节点保留。
- 删除时，节点消失，节点上的 `sourceID` 也随节点消失。
- 新增时，Chrome 分配新 ID，我们给新节点生成或继承明确的 `sourceID`，再写进永久 JSON。

建议改法：

- 保持当前架构：本地操作由 Chrome Bookmark API 执行，执行成功后必须可靠同步进 `bcs:perm:main.tree`。
- 如果 Chrome 成功但永久 JSON 同步/回写失败，必须提示并标记永久栏目需要修复/重刷，不能静默当成完整成功。
- 新增时必须明确新 Chrome ID 对应的 `sourceID`。
- 外部 Chrome 事件仍走事件同步，不属于这条本地 UI 操作成功后的确认链。

### [P2] 比较/hash 没完整纳入根目录元数据

位置：

- `history_html/sync/obsidian-git-sync.js:5153`

当前现象：

- 根目录 comparable 目前主要包含 `rootKey`、`sourceID`、`children`。
- 顶层根目录的 `folderType` 和 `syncing` 没有作为独立同步字段进入比较。

这是什么意思：

- 这里说的不是“便当标记”。
- 它说的是 Chrome 顶层根目录身份，例如：
  - 书签栏
  - 其他书签
  - 移动书签
  - managed / mobile 等根目录
- `folderType` 和 `syncing` 是这些根目录的身份/匹配元数据。

不改的后果：

- 某些根目录元信息变化可能不进入 hash。
- 冲突判断、same 判断、dirty 判断可能漏掉根目录身份变化。
- pull/push 时更容易把远端根目录匹配到错误的本地根目录。

建议改法：

- comparable 根节点保留 `folderType` 和 `syncing`。
- signature/hash 的口径应和“剥离本地 Chrome ID 后的同步 JSON”一致。

### [P2] Chrome 事件同步仍是整树反灌，并且会静默补 sourceID

位置：

- `history_html/history.js:14008`
- `history_html/history.js:14168`
- `history_html/history.js:14195`
- `history_html/bookmark_canvas_module.js:32689`

当前现象：

- `onCreated/onRemoved/onChanged/onMoved` 事件后，会调度从 Chrome 整树同步回 `bcs:perm:main`。
- 整树同步时允许 `allowGenerateMissingSourceID: true`。

用户能感知到的效果：

- 普通改名、移动、删除，也可能触发整树回灌。
- 如果旧节点缺 `sourceID`，运行期可能静默补出来。
- 这会掩盖迁移后的数据问题。

计划书要求：

- 迁移阶段可以补齐缺失 `sourceID`。
- 迁移完成后，缺失 `sourceID` 应 fail closed。
- Chrome 原生事件应按事件类型结构化更新 JSON：
  - 新建：生成 `sourceID` 并插入 JSON
  - 改名/改 URL：按 Chrome ID 找到节点并更新
  - 移动：移动 JSON 节点
  - 删除：删除 JSON 节点
  - 同级重排：重排 children

建议改法：

- 普通 Chrome 事件不要整树反灌。
- 只有浏览器导入、大批量外部导入这类场景，才允许受控地从 Chrome 重建并生成新 `sourceID`。
- pull 应用或批量重建期间要 suppress 自己触发的 Chrome events，避免中间态回写。

### [P2] 仍存在运行期 Chrome ID -> sourceID 的 pending map

位置：

- `history_html/bookmark_canvas_module.js:31784`
- `history_html/bookmark_canvas_module.js:31796`
- `history_html/bookmark_canvas_module.js:32696`

当前现象：

- 内存里仍有一个短生命周期的 Chrome ID 到 `sourceID` 映射表。
- 新建节点后会把 Chrome ID 和 `sourceID` 放进去，后续整树同步再拿它拼回 JSON。

这是什么意思：

- 它不是永久存储表，但仍然是“节点 JSON 之外的身份表”。
- 计划书目标态是身份直接嵌入节点 JSON，不再需要单独映射。

不改的后果：

- 身份来源仍然分散。
- 某些时序下，pending map 丢失或未消费，会导致 sourceID 依赖运行期状态。
- 后续维护者容易继续沿用 Chrome ID 映射思路。

建议改法：

- 我们自己发起的新建：用 pending JSON 节点承接 sourceID，再 commit Chrome ID。
- 远端应用：应用完成后直接把 Chrome 分配的 ID 回写进 `bcs:perm:main.tree`。
- 不再暴露或依赖 pending Chrome ID map。

### [P2] 缺少 onChildrenReordered 覆盖

位置：

- `history_html/history.js:14132`

当前现象：

- 当前监听了 `onCreated/onRemoved/onChanged/onMoved`。
- 没有监听 `bookmarks.onChildrenReordered`。

用户能感知到的效果：

- 如果用户在 Chrome 书签管理器里对同级书签排序，Chrome 可能发出重排事件。
- 当前内部永久 JSON 可能没有记录这个顺序变化。
- 下次渲染或同步时，同级顺序可能回退或不同步。

建议改法：

- 注册 `bookmarks.onChildrenReordered`。
- 按事件里的父节点和 child ID 顺序，重排 `bcs:perm:main.tree` 对应 children。

### [P2] 永久节点 payload 仍会退回 Chrome 树或旧缓存

位置：

- `history_html/bookmark_tree_context_menu.js:89`
- `history_html/bookmark_tree_drag_drop.js:790`
- `history_html/search/search.js:5972`

当前现象：

- 从永久栏复制/剪切时，如果内部 JSON 读不到节点，会退回 `chrome.bookmarks.getSubTree()`。
- 永久拖到临时栏时，也会退回 Chrome subtree。
- 搜索结果生成临时栏目时，内部 JSON 不可用会退回 `cachedCurrentTree`。

用户能感知到的效果：

- 生成临时栏目、复制 payload、拖拽 payload 时，可能拿到没有 `sourceID` 的 Chrome 节点。
- 后续粘贴、同步、跨设备匹配时会丢永久身份。

建议改法：

- 永久来源的 payload 必须从 `bcs:perm:main.tree` 读取。
- 读不到或缺 `sourceID` 时直接提示失败。
- 不应该用 Chrome subtree 或旧缓存拼永久 payload。

## 建议拆分执行顺序

### 第一轮：只做 pull 恢复事务

目标：

- 把云端覆盖本地永久栏目纳入恢复面板。
- 学 `Bookmark-Backup` 的事务模型，而不是临时 catch 回滚。

验收：

- pull 开始前有开始前永久 JSON 和 Chrome 树。
- 目标远端永久 JSON 固化进事务。
- 中断后恢复面板能继续或回滚。
- 继续/回滚都有后置校验。
- 成功后清理事务缓存。

### 第二轮：讲清并修正插件自发永久操作

目标：

- 明确区分“插件自己发起”和“Chrome 外部事件”。
- 插件自己发起的操作走 prepare / Chrome API / commit / rollback。
- 外部 Chrome 事件走事件后结构化同步。

验收：

- 新建节点能解释清楚 pending 节点如何拿到最终 Chrome ID。
- bridge 缺失时，插件自发操作不会继续调用 Chrome API。
- Chrome 外部事件不要求预写。

### 第三轮：再处理 P2 收敛项

目标：

- 根目录 `folderType/syncing` 进入 hash。
- 普通 Chrome 事件不整树反灌。
- 移除运行期 pending map。
- 补 `onChildrenReordered`。
- 永久 payload 不再退回 Chrome/cache。

## 当前结论

当前代码已经在大方向上接近计划书，但仍有几个事务边界和身份边界没有完全收住。

最应该优先讨论和修的是 pull 云端覆盖本地，因为它是破坏性最高的路径。这里建议直接采用 `Bookmark-Backup` 的恢复事务思想：开始前固化 start/target，失败或中断交给恢复面板，继续/回滚后做后置校验。这样比在 pull 函数里临时恢复某个 JSON 更稳，也更符合你的预期。

## 2026-04-28 收尾复核

这次未提交 diff 主要先收住了最危险的一条路径：云端覆盖本地永久栏目。

已处理的部分：

- 普通 pull、首次同步“以云端为准”、冲突面板“使用云端覆盖本地”，开始前都会尽量保存两份备份：
  - 当前 `bcs:perm:main` 永久栏目 JSON
  - 当前 Chrome Bookmark API 拿到的书签树
- 恢复事务里的主备份以 `bcs:perm:main` 为准，Chrome 树作为额外保险。
- 如果云端覆盖永久栏目过程中失败，回滚会优先用开始前的永久栏目 JSON 恢复，再做 Chrome 树和内部 JSON 的后置校验。
- 如果普通 pull / 首次同步 / 冲突面板使用云端在破坏性阶段失败，恢复锁会进入失败态，恢复面板可以继续、回滚，必要时导出双快照。
- 恢复导出的开始前快照里会带上永久栏目恢复 payload，避免只导出旧的普通 snapshot 而缺少真正的永久 JSON 备份。

这部分仍需要真实浏览器场景验收：

- pull 应用到一半时模拟 Chrome API 失败。
- pull 应用到一半时关闭侧边栏或标签页，再重新打开。
- 冲突面板选择“使用云端”时模拟中断。
- 首次同步选择“以云端为准”时模拟中断。
- 分别验证恢复面板的“按云端继续”和“回到覆盖前本地状态”。

## 仍未解决的主要问题

### 1. 插件自己发起的永久操作成功后，永久 JSON 同步失败还缺明确状态

涉及功能：

- 右键新增书签 / 文件夹
- 右键改名
- 右键删除
- 右键移动
- 插件内拖拽移动
- 快速添加到永久栏

问题不是“所有 Chrome 变化都要先写 JSON”。按当前架构，本地日常操作可以继续由 Chrome Bookmark API 执行。真正要补的是：Chrome API 已经成功后，永久 JSON 同步/回写失败不能只是打印日志或静默兜底；必须提示，并标记永久栏目需要修复/重刷。

后续改法应该是：插件自发操作走 Chrome API -> 永久 JSON 确认同步；外部 Chrome 书签管理器操作走 Chrome 事件同步，两者都不能静默留下“Chrome 已变、永久 JSON 状态不明”的结果。

### 2. 根目录元数据没有完整进入比较和 hash

涉及内容：

- 永久栏根目录的 `folderType`
- 永久栏根目录的 `syncing`

当前比较逻辑主要看 children 和部分根身份字段。后果是某些根目录标记变化可能不触发冲突判断或同步差异判断。后续需要把这些字段作为同步 JSON 的一部分参与比较，同时继续剥离本机 Chrome `id`。

### 3. Chrome 事件同步仍有整树反灌和静默补 sourceID 风险

涉及场景：

- 用户在 Chrome 书签管理器里改名、移动、删除
- 其他扩展或浏览器原生入口改动书签

当前还有从 Chrome 整棵树 normalize 回内部 JSON 的路径，并允许给缺失 `sourceID` 的节点静默补 ID。后果是迁移完成后，如果某个旧节点缺身份，普通事件也可能“顺手生成”身份，和计划书限定的 sourceID 生成场景不一致。

后续应改成事件级同步：改名只更新对应节点，移动只调整父子关系和顺序，删除只删除对应节点；迁移后发现缺 `sourceID` 要提示或阻断，而不是普通运行期静默补。

### 4. 运行期 Chrome ID 到 sourceID 的 pending map 仍存在

当前仍有短生命周期的 Chrome ID -> `sourceID` 内存映射。它不是持久表，但依然是节点 JSON 之外的身份来源。

后续目标是：新建节点的身份由预写 JSON 节点承接；Chrome 返回真实 ID 后只 commit 回这个节点。不要再依赖额外的运行期身份表。

### 5. 还缺 Chrome 原生同级重排事件

当前监听覆盖了创建、删除、改名、移动，但还缺 `bookmarks.onChildrenReordered`。

后果是用户在 Chrome 书签管理器里对同级书签排序时，内部永久 JSON 可能没有记录这个顺序。后续需要按 Chrome 事件里的父节点和子节点顺序重排 `bcs:perm:main.tree`。

### 6. 永久来源 payload 仍有退回 Chrome/cache 的路径

涉及功能：

- 从永久栏复制 / 剪切
- 永久拖到临时栏
- 搜索结果生成临时栏目

当前部分路径在读不到内部永久 JSON 节点时，会退回 Chrome subtree 或旧缓存。后果是 payload 可能缺 `sourceID`，后续粘贴、同步、跨设备匹配会丢身份。

后续应要求：永久来源的 payload 必须从 `bcs:perm:main.tree` 读取；读不到或缺 `sourceID` 时直接失败并提示。

### 7. 验收脚本还没有完全跟上目标态

现有 guard / acceptance 脚本仍有旧 source-id-map 思路的检查。后续清掉运行期映射和旧兼容路径后，需要同步更新脚本，让它验证“身份只来自节点 JSON”这一目标态。
