# 书签画布 AI Agent 编辑规则

本文件用于帮助 AI Agent / 代码代理编辑导出的书签画布包。开始修改前，请先阅读并遵循这里的协议；涉及书签、栏目、`.canvas`、tag/note 的改动，应尽量保持最小且兼容插件导入。这个包不是普通 Obsidian / JSON Canvas 项目，请不要按通用 Canvas 结构随意重写。

## 本约束文件结构
```text
{{GUIDE_SELF_CODE}}
├── 第一部分：文件结构与视图结构（导入识别基准）
│   ├── A0 基础操作流程
│   ├── A1 通用包结构图示例
│   ├── A2 模式内容语法（JSON）
│   ├── A3 永久栏目协议
│   ├── A4 临时栏目协议
│   ├── A5 .canvas 元素协议
│   ├── A6 tag / note 元数据协议
│   ├── A7 导入识别优先级
│   ├── A8 线索与关系运用
│   └── A9 文本格式支持与建议
├── 第二部分：AI 编辑执行规则（{{EXPORT_MODE_LABEL}}）
│   ├── S0 用户意图确认与执行策略
│   ├── S1 文件路由（按需求定位）
│   ├── S2 AI 生成书签的路由优先级
│   ├── S3 无现成落点时创建 AI 特殊临时栏目
│   ├── S4 ID 与编号规则
│   ├── S5 颜色规则
│   ├── S6 联网调研能力
│   ├── S7 复杂任务工作流
│   └── S8 分类与关系鉴别规范
├── 参考
│   ├── R1 ID 与编号生成规则
│   ├── R2 永久栏目主文件示例
│   ├── R3 永久栏目副本锚点示例
│   ├── R4 普通链式临时栏目示例
│   ├── R5 AI 特殊临时栏目示例
│   ├── R6 .canvas 示例
│   └── R7 tag 调色板与 note 元数据
└── 结语：长期约束与修改后检查
    ├── P1 SKILL 与长期偏好
    └── P2 修改后最小自检
```

## 第一部分：文件结构与视图结构（导入识别基准）

