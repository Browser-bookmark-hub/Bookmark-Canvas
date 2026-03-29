# Chrome Bookmarks API 严格对齐执行计划书

更新时间：2026-03-29  
适用阶段：测试阶段（未上线）  
执行原则：后续改造按本文件推进，不再另起分叉方案。

## 1. 目标（最终状态）

1. 永久栏目树结构以 `chrome.bookmarks.getTree()` 返回结构为唯一真相源（raw shape），不做字段改写。
2. 同步导出/导入中的永久树，与 Chrome API 结构保持一致。
3. 临时栏目相关 JSON 的导入导出行为明确统一：
   - 既支持通用书签 JSON（数组/Chrome roots 等）。
   - 也支持书签画布自己的 temporary section JSON 协议（`sectionType: "temporary"` + `items`）。
4. 保留现有交互能力（右键菜单、批量操作、拖拽、监听更新、同步流程），不牺牲已有功能。
5. 不加回滚开关（当前为测试阶段，按一次性收敛执行）。

## 2. 当前事实（已核对）

1. 同步线路目前仅保留 JSON：`history_html/sync/obsidian-git-sync.js` 中 `OBSIDIAN_EXPORT_FORMATS = new Set(['json'])`。
2. 非同步线路仍保留 `visual / visual-no-icon / json`：`history_html/bookmark_canvas_module.js` 中 `__CANVAS_OBSIDIAN_EXPORT_FORMATS`。
3. 永久树主链已改为 raw clone：
   - `__normalizePermanentTreeSnapshotForProtocol` 兼容保留，但语义已收敛为 raw clone。
   - `CanvasProtocolBridge` 新增 `clonePermanentTreeSnapshotRaw`，同步优先走该方法。
4. 永久 JSON 协议 `tree` 已改为 raw root object 输出（保持与 Chrome API 结构对齐）。
5. 临时栏目运行态仍使用内部 `items` 结构；但“书签文件 -> JSON”入口已支持 temporary section JSON 协议识别与导入。
6. 右键与主要交互链路主要依赖 DOM dataset（`nodeId/nodeUrl/nodeType/treeType/sectionId`），并不直接依赖 `folderType/syncing`，具备“数据层收敛、交互层稳定”的改造条件。
7. 同步本地快照构建时，临时栏目优先使用 `bcs:temp-state-snapshot` 已存储原始 JSON 字符串，不再默认用运行态重建覆盖。
8. 远端快照应用到本地时，不再对临时栏目做额外过滤/重写；以“云端是什么，本地就写什么（通过最小合法校验）”为准。
9. 仅在 payload 损坏或缺失时，才走兼容归一化兜底（保护旧数据与异常数据）。

## 3. 你关心的问题（结论）

问题：`临时栏目单独拿出来 JSON，是否无法导入？`

结论（按当前代码）：

1. `画布快照 -> JSON` 入口（`package-json`）仍只接受“画布快照备份 JSON”结构（这是设计边界，不是缺陷）。
2. `书签文件 -> JSON` 入口（`importJsonBookmarks`）现在可导入：
   - 通用书签 JSON；
   - temporary section JSON 协议（`sectionType: "temporary"` / `items`）。
3. 因此“临时栏目单文件 JSON”现在已有可用导入路径（走“书签文件 -> JSON”入口）。

## 4. 改造边界与约束

1. 仅做结构对齐与导入能力补齐，不做无关 UI 重构。
2. 不删除非同步线路的 visual/visual-no-icon 能力。
3. 不改动右键保护策略与行为规则（只做必要适配，不降级能力）。
4. 不引入回滚开关（按测试阶段一次性推进）。

## 5. 执行阶段与清单

## 阶段 A：永久树 raw 化（同步与导出主链）

- [x] A1. 新增“raw 深拷贝”工具函数，仅做 JSON clone，不做 normalize 改写。
- [x] A2. `getPermanentTreeSnapshotForSync` 改为返回 raw tree snapshot（保留空树校验）。
- [x] A3. 永久 section JSON 协议中的 `tree` 改为 raw-compatible 输出（保留协议壳，不改写节点字段）。
- [x] A4. 导入读取保持兼容旧格式（旧 `folderType/syncing`、旧裁剪树仍可读）。
- [x] A5. 移除“以 normalize 作为主链输入”的路径依赖，仅在必要的兼容读场景使用。

验收：

