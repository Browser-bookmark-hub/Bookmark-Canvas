# 本地存储、导入导出及 Tag 系统重构规范

本规范是整个书签画布系统中**本地存储、导入导出协议、同步增量更新以及 Tag 标签系统**的唯一权威设计与实现标准。它整合了历史计划、多次修复计划的决策成果以及当前的实际代码实现。

---

## 零、BCS 文档层与插件本地状态边界（当前执行口径）

### 0.1 存储首要目标
本插件的 BCS 存储首要服务对象是 **Obsidian JsonCanvas 对齐、导入、导出、备份、拉取、推送** 等基础交互。也就是说，`bcs:*` 文档层应优先表达“画布文档是什么”，而不是表达“当前插件 UI 怎么显示”。

当前不做 `settings.json` 导入/导出，也不做“完整插件工作区备份”。在这个前提下，不需要进行三层物理迁移；只需要保持导入/导出/备份/推送/拉取入口不读取插件 UI 偏好状态。

### 0.2 BCS 文档层范围
以下 key/前缀属于当前 BCS 文档或文档同步层：

* `bcs:canvas`：Obsidian JsonCanvas 清单，保存 file/text/group nodes 与 edges。它不是运行时 `CanvasState` 原样序列化，而是由 builder 转换成 JsonCanvas 形态。
* `bcs:section:*`：临时栏目 JSON 协议分片，保存临时栏目的书签/文件夹内容及必要的栏目协议 meta。
* `bcs:perm:main`：永久栏目主数据，含说明块、`identityMap`、永久书签树。
* `bcs:perm:copy-*`、`bcs:perm:copies`、`bcs:perm:root-meta`、`bcs:perm:tip-*`：永久栏目副本、根元信息和说明相关数据。
* `bcs:meta`：画布计数器、颜色游标、时间戳等 BCS 元信息。
* `bcs:signal`：跨页面/跨上下文同步信号，不属于导出内容本体。

导出、备份、推送、拉取准备流程的基准是：先把运行时状态 flush 到 BCS，再从 BCS 读取并构建 export sandbox，最后由 sandbox 输出导出包或备份槽。懒加载/休眠只卸载 DOM 或降低渲染成本，不卸载 `CanvasState` 中的核心数据。

### 0.3 插件 UI/偏好状态不进入导出包
以下状态属于插件 UI/偏好/视图状态，默认不进入 BCS 文档导出包，也不参与 Obsidian JsonCanvas 语义：

* 节点 UI 状态：`canvas-node-ui-state-v1`（如 `pinned`、`colorLocked`、Markdown 字号）、旧兼容 `canvas-node-pin-state-v1`。
* 外观与交互偏好：`canvas-appearance-settings-v1`、`canvas-other-settings-v1`、`canvas-custom-shortcuts`。
* 缩放/性能偏好：`canvas-node-layout-zoom-v1`、`canvasMinZoomLimit`、`canvasMaxZoomLimit`、`canvasZoomThresholds`、`canvasZoomMagnetSettings`、`canvasSafeZoneSettings`、`canvas-perf-manual-base-v1`、`canvas-perf-linked-from-other-v1`、`canvasLowDetailEnabled`、`canvasVirtualizationEnabled` 等。
* 视图状态：`canvas-node-maximized-v1`、`canvas-node-last-maximized-v1`、`canvas-scroll-preferences`、`canvas-scrollbar-preload-v1`、`temp-section-scroll:*`、`temp-section-collapsed:*`、`canvas-temp-root-visible:*`、`canvas-temp-expand-state`、`permanent-section-scroll:*`、`permanent-section-expanded:*` 等。

这些状态可以继续留在本地 storage。除非未来明确实现 `settings.json`、完整工作区备份或跨设备同步插件偏好，否则不得把它们写入 `bcs:canvas` 或导出包主体。

### 0.4 流程状态与命名例外
当前存在少量流程状态使用了 `bcs:` 命名，但它们不是 Obsidian JsonCanvas 文档内容：