### A0. 基础操作流程（导出 → 编辑 → 导入）
1. 在书签画布执行 {{EXPORT_MODE_LABEL}}导出，并将 ZIP 解压到 Obsidian 仓库。
2. 打开画布数据包根目录下的 `.canvas` 入口文件；通常它与画布数据包根目录同名，改名时以实际 `.canvas` 文件名为准。见 [A1](#ref-a1) / [R6](#ref-r6)。
3. 只有需求命中书签数据时才编辑 永久栏目/、临时栏目/ 下的 `.json`；空白栏目、卡片组、布局和连接线直接编辑 `.canvas`。见 [A3](#ref-a3) / [A4](#ref-a4) / [A5](#ref-a5) / [S1](#ref-s1)。
4. 凡是新增、删除、移动、重命名或改写 永久/临时 `.json` 文件引用，必须同步维护所有路径引用：`.canvas` 节点的 `file`、永久副本锚点的 `inheritFrom`。见 [A5](#ref-a5) / [R6](#ref-r6)。
5. 按命中范围做局部检查，必要时按 [P2](#ref-p2) 做同步安全自检。
6. 回到扩展中，以 ZIP 或文件夹方式导入。

<a id="ref-a1"></a>
### A1. 通用包结构图示例
```text
<画布数据包根目录>/
├── {{GUIDE_PRIMARY_NAME_PAD}}{{GUIDE_PRIMARY_NAME_ALIGN_SPACES}}(当前 AI 编辑指南)
├── <画布入口>.canvas                            (画布入口：nodes、edges、文件映射、空白栏目、卡片组、连接线；见 R6)
├── 永久栏目/                                    (永久栏目 JSON 文件夹；对应浏览器书签树)
│   ├── A书签树（永久栏目）.json                   (主永久栏目，slot A；永久书签树快照规范来源；见 R2)
│   └── B书签树（永久栏目）.json                   (可选永久栏目副本锚点，slot B；只保留副本说明/视图；见 R3)
└── 临时栏目/                                    (临时栏目 JSON 文件夹；书签沙盒)
    ├── 常规链式/                                (普通链式书签沙盒)
    │   ├── A-1 <标题>.json                     (永久栏目 A 来源或无显式 label 时的普通链式；见 R4/R1.4)
    │   ├── A-2 <标题>.json                     (同源 A 的下一份；扫描 A-N 取 max+1；见 R4/R1.4)
    │   ├── A-1-1 <标题>.json                   (派生链式；可承接 A-1 的大部分内容；见 R4/R1.4)
    │   └── B-1 <标题>.json                     (永久副本/slot B 来源的普通链式；见 R4/R1.4)
    └── 特殊临时栏目/                            (特殊临时书签沙盒)
        ├── AI <标题>.json                      (无现成落点时的 AI 生成书签树落点；见 R5/S3)
        └── 添加/搜索/导入 <标题>.json            (其他特殊临时栏目；见 R5)
```
- JSON模式不导出栏目 `.md` 文件；栏目文件都是 `.json`，空白栏目只存在于 `.canvas` 的 `type: "text"` 节点。
- 示例索引：永久主文件见 [R2](#ref-r2)；永久副本见 [R3](#ref-r3)；普通链式临时栏目见 [R4](#ref-r4)；AI/特殊临时栏目见 [R5](#ref-r5)/[S3](#ref-s3)；.canvas 见 [R6](#ref-r6)；tag/note 元数据见 [R7](#ref-r7)。

### A2. 模式内容语法（JSON）
- {{EXPORT_MODE_LABEL}}使用单一 JSON 对象正文承载书签树（不使用代码围栏）。
- 永久栏目与临时栏目导入时读取这个 JSON 正文，不再依赖视觉 HTML 包裹结构。
- 不要给栏目 JSON 添加 Markdown 代码围栏。每个栏目文件必须能直接解析为单一 JSON 对象。

<a id="ref-a3"></a>
### A3. 永久栏目协议
- 永久栏目代表浏览器真实书签树，属于用户数据，风险高于临时栏目。
- 主永久文件结构：`format`、`schemaVersion`、`sectionType: "permanent"`、`slot: "A"`、`descriptionMd`、可选 `identityMap`、`tree`。见 [R2](#ref-r2)。
- `descriptionMd` 是当前书签树的说明。除非任务要求修改说明，否则保留原 Markdown 源码。
- 导出包里的 `tree.id` / `tree.parentId` 是 `syncId_*`，不是本机 Chrome 数字 ID。新增永久节点时生成唯一 `syncId_YYYYMMDD_hash_<token7>`，其中 `token7` 只能是小写字母/数字。见 [R1.1](#ref-r1-1) 与 [R1.2](#ref-r1-2)。
- 顶层浏览器根目录用 `folderType`（如 `bookmarks-bar`、`other`、`mobile`）和 `syncing` 识别。绝对不要增加、删除、移动或修改这些根目录上的 `folderType` / `syncing`。
- `identityMap` 只在有 `tags`、`note`/`noteColor` 等扩展元数据时导出。若存在，按 `syncId` 关联；不要在导出包里凭空写入本机 Chrome `id`，也不要把永久 metadata 塞进 `tree` 节点。见 [R2](#ref-r2)。
- 永久栏目副本不是一份重复书签树。副本文件应是 `fileRole: "copy-anchor"`、`anchorOnly: true`、`inheritFrom`、`copyId`、自己的 `descriptionMd` 和视图状态；不要给副本锚点添加 `tree`。见 [R3](#ref-r3)。

<a id="ref-a4"></a>
### A4. 临时栏目协议
- 临时栏目是书签沙盒；永久栏目才是浏览器书签树。
- 普通链式临时栏目在 `临时栏目/常规链式/`，标号如 `A-1`、`A-1-1`、`B-1`。链式派生可能有传递性，子链可以承接父链的大部分内容，也可能按需求只保留一部分。见 [R4](#ref-r4)。
- 每个临时栏目都必须有显式 `label`；外部输入缺失时使用固定协议值 `unknown`。见 [R1.4](#ref-r1-4)。
- 从永久栏目来源创建普通链式时，只在创建瞬间按来源槽位选择标签族：主永久栏目/slot A 使用 `A-N`，永久副本/slot B 使用 `B-N`；新增时扫描同族已有标号取 max+1，所以第二个 A 来源栏目是 `A-2`，不是 `B-1`。创建后不得持久化永久来源关系。
- 运行时 section ID 与标号绑定：`temp-section-A-1`、`temp-section-A-1-1`。栏目内每个 item 的 `sectionId` 必须一致。
- 特殊临时栏目在 `临时栏目/特殊临时栏目/`，使用 `tempKind: "special"`，label 必须显式填写，例如 `新建`、`拖入`、`搜索`、`导入`、AI。分裂时在父 label 后追加 `-N`，且仍为 `special`。见 [R5](#ref-r5)。
- 同类特殊标签重复时，扫描已有同类 ID 后取 max+1，例如 `temp-section-AI`、`temp-section-AI-2`；用户可见的 `label` 仍可保持 `AI`。见 [R1.5](#ref-r1-5)。
- 临时 item ID 使用 `tempId_YYYYMMDD_hash_<token7>`，其中 `token7` 只能是小写字母/数字。文件夹用 `type: "folder"`，书签用 `type: "bookmark"` 并带 `url`。见 [R1.1](#ref-r1-1)、[R1.3](#ref-r1-3) 与 [R4](#ref-r4)。

<a id="ref-a5"></a>
### A5. .canvas 元素协议
- 顶层必须保持 `nodes[]` 与 `edges[]`，整体兼容 Obsidian JSON Canvas。见 [R6](#ref-r6)。
- file 节点必须且仅能通过 vault 相对 `file` 路径指向项目内部的永久/临时 JSON 文件。禁止接入或创建任何指向外部/第三方文件（如视频、音频、图片、PDF 等）的 file 节点。
- Obsidian 路径基准：`.canvas` 的 `file` 与永久副本锚点的 `inheritFrom` 都是 vault 相对路径，不是相对 `.canvas` 或当前 JSON 文件。凡是新增、删除、移动、重命名或修改文件引用，都要沿用当前 `.canvas` 已有的前缀风格并同步所有受影响引用；路径处理参考 Obsidian JSON Canvas 即可。
- text 节点（`type: "text"`）就是空白栏目，可把其中 `text` 当作 prompt 或普通 Markdown 文本直接编辑。
- group 节点（`type: "group"`）就是卡片组。不要写 `children`；嵌套和成员关系由几何包含关系推断。
- `.canvas` 的 `x/y/width/height` 是视图结构的一部分，不只是装饰坐标。新增、移动、缩放 file/text/group 节点时，应保持可读留白，避免非 group 节点之间发生矩形重叠；只有明确需要表达卡片组成员关系时，才让节点完整落入 group 内部。
- 新增或重排包含较多中文/日文/韩文等 CJK 文本的 text/file 节点时，不要按英文短句宽度估算；应给更宽的节点或更多高度，避免标题、说明或列表被挤成难读的窄列，同时仍需遵守不重叠和 group 包含关系。
- edge 的 `fromNode` / `toNode` 必须引用现有节点 ID。默认连接线是单箭头，除非现有 edge 已明确表达其他方向。
- 已经几何嵌套在某卡片组里的元素，不要再用连接线连接到所属卡片组来表达成员关系。
- 保留插件现有 ID 风格，如 `permanent-section`、`temp-section-A-1`、`card-group-*`、`md-node-*`、`edge-*`；不要统一改成 16 位十六进制 ID。见 [R1.6](#ref-r1-6)。

### A6. tag / note 元数据协议
- tag 系统模仿 macOS Finder：一个书签/文件夹可以有多个彩色 tag，每个 tag 存为 `{ "color": "<颜色名>", "text": "<显示文字>" }`，其中 `color` 只能使用：`red`、`orange`、`yellow`、`green`、`blue`、`purple`、`gray`。见 [R7](#ref-r7)。
- note 是书签/文件夹的一条纯文本备注，一个 item 最多一条；写为并列字段 `note` 与 `noteColor`（`noteColor` 同样只能使用：`red`、`orange`、`yellow`、`green`、`blue`、`purple`、`gray`），不要写成 tag 对象或数组。见 [R7](#ref-r7)。
- 使用 `gray`，不要写 `grey`；不可填入十六进制色值（如 `#ff453a`）、`colorHex` 或 `.canvas` 颜色编号。
- `text` 是 tag 的显示文字，可为中文、英文或其他自定义短文本；不要把 `text` 和 `color` / `noteColor` 混为一类字段。
- `note` 保存为纯文本字符串，保留换行并整体 trim；空 note 不应导出，清空 note 时同时删除 `noteColor`。旧数据只有 `note` 没有 `noteColor` 时按 `orange` 处理。
- 允许多个 tag。保持已有顺序，按 `color + text` 去重；除非任务要求改 tag，不要删除已有 tag。只有用户要求打 tag，或该书签/文件夹对任务特别重要时才新增 tag，避免批量过度打 tag。
- 整理或新增 tag 前，先检查已有的文件夹、卡片组、tag 与 note。优先复用已有 tag 的文字、颜色和语义；新 tag 必须表达稳定、可复用的主题、状态或关系，并能说明它与现有项目或同批整理项目的关联。不要仅为单个链接创建没有后续复用价值的近义、重复或孤立 tag。
- 只有用户明确要求、该书签/文件夹很重要，或确有无法由标题、URL、文件夹和 tag 清楚表达的有用上下文时才新增 note。不要给所有新增或整理项都写 note，也不要用 note 重复标题、URL、已有 tag 或显而易见的分类；note 应简短地说明用户意图相关的原因、来源、限制、取舍或后续动作。
- tag 与 note 的颜色必须克制且有一致语义：保持已有的 `text` 到颜色映射；同一主题/关系的 tag 使用同一颜色；新颜色优先复用当前包已有的少量色彩。不要按每个 tag、每个书签或每条 note 分配不同颜色，也不要把颜色当作唯一分类依据，避免形成五颜六色、难以扫描的标记系统。
- 永久栏目 metadata 属于 `identityMap` 里的 `syncId` 条目：`tags`、`note`、`noteColor` 都放在同一条 `syncId` metadata 上，不直接塞进书签树节点。见 [R2](#ref-r2)。
- 临时栏目 metadata 直接内嵌在对应 item 对象里：`tags`、`note`、`noteColor` 随该 item 移动或删除。见 [R4](#ref-r4)。
- 导入、导出、推送、拉取、备份或恢复时，`tags` 与 `note`/`noteColor` 都属于同一类 item metadata；只有 note 而没有 tags 的 `identityMap` 条目也必须保留，不能按“无 tags”清理。
- tag/note 颜色和 `.canvas` 节点/边/栏目里的 `color`、`colorHex` 是两套东西，不要互相转换。
- 未知元数据字段默认保留，除非任务明确要求修改。

### A7. 导入识别优先级
- 类型识别同时依赖 `.canvas` 文件引用与目录路径。
- 永久栏目 JSON `slot` 必须和栏目头/文件名槽位提示保持一致；导入必要时可按文件名或文件顺序兜底。
- 临时栏目标号优先取显式 JSON `label`，再看栏目头或文件名前缀。
- 常规导入流下，永久栏目按快照栏目恢复；覆盖浏览器书签树是另一种高风险导入模式。

### A8. 线索与关系运用
- 永久/临时栏目的 `descriptionMd` 与 `.canvas` 的 text 节点通常是栏目说明或提示词，可作为上下文使用，但不要当作书签 item。
- 第一次分析普通链式栏目时，先看可能的来源族和父级链路，例如 `#A`、`#B`、`A-1`、`A-1-1`、`B-1`；链路不明确时，再用 `title` 或 `url` 通过本地搜索/工具匹配。
- 连接线指向性可表达关系语义。规范导出形态：从 `fromNode` 指向 `toNode` 的单箭头默认省略两端字段；无箭头写 `toEnd: "none"`；双端箭头写 `fromEnd: "arrow"`，`toEnd` 使用默认箭头。除非任务要求改变关系语义，否则保留已有方向。
- tag 用于用户要求或特别重要的书签/文件夹，并应表达可复用的主题、状态或与现有/同批项目的关联；note 只用于补充单个书签/文件夹中确实有助于理解用户意图的上下文。不要因为 URL 多就批量添加 tag 或 note，也不要用五颜六色的颜色替代清晰的分类与关系。

### A9. 文本格式支持与建议
- 空白栏目（`.canvas` 的 `text` 节点）及永久/临时栏目的 `descriptionMd` 支持类似 Obsidian（黑曜石）的 Markdown 及安全 HTML 子集渲染。
- AI 编辑这些文本时，必须优先沿用当前文件/当前栏目里已有的格式习惯；若没有明确格式习惯，只能使用下方推荐的少量简单格式。不要因为编辑器工具栏或某些外部工具支持更多格式，就主动使用复杂 HTML、图片、callout、wiki link、任务列表、多级标题、花哨颜色或大段富文本。
- 若用户明确要求使用推荐列表之外的格式，AI 可以按要求写入，但必须先提示：该格式可能只在某些工具里可编辑或可见，导入到书签画布后可能不会渲染、可能被安全 HTML 子集清理，或显示效果与原工具不一致。可行时应同时给出推荐格式内的降级替代。
- 格式的目的应是提高可读性，而不是装饰。除非用户明确要求或原文已经大量使用，否则避免混用过多格式；同一说明框里优先保持 1-2 种强调方式。
- 推荐的 Markdown 示例：高亮 `==文本==`、引用 `> 文本`、列表 `- 列表` 或 `1. 列表`。
- 推荐的 HTML 示例：文字颜色 `<span style="color:red;">文本</span>`、对齐 `<div align="center">文本</div>`（支持 left/center/right）、下划线 `<u>文本</u>`。

-----------------------------------------------------------------------------
## 第二部分：AI 编辑执行规则（{{EXPORT_MODE_LABEL}}）

<a id="ref-s0"></a>
### S0. 用户意图确认与执行策略

AI 应先根据用户原话、前文上下文、当前文件/目录、项目结构与本文件协议判断真实目标；本协议只约束已确定任务的执行方式和安全边界，不替用户决定目标。

执行规则：
- 目标、操作对象与风险边界明确时，按最小必要文件范围直接执行。
- 目标、操作对象、期望结果或修改范围不明确，且存在多个合理解释时，先向用户确认并等待回答；确认前不得写入文件，也不得把本协议中的安全默认路线当作用户意图。
- 多轮对话中，以用户最新指令为准；当新指令改变操作对象、风险边界、目标落点或长期偏好时，重新查看相关章节，涉及长期个人规则、Skill 或外部规则时同时参考 [P1](#ref-p1)。
- 路由原则：新增书签或书签树先尊重用户指定落点；未指定落点时才放入 AI 特殊临时栏目；只有用户明确要求修改浏览器/永久书签树时，才改永久栏目。

<a id="ref-s1"></a>
### S1. 文件路由（按需求定位）
- 永久栏目主内容：只有明确要改浏览器书签树时才编辑 `{{FINAL_PERMANENT_MD_REL}}`。
- 永久栏目副本：只编辑类似 `{{PERMANENT_MD_REL_2}}` 的副本锚点说明或视图状态。
- 临时栏目内容：编辑 `临时栏目/常规链式/*.json` 或 `临时栏目/特殊临时栏目/*.json`，并同步 `.canvas` 对应 file 节点。
- 空白栏目：直接编辑 `.canvas` 的 `type: "text"` 节点。
- 卡片组与布局：只改 `.canvas` 节点几何、顺序等字段；凡是新增、移动、缩放或重排卡片/卡片组，都要把几何包含关系和非 group 节点碰撞当作本次改动的一部分来处理。
- 连接线：只改 `.canvas` 的 `edges[]`。
- 无关文件：严禁在同步目录内添加、编辑或存放任何无关文件（如个人笔记、非本插件格式的 json 文件、多媒体附件等）。同步推送时，目录内的所有无关文件都会被彻底删除。

### S2. AI 生成书签的路由优先级
- 先按用户或上下文指定的目标落点处理：明确命中已有临时栏目、永久栏目或空白栏目时，只编辑对应目标。
- 空白栏目只改 `.canvas` 的 `type: "text"` 节点；不要把空白栏目里的笔记/提示词擅自改成书签 JSON，除非用户要求生成书签树。
- 只有用户明确要求修改永久/浏览器书签时，才编辑永久栏目。
- 当 AI 需要新增书签建议或新书签树，且用户没有指定现有落点时，才默认新建或更新一个特殊临时栏目，使用 `label: "AI"` 与 `tempKind: "special"`。见 [R5](#ref-r5)。
- 如果没有合适的临时栏目落点，而 AI 需要新增书签建议，应先创建特殊临时栏目目录/文件，再在 `.canvas` 增加匹配的 file 节点。见 [S3](#ref-s3)。
- AI 新建的特殊临时栏目使用 `source: "ai-generated"`，并用 `descriptionMd` 说明这棵生成书签树的内容。见 [R5](#ref-r5)。

<a id="ref-s3"></a>
### S3. 无现成落点时创建 AI 特殊临时栏目
- 只在 AI 需要新增书签建议或新书签树，且用户没有指定已有临时栏目、永久栏目或空白栏目作为落点时使用本规则。
- 不要把这些建议直接写进永久栏目；只有用户明确要求修改永久/浏览器书签时，才编辑永久栏目。
- 如果 `临时栏目/特殊临时栏目/` 不存在，先创建这个文件夹；已存在则复用。
- 在该文件夹写入 `AI <标题>.json`，JSON 结构按 [R5](#ref-r5)：`sectionType: "temporary"`、`label: "AI"`、`tempKind: "special"`、`source: "ai-generated"`、`descriptionMd`、`items`。`id` 默认用 `temp-section-AI`；若冲突则用同标签下一个后缀，如 `temp-section-AI-2`。
- 在入口 `.canvas` 的 `nodes[]` 增加匹配的 file 节点：节点 `id` 与 JSON 栏目 `id` 保持一致，`file` 使用当前包前缀风格下的 vault 相对路径，`x/y/width/height/color` 参考 [R6](#ref-r6) 示例布置，并避开已有节点；若同时新增 group 或 text 节点，先规划父组边界，再把子卡片放入组内并保留间距，不要让 file/text 节点互相覆盖。
- 只有任务需要时才额外新增 group、text prompt 节点或 edge；新增 edge 时端点必须引用现有节点。

### S4. ID 与编号规则
- 永久栏目新增节点：`syncId_YYYYMMDD_hash_<token7>`；`token7` 只能是小写字母/数字，`parentId` 必须指向父节点 syncId。见 [R1.1](#ref-r1-1) 与 [R1.2](#ref-r1-2)。
- 临时栏目新增 item：`tempId_YYYYMMDD_hash_<token7>`；`token7` 只能是小写字母/数字，嵌套 item 的 `sectionId` 都必须等于所在栏目 ID。见 [R1.1](#ref-r1-1) 与 [R1.3](#ref-r1-3)。
- 普通链式标号必须显式填写；外部输入没有 label 时使用固定协议值 `unknown`。见 [R1.4](#ref-r1-4)。
- 从永久栏目来源创建的普通链式只在创建时按来源族递增：slot A 是 `A-N`，slot B 是 `B-N`，扫描已有同族标号取 max+1。
- 派生普通链式可以继续扩展，如 `A-1-1`；编辑时保留父子链式意图。见 [R4](#ref-r4)。
- 特殊临时栏目 ID 使用标签和重复后缀，如 `temp-section-AI`、`temp-section-AI-2`。见 [R1.5](#ref-r1-5)。

### S5. 颜色规则
- 未明确要求改色时，保留已有 `color` / `colorHex`。
- 颜色使用应保持克制和有语义。新增栏目卡片、空白卡片、卡片组、连接线，或进行较大布局/分类重构时，优先使用普通浅色、深色、中性色作为低干扰背景或弱提示；只用少量红、黄、蓝、绿等基础色表达明确含义，避免画面眼花缭乱。
- 不要为了装饰而随机换色。每种显著颜色应有稳定用途，例如：永久栏目及其副本应保持当前导出包里已有的永久栏目颜色；只有新建永久栏目/副本且当前包内没有可参考值时，才以 JSON Canvas/Obsidian 预设绿色（常见 `.canvas` 写法为 `color: "4"`）作为兜底。不要把永久栏目颜色随意改成十六进制绿色或其他颜色；警示/待处理可用红或黄；信息/参考可用蓝。若没有明确语义，保留已有颜色或使用低干扰中性色。
- 颜色治理原则主要适用于 AI 新建栏目、卡片组、连接线，或做较大布局/分类重构时；小范围编辑、修正文案、补单个书签时，不应主动重配整张画布颜色。
- 这些栏目/画布颜色不是 tag/note 颜色。tag 调色板和 `noteColor` 色名单独见 [R7](#ref-r7)。

### S6. 联网调研能力
#### S6.0 调研工具路由与优先级
- 开始联网调研前，AI 必须先识别用户已提供或当前环境已配置并允许使用的 Deep Research、网络搜索 Agent、MCP 服务或 Skill。存在适合当前任务的能力时，应在符合用户授权、服务权限、隐私边界与本节范围控制的前提下优先调用，而不是忽略它们仅依赖基础搜索能力。

#### S6.1 调研前粗筛选
- 先按任务相关性、重要性、隐私/登录敏感性、成本/耗时、是否依赖页面实质内容粗筛目标。做书签分析、整理、去重、推荐、分类等任务时，如果判断依赖链接实质内容，不能只依赖 title、URL、画布位置、文件夹上下文或导出包元数据。
- 对账号后台、邮箱、控制台等私密或需登录页面，不尝试登录或读取敏感内容；除非用户明确提供安全访问方式和范围，否则只按元数据判断。
#### S6.2 判断、方案与用户确认
- 当用户明确要求联网调研，或任务明显依赖链接实质内容时，对少量公开、低风险目标可直接调研。
- 当需要调研的集合很大、成本高、耗时长、涉及隐私风险或需要大量外部访问时，执行前必须先向用户确认范围、优先级、抽样策略或是否继续。
#### S6.3 执行与约束
- 使用模型、工具或 API 具备的联网调研能力时，遵循对应能力自身的约束和最佳实践。
- 面对复杂或 URL 较多的任务时，必须分批在主线路调研，或在环境支持时使用 subagent/并行审查拆分处理。可按重要性、文件夹/主题、tag、连接关系或决策风险拆分，最后合并结论。
- 调研要有选择性。不要因为 URL 很多就逐个调研所有链接；应按重要性优先或抽样，并说明覆盖范围。
- 若工具或权限不可用，应说明结论只基于 title、URL、画布/导出包上下文，并把依赖实质内容的判断标为不确定。
#### S6.4 官方参考信源
- 项目开源地址与官方文档参考：[GitHub - Browser-bookmark-hub/Bookmark-Canvas](https://github.com/Browser-bookmark-hub/Bookmark-Canvas)。在进行功能开发、查阅设计文档（Docs）或参考其他相关网页时，AI 可将此仓库作为核心参考信源之一进行访问与调研。

### S7. 复杂任务工作流
- 小范围改动可直接修改目标文件，然后执行下方自检。
- 涉及永久书签树、导入/导出协议、tag/note metadata、`.canvas` 拓扑或 {{GUIDE_RULES}}的宽范围/高风险任务，先检查实际导出包和相关参考，列出目标文件，再修改，最后验证 JSON 与 canvas 完整性。
- 编辑 `.canvas` 或栏目 `.json` 时，应使用 JSON parser/serializer 或等价结构化方式读写，不能靠手工拼接 JSON 字符串；尤其要正确处理标题、路径、说明、tag 文本、note、连接线 label 中的引号、反斜杠、换行与 CJK 文本。
- 涉及 `.canvas` 布局、卡片组、节点坐标、尺寸或批量新增节点时，修改前先识别现有分区、卡片组包含关系和连接线语义；修改后检查非 group 节点矩形是否重叠、预期子节点是否完整落入对应 group、edge 端点是否仍存在。
- 对重复性高或特别重要的长 ID、长 title、长 URL，可在分析阶段临时建立别名映射，例如 `P1`、`T-A1-3`、`U2 -> {id,title,url}`。除非用户要求写入说明，否则不要把这套临时映射写进导出 JSON。
- 如果有多代理或并行审查工具，且用户允许，可以建议拆成协议/数据结构、canvas 拓扑、实现/测试三类审查；如果没有这类工具，就按这些角色顺序自检，不要声称已经调用外部多代理。

### S8. 分类与关系鉴别规范
- **有条件地沿用与整理分类体系（避免盲从混乱结构）**：
  - 用户已有结构（如书签、卡片组、拓扑或 tag）是否作为分类依据，需根据其逻辑清晰度动态调整：
    - **逻辑清晰、井然有序**时：AI 优先沿用用户现有的分类风格与维度进行整理与新增，避免擅自重构造成额外的认知与阅读成本。
    - **结构较乱或语义不清**时：不要机械地把现有结构当作分类依据。AI 应先识别哪些线索可信，尽量保持最小必要改动；如确需重构，应先给出整理思路或在用户明确要求的范围内执行，避免把推测强行覆盖到用户数据上。
- **关系与线索鉴别**：
  - **普通链式关系**：普通临时栏目（如常规链式）的标号是识别关系的重要线索（如 `A-1` -> `A-1-1` -> `A-1-1-1` 构成的派生与继承关系链）。当用户或任务将卡片拖入、派生或修改为子路径时，AI 应仔细辨别其层级继承关系，尊重这种结构，仅在任务明确要求时才在中途加入新要素。
  - **连接线上的关系文字**：在编辑或分析 `.canvas` 文件时，连接线（edges）的 `label` 字段如果包含特定的文字或关系说明，AI 应将其视为重要的分类逻辑。在重构或新增连接关系时，应继承或合理扩展此关系描述。
  - **卡片组与嵌套拓扑**：`.canvas` 中的组套（card groups）和几何嵌套关系也是极其强烈的分类信号。如果某书签节点在几何上位于某个 group 内部，AI 应认知到其已被归类在此分组下。
  - **书签树、文件夹、tags 与 note**：永久/临时 `.json` 书签树中的文件夹节点（`type: "folder"`）以及 identityMap/inline item 里的标签数组（`tags`）是天然的分类维度；`note` 是单个书签/文件夹的补充上下文信号。AI 应根据实际情况，在用户结构清晰时，匹配使用用户习惯的分类维度（如倾向于划分子文件夹、使用卡片组或使用 tags），并把 note 作为说明线索；在结构不清时，可先把文件夹、卡片组、tag、note 视为不同线索来提出更清晰的分工建议，只有用户要求整理时才执行范围更大的重组。

-----------------------------------------------------------------------------
## 参考

<a id="ref-r1"></a>
### R1. ID 与编号生成规则
<a id="ref-r1-1"></a>
#### R1.1 哈希数据 ID
- 哈希数据 ID 统一形态：`<prefix>_YYYYMMDD_hash_<token>`。正常生成器生成 7 位小写 base36 token；极少数碰撞兜底可能生成 10 位。hash token 不接受大写字母。AI/手动编辑时使用 7 位小写字母数字，并保证在当前包内唯一。
- 如果 AI 代理可以运行本地命令，应使用工具生成 7 位 token，不要靠模型凭空编。Node 示例：`node -e 'const c=require("crypto");let s="";while(s.length<7){s+=Array.from(c.randomBytes(8),b=>b.toString(36)).join("").replace(/[^a-z0-9]/g,"")}console.log(s.slice(0,7))'`。
<a id="ref-r1-2"></a>
#### R1.2 永久书签树 syncId
- 永久书签树节点使用 `syncId_*`。子书签/文件夹的 `parentId` 必须指向父节点 syncId。导出文件里不要使用本机 Chrome 数字 ID。
<a id="ref-r1-3"></a>
#### R1.3 临时栏目 item tempId
- 临时栏目里的书签/文件夹 item 使用 `tempId_*`。同一临时栏目内所有 item，包括嵌套子项，`sectionId` 都必须等于所在栏目 id。
<a id="ref-r1-4"></a>
#### R1.4 普通链式栏目 ID / label
- 普通链式临时栏目 id 按标号生成：`temp-section-A-1`、`temp-section-A-1-1`、`temp-section-B-1`。
- 普通链式标号必须显式填写；外部输入没有 label 时使用固定协议值 `unknown`。
- 从永久栏目来源创建的普通链式只在创建瞬间按来源族递增：slot A 生成 `A-N`，永久副本/slot B 生成 `B-N`，扫描已有同族标号取 max+1。例如已有 `A-1` 时，另一个 A 来源栏目应为 `A-2`。
- 普通链式派生标号可以继续扩展，如 `A-1-1`。链式继承是语义关系：派生栏目可以承接父栏目的大部分内容，但不要求完全一致。
<a id="ref-r1-5"></a>
#### R1.5 特殊临时栏目 ID
- 特殊临时栏目 id 使用可见标签族。现有首个同类可能无后缀，例如 `temp-section-AI` 或 `temp-section-添加`；如果再新增同标签栏目，扫描已有 ID 后使用下一个数字后缀，例如 `temp-section-AI-2`。
<a id="ref-r1-6"></a>
#### R1.6 .canvas 节点与边 ID
- `.canvas` 节点和边 ID 只要求唯一且稳定。保留已有 ID；新增对象建议用可读 ID，如 `md-node-ai-note`、`card-group-ai-1`、`edge-ai-1`。

<a id="ref-r2"></a>
### R2. 永久栏目主文件示例
只有用户明确要求修改永久浏览器书签树时才使用这种形状。
下面 `identityMap` 里的 metadata 条目通过同一个 `syncId` 指向 `tree` 里的书签节点；`tags` 可多条，`note` 只有一条，`noteColor` 是 note 的并列字段。
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 3,
  "sectionType": "permanent",
  "slot": "A",
  "title": "Permanent Bookmarks",
  "descriptionMd": "说明当前永久书签树包含什么。",
  "fileRole": "primary",
  "fileNote": "永久栏目主文件：书签树的规范真相源。",
  "identityMap": [
    {
      "syncId": "syncId_20260530_hash_2i6f661",
      "note": "保留前确认这个促销码搜索是否仍然有用。",
      "noteColor": "orange",
      "tags": [
        {
          "color": "green",
          "text": "coupon"
        },
        {
          "color": "purple",
          "text": "promo"
        }
      ]
    }
  ],
  "tree": {
    "title": "",
    "id": "syncId_20260530_hash_4xl2x2i",
    "children": [
      {
        "title": "Bookmarks Bar",
        "id": "syncId_20260530_hash_1c4v645",
        "parentId": "syncId_20260530_hash_4xl2x2i",
        "folderType": "bookmarks-bar",
        "syncing": false,
        "children": [
          {
            "title": "windsurf promo code - Google 搜索",
            "id": "syncId_20260530_hash_2i6f661",
            "parentId": "syncId_20260530_hash_1c4v645",
            "url": "https://www.google.com/search?q=windsurf+promo+code"
          }
        ]
      },
      {
        "title": "Other Bookmarks",
        "id": "syncId_20260530_hash_8r5t1v6",
        "parentId": "syncId_20260530_hash_4xl2x2i",
        "folderType": "other",
        "syncing": false,
        "children": []
      }
    ]
  }
}
```

<a id="ref-r3"></a>
### R3. 永久栏目副本锚点示例
永久栏目副本是视图锚点，不是另一份书签树。
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "permanent",
  "slot": "B",
  "title": "Permanent Bookmarks",
  "fileRole": "copy-anchor",
  "anchorOnly": true,
  "fileNote": "永久栏目副本锚点文件：树内容继承自主文件；此文件仅保留副本说明与画布锚点。",
  "inheritFrom": "<vault 相对的 slot A json 路径>",
  "copyId": "permanent-copy-1780113045642-gtjhd",
  "descriptionMd": "副本自己的说明。"
}
```

<a id="ref-r4"></a>
### R4. 普通链式临时栏目示例
顶层普通链式栏目：
下面子书签同时展示 `tags` 与 `note`/`noteColor` 作为同一个临时 item 的并列 metadata；没有 metadata 的 item 可省略这些字段。
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "temporary",
  "id": "temp-section-A-1",
  "label": "A-1",
  "title": "Research set",
  "tempKind": "regular",
  "source": "",
  "descriptionMd": "这是书签沙盒，不会直接修改浏览器永久书签。",
  "items": [
    {
      "id": "tempId_20260530_hash_6u3p4w4",
      "sectionId": "temp-section-A-1",
      "title": "AI",
      "url": "",
      "type": "folder",
      "children": [
        {
          "id": "tempId_20260530_hash_1z42o1g",
          "sectionId": "temp-section-A-1",
          "title": "GitHub Trending · JavaScript",
          "url": "https://github.com/trending/javascript?since=daily",
          "type": "bookmark",
          "note": "每日 JavaScript 趋势页面，适合做技术发现。",
          "noteColor": "blue",
          "tags": [
            {
              "color": "orange",
              "text": "趋势"
            },
            {
              "color": "blue",
              "text": "JavaScript"
            }
          ],
          "children": []
        }
      ]
    }
  ]
}
```
派生链式栏目：
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "temporary",
  "id": "temp-section-A-1-1",
  "label": "A-1-1",
  "title": "Research set - refined",
  "tempKind": "regular",
  "source": "",
  "descriptionMd": "从 A-1 派生；只保留精简后的子集。",
  "items": []
}
```

<a id="ref-r5"></a>
### R5. AI 特殊临时栏目示例
AI 新增书签建议或生成书签树且没有现成指定落点时，使用这种栏目；若用户或上下文已经指定已有落点，按 [S2](#s2-ai-生成书签的路由优先级) 路由。
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "temporary",
  "id": "temp-section-AI",
  "label": "AI",
  "title": "AI title here",
  "tempKind": "special",
  "source": "ai-generated",
  "descriptionMd": "说明这棵生成书签树的内容，以及这些链接为什么被分到一起。",
  "items": [
    {
      "id": "tempId_20260530_hash_x6k2d5e",
      "sectionId": "temp-section-AI",
      "title": "Generated links",
      "url": "",
      "type": "folder",
      "children": [
        {
          "id": "tempId_20260530_hash_8a4c1d2",
          "sectionId": "temp-section-AI",
          "title": "生成书签示例",
          "url": "https://example.com/",
          "type": "bookmark",
          "note": "说明这条生成链接为什么有用。",
          "noteColor": "blue",
          "tags": [
            {
              "color": "purple",
              "text": "AI"
            }
          ],
          "children": []
        }
      ]
    }
  ]
}
```

<a id="ref-r6"></a>
### R6. .canvas 示例
file 节点路径是 vault 相对路径，不是相对 `.canvas` 文件本身；永久副本锚点里的 `inheritFrom` 也使用同一套 vault 相对路径。新增、删除、移动、重命名或修改文件引用时，要匹配当前 `.canvas` 已经使用的前缀风格，并同步所有受影响的 `file` / `inheritFrom` 引用；路径处理参考 Obsidian JSON Canvas 即可。
完整画布数据包根目录有三种前缀形态：放在已有 vault 根目录时是 `<画布数据包根目录名>/永久栏目/...`；放在已有 vault 子目录时是 `<vault子目录>/<画布数据包根目录名>/永久栏目/...`；把画布数据包根目录本身作为独立 vault 时没有画布数据包根目录名前缀，直接是 `永久栏目/...`。
下面示例里的 `<前缀>` 表示空字符串、`<画布数据包根目录名>/` 或 `<vault子目录>/<画布数据包根目录名>/`。
从 `fromNode` 指向 `toNode` 的默认单箭头边省略 `fromEnd` 和 `toEnd`；只有无箭头才写 `toEnd: "none"`，双端箭头才写 `fromEnd: "arrow"`。
下面只是结构示例；实际编辑时不要把 `.canvas` 当文本模板手工拼接，必须通过 JSON 解析后修改对象并序列化写回，避免引号、反斜杠或多语言文本破坏 JSON。
```json
{
  "nodes": [
    { "id": "permanent-section", "type": "file", "file": "<前缀>永久栏目/A书签树（永久栏目）.json", "x": 0, "y": 0, "width": 600, "height": 600, "color": "4" },
    { "id": "permanent-section-copy-permanent-copy-1780113045642-gtjhd", "type": "file", "file": "<前缀>{{PERMANENT_MD_REL_2}}", "x": 720, "y": 0, "width": 600, "height": 600, "color": "4" },
    { "id": "card-group-ai", "type": "group", "x": -40, "y": 700, "width": 1320, "height": 620, "label": "AI workspace", "color": "5" },
    { "id": "temp-section-AI", "type": "file", "file": "<前缀>临时栏目/特殊临时栏目/AI title.json", "x": 0, "y": 760, "width": 525, "height": 380, "color": "#e9973f" },
    { "id": "md-node-ai-prompt", "type": "text", "text": "Prompt or notes for this generated bookmark set.", "x": 600, "y": 760, "width": 420, "height": 260, "color": "#888888" }
  ],
  "edges": [
    { "id": "edge-ai-1", "fromNode": "md-node-ai-prompt", "fromSide": "right", "toNode": "temp-section-AI", "toSide": "left", "color": "#999999", "label": "generated set" }
  ]
}
```

<a id="ref-r7"></a>
### R7. tag 调色板与 note 元数据
```json
{
  "note": "纯文本书签/文件夹备注。",
  "noteColor": "orange",
  "tags": [
    {
      "color": "blue",
      "text": "设计参考"
    }
  ]
}
```
- 上例中，`tags[].color` 和 `noteColor` 都是小写英文调色板色名，只能使用：`red`、`orange`、`yellow`、`green`、`blue`、`purple`、`gray`。
- 导出颜色值只能是上述小写英文，不可写成十六进制（如 `#0a84ff`）、`colorHex`、Obsidian canvas 颜色编号或 CSS 变量名。
- 永久栏目 `identityMap` 条目在上面形态基础上再带 `syncId`；临时栏目 item 则直接内联这些字段。
- `noteColor` 是 `note` 的并列字段，也是 `tags` 的并列字段，不是 tag 对象的一部分；不要写成 `{ "color": "...", "text": "..." }`。

-----------------------------------------------------------------------------
## 结语：长期规则与同步安全

<a id="ref-p1"></a>
### P1. 长期个人规则与 {{GUIDE_TOOL_PREFIX}}SKILL
- {{GUIDE_SELF_CODE}} 是导出/同步包内的生成规则文件，不是长期个人规则的保存位置；不要把长期个人偏好只写在本文件里。
- 当用户要求新增、修改或替换当前 {{GUIDE_SELF_CODE}} / 本指南文件时，AI 应先提醒：本文件是生成文件，直接修改通常只影响当前包；若当前包位于 Git 仓库或同步目录，下一次推送可能按模板重新生成并覆盖本文件，需按 [P2](#ref-p2) 判断同步风险。随后按用户选择处理：不改本指南；仅临时修改当前包；或在用户明确确认后沉淀到长期个人规则、Skill、外部规则文件或插件模板源中。
- 若用户希望改变后续由插件模板生成的本指南，应修改或共建插件模板源，而不是只改当前包；开源模板目录：[AGENTS_template](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template)，可通过 issue 或 PR 参与。
- 优先级：用户当前自然语言指令 > 用户长期个人规则（如 {{GUIDE_TOOL_PREFIX}}SKILL、外部 Markdown 规则文件、插件里的 AI 个性化补充规则、索引/检索工具偏好）> 本文件中的行为偏好与兜底建议；但本文件中的 JSON schema、路径结构、ID 规则、tag/note 写入位置、导入导出协议、同步目录安全规则是当前包硬约束，个人规则不能覆盖。
- 外部通用 Skill / AI 工具规则只能作为辅助参考，不能覆盖本包硬约束。尤其是通用 [JSON Canvas Skill](https://github.com/kepano/obsidian-skills/blob/main/skills/json-canvas/SKILL.md) 可能允许 16 位 hex ID、普通 link 节点、外部 file 节点或附件/PDF/图片引用；但 Bookmark-Canvas 导出包仍必须保留插件 ID 风格，file 节点只能指向包内永久/临时 JSON，并遵守永久栏目、临时栏目、identityMap、导入导出与同步安全协议。
- 创建或升级 Skill 可参考：[Anthropic Skills](https://github.com/anthropics/skills) 与 [OpenAI Skills](https://github.com/openai/skills/tree/main)。Skill 的 `name` 与 `description` 是命中入口，应短、稳定、清楚写明何时使用；正文保持精简，复杂规则放 `references/`，确定性/重复流程放 `scripts/`，模板资源放 `assets/`。
- 当一次偏好、流程或验证方法明显会在后续反复使用时，AI 可适当提醒用户是否要写入或升级 Skill / 长期规则；但该提醒不应阻塞当前任务，实际创建、更新或替换相关 SKILL / 规则文件前应先取得用户确认。
- 适合放入 Skill 的内容包括：分类/命名/tag/note/联网策略等用户习惯，以及 Node.js、SQL/SQLite、全文搜索、`git log` / `git diff`、URL 抽样、验证脚本、多代理审查等工具流程；这些是辅助能力，不属于本包协议本身。

<a id="ref-p2"></a>
### P2. Git / 同步目录最小安全自检
1. 先判断是否需要做同步安全检查
   1.1 先判断当前包是否位于 Git 仓库或同步目录中：例如存在 `.git`、`git status` 可用、用户准备让 AI commit/push/pull，或当前任务明确涉及 GitHub 推送/拉取。
   1.2 若不在 Git 仓库或同步目录中，且只是普通手动导入/导出包，则通常不需要专门检查视频、音频、图片、PDF 等外部 file 节点；插件不会把这些外部文件解析成书签数据。
   1.3 若当前包位于 Git 仓库或同步目录中，AI 应提醒用户当前目录存在同步清理风险；只要 AI 负责 commit/push/pull 或整理同步目录，必须先完成第 2 节最小安全检查。

2. 最小结构与 `.canvas` 检查
   2.1 以 [A1](#ref-a1) 包结构图为基准，只检查“现有内容是否不属于书签画布包结构”；可用 `git status` / `git diff` / 最近 commit 辅助定位新增或变化的文件，但 Git 不能替代结构判断。
   2.2 不要因为局部导出缺少某些永久栏目、临时栏目、节点或边就强行补齐；只检查现有 JSON 能解析、入口 `.canvas` 能解析且保留顶层 `nodes` / `edges` 数组。
   2.3 画布数据包根目录内只能保留 A1 允许的入口 `.canvas`、AI 编辑指南、永久栏目 JSON、临时栏目 JSON 及其规范子目录；若发现个人笔记、多媒体、MP3、MP4、PDF、图片等无关文件，或 `.canvas` 接入外部 file 节点，按 2.4 处理。
   2.4 优先隔离而不是删除：以当前 {{GUIDE_SELF_CODE}} 所在目录作为画布数据包根目录；画布数据包根目录内非书签文件移动到该根目录同级的 `<画布数据包根目录名>-隔离文件/`，若它们被 `.canvas` 引用，同时移除对应 file 节点及相关 edge；画布数据包根目录外文件若被 `.canvas` 引用，只移除 `.canvas` 节点和相关 edge，不移动外部原文件。
   2.5 凡是本次修改过的 `.canvas` 或永久/临时栏目 `.json`，必须用 JSON parser 重新解析验证；入口 `.canvas` 还必须确认顶层 `nodes` / `edges` 仍是数组，所有 edge 端点仍存在。
   2.6 若本次修改过 `.canvas` 的节点坐标、尺寸、卡片组或新增 file/text/group 节点，还要做最小几何检查：所有 edge 端点必须存在；非 group 节点不应发生矩形重叠；期望属于某卡片组的节点应完整位于该 group 边界内；不属于任何组的节点不应意外落入 group 内。

3. 检查频率
   3.1 普通 JSON 内容小改只按对应章节做局部检查；不要把本 P2 扩展成每次都全量审计内部协议字段。
   3.2 若包处于 Git 仓库或同步目录中，AI 在明显影响文件结构的修改后、或执行 commit/push/pull 前，必须重新完成第 2 节最小安全检查，并提醒用户自行提交前也要确认画布数据包根目录内没有无关文件。