1. 同步快照中的 `permanentTreeSnapshot` 可与 `chrome.bookmarks.getTree()` 结果同构对齐。
2. 永久栏目导出后再导入，树结构不丢字段、不额外注入字段。

## 阶段 B：临时栏目 JSON 导入能力补齐

- [x] B1. 在 `importJsonBookmarks` 增加 temporary section 协议识别：
  - 识别 `format: "bookmark-canvas-section"` + `sectionType: "temporary"` + `items`。
- [x] B2. 对 temporary section 协议走专用转换，正确读取 `items` 树，不走通用“单对象”降级逻辑。
- [x] B2.1. temporary section 协议元数据保留：`descriptionMd / sequenceNumber / originPermanent / updatedAt`。
- [x] B3. 明确两类 JSON 导入路径职责：
  - `package-json`：画布快照包导入。
  - `json`（书签文件）：通用书签 JSON + temporary section JSON。
- [x] B4. 补齐提示文案，避免用户误用入口。

验收：

1. 单个 temporary section `.json` 可直接通过“书签文件 -> JSON”导入并完整还原树结构。
2. 现有 Chrome/Firefox/通用 JSON 导入能力不回退。

## 阶段 C：协议一致性收敛

- [x] C1. 永久/临时导出协议文档更新（字段说明、兼容策略、示例）。
- [x] C2. 同步模块与导入模块统一引用同一份树结构约定（避免各自再定义）。
- [x] C3. 校对 `.canvas`、空白栏目 markdown 镜像与导入规则文档的一致性措辞。

验收：

1. 文档与实际导入导出结果一致。
2. 关键路径不再依赖“隐式 normalize”。

## 阶段 D：回归测试（必须通过）

- [x] D0. 自动校验：`node --check history_html/bookmark_canvas_module.js` 与 `node --check history_html/sync/obsidian-git-sync.js` 通过。
- [ ] D1. 永久栏目：右键打开/编辑/剪切复制粘贴/删除。
- [ ] D2. 临时栏目：拖拽移动、层级调整、分裂/合并相关能力。
- [ ] D3. 监听链路：`onCreated/onRemoved/onChanged/onMoved` 触发后的 UI 刷新。
- [ ] D4. 同步：push/pull、增量与覆盖路径、冲突确认路径。
- [ ] D5. 导入导出：
  - 画布快照 JSON/ZIP/Folder。
  - 书签 HTML/JSON。
  - 单 temporary section JSON。

执行清单：`docs/Chrome-Bookmarks-API对齐回归清单.md`

通过标准：

1. 无明显功能回归。
2. 无阻断级报错。
3. 树结构对齐目标达成。

## 阶段 E：同步链路去映射（临时栏目直通）

- [x] E1. `buildLocalSnapshot` 改为临时栏目 raw 优先直通（`bcs:temp-state-snapshot` 原文优先）。
- [x] E2. `normalizeSnapshot` 保留合法 raw 字符串，不做无差别重序列化。
- [x] E3. `buildSnapshotForRemoteLocalApply` 取消临时栏目二次过滤重写。
- [x] E4. 远端 folder 解析仅在缺失临时栏目 raw 时才用 `tempState` 兜底填充。
- [ ] E5. 手工回归：push/pull 后对比本地与云端临时栏目 JSON（语义与结构一致）。

验收：

1. 临时栏目在同步主链满足“本地 -> 云端 -> 本地”同构直通。
2. 不破坏既有保护：损坏数据仍可兜底修复，非损坏数据不被额外改写。

## 6. 实施顺序（固定）

1. 先做阶段 A（永久树 raw 主链）。
2. 再做阶段 B（临时栏目单 JSON 导入补齐）。
3. 再做阶段 C（文档与协议一致性）。
4. 再做阶段 E（同步链路去映射，临时栏目直通）。
5. 最后做阶段 D（整体验证与收口）。

## 7. 变更记录（执行时填写）

- [x] 第 1 次提交：阶段 A（2026-03-29，raw 主链落地）
- [x] 第 2 次提交：阶段 B（2026-03-29，temporary section JSON 导入识别）
- [x] 第 3 次提交：阶段 C（2026-03-29，文档与协议说明对齐）
- [x] 第 4 次提交：阶段 E（2026-03-29，同步临时栏目直通）
- [ ] 第 5 次提交：阶段 D（仅测试/文档收口）