* `bcs:backup:slot`：单槽备份内容，来自导出 sandbox 的快照。
* `bcs:auto-backup:settings:v1`：自动备份开关、间隔、上次备份时间等流程设置。
* `canvas-import-threshold-v1`：覆盖/增量导入阈值。
* `bcs:legacy-temp-migrated-v1`：一次性迁移标记。

这些 key 可以继续保留；在不做 `settings.json` 的阶段，不需要为它们进行物理迁移。但新增代码必须在语义上区分“文档数据”“流程状态”“插件 UI/偏好状态”。

### 0.5 临时栏目分片增量边界
临时栏目分片后的写入规则如下：

* 临时栏目内容编辑：只写受影响的 `bcs:section:<sectionId>`。
* 临时栏目创建/删除：`bcs:canvas` 作为 JsonCanvas 清单整体重写，同时只 upsert/remove 受影响的 `bcs:section:*`，不得重写无关 section。
* 画布布局、Markdown 节点、连接线：写 `bcs:canvas` 清单，不重写所有 `bcs:section:*`。
* 全量覆盖、清空、恢复、迁移兜底等全局语义操作可以全量重建 BCS 文档。

注意：`bcs:canvas` 是单个 JsonCanvas 清单，整体写入是合理边界；本轮分片优化避免的是“临时栏目内容全量重写”，不是把 JsonCanvas 清单拆碎。

### 0.6 `bcs:section:*` 的插件协议 meta
`bcs:section:*` 是本插件的临时栏目 JSON 协议，不是 Obsidian Canvas 原生节点本体。它可以包含恢复临时栏目所需的最小协议 meta，例如 `sectionMeta.title`、`label`、`source`、`descriptionMd`、`originPermanent`、`descFontSize`、`descDisplayMode`、`descDisplayRows`、`descEditMode`、`descEditRows`、`suppressPlaceholder` 等。

这些字段不属于 `bcs:canvas` 的 JsonCanvas 语义。后续新增字段时必须先判断：若只是插件 UI 偏好或视图状态，应进入独立本地 key；只有服务临时栏目内容恢复、导入、导出、备份、推送、拉取的字段，才允许进入 `bcs:section:*`。

---

## 一、 插件本地存储改造设计

### 1.1 永久栏目主数据及映射表设计 (`identityMap`)
* **真相源归属**：`bcs:perm:main` 是永久栏目主数据的唯一真相源。
* **数据结构组合**：为了保证原子性，`identityMap`（身份映射表）与永久栏目源书签树必须存放在同一个 JSON 中，在导出时也一并输出，严禁拆分成独立文件。
* **物理字段顺序**：字段在 JSON 内的物理存储顺序必须严格契合以下标准：
  1. 说明块 `descriptionMd`
  2. 映射表 `identityMap`
  3. 书签树 `tree` (以及其他辅助元属性如 `fileRole`, `fileNote` 等)
* **最小映射单元**：本地存储的映射单元绑定 Chrome 本地 `chromeId` 与跨设备唯一的 `syncId`，结构为：
  ```json
  {
    "id": "572568", 
    "syncId": "syncId_20260516_hash_aB3xZ9q",
    "tags": [
      { "color": "red", "text": "import" },
      { "color": "blue", "text": "work" }
    ]
  }
  ```
  * `id` 与 `syncId` 共同构成最小绑定单元格。若这两个字段被删除，则该映射条目自然失去意义，需一并清理。
  * `tags` 数组（及其包含的 `color`, `text` 字段）在永久栏目中**只存在于映射表的单元项中**，不会被嵌入到 Chrome 的树节点或 BCS 书签树节点内。

