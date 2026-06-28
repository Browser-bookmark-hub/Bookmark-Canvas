# bookmark-canvas-skills 任务书

> 返回文档索引：[docs/README.md](./README.md)

## 1. 任务背景

Bookmark-Canvas 当前已经形成了三层不同的知识：

1. 通用 JSON Canvas 能力
2. 通用 Obsidian Markdown 能力
3. Bookmark-Canvas 自己的目录结构、导入导出协议、同步语义

如果把这三层混写在一个 skill 里，会有两个问题：

- 通用能力和私有协议缠在一起，后续很难维护
- AI 很容易把“标准 `.canvas` 语法”和“Bookmark-Canvas 私有规则”混为一谈

因此，本任务的正式目标不是“把所有文档打包成一个大 skill”，而是先建立一个**最普通、最兼容、最克制**的 skills 骨架。

本任务当前明确要求：

- 先遵循最基础的 Agent Skills 结构
- 不加入任何平台专有目录或元数据
- 先把骨架和分层理顺，再逐个补内容
- 先以单套标准结构落地，不在这一阶段拆中文 / 英文双份

---

## 2. 本轮正式结论

### 2.1 只使用通用 skills 结构

当前阶段只保留：

- `skills/<skill-name>/SKILL.md`
- `skills/<skill-name>/references/`

当前阶段不做：

- `.claude-plugin/`
- `agents/openai.yaml`
- marketplace 元数据
- 任意平台专有包装层

也就是说，本轮优先兼容的是 **Agent Skills 规范本体**，不是某个单独平台的增强结构。

### 2.2 先分层，不先混写

本轮 skill 分为三类：

- `json-canvas`
- `obsidian-markdown`
- `bookmark-canvas`

含义分别是：

- `json-canvas`：只负责标准 `.canvas`
- `obsidian-markdown`：只负责标准 Obsidian Markdown
- `bookmark-canvas`：只负责 Bookmark-Canvas 自己的私有语义和协议

### 2.3 先做单套标准骨架

当前阶段不先拆：

- 中文 skill
- 英文 skill

原因：

- 当前 Bookmark-Canvas 私有协议还在持续收敛
- 若此时直接做双份，会增加重复维护成本
- 更稳的做法是先把标准骨架与正式规则做稳，再决定是否镜像出多语言版本

### 2.4 优先使用真实导出样本，而不是只看讨论稿

本轮编写 Bookmark-Canvas 私有 skill 时，内容来源优先级应为：

1. 真实同步 / 导出样本  
   `/Users/kk/Downloads/chrome download/test/书签画布`
2. 运行时代码中生成的导入规则与协议文案  
   `history_html/bookmark_canvas_module.js`
3. 目录栏真实分类实现  
   `history_html/canvas_sidebar_directory.js`
4. 当前仍有效的正式 docs
5. 历史讨论稿与规划书（仅作为解释来源，不直接当最终协议）

---

## 3. 正式目录骨架

建议在插件仓库外建立独立目录：

```text
bookmark-canvas-skills/
└── skills/
    ├── json-canvas/
    │   ├── SKILL.md
    │   └── references/
    │       └── examples.md
    ├── obsidian-markdown/
    │   ├── SKILL.md
    │   └── references/
    │       ├── callouts.md
    │       ├── embeds.md
    │       └── properties.md
    └── bookmark-canvas/
        ├── SKILL.md
        └── references/
            ├── brief.md
            ├── package.md
            ├── grammar.md
            ├── examples.md
            └── limits.md
```

说明：

- `json-canvas` 与 `obsidian-markdown` 属于通用基础 skill
- `bookmark-canvas` 属于本项目私有 skill
- 当前不额外添加任何平台兼容目录

---

## 4. 各 skill 的职责边界

### 4.1 `json-canvas`

职责：

- 只描述标准 JSON Canvas 结构
- 只讨论 `.canvas` 中的：
  - `nodes`
  - `edges`
  - `file`
  - `text`
  - `group`
  - 连接关系与合法性校验

不负责：

- Bookmark-Canvas 的栏目语义
- `BC_ROOT_META`
- `BC_EDITABLE_RULE`
- `BC_NATIVE_TEXT_META`
- 私有目录结构

### 4.2 `obsidian-markdown`

职责：

- 只描述 Obsidian Markdown 的通用能力
- 包括：
  - 标题
  - 列表
  - callouts
  - embeds
  - properties

不负责：

- Bookmark-Canvas 的栏目规则
- 永久栏目 / 临时栏目 / 空白栏目语义
- 私有注释块协议

### 4.3 `bookmark-canvas`

职责：

- 只描述 Bookmark-Canvas 自己的“包结构 + 语义结构 + 私有协议”
- 包括：
  - 永久栏目
  - 临时栏目
  - 空白栏目
  - 导入区块
  - 私有目录结构
  - 私有注释块
  - 导入导出恢复规则

不负责：

- 重复解释标准 `.canvas` 基础语法
- 重复解释标准 Obsidian Markdown 基础语法

---

## 5. `bookmark-canvas` 的正式文件骨架

```text
bookmark-canvas/
├── SKILL.md
└── references/
    ├── brief.md
    ├── package.md
    ├── grammar.md
    ├── examples.md
    └── limits.md
```

