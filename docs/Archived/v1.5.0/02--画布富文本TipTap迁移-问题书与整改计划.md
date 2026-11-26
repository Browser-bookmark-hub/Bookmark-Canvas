# 画布富文本 TipTap 迁移：问题书与整改实施计划

状态：历史基线问题书，后续已部分修复；以下清单不代表当前 HEAD 的全部现状。
基线 Commit：`fe3b4078fbd802b044acd5343069dd1f1d07bd17`（`feat(富文本): 空白栏目 与 栏目备注 转tiptap开源三方库`）  
审计范围：
- [`tools/build-tiptap-bundle/package.json`](../../../tools/build-tiptap-bundle/package.json) / [`build.js`](../../../tools/build-tiptap-bundle/build.js) / [`entry.js`](../../../tools/build-tiptap-bundle/entry.js)
- [`Bookmark-Canvas-main/history_html/history.html`](../../../Bookmark-Canvas-main/history_html/history.html)
- [`Bookmark-Canvas-main/history_html/bookmark_canvas_module.js`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js)
- [`Bookmark-Canvas-main/history_html/bookmark_canvas.css`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas.css)
- [`Bookmark-Canvas-main/history_html/canvas_obsidian_style.css`](../../../Bookmark-Canvas-main/history_html/canvas_obsidian_style.css)
- [`Bookmark-Canvas-main/history_html/storageBCS/storageBCS_core.js`](../../../Bookmark-Canvas-main/history_html/storageBCS/storageBCS_core.js)
- [`Bookmark-Canvas-main/history_html/vendor/obsidian-markdown.js`](../../../Bookmark-Canvas-main/history_html/vendor/obsidian-markdown.js) / `canvas-editor-tiptap.bundle.js`

---

## 2026-11-13 修复补充（基于 `4a7210e`）

本轮修复临时备注失焦未保存、实体文本反复解码、`details/summary` 编辑降级、表格竖线串列、引用/嵌套待办勾错位置，以及永久副本虚拟化后的 document 监听器残留。未修改的编辑文档保留原始 Markdown；虚拟化提交草稿与删除销毁分开处理。

构建和自动化回归说明见 [`tools/build-tiptap-bundle/README.md`](../../../tools/build-tiptap-bundle/README.md)。测试覆盖当前引擎与备注生产逻辑，不代替真实浏览器 IME、拖选和大规模内存/性能验收。官方 Markdown 扩展迁移、完整 Obsidian 扩展语法和全链路增量持久化仍属于后续事项。

---

## 一、背景与总体评估

Commit `fe3b407` 将原有基于原生 `contenteditable`、手工 `Selection/Range` 与正则实时 DOM 重写的编辑器，重构为基于 **ProseMirror + TipTap v3（`^3.33.0`）** 的富文本方案（[`bookmark_canvas_module.js`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js) 净减少 3,413 行）。该技术选型本身完全正确，能够从根源解决中文输入法（IME）吞字符、光标漂移和脆弱的原生撤销栈问题。

但就当前落盘代码而言，本次迁移仍处于**“可用但半完成”的过渡状态**：
1. **同一工程内两套生命周期架构分裂**：临时/永久栏目备注已实现“只读态静态 HTML + 编辑态懒挂载 + 退出销毁”；而空白栏目（`mdNodes`）仍是“视口内全量常驻实例化（`editable: true`）”，且虚拟化移出未销毁，导致多空白卡场景内存与交互同步成本放大。
2. **存在若干直接影响稳定性的 P0 运行时缺陷**：调用越域函数导致 `ReferenceError` 崩溃、DOM `focus`/`blur` 不冒泡导致状态卡死、快捷键双倍撤销、清空按钮写回旧数据、初始化异常清库等。
3. **存在 TipTap v3 API 错配与数据往返断层**：`history` 选项在 v3 已失效、沿用已弃用的 `tiptap-markdown@0.9.0` 形成三套 Markdown 解析并存、对齐节点与内联 Markdown 混排重载损坏、`obsidian://` 协议被拦、清洗器误剥 `<pre>` 与 TaskList 属性。

---

## 二、问题清单（Issue Register）

> 优先级定义：**P0**（崩溃 / 丢数据 / 功能阻塞 / 持续泄漏）、**P1**（兼容回归 / 交互错乱 / 明显性能瓶颈）、**P2**（架构债务 / 代码清洁度 / 长期演进）。

### A. P0 级关键缺陷（必须优先止血）