* **绑定与重写规则**：
  1. `syncId` 在普通本地操作时（非导入期间）仅在**新增节点**时由本地生成，一旦绑定，只要该节点未被物理删除，`syncId` 与 `chromeId` 的映射关系终生不得改变。
  2. 节点的重命名（修改 `title`）、移动（修改父级）以及修改链接（修改 `url`）**绝不能**导致 `syncId` 改变。
  3. 从浏览器物理树整树回写 BCS 的任意路径，必须调用 [__verifyAndHealIdentityMap](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/history_html/storageBCS/storageBCS_core.js#L1514) 来校准 `identityMap`。禁止用物理树直接覆盖后丢弃旧 mapping，防止 `syncId` 丢失或重建。

---

### 1.2 临时栏目存储与唯一标号 ID 设计
* **栏目 ID 规则**：临时栏目自身的 `sectionId`（即 `section.id`）使用左上角标号链，且必须保留 `temp-section-` 前缀。
  * 命名示例：`temp-section-A-1`、`temp-section-A-1-1`。
  * 普通链式临时栏目与特殊临时栏目均遵循此规则。
* **卡片项 ID 规则**：临时栏目下各个书签/文件夹项（Item）的 ID，采用防冲突哈希格式：`tempId_YYYYMMDD_hash_xxxxxxx`。
* **嵌套字段关联**：
  1. 书签/文件夹项的 `item.sectionId` 必须与所在临时栏目的 `sectionId` 保持一致。
  2. 当栏目位置发生调整导致左上角标号链改变时，必须统一重写 `section.id`。重写时需通过 [makeUniqueTempSectionId](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/history_html/bookmark_canvas_module.js)（或同等唯一性检测逻辑）进行防撞校验，如果 `newId` 被占用则加上稳定后缀（如 `-2`, `-3`）。
  3. 重写 ID 后，以下关联项必须同步刷新：
     * DOM 壳体 ID (`id` 与 `data-section-id`)
     * 所有子项的 `item.sectionId`
     * 连线数据 (`edges.fromNode` / `edges.toNode`)
     * 导入容器归属 (`containedTempIds`)
     * 折叠与滚动位置状态持久化 Key (`temp-section-collapsed:${sectionId}`, `temp-section-scroll:${sectionId}`)
* **临时栏目 Tag 存储**：临时栏目的标签数据直接以内联对象的形式嵌入到对应的书签/文件夹 JSON 单元（即 `item.tags`）中，跟随节点本身的移动/删除一同流转，不在主表中统一记录。

---

## 二、 手动导入与导出协议

### 2.1 手动导出协议（沙盒隔离机制）
为了防止导出时对当前正在运行的 Live 数据及 Chrome 书签产生写污染，导出必须在独立的**内存沙盒 (Sandbox)** 内进行：
1. 导出前优先构建 export sandbox。
2. 永久栏目数据进入沙盒后，利用 `identityMap` 进行翻译：
   * 将书签树中所有节点及父节点的本地 `id` / `parentId` 值，翻译并替换成其对应的云端稳定 `syncId`。
   * 去除表示 Chrome 本地排序位置的 `index` 字段。
   * 导出的 JSON 树状结构中**不得出现任何 Chrome 本地数字 ID**，但必须保留 `id` 和 `parentId` 的字段名称。
3. 沙盒中导出的 `identityMap` 必须**彻底清除 Chrome 本地 ID**，仅作为节点扩展元数据表使用：只保留带有 `tags`、`note`、`noteColor` 等扩展字段的 `{ "syncId": "...", ...extras }` 条目；没有扩展字段的节点不再单独导出 `identityMap` 条目。导出树本身的 `tree.id` / `tree.parentId` 已经使用 `syncId`，因此导入端以树结构作为 syncId 真相源，再按 `identityMap` 补回扩展元数据。
4. **ID 体系一致性约束**：导出的二级文件（如 `.canvas` 里的 `containedTempIds`，以及导出的 markdown 格式的 `contentNodes`）在导出时也必须转换成 `syncId` 的形态输出，禁止混合输出 Chrome 本地 ID。

---

### 2.2 手动导入协议 (覆盖与增量同步)

#### 2.2.1 覆盖导入形式
* **UI 交互**：覆盖导入在界面上会有二次确认警示框，提示用户此操作将清空本地当前画布。
* **覆盖范围**：覆盖永久栏目主栏（含 `identityMap`、书签树、说明）、永久栏目副本、临时栏目以及 `.canvas`（含 mdNodes, edges 等）。
* **回滚备份策略**：
  * 在进行覆盖导入前，系统必须自动向单槽备份空间写入“导入前的本地备份快照”。
  * 若覆盖过程中抛出任何异常导致导入失败，系统会捕获错误并**自动执行一次单槽备份的恢复导入**。在恢复时，绝不能写当前备份槽，防止正常备份被污染。

#### 2.2.2 覆盖更新执行流程（物理落地）
1. 启用 `beginBookmarkBulkMute` 块静默，防止 Chrome 事件通知引起 DOM/BCS 的逐条副作用。
2. 清空目标 Chrome 书签根目录。
3. 从导入包的快照树重建书签树。其中根节点和顶层固定根按 `folderType`（`bookmarks-bar` -> `1`, `other` -> `2`, `mobile` -> `3`）映射到 Chrome 本地固定 ID。
4. 每次 `chrome.bookmarks.create` 成功后，实时在内存中记录 `导入包节点 id (syncId) -> 返回的 Chrome 物理 id`。
5. 以导入包为**唯一 syncId 来源**重建本地映射表 `identityMap`。
6. 拉取物理 Chrome 树刷新 BCS 并写入存储。

#### 2.2.3 增量更新执行流程（操作 B 算法）
当对比差异未达到设定阈值时执行增量更新。为了防止位置错乱和级联删除，必须按照以下精确时序进行：
1. **DFS 创建与更新 (Create & Update)**：
   * 自顶向下遍历导入快照树。若遇到本地不存在的节点，调用 `chrome.bookmarks.create` 创建，并立即登记在 `syncIdToChromeId` 中。
   * 对比本地已存在节点的 `title` 和 `url`。若有变化，调用 `chrome.bookmarks.update` 原地修改（限制只对非文件夹节点修改 `url`）。
2. **跨父级移动 (Parent Move - Phase 1)**：
   * 收集所有父目录发生变化的节点。调用 `chrome.bookmarks.move` 将它们移动到新父目录下（先统一追加在末尾）。
3. **删除冗余节点 (Delete)**：
   * 遍历本地映射表，凡不在导入包 `expectedSyncIds` 范围内的节点予以删除。对于文件夹节点，调用 `chrome.bookmarks.removeTree` 进行清理。
   * **删除位置设计**：由于步骤 2 先移走了需要“保留并跨越移动”的子节点，此时再删除冗余父文件夹，可确保这些生存子节点不会被 Chrome API 级联删除误杀。
   * 删除完毕后，立即在内存映射表中剔除这些被删节点的绑定关系。
4. **同级重排序 (Sibling Reorder - Phase 2)**：
   * 收集需要重新排序的文件夹。在内存中对文件夹子项创建 `simulatedList`。
   * 遍历期望排序列表，在内存模拟数组中对错位项进行 `splice` 模拟。只有在模拟出的当前下标与预期目标下标不一致时，才调用 `chrome.bookmarks.move(chromeId, { parentId, index: targetIndex })` 进行物理移动。

#### 2.2.4 阈值决策机制（操作 A 算法）
在准备导入前，调用 [__countOverwriteDiff](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/history_html/transfer_AI_sync/import-export-transfer-feature.js#L882) 深度比对本地数据与导入包快照树，并计算精确的 API 写入成本：
* 统计指标包括：`Adds`（新增节点数）、`Deletes`（待删节点数）、`Updates`（内容修改数）以及 `Moves`（父目录移动及同级排序次数）。
* 排序移动的 Moves 估算采用“同级相对位置索引比对”的保守估算算法。
* 决策公式：
  * 若 `threshold === 0`：**强制进入覆盖更新分支**（无视差异大小）。
  * 若 `Adds + Deletes + Updates + Moves >= threshold`（默认值为 300）：判定开销过大，容易触发 Chrome API 频次限制，自动转入**覆盖更新分支**。
  * 若未达阈值：执行**增量更新分支**。

#### 2.2.5 导入强校验与 managed 兼容（操作 B 后置校验）
增量/覆盖操作执行 Chrome 落地后，必须在写回 `bcs:perm:main` 前通过 [bridge.validateImportedIdentityMapAgainstTree](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/history_html/storageBCS/storageBCS_core.js#L1768) 进行质检核对：
1. **防误杀（Ignored Roots）**：针对企业托管环境下可能存在的只读根节点 `managed` (通常为 `chromeId="4"`)，以及其他非标准扩展根节点，必须通过 [__collectIgnoredChromeIdsFromFreshTree](file:///Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main/history_html/storageBCS/storageBCS_core.js#L1826) 自动收集，并在校验中安全跳过。
2. **强一致性校验**：
   * 每一个 Chrome 树节点的物理 `chromeId` 必须有且仅有一个 mapping，不可发生映射丢失或重复。
   * 所有的 `syncId` 必须与导入包的 `expectedSyncIds` 保持一致，防止在此期间重新生成非受信任的 `syncId` 污染同步序列。
3. 校验未通过时，立刻抛出异常，阻止写回永久存储，并触发失败回滚流程。

---

## 三、 Tag 标签系统设计

### 3.1 数据存储分布
* **永久栏目**：每个节点标签存储在映射表的主条目内。示例：`identityMap[*].tags`。
* **临时栏目**：每个节点的标签以内联属性形式存储在书签/文件夹项对象中。示例：`item.tags`。
* **单体标签格式**：`{ "color": "red", "text": "import" }`，其中 `color` 代表色彩标记，`text` 代表用户定义的文本（默认与颜色同名）。

---

### 3.2 UI 交互与渲染规范
* **色彩系统**：提供 7 种标准色：红（red）、橙（orange）、黄（yellow）、绿（green）、蓝（blue）、紫（purple）、灰（grey）。
* **MacOS 访达风格 Tag 面板**：
  * 提供 MacOS Finder 风格的面板选择界面。
  * 用户可在此面板上勾选、添加新文本或通过色盘快速点选。若用户仅点选颜色，文字部分将自动兜底为对应的颜色名称（支持中英文，如 `Red` / `红色`）。
* **面板触发时机**：
  * 悬浮于书签节点上方时，水平引导线右侧的操作触发按钮（水平对齐）可点击召唤面板。
  * 在书签的右键快捷菜单或卡片的批量操作控制条中，点击标签符号（`#`）面板即可浮现。
* **视觉渲染位置**：
  * 在常规模式下，颜色圆片（若有重叠则按叠放效果）显示在“书签/文件夹”水平引导线的左侧，水平对齐。
  * 鼠标悬停在圆片上时显示气泡，标示 Tag 文本。如果横向宽度不足，则自动平移在操作按钮左侧显示。
  * 书签/文件夹的文字显示行数最大限制为 3 行，溢出部分自动以省略号表示，鼠标悬浮时展示全名。

---

### 3.3 搜索与智能过滤 (Tag 模式)
* **标签搜索**：在书签全局搜索区域内，支持使用 `#Red` 或 `#工作` 等带 `#` 前缀的语法精准筛选对应标签的书签，同时常规书签列表中也会把标签彩点一并渲染。
* **动态临时栏目**：支持将筛选出来的特定标签书签自动汇聚，生成一块动态的特殊临时栏目，其本质是通过标签模式提供对底层永久/临时数据的多维透视。

---

## 四、 兼容性与边界防御要求

1. **单文件导入自兼容**：
   * 单文件 JSON 导入仅作为增量素材转换为临时栏目，不能改写真实的 Chrome 书签树。
   * 必须兼容包含根节点、单 Root 或裸书签数组等各种深度的合法 JSON 树。
   * 永久单文件导入时，`identityMap` 中的 tags 只用于数据恢复，不可将其中已失效的旧 Chrome ID 直接塞入本地永久绑定映射表中。
2. **强制覆盖标识**：`threshold: 0` 具有最高优先级，只要设定为 `0` 则绝对避开增量对比，强制进行物理擦除与重建。
3. **静默机制保障**：所有的增量/全量更新 API 写路径，必须在 `muteSession` 作用域下开展。期间 mapping 的变化由同步同步进程自己处理，不依赖 Chrome 的创建/删除事件监听做反射式写入，防止事件回调产生写入死循环或竞争漏标。
4. **Legcy IDs 清理**：旧版本的临时栏目 ID 正则（包括带有数字自增、`tempSecId_` 开头、以及在创建过渡期间可能遗留的 `temp-section-pending-`）均会在加载时统一清理并重写为唯一标号链 ID，防止遗留脏数据引发 edge 连线错位。