### 5.1 `SKILL.md`

作用：

- 作为 Bookmark-Canvas skill 的唯一入口
- 告诉 AI 何时应该触发这个 skill
- 告诉 AI 优先读取哪些 reference

要求：

- 必须短
- 不写成长篇产品百科
- 不重复 references 的细节

### 5.2 `references/brief.md`

作用：

- 放最短的一页规则
- 只写：
  - `3-4` 条核心规则
  - 一个“AI 可以做什么”的动作表

要求：

- 要足够短
- 要让 AI 一次性理解最重要的事情
- 不能写成长篇说明

### 5.3 `references/package.md`

作用：

- 定义 Bookmark-Canvas 的真实包结构
- 说明目录与对象的对应关系

至少要覆盖：

- `永久栏目/`
- `临时栏目/常规链式/`
- `临时栏目/特殊临时栏目/`
- `空白栏目/插件空白卡片/`
- `空白栏目/obsidian原生卡片/`
- `.canvas` 与 `.md` 的对应关系

### 5.4 `references/grammar.md`

作用：

- 定义 Bookmark-Canvas 各类导出 / 编辑语法

至少要覆盖：

- `editable`
- `visual`
- `visual-no-icon`
- 永久栏目 Markdown 结构
- 临时栏目 Markdown 结构
- 空白栏目 Markdown 结构
- 私有注释块：
  - `BC_ROOT_META`
  - `BC_EDITABLE_RULE`
  - `BC_NATIVE_TEXT_META`

### 5.5 `references/examples.md`

作用：

- 提供最小可工作的真实样例
- 让 AI 通过样例直接理解目录结构和协议

当前优先样本：

- `/Users/kk/Downloads/chrome download/test/书签画布`

### 5.6 `references/limits.md`

作用：

- 记录当前仍需保守处理的边界与未成熟能力

至少要覆盖：

- `import-container / group / 导入区块` 仍不应写成完全稳定协议
- `bookmark-canvas.backup.json` 是备份协议，不是主编辑协议
- 旧路径兼容
- 已废弃但仍需兼容忽略的内容，例如 `BC_FOLD_STATE`

---

## 6. `bookmark-canvas` 当前应写入的正式主题

### 6.1 必须进入正式 skill 的内容

- 目录栏正式分类
- 真实导出目录结构
- 永久栏目是浏览器真实书签树
- 临时栏目分为：
  - 常规链式
  - 特殊临时栏目
- 空白栏目分为：
  - 插件空白卡片
  - Obsidian 原生卡片
- 常规导入下，永久栏目按快照恢复，不直接覆盖真实浏览器书签
- 原生卡片真实节点在 `.canvas` 的 `text` 节点中，镜像 `.md` 只是协议辅助层

### 6.2 当前不应写成“成熟稳定协议”的内容

- `import-container`
- group 成员关系
- sandbox 导入
- 任何平台专有 metadata
- 尚未稳定的历史讨论稿命名

---

## 7. 内容来源与取材规则

### 7.1 优先取材来源

1. 真实同步样本  
   `/Users/kk/Downloads/chrome download/test/书签画布`
2. 导出时运行时代码生成的规则文案  
   `history_html/bookmark_canvas_module.js`
3. 目录栏实现  
   `history_html/canvas_sidebar_directory.js`

### 7.2 次级来源

- `docs/视觉模式无图标与目录结构对齐任务书.md`
- `docs/permanent-root-meta-plan.md`
- `docs/README.md`

### 7.3 不直接作为最终真相源的文档

- 仅讨论用的旧规划书
- 已落后的旧“导入规则说明”
- 纯内部开发同步文档

---

## 8. 本轮范围外

当前不做：

- 中英文双份镜像结构
- `openai.yaml`
- `.claude-plugin`
- marketplace 打包
- 平台专有适配层
- 把 skill 直接塞进插件运行时代码

---

## 9. 验收标准

### 9.1 结构

- 存在 `skills/` 根目录
- 存在 3 个 skill：
  - `json-canvas`
  - `obsidian-markdown`
  - `bookmark-canvas`
- `bookmark-canvas` 至少包含：
  - `SKILL.md`
  - `references/brief.md`
  - `references/package.md`
  - `references/grammar.md`
  - `references/examples.md`
  - `references/limits.md`

### 9.2 内容

- 正确区分通用 `.canvas` 与 Bookmark-Canvas 私有协议
- 正确反映真实目录结构
- 正确反映编辑模式样本
- 正确标注未成熟能力的边界

### 9.3 边界

- 不引入平台专有目录
- 不依赖插件运行时代码才能“成立”
- 不把讨论稿原样搬成正式 skill

---

## 10. 实施顺序建议

1. 先固定本任务书中的正式目录骨架
2. 先引入或整理通用基础 skill：
   - `json-canvas`
   - `obsidian-markdown`
3. 再建立 `bookmark-canvas/SKILL.md`
4. 先写 `bookmark-canvas/references/brief.md`
5. 再根据真实同步样本写 `package.md`
6. 再补 `grammar.md`
7. 再补 `examples.md`
8. 最后补 `limits.md`

当前原则：

- 先把骨架做稳
- 再逐个补内容
- 每次只解决一层，不同时混改三层
