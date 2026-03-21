# Native Text 分片对齐执行计划（立即实施）

日期：2026-03-24
范围：代码层改造（不依赖文档迁移）
目标：补齐“空白栏目 native text 仍是双轨”的最后缺口，使其进入 BCS 分片主链路。

---

## 1. 问题定义

当前状态：
- 临时栏目、永久栏目、画布结构基本已对齐。
- 空白栏目中的普通 markdown 卡片已进入 `bcs:md:*`。
- 空白栏目中的 native text 卡片仍主要依赖 `.canvas text` 节点 + 导出镜像，不在 `bcs:md:*` 主链路里稳定闭环。

影响：
- 本地存储与导出/同步模型仍存在双轨。
- 审计脚本在 `md_ids_aligned` 一类检查中容易出现偏差。

---

## 2. 实施目标

1. native text 节点进入 `bcs:md:*` 分片读写链路。
2. native text 的 `_filePath` 映射进入分片守门员，参与脏标记与清脏。
3. 从 BCS 反序列化时可还原 native text 节点，不退化为普通 md 节点。
4. 保持 `.canvas` 仍为布局/连线镜像承载，不破坏现有导出兼容。

---

## 3. 代码改造点

1. `__collectBcsFileRefsFromState`
- 新增 `nativeTextPaths`、`nativeTextPathById` 输出。
- native text 节点在计算文件名后写入 path 映射，而非仅加入 `nativeTextNodes`。

2. `__buildBcsMdPayloadFromNode`
- 不再把 native text 直接排除。
- native text payload 使用：
  - `id`
  - `markdownSource`（由 `__buildCanvasNativeTextMirrorMarkdown` 生成）
  - `subtype` / `source`
  - 可选 `createdAt` / `updatedAt`

3. `__saveCanvasTempStateToBcsStorage`
- `mdIdSet/mdById` 包含 native text（仅排除 import-container）。
- 写入 md 分片时，`filePath` 优先 `mdNodePathById`，再 fallback `nativeTextPathById`。

4. `__buildCanvasTempStateFromBcsStorage`
- md 分片恢复时识别 native payload（`subtype/source`）。
- 对 native payload 的 `markdownSource` 执行 `__extractCanvasNativeTextMetaCommentBlock`，恢复 `text`。
- 构造 `subtype: canvas-native-text`、`source: obsidian-canvas-text` 节点。

---

## 4. 验收标准（代码层）

1. 语法校验通过：
- `node --check history_html/bookmark_canvas_module.js`

2. 结构性验收：
- native text 对应 ID 能出现在 `bcs:md:*`。
- native text 对应 md 分片存在 `_filePath`。
- 从 BCS 反序列化后 native text 节点仍为 `canvas-native-text`，且 `text` 正确。

3. 同步链路验收：
- `buildDirtySyncFilesFromShards()` 对 native text 的变更能给出路径。
- `clearShardedDirtyBySyncedFiles()` 后 native text 对应分片可清脏。

---

## 5. 非目标

1. 不改视觉模式/视觉无图标的 UI 表现。
2. 不改永久栏目 API 真相源策略。
3. 不做历史兼容层回退（按当前“仅新分片”方向执行）。

---

## 6. 执行顺序

1. 先改 `bookmark_canvas_module.js` 四个函数。
2. 跑语法检查。
3. 输出最小 F12 校验脚本（S1/S2/S3）用于你侧验证。