#### ISSUE-01：`markExpandedSourceToolbarInteraction()` 作用域错用导致运行时 `ReferenceError`
- **位置**：[`Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L14878`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L14878)（定义位于 [`#L18505`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L18505)）
- **根因**：空白卡片内部的字体改色浮层 `mousedown` 监听调用了 `markExpandedSourceToolbarInteraction()`，但该函数仅定义在 `__mountMdCloneDescriptionEditor` 闭包内部；空白卡片作用域内对应的函数是 `markToolbarInteraction()`（`#L14616`）。
- **后果**：在空白卡片点击字体改色浮层立即抛出未捕获 `ReferenceError`，且无法置位 `suppressBlurExit`。

#### ISSUE-02：`focus` / `blur` DOM 不冒泡导致编辑态失效、`editor.blur()` 无效与状态锁死
- **位置**：
  - [`bookmark_canvas_module.js#L15458, #L18312`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L15458)（未传入 `onFocus` / `onBlur`）
  - [`#L15554, #L15559, #L15937, #L20491`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L15554)（绑定外层容器冒泡 `focus`/`blur`）
  - [`#L15574, #L15924`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L15574)（调用 `editor.blur()`）
  - [`clearMdSelection#L13931-L13946`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L13931-L13946)
- **根因**：TipTap 实际聚焦元素是子元素 `.tiptap.ProseMirror`（`contenteditable="true"`），而外层 `editor` / `descriptionText` 不可聚焦（描述框更显式设 `contentEditable = 'false'` 于 `#L18310`）。浏览器 `focus`/`blur` 事件**不会冒泡**：
  1. 外层监听器收不到内部焦点变化，导致失焦保存与退出编辑链路失灵；
  2. `Escape`（`#L15574`）和 `pauseEditForCtrl`（`#L15924`）调用 `editor.blur()` 为空操作；
  3. 点击画布空白处触发 `clearMdSelection()` 时只移除 DOM 类名并置 `prevNode.isEditing = false`，未调用 `exitEditMode()` 或 `.tiptapInstance.blur()`，导致闭包变量 `isInEditMode` 卡死为 `true`，后续单击/双击卡片无法再次进入编辑。

