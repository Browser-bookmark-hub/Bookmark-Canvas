# 画布 Mermaid 浮层微画布与组件悬浮工具栏实施计划

## 一、方案背景与目标

当前系统中，Mermaid 图表在栏目卡片（`permanent-bookmark-section`、`temp-canvas-node`）中受 160px 容器高度限制，复杂时序图、状态机和看板难以完整浏览。同时，用户在只读状态下点击图表易误触卡片正文富文本编辑态。

本计划旨在通过**“图表选中态 + 左上角三按键悬浮操作栏 + 浮层微画布（对齐主画布手势与快捷键）”**的完整闭环，实现：
1. **读写解耦**：单击图表仅激活组件选中态，阻断卡片正文富文本编辑误触；
2. **三键悬浮栏**：左上角提供 `[🔍 预览大图]`、`[✏️ 编辑源码]`、`[✕ 退出]`；
3. **浮层微画布（Layer Canvas）**：复用主画布手感，支持 `Ctrl/Cmd + 滚轮` 缩放（以鼠标为锚点）、触控板捏合、鼠标拖拽/双指四向平移漫游、双击自适应居中复位、`Esc` 秒退；
4. **事件隔离（Event Trap）**：浮层激活期间彻底拦截事件穿透，绝不引起底层大画布飘移。

---

## 二、复用既有接口与架构规范

充分复用项目现有基础设施：
- **快捷键判定**：复用 `isCustomCtrlKeyPressed(event)`，兼容 Mac/Windows/Linux 各平台修饰键；
- **事件隔离**：复用 `preventCanvasEventsPropagation(el)`，彻底阻断拖拽冒泡；
- **主题系统**：复用 `[data-theme="dark"]` 与 `canvas_obsidian_style.css` 已完善的 `--pele-*`、`--bg-primary`、`--text-primary` 变量；
- **宿主卡片编辑入口**：
  - 空白卡片（`md-canvas-node`）：复用 `el.__enterEditMode()`；
  - 临时栏目备注（`temp-node-description`）：绑定并调用 `__enterEditingDescription()`；
  - 永久栏目备注（`permanent-section-tip`）：绑定并调用 `__enterEditingTip()`。

---

## 三、实施任务与分工

| 阶段 | 核心任务 | 涉及文件 | 状态 | 交付效果 |
| :--- | :--- | :--- | :--- | :--- |
| **阶段 1：样式与视觉体系** | 1. 悬浮工具栏 `.pele-diagram-toolbar` 样式（深浅主题自适应、毛玻璃）<br>2. 选中高亮外框 `.pele-diagram-container.pele-selected`<br>3. 全屏浮层画布与控制条样式 `.canvas-mermaid-lightbox-overlay` | `Bookmark-Canvas-main/history_html/canvas_obsidian_style.css` | **已完成** | 视觉精致现代，深浅模式无缝自适应 |
| **阶段 2：选中态与三键工具栏挂载** | 1. 单击图表进入选中态，阻止冒泡到卡片富文本<br>2. 动态挂载左上角三按键<br>3. 点击外部区域或 [✕] 自动退出选中态<br>4. [✏️] 精准唤起宿主卡片编辑 | `Bookmark-Canvas-main/history_html/bookmark_canvas_module.js` | **已完成** | 彻底杜绝误触编辑，提供明确的交互入口 |
| **阶段 3：浮层微画布（平移/缩放/复位）** | 1. 挂载 Lightbox 容器与自适应视口<br>2. Ctrl+滚轮与捏合：以鼠标为中心平滑缩放（0.1x ~ 10x）<br>3. 鼠标抓手拖拽与双指四向平移<br>4. 双击视口/点击按钮自适应居中（Fit to screen）<br>5. 全局 Esc 与遮罩点击秒退 | `Bookmark-Canvas-main/history_html/bookmark_canvas_module.js` | **已完成** | 体验与主画布 100% 一致，无额外学习成本 |
| **阶段 4：自动化测试与验证** | 1. 补充单元测试验证 Lightbox 状态机与工具栏交互<br>2. 运行完整单元测试集保证 100% 通过（204 项全部通过） | `tools/build-tiptap-bundle/tests/mermaid-lifecycle.test.cjs` | **已完成** | 零回归错误，204 项单元测试全绿通过 |

---

## 四、安全与边界控制

1. **防穿透保证**：Lightbox 激活期间捕获所有 `wheel`、`pointerdown`、`keydown`，绝不触发底层大画布移动或快捷键误触发；
2. **源码无损保证**：纯视图层投影，不修改 `data-mermaid-source` 与底层 BCS 存储；
3. **销毁安全保证**：关闭浮层时解绑所有全局监听器，绝无内存泄漏或残余事件。