#### ISSUE-03：空白卡片 `Ctrl/Cmd+Z` / `Ctrl+Y` 触发双重撤销/重做
- **位置**：[`prosemirror-view/src/input.ts#L142-L145`](../../../tools/build-tiptap-bundle/node_modules/prosemirror-view/src/input.ts#L142-L145) + [`bookmark_canvas_module.js#L15577-L15594`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L15577-L15594)
- **根因**：ProseMirror 内部 `UndoRedo` keymap 命中后调用 `event.preventDefault()` 但**不调用 `stopPropagation()`**；事件继续冒泡到外层 `editor` 的 `keydown` 监听时，代码未检查 `e.defaultPrevented`，紧接着又手动调了一次 `editor.__tiptapInstance.undo()` / `.redo()`。
- **后果**：单次快捷键会同时撤销或重做两步。

#### ISSUE-04：清空说明直接 `innerHTML = ''` 破坏编辑器并引发“数据复活”
- **位置**：[`clearTempDescription#L20428-L20444`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L20428-L20444)、[`clearPermanentTip#L24414-L24422`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L24414-L24422)
- **根因**：在编辑态挂载着 TipTap 实例期间直接执行 `innerHTML = ''` 抹除 `.ProseMirror` DOM，既未调用 `cancelTiptap()` / 清空文档，也未清理实例引用；更严重的是 `clearPermanentTip` 随即调用 `persistTip()` → `syncTipDraft()`（`#L24244`），检测到 `tipText.__tiptapInstance` 仍存在，直接从内存中读取未清空的旧 Markdown 重新写回存储与页面。

#### ISSUE-05：虚拟化离屏回收、节点删除与全局事件未销毁，造成 TipTap 实例与监听泄漏
- **位置**：
  - 视口回收：[`bookmark_canvas_module.js#L35209-L35212, #L37006-L37009`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L35209-L35212) 与 [`__unloadMdNodeContentInPlace#L14321-L14330`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L14321-L14330)
  - 单卡删除：[`removeMdNode#L16986-L16992`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L16986-L16992)、`removeTempNode`（`#L23394`）、`removePermanentSectionCopy`（`#L12689`）
  - 实时同步与清空重置：[`#L25495, #L25508`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L25495-L25508)、`_doClearCanvas`（`#L23526, #L23536, #L23565`）、`executeClickToClearDeletion`（`#L23872, #L23883`）、[`storageBCS_core.js#L4712-L4713`](../../../Bookmark-Canvas-main/history_html/storageBCS/storageBCS_core.js#L4712-L4713)
  - 全局监听泄漏：[`#L24473-L24480`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L24473-L24480)
- **根因**：全仓仅有 `__resetMdNodeElementForRender`（`#L14279`）调用了 `__cleanupMdNodeElementLifecycle(el)`。
  1. 视口虚拟化移出屏幕时只给空白卡加 `.low-detail-active` 后直接 `el.remove()`，不销毁 `EditorView`、`DOMObserver` 与 `fullscreenObserver`；卡片反复进出视口持续叠加泄漏；
  2. 永久栏目 `bindPermanentSectionTipBehavior` 每次绑卡都会在 `document` 捕获阶段新增 `mousedown` 监听（且 `#L24476` 误写了 `.temp-node-description-controls`），删卡/重绘时永不解绑。

#### ISSUE-06：图片与表格 Schema 缺失，截图粘贴与拖放插入损坏
- **位置**：[`entry.js#L1-L18`](../../../tools/build-tiptap-bundle/entry.js#L1-L18)、[`bookmark_canvas_module.js#L7755-L7795, #L15807-L15809, #L18488-L18490`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L7755-L7795)
- **根因**：
  1. Bundle 未安装和注册 `@tiptap/extension-image` 与 `@tiptap/extension-table`；
  2. 粘贴截图调用 `tiptapInstance.insertContent('![alt](data:...)')`，TipTap 默认按 HTML 解析而非 Markdown 解析，直接把原始 Base64 文本字符串插入正文，且卡片重新解析后无 `image` 节点会被 Schema 静默丢弃；
  3. 拖放反馈逻辑（`#L7755, #L7792`）判断 `document.activeElement === editorEl`，在 `.ProseMirror` 聚焦时恒为 `false`。

#### ISSUE-07：初始化异常清库、实时同步覆写与原生节点类型篡改
- **位置**：
  - [`#L15397-L15471`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L15397-L15471)（空白卡失去无 TipTap 降级渲染与可编辑兜底）
  - [`#L18310-L18343`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L18310-L18343)（`mountTiptap` 在 `CanvasTiptapEngine.create` 成功前先执行 `editor.innerHTML = ''`）
  - [`#L25585`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L25585)（跨端同步收到变更时未检查编辑态直接 `renderMdNode` 重建）
  - [`__applyPermanentTipContentRealtimeSync#L26517-L26540`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L26517-L26540)（以 `tipText.contentEditable === 'true'` 判断编辑态，但 TipTap 挂载期间外层是 `'false'`）
  - [`__syncMdNodeFromEditor#L18068-L18082`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L18068-L18082)（无条件覆写 `subtype = CANVAS_PLUGIN_MARKDOWN_SUBTYPE` / `canvasTextKind = 'blank'`，篡改导入的 `canvas-native-text` 节点）。

---

### B. P1 级兼容性、数据往返与严谨性问题

#### ISSUE-08：空白卡“三重序列化”与 220ms 全画布 O(N) 扫描（性能核心地雷）
- **位置**：[`entry.js#L185-L194`](../../../tools/build-tiptap-bundle/entry.js#L185-L194)、[`bookmark_canvas_module.js#L15461-L15463, #L15549-L15551, #L18068-L18083, #L6285-L6300`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L15461-L15463)、[`storageBCS_core.js#L6763-L6808`](../../../Bookmark-Canvas-main/history_html/storageBCS/storageBCS_core.js#L6763-L6808)
- **根因**：空白卡单次键入触发：① TipTap `onUpdate` 序列化（外层丢弃 `(md, html)` 参数）→ ② `__syncMdNodeFromEditor` 二次序列化 → ③ 冒泡原生 `input` 事件第三次触发保存；同时 220ms 防抖保存调用 `__buildCanvasManifestPatchState`，内部 `__updateAllMdNodeLowDetailOverlays` 与协议标准化函数都会扫描全量 `CanvasState.mdNodes`。

#### ISSUE-09：空白卡片 Eager 全量实例化 & 同步 Bundle 阻塞首屏
- **位置**：[`bookmark_canvas_module.js#L14449, #L15458-L15460, #L14321-L14330`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L14449)、[`history.html#L48-L50`](../../../Bookmark-Canvas-main/history_html/history.html#L48-L50)
- **根因**：
  1. 空白卡即使在只读浏览、传递 `shellOnly` 或进入 `low-detail-active` 时，依然维持每个卡片一套 `EditorView` + `DOMObserver` + `markdownit` + `contenteditable="true"`；
  2. `<head>` 同步阻塞加载 `marked.min.js`（35,511 B）+ `obsidian-markdown.js`（11,191 B）+ `canvas-editor-tiptap.bundle.js`（586,742 B），合计 **633,444 B（~619 KB）**，即便从未打开或编辑卡片也阻塞首屏。

#### ISSUE-10：TipTap v3 `StarterKit` 配置项错配（`history` → `undoRedo` / `trailingNode`）
- **位置**：[`tools/build-tiptap-bundle/entry.js#L139-L158`](../../../tools/build-tiptap-bundle/entry.js#L139-L158)
- **根因**：StarterKit v3 将 `history` 更名为 `undoRedo`；传入 `history: { depth: 300, newGroupDelay: 300 }` 已被实测静默忽略（回退 `100 / 500`）；同时 v3 默认启用的 `TrailingNode` 未显式关闭，尾部块后会自动附加空 `<p></p>`。

#### ISSUE-11：已弃用 `tiptap-markdown@0.9.0` 叠加插件规则、三引擎并存及属性未转义
- **位置**：[`tools/build-tiptap-bundle/entry.js#L12, #L26-L45, #L68-L113`](../../../tools/build-tiptap-bundle/entry.js#L12)、[`MarkdownParser.js#L24-L28`](../../../tools/build-tiptap-bundle/node_modules/tiptap-markdown/src/parse/MarkdownParser.js#L24-L28)
- **根因**：
  1. 社区包 `tiptap-markdown` 已停止维护并推荐迁移官方 `@tiptap/markdown`；
  2. `MarkdownParser.parse()` 每次解析都会遍历调用 `setup(md)`，而 `CustomHighlight`（`#L42`）无幂等保护直接 `md.use(markdownItMark)`，实测多次解析会重复堆积多份 `'mark'` 解析规则（内置 `taskListPlugin` 同理）；
  3. `CustomParagraph` / `CustomHeading` 在非靠左对齐时输出 `<p style="text-align: center">` / `<hN style="...">` 包裹 `state.renderInline(node)`。CommonMark 解析器会把以 `<p`/`<h` 开头的行识别为 HTML Block，**导致内部 `**bold**`、`==highlight==`、链接在重载后退化为纯文本字面量**；
  4. `CustomHighlight`（`#L27`）与对齐模板直接拼接属性字符串未做转义，配合 `html: true` 存在 HTML 属性逃逸风险。

#### ISSUE-12：HTML 清洗器与静态描述渲染破坏 TipTap 输出结构
- **位置**：[`__sanitizeCanvasRichTextHtml#L17014-L17074`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L17014-L17074)、[`__coerceDescriptionSourceToHtml#L17562-L17572`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L17562-L17572)
- **根因**：
  1. `allowedTags` 缺失 `'pre'`、`'label'`，`allowedAttrs` 缺失 `'data-type'`、`'data-checked'`、`'data-color'`，清洗后会把围栏代码块 `<pre><code>` 降级为文本节点并破坏 TaskList；
  2. `__coerceDescriptionSourceToHtml` 在命中 HTML 标签但无块级 Markdown 前缀（`looksLikeHtml && !looksLikeMarkdown`）时直接原样返回，遗漏内联 Markdown 语法解析。

#### ISSUE-13：Obsidian 链接协议拦截 & 旧版/扩展语法兼容断层
- **位置**：[`entry.js#L153-L155`](../../../tools/build-tiptap-bundle/entry.js#L153-L155)、[`extension-link/dist/index.js#L309-L327`](../../../tools/build-tiptap-bundle/node_modules/@tiptap/extension-link/dist/index.js#L309-L327)
- **根因**：`Link` 扩展未传入 `protocols: ['obsidian', 'chrome-extension']`，`obsidian://` 深度链接会被校验拦截；旧数据与预置卡中的 `<font color>`、`<center>`、`align="..."` 以及 [`obsidian-markdown.js`](../../../Bookmark-Canvas-main/history_html/vendor/obsidian-markdown.js) 支持的 `[[wikilink]]`、`> [!callout]` 在 TipTap 载入后被剥除或退化。

#### ISSUE-14：标题折叠彻底失效
- **位置**：[`__applyHeadingCollapse#L18202`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L18202)、[`__handleHeadingCollapseClick#L18254-L18276`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L18254-L18276)
- **根因**：一方面 `#L18257` 断言 `heading.parentNode !== editorEl`（TipTap 下标题父级是 `.tiptap.ProseMirror`），另一方面空白卡渲染流程从未调用 `__applyHeadingCollapse`，根本没有注入 `data-md-collapsible="true"`。

#### ISSUE-15：IME 组合守卫缺失、`Escape` 行为分裂与自定义 `copy` 冲突
- **位置**：[`bookmark_canvas_module.js#L15549, #L15572, #L15658-L15736, #L20485, #L20510, #L24465, #L24483`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L15549)
- **根因**：外部 `input`/`Escape` 缺 `e.isComposing` 守卫（临时栏目按 Esc 取消中文候选直接丢全文）；临时栏目 Esc 放弃编辑（`commit: false`）而永久栏目提交保存（`commit: true`）；冒泡 `copy` 监听与 TipTap 原生 `transformCopiedText: true` 竞争且仍沿用已失效的 `.md-task-item` 类。

#### ISSUE-16：工具栏状态零同步 & CSS 样式 regression
- **位置**：[`bookmark_canvas_module.js`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js)、[`bookmark_canvas.css#L329, #L645, #L649, #L2082, #L3311-L3320, #L6655-L6855`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas.css#L329)
- **根因**：
  1. `onSelectionUpdate` 与 `editor.isActive(...)` 全文 **0 次调用**，移动光标或选区切换时格式按钮高亮不会更新；字号（`editor.style.fontSize`）无法进入 TipTap 撤销栈；
  2. 占位符依赖外层 `.md-wysiwyg-editor:empty::before`（挂载 `.ProseMirror` 后 `:empty` 恒为假，且未安装 `@tiptap/extension-placeholder`）；
  3. 暗黑模式 `#L649` 与 `#L2082` 遗漏 `:not(pre) >` 隔离，污染 `<pre><code>`；`ul[data-type="taskList"]`（`#L6828-L6850`）缺失已勾选删除线与暗色灰化；TipTap 行内背景高亮点缀（`color: inherit`）在深色模式下缺少可读性保障。

---

### C. P2 级技术债与代码清洁度问题

#### ISSUE-17：半迁移死代码、重复逻辑与 `\u200B` 清洗不对称
- **位置**：
  - `saveSelection` 空转监听：[`#L15475-L15487, #L18458-L18469`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L15475-L15487)
  - 旧选区与 `\u200B` 注入死代码：[`#L15233-L15394, #L15738-L15785, #L18430-L18455`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L15233-L15394)
  - 重复分支与空桩：`#L19338-L19341` 与 `#L19376-L19379`（重复 `action === 'md-format-close'`）；`#L19404-L19405`（空桩 `recordSnapshot` / `clearUndoHistory`）；`#L15632, #L19388`（旧 `.md-task-checkbox`）
  - 工具栏与浮层代码在空白卡（`#L14616-L15400`）与克隆描述编辑器（`#L18495-L19408`）间大段复制；
  - [`storageBCS_core.js#L7477`](../../../Bookmark-Canvas-main/history_html/storageBCS/storageBCS_core.js#L7477) 在临时备注规范化中剔除了 `\u200B`，但永久栏目多条直读 `descriptionMd` 路径（如 `#L823-L827`）未作对称清洗；
  - Resize（`makeTempNodeResizable` / `applyCtrlResize`）未走 `requestAnimationFrame` 节流，长文卡片拖拽缩放直接重排 `white-space: pre-wrap`。

---

## 三、分阶段整改实施计划

### 阶段 1：P0 止血修复（崩溃、失焦/清空/双撤销、泄漏、异常兜底）

**目标**：消除所有线上阻塞型 Bug、内存泄漏与数据覆写风险，可作为热修 PR 独立交付。

1. **修复运行时崩溃与事件/状态机断裂**
   - 将 [`#L14878`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L14878) 改回 `markToolbarInteraction()`。
   - 在 [`#L15458`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L15458) 与 [`#L18312`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L18312) 的 `CanvasTiptapEngine.create` 调用中显式接入 `onFocus` 与 `onBlur`，移除外层无用的冒泡 `focus`/`blur` 绑定（或改用 `focusin`/`focusout` 并配合 `container.contains(e.relatedTarget)` 守卫）。
   - 为外层包装 `editor.blur` 做代理转发至 `editor.__tiptapInstance.blur()`（或统一改为调用 `tiptapInstance.blur()`）；修复 `clearMdSelection()`（`#L13931`），当选中卡处于编辑态时显式触发退出回调或失焦清理。
2. **修复双倍撤销、IME 保护与清空动作**
   - 在 [`#L15572-L15594`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L15572-L15594) 头部增加 `if (e.isComposing || e.defaultPrevented) return;`，删除重复的 `undo()` / `redo()` 二次派发，统一交由 ProseMirror 内置 `UndoRedo` 处理（或在自定义菜单按钮点击时才调 `.undo()` / `.redo()`）；同时为 `#L15549, #L20485, #L24465` 补全 `e.isComposing` 守卫，并统一临时/永久栏目 `Escape` 行为（建议先关闭二级弹层、或确认提交/退出规则一致）。
   - 修改 `clearTempDescription`（`#L20428`）与 `clearPermanentTip`（`#L24414`）：若 TipTap 实例存在，先调用 `cancelTiptap()`（或 `setMarkdown('', false)` 并销毁再渲染空静态态），禁止直接 `innerHTML = ''` 后让 `persistTip()` 从残留实例回读旧内容。
3. **封堵实例、观察者与全局事件泄漏**
   - 抽取统一销毁 helper（扩展 `__cleanupMdNodeElementLifecycle` 与备注编辑器清理函数），在以下全部路径强制调用：
     - 视口虚拟化回收（`#L35209, #L37007` 及 temp/copy 节点回收）；
     - `removeMdNode`（`#L16986`）、`removeTempNode`（`#L23394`）、`removePermanentSectionCopy`（`#L12689`）；
     - 远端实时同步移除/重绘（`#L25495, #L25508`）及 `_doClearCanvas`、`executeClickToClearDeletion`、`__resetCanvasDomAndStateForImport`、`showCanvasNodeLoadError`、`__renderTempNodeImpl` 重建。
   - 为永久栏目 `bindPermanentSectionTipBehavior` 注册在 `document` 上的 `mousedown` 绑定保存句柄并在销毁时 `removeEventListener`（同时修正 `#L24476` 选择器），或在画布层面改为单全局委托；[`entry.js#L285, #L314`](../../../tools/build-tiptap-bundle/entry.js#L285) 的 `requestAnimationFrame` 内增加 `if (this.isDestroyed || !container.isConnected) return;`。
4. **修复同步覆写与初始化失败兜底**
   - `__mountMdCloneDescriptionEditor#L18311` 改为**确认 `CanvasTiptapEngine.create` 成功返回后再替换静态 DOM**，失败时保留并回退原有静态/原生编辑态。
   - 远端实时同步（`#L25585`）增加编辑中跳过或平滑合并守卫；永久栏目 [`__applyPermanentTipContentRealtimeSync#L26517, #L26539`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L26517) 改用 `tipContainer.classList.contains('editing') || tipText.__tiptapInstance` 判定编辑态。
   - `__syncMdNodeFromEditor#L18075` 仅在非原生节点时默认设为 `CANVAS_PLUGIN_MARKDOWN_SUBTYPE`，保留已有 `CANVAS_NATIVE_TEXT_SUBTYPE`（`__isCanvasNativeTextNode(node)`）不被改写。

---

### 阶段 2：空白卡懒挂载重构与多卡性能优化（对齐大厂 Flyweight 架构）

**目标**：让 200+ 甚至更多空白卡片与带备注栏目卡片在浏览/缩放/输入时都保持极低内存和流畅帧率。

1. **空白卡片全面改造为“静态 HTML + 按需懒挂载”**
   - 抽离通用富文本宿主挂载器，替换目前空白卡“渲染即 `new Editor({ editable: true })`”的模式：
     - **只读展示态 / `shellOnly` / `low-detail-active`**：零 TipTap 实例，直接使用经安全清洗和渲染管线产出的静态 HTML 渲染（`node.html` 或缓存渲染结果），点击链接与复选框可直接在静态态交互同步；
     - **进入编辑态（双击、再次单击、或选中按 `Enter`）**：通过 `CanvasTiptapEngine.create` 在点击坐标 `focusAtCoords` 挂载编辑器（或从单实例/小容量 Editor Pool 复用）；
     - **退出编辑 / 失焦 / 离屏 / `low-detail`**：立即同步最终 Markdown 与 HTML 并 `destroy()` 释放 ProseMirror 与 `MutationObserver`，恢复静态展示态（全画布始终维持 `0` 或 `1` 个活跃 TipTap 实例）。
2. **消灭打字热路径“三重序列化”与高频 O(N) 扫描**
   - 移除 `#L15549` 与 `#L19382` 重复绑定的原生 `editor.addEventListener('input', ...)`，仅以 TipTap `onUpdate(md, html)` 为唯一变更来源；
   - 让 `onUpdate` 传入的 `(md, html)` 直接供同步函数复用（避免再次调用 `getMarkdown()` / `getHTML()`），或将 `getMarkdown()` 移出同步按键路径改为对状态加 dirty 标记并在 220ms 防抖/失焦保存时再序列化一次；
   - 优化 `__buildCanvasManifestPatchState`（`#L6285-L6300`）：文本内容编辑保存时**只更新当前脏节点的低细节快照与规范化字段**，避免每次防抖保存遍历全量 `CanvasState.mdNodes`。
3. **非阻塞加载与 Resize/渲染微调**
   - 将 `canvas-editor-tiptap.bundle.js` 改为延迟加载 / 按需动态加载（首次进入画布编辑或空闲预加载），移除 [`history.html#L50`](../../../Bookmark-Canvas-main/history_html/history.html#L50) 首屏同步解析阻塞；
   - 为卡片 Resize（`makeTempNodeResizable` / `applyCtrlResize`）加入 `requestAnimationFrame` 批处理；给 [`canvas_obsidian_style.css#L1830`](../../../Bookmark-Canvas-main/history_html/canvas_obsidian_style.css#L1830) 的卡片补上 `contain: layout style paint;`（视溢出句柄层级确认局部规则兼容性）。

---

### 阶段 3：Schema 补齐、双向兼容性修复与交互同步

**目标**：打通图片、表格、对齐、历史数据、Obsidian 语法、工具栏反馈与样式一致性。

1. **修正 [`entry.js`](../../../tools/build-tiptap-bundle/entry.js) 依赖配置与扩展**
   - `StarterKit.configure(...)` 中将 `history` 改为 `undoRedo: { depth: 300, newGroupDelay: 300 }`，显式设置 `trailingNode: false`，修正注释及 `CanvasTiptapEngine.version`。
   - `CustomHighlight.parse.setup(md)` 增加幂等标记（例如 `if (md.__canvasMarkLoaded) return; md.__canvasMarkLoaded = true;`），避免每次 `parse()` 叠加规则。
   - 新增 `@tiptap/extension-image`（配合 `allowBase64: true`，把拖放/粘贴图片转为真正 `Image` 节点而非插入 `![]()` 纯文本；同时修复 `#L7755, #L7792` 改用 `editorEl.contains(document.activeElement)`）和 `@tiptap/extension-table` 系列（按需评估包体增量）。
   - `Link` 配置补充 `protocols: ['obsidian', 'chrome-extension']`。
2. **修复双向序列化、清洗器与旧格式兼容**
   - **解决 `<p style="text-align: ...">**bold**</p>` 往返失真**：不再直接向 Markdown 源码里拼接 `<p style="text-align: center">` 包裹未渲染的 `**bold**` 文本。可选方案：
     - *方案 A（推荐）*：对齐块在写入 Markdown 时将其内部节点渲染为标准 HTML 行内标签（`<strong>`, `<em>`, `<mark>`, `<a>`），保证 CommonMark HTML Block 自洽；或
     - *方案 B*：保留扩展注释/指令语法（如块尾标记）或直接以 ProseMirror JSON 为规范真值。
   - `CustomHighlight`、对齐序列化补充属性值转义（仅允许安全色值/对齐枚举）。
   - 修复 [`__sanitizeCanvasRichTextHtml`](../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js#L17014-L17074)：补充 `'pre'`、`'label'` 到 `allowedTags`，补充 `'data-type'`、`'data-checked'`、`'data-color'` 到 `allowedAttrs`（同时评估收紧 `data:image/svg+xml` 内联风险）；修复 `__coerceDescriptionSourceToHtml#L17568`，确保含行内 HTML 标签时仍正确解析其中的行内 Markdown。
   - 补齐对历史 `<font color>` 与 `<center>` / `p[align]` 的 TipTap `parseHTML` 兼容规则，避免旧数据首次编辑颜色/对齐被静默吞掉；统一永久栏目 `descriptionMd` 的 `\u200B` 清洗（同 `storageBCS_core.js#L7477`）。
3. **重构标题折叠、工具栏联动与 CSS 修复**
   - **标题折叠**：通过 ProseMirror `Plugin` + `Decoration` / `NodeView` 实现编辑器内部折叠（或统一在阶段 2 的静态阅读态继续保留 `__applyHeadingCollapse`，编辑态自动全部展开 / 由 Decoration 接管，避免手工往 `.ProseMirror` DOM 塞 class）。
   - **工具栏同步**：在 `create()` 接入 `onSelectionUpdate`，使用 `inst.isActive(...)` 实时同步粗体/斜体/下划线/高亮/标题/列表/对齐激活态；补齐 `.md-format-btn.active` 与 `.md-format-align-btn.active` 样式；移除自定义 `copy` 监听对 `.md-task-item` 的依赖或彻底收敛到 TipTap `clipboardTextSerializer` 与静态 HTML 复制分支。
   - **CSS 修复**：引入 `@tiptap/extension-placeholder`（或将 `data-placeholder` 注入 `.ProseMirror p.is-editor-empty:first-child::before`）替代外层 `:empty::before`；补齐暗黑模式 `#L649` / `#L2082` 的 `:not(pre) > code` 隔离、`ul[data-type="taskList"] li[data-checked="true"]` 勾选删除线，以及高亮文本深色对比度。
   - **清理半迁移死代码**：删除 `#L15486-L15487` / `#L18468-L18469` 空转 `saveSelection` 监听器、`#L15233-L15394` 死分支、`#L19376` 重复 `md-format-close`、抽离共享工具栏/颜色选择器组件消除两套 ~300 行重复代码。

---

### 阶段 4：中长期架构演进（引擎统一）

1. **迁移社区 `tiptap-markdown@0.9.0` 至 TipTap 官方 `@tiptap/markdown`（`MarkdownManager`）**：解决社区包停更及每次实例重建 `markdownit` 问题。
2. **统一渲染引擎（消灭三引擎分叉）**：使用同一套解析/序列化管线负责编辑器与只读卡片预览（如评估以轻量渲染器或 `MarkdownManager` 输出+单套扩展规则覆盖 Obsidian Callout / Wikilink / Highlight / TaskList，逐步淘汰正则 `fallbackHtml` 和手写 `__htmlToMarkdown`）。
3. **存储模型演进（可选评估）**：在不破坏现有 Obsidian `.canvas`（`text` 字段）导出的前提下，内部缓存/扩展字段可评估保留规范 JSON 或保证 HTML+MD 无损双向规范。

---

## 四、验收与验证清单（Verification Checklist）

每次分阶段落地后，建议逐项跑通以下验证：

| 验证项 | 操作与预期结果 |
| --- | --- |
| **Bundle 配置与解析单元测试（Node）** | 验证 `StarterKit` 启用 `undoRedo`（`depth: 300`）、关闭 `trailingNode`；连续多次 `setMarkdown` 后 `markdown-it` rule 数量保持恒定；`<p style="text-align: center">**加粗** ==高亮==</p>` 重载后粗体与高亮均完整保留。 |
| **崩溃与焦点状态回归** | 打开空白卡字体颜色浮层切换预设色/自定义色无控制台报错；点击编辑器外/另一张卡/画布空白处，编辑器正确触发 `onBlur` 保存并重置 `isInEditMode`，再双击可正常重新编辑；空白卡按一次 `Ctrl/Cmd+Z` 只撤销 1 步。 |
| **清空、IME 与图片粘贴回归** | 在编辑态点击临时/永久备注清空按钮，内容被彻底清空且失焦刷新后不“复活”；中文输入法输入候选词期间按 `Esc` 只取消候选词而不清空/退出卡片；粘贴截图与拖放图片均正确展示并在刷新后保留；`obsidian://` 链接可保存并点击跳转；导入的 `canvas-native-text` 编辑后仍保持原节点类型。 |
| **多卡性能与内存泄漏检查** | 在画布放置 100+ 空白卡与 100+ 带备注栏目，浏览静止态检查 `document.querySelectorAll('.tiptap.ProseMirror').length`（阶段 2 落地后应为 **0**，编辑中最多 **1**）；反复大范围平移进出视口后抓取 Chrome DevTools Heap Snapshot，确认无游离 `EditorView` / `MutationObserver` 与 `document.mousedown` 监听增长；连续打字观察 Performance 面板单次按键无重复序列化与全表遍历尖峰。 |
