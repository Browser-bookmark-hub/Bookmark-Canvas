# 书签画布导入/导出规则

本文件专项给 AI 代理使用：编辑导出的书签画布包时，必须按插件协议最小改动，不能按普通 Canvas 文件随意重写。

## 第一部分：文件结构与视图结构（导入识别基准）

### A0. 完整操作示例（导出 → 编辑 → 导入）
1. 在书签画布执行 {{EXPORT_MODE_LABEL}}导出。
2. 将 ZIP 解压到 Obsidian 仓库。
3. 打开导出包根目录下的 `.canvas` 入口文件。通常它与导出文件夹同名；如果用户改名，以实际 `.canvas` 文件名为准。
4. 只有需求命中书签数据时才编辑 永久栏目/、临时栏目/ 下的 `.json`；空白栏目直接编辑 `.canvas` 的 text 节点。
5. 若重命名或移动 永久/临时 `.json` 文件，必须同步修改 `.canvas` 中所有对应 file 路径。
6. 回到扩展中，以 ZIP 或文件夹方式导入。

<a id="ref-a1"></a>
### A1. 通用包结构图
```text
<导出包根目录>/
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
        ├── AI <标题>.json                      (无现成落点时的 AI 生成书签树落点；见 R5/R7)
        └── 添加/搜索/导入 <标题>.json            (其他特殊临时栏目；见 R5)
```
- JSON模式不导出栏目 `.md` 文件；栏目文件都是 `.json`，空白栏目只存在于 `.canvas` 的 `type: "text"` 节点。
- 示例索引：永久主文件见 [R2](#ref-r2)；永久副本见 [R3](#ref-r3)；普通链式临时栏目见 [R4](#ref-r4)；AI/特殊临时栏目见 [R5](#ref-r5)/[R7](#ref-r7)；.canvas 见 [R6](#ref-r6)；tag 见 [R8](#ref-r8)。

### A2. 模式内容语法（JSON）
- {{EXPORT_MODE_LABEL}}使用单一 JSON 对象正文承载书签树（不使用代码围栏）。
- 永久栏目与临时栏目导入时读取这个 JSON 正文，不再依赖视觉 HTML 包裹结构。
- 不要给栏目 JSON 添加 Markdown 代码围栏。每个栏目文件必须能直接解析为单一 JSON 对象。

### A3. 永久栏目协议
- 永久栏目代表浏览器真实书签树，属于用户数据，风险高于临时栏目。
- 主永久文件结构：`format`、`schemaVersion`、`sectionType: "permanent"`、`slot: "A"`、`descriptionMd`、可选 `identityMap`、`tree`。见 [R2](#ref-r2)。
- `descriptionMd` 是当前书签树的说明。除非任务要求修改说明，否则保留原 Markdown 源码。
- 导出包里的 `tree.id` / `tree.parentId` 是 `syncId_*`，不是本机 Chrome 数字 ID。新增永久节点时生成唯一 `syncId_YYYYMMDD_hash_<token7>`，其中 `token7` 只能是小写字母/数字。见 [R1.1](#ref-r1-1) 与 [R1.2](#ref-r1-2)。
- 顶层浏览器根目录用 `folderType`（如 `bookmarks-bar`、`other`、`mobile`）和 `syncing` 识别。绝对不要增加、删除、移动或修改这些根目录上的 `folderType` / `syncing`。
- `identityMap` 只在有 tags 等扩展元数据时导出。若存在，按 `syncId` 关联；不要在导出包里凭空写入本机 Chrome `id`。见 [R2](#ref-r2)。
- 永久栏目副本不是一份重复书签树。副本文件应是 `fileRole: "copy-anchor"`、`anchorOnly: true`、`inheritFrom`、`copyId`、自己的 `descriptionMd` 和视图状态；不要给副本锚点添加 `tree`。见 [R3](#ref-r3)。

### A4. 临时栏目协议
- 临时栏目是书签沙盒；永久栏目才是浏览器书签树。
- 普通链式临时栏目在 `临时栏目/常规链式/`，标号如 `A-1`、`A-1-1`、`B-1`。链式派生可能有传递性，子链可以承接父链的大部分内容，也可能按需求只保留一部分。见 [R4](#ref-r4)。
- 普通链式若有显式 `label`，以 `label` 为准；无显式 label 时才由 `sequenceNumber` 经 `toAlphaLabel()` 生成兜底顶层标号：1 => A-1，2 => B-1，3 => C-1，27 => AA-1。见 [R1.4](#ref-r1-4)。
- 从永久栏目来源创建的普通链式按来源槽位编号：主永久栏目/slot A 使用 `A-N`，永久副本/slot B 使用 `B-N`；新增时扫描同族已有标号取 max+1，所以第二个 A 来源栏目是 `A-2`，不是 `B-1`。
- 运行时 section ID 与标号绑定：`temp-section-A-1`、`temp-section-A-1-1`。栏目内每个 item 的 `sectionId` 必须一致。
- 特殊临时栏目在 `临时栏目/特殊临时栏目/`，使用 `tempKind: "special"`，label 可以是拖入、搜索、添加、导入、AI 等中文或英文标签。见 [R5](#ref-r5)。
- 同类特殊标签重复时，扫描已有同类 ID 后取 max+1，例如 `temp-section-AI`、`temp-section-AI-2`；用户可见的 `label` 仍可保持 `AI`。见 [R1.5](#ref-r1-5)。
- 临时 item ID 使用 `tempId_YYYYMMDD_hash_<token7>`，其中 `token7` 只能是小写字母/数字。文件夹用 `type: "folder"`，书签用 `type: "bookmark"` 并带 `url`。见 [R1.1](#ref-r1-1)、[R1.3](#ref-r1-3) 与 [R4](#ref-r4)。

### A5. .canvas 元素协议
- 顶层必须保持 `nodes[]` 与 `edges[]`，整体兼容 Obsidian JSON Canvas。见 [R6](#ref-r6)。
- file 节点必须且仅能通过 vault 相对 `file` 路径指向项目内部的永久/临时 JSON 文件。禁止接入或创建任何指向外部/第三方文件（如视频、音频、图片、PDF 等）的 file 节点。
- text 节点（`type: "text"`）就是空白栏目，可把其中 `text` 当作 prompt 或普通 Markdown 文本直接编辑。
- group 节点（`type: "group"`）就是卡片组。不要写 `children`；嵌套和成员关系由几何包含关系推断。
- edge 的 `fromNode` / `toNode` 必须引用现有节点 ID。默认连接线是单箭头，除非现有 edge 已明确表达其他方向。
- 已经几何嵌套在某卡片组里的元素，不要再用连接线连接到所属卡片组来表达成员关系。
- 保留插件现有 ID 风格，如 `permanent-section`、`temp-section-A-1`、`card-group-*`、`md-node-*`、`edge-*`；不要统一改成 16 位十六进制 ID。见 [R1.6](#ref-r1-6)。

### A6. tag 系统协议
- tag 系统模仿 macOS Finder：一个书签/文件夹可以有多个彩色 tag，每个 tag 存为 `{ "color": "<颜色名>", "text": "<显示文字>" }`。见 [R8](#ref-r8)。
- `color` 只能使用小写英文色名：`red`、`orange`、`yellow`、`green`、`blue`、`purple`、`gray`。使用 `gray`，不要写 `grey`；不要把十六进制、`colorHex` 或 `.canvas` 颜色编号写进 tag。
- 调色板显示色：red `#ff453a`、orange `#ff9f0a`、yellow `#ffd60a`、green `#30d158`、blue `#0a84ff`、purple `#bf5af2`、gray `#8e8e93`。
- `text` 是 tag 的显示文字。用户在 UI 里只点颜色时，插件会用对应本地化颜色名；AI 手动编辑 JSON 时应写明确、简短的 `text`。
- 允许多个 tag。保持已有顺序，按 `color + text` 去重；除非任务要求改 tag，不要删除已有 tag。
- 只有用户要求打 tag，或该书签/文件夹对任务特别重要时才新增 tag；避免对大量 URL 过度打 tag。
- 永久栏目 tags 属于 `identityMap` 里的 `syncId` 条目，不直接塞进书签树节点。见 [R2](#ref-r2)。
- 临时栏目 tags 直接内嵌在对应 item 对象里，随该 item 移动或删除。见 [R4](#ref-r4)。
- tag 颜色和 `.canvas` 节点/边/栏目里的 `color`、`colorHex` 是两套东西，不要互相转换。
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
- tag 用于用户要求或特别重要的书签/文件夹；不要因为 URL 多就批量添加过多 tag。

### A9. 文本格式支持与建议
- 空白栏目（`.canvas` 的 `text` 节点）及永久/临时栏目的 `descriptionMd` 支持类似 Obsidian（黑曜石）的 Markdown 及部分 HTML 渲染。
- 格式应主要根据用户当前所用工具的习惯来决定；若某些工具不支持，则按用户的实际习惯调整，其他工具视情况补充。无需列举所有支持的工具与格式。
- 推荐的 Markdown 示例（3种）：高亮 `==文本==`、引用 `> 文本`、序列 `- 列表` 或 `1. 列表`。
- 推荐的 HTML 示例（2种）：文字颜色 `<span style="color:red;">文本</span>`、对齐 `<div align="center">文本</div>`（支持 left/center/right）。

-----------------------------------------------------------------------------
## 第二部分：AI 编辑执行规则（{{EXPORT_MODE_LABEL}}）

### S0. 用户意图确认与执行策略

AI 应先根据用户原话、当前文件/目录、项目结构与本文件协议判断用户的真实目标。本协议只用于约束已确定任务的执行方式和安全边界，不用于替用户决定任务目标。

当用户目标、操作对象与风险边界明确时，直接按最小必要范围执行。

当用户请求的目标、操作对象、期望结果或修改范围不明确，且存在多个合理解释时，必须先向用户确认并等待回答，不得直接写入文件。

不得因为本协议中存在某个安全默认路线，就把模糊请求自动解释为该路线。安全默认路线也必须建立在用户目标已确认的前提上。

路由原则：只改最小必要文件集合。AI 新增书签或书签树时先尊重用户指定落点；没有明确落点时才放入 AI 特殊临时栏目；只有用户明确要求修改浏览器书签树时，才改永久栏目。

### S1. 文件路由（按需求定位）
- 永久栏目主内容：只有明确要改浏览器书签树时才编辑 `{{FINAL_PERMANENT_MD_REL}}`。
- 永久栏目副本：只编辑类似 `{{PERMANENT_MD_REL_2}}` 的副本锚点说明或视图状态。
- 临时栏目内容：编辑 `临时栏目/常规链式/*.json` 或 `临时栏目/特殊临时栏目/*.json`，并同步 `.canvas` 对应 file 节点。
- 空白栏目：直接编辑 `.canvas` 的 `type: "text"` 节点。
- 卡片组与布局：只改 `.canvas` 节点几何、顺序等字段。
- 连接线：只改 `.canvas` 的 `edges[]`。
- 无关文件：严禁在同步目录内添加、编辑或存放任何无关文件（如个人笔记、非本插件格式的 json 文件、多媒体附件等）。同步推送时，目录内的所有无关文件都会被彻底删除。

### S2. AI 生成书签的路由优先级
- 先按用户或上下文指定的目标落点处理：明确命中已有临时栏目、永久栏目或空白栏目时，只编辑对应目标。
- 空白栏目只改 `.canvas` 的 `type: "text"` 节点；不要把空白栏目里的笔记/提示词擅自改成书签 JSON，除非用户要求生成书签树。
- 只有用户明确要求修改永久/浏览器书签时，才编辑永久栏目。
- 当 AI 需要新增书签建议或新书签树，且用户没有指定现有落点时，才默认新建或更新一个特殊临时栏目，使用 `label: "AI"` 与 `tempKind: "special"`。见 [R5](#ref-r5)。
- 如果没有合适的临时栏目落点，而 AI 需要新增书签建议，应先创建特殊临时栏目目录/文件，再在 `.canvas` 增加匹配的 file 节点。见 [R7](#ref-r7)。
- AI 新建的特殊临时栏目使用 `source: "ai-generated"`，并用 `descriptionMd` 说明这棵生成书签树的内容。见 [R5](#ref-r5)。

### S3. ID 与编号规则
- 永久栏目新增节点：`syncId_YYYYMMDD_hash_<token7>`；`token7` 只能是小写字母/数字，`parentId` 必须指向父节点 syncId。见 [R1.1](#ref-r1-1) 与 [R1.2](#ref-r1-2)。
- 临时栏目新增 item：`tempId_YYYYMMDD_hash_<token7>`；`token7` 只能是小写字母/数字，嵌套 item 的 `sectionId` 都必须等于所在栏目 ID。见 [R1.1](#ref-r1-1) 与 [R1.3](#ref-r1-3)。
- 普通链式标号：显式 `label` 优先；没有显式 label 时才用 `{字母}-1` 兜底，字母由 `sequenceNumber` 经 `toAlphaLabel()` 得到，示例：1 A-1，2 B-1，3 C-1，27 AA-1。见 [R1.4](#ref-r1-4)。
- 从永久栏目来源创建的普通链式按来源族递增：slot A 是 `A-N`，slot B 是 `B-N`，扫描已有同族标号取 max+1。
- 派生普通链式可以继续扩展，如 `A-1-1`；编辑时保留父子链式意图。见 [R4](#ref-r4)。
- 特殊临时栏目 ID 使用标签和重复后缀，如 `temp-section-AI`、`temp-section-AI-2`。见 [R1.5](#ref-r1-5)。

### S4. 颜色规则
- 未明确要求改色时，保留已有 `color` / `colorHex`。
- 普通临时栏目颜色跟随链式继承：未锁定子级跟随父级，锁定会断开下游继承。
- 特殊临时栏目默认遵循应用外观设置，除非任务给出具体颜色。
- 这些栏目/画布颜色不是 tag 颜色。tag 调色板色名单独见 [R8](#ref-r8)。

### S5. 联网调研能力
#### S5.1 调研前粗筛选
- 先按任务相关性、重要性、隐私/登录敏感性、成本/耗时、是否依赖页面实质内容粗筛目标。做书签分析、整理、去重、推荐、分类等任务时，如果判断依赖链接实质内容，不能只依赖 title、URL、画布位置、文件夹上下文或导出包元数据。
- 对账号后台、邮箱、控制台等私密或需登录页面，不尝试登录或读取敏感内容；除非用户明确提供安全访问方式和范围，否则只按元数据判断。
#### S5.2 判断、方案与用户确认
- 当用户明确要求联网调研，或任务明显依赖链接实质内容时，对少量公开、低风险目标可直接调研。
- 当需要调研的集合很大、成本高、耗时长、涉及隐私风险或需要大量外部访问时，执行前必须先向用户确认范围、优先级、抽样策略或是否继续。
#### S5.3 执行与约束
- 使用模型、工具或 API 具备的联网调研能力时，遵循对应能力自身的约束和最佳实践。
- 面对复杂或 URL 较多的任务时，必须分批在主线路调研，或在环境支持时使用 subagent/并行审查拆分处理。可按重要性、文件夹/主题、tag、连接关系或决策风险拆分，最后合并结论。
- 调研要有选择性。不要因为 URL 很多就逐个调研所有链接；应按重要性优先或抽样，并说明覆盖范围。
- 若工具或权限不可用，应说明结论只基于 title、URL、画布/导出包上下文，并把依赖实质内容的判断标为不确定。
#### S5.4 官方参考信源
- 项目开源地址与官方文档参考：[GitHub - Browser-bookmark-hub/Bookmark-Canvas](https://github.com/Browser-bookmark-hub/Bookmark-Canvas)。在进行功能开发、查阅设计文档（Docs）或参考其他相关网页时，AI 可将此仓库作为核心参考信源之一进行访问与调研。

### S6. 复杂任务工作流
- 小范围改动可直接修改目标文件，然后执行下方自检。
- 涉及永久书签树、导入/导出协议、tag、`.canvas` 拓扑或 {{GUIDE_RULES}}的宽范围/高风险任务，先检查实际导出包和相关参考，列出目标文件，再修改，最后验证 JSON 与 canvas 完整性。
- 对重复性高或特别重要的长 ID、长 title、长 URL，可在分析阶段临时建立别名映射，例如 `P1`、`T-A1-3`、`U2 -> {id,title,url}`。除非用户要求写入说明，否则不要把这套临时映射写进导出 JSON。
- 如果有多代理或并行审查工具，且用户允许，可以建议拆成协议/数据结构、canvas 拓扑、实现/测试三类审查；如果没有这类工具，就按这些角色顺序自检，不要声称已经调用外部多代理。

### S7. 分类与关系鉴别规范
- **有条件地沿用与整理分类体系（避免盲从混乱结构）**：
  - 用户已有结构（如书签、卡片组、拓扑或 tag）是否作为分类依据，需根据其逻辑清晰度动态调整：
    - **逻辑清晰、井然有序**时：AI 优先沿用用户现有的分类风格与维度进行整理与新增，避免擅自重构造成额外的认知与阅读成本。
    - **杂乱无章、一团糟**时：用户已有结构**不能**作为分类与判断的依据。AI 此时应主动发挥整理与归类能力，帮助用户理清脉络、重构建立清晰规范的新秩序，而非盲从或迎合原有的混乱布局。
- **关系与线索鉴别**：
  - **普通链式关系**：普通临时栏目（如常规链式）的标号是识别关系的重要线索（如 `A-1` -> `A-1-1` -> `A-1-1-1` 构成的派生与继承关系链）。当用户或任务将卡片拖入、派生或修改为子路径时，AI 应仔细辨别其层级继承关系，尊重这种结构，仅在任务明确要求时才在中途加入新要素。
  - **连接线上的关系文字**：在编辑或分析 `.canvas` 文件时，连接线（edges）的 `label` 字段如果包含特定的文字或关系说明，AI 应将其视为重要的分类逻辑。在重构或新增连接关系时，应继承或合理扩展此关系描述。
  - **卡片组与嵌套拓扑**：`.canvas` 中的组套（card groups）和几何嵌套关系也是极其强烈的分类信号。如果某书签节点在几何上位于某个 group 内部，AI 应认知到其已被归类在此分组下。
  - **书签树、文件夹与 tags**：永久/临时 `.json` 书签树中的文件夹节点（`type: "folder"`）以及 identityMap 里的标签数组（`tags`）是天然的分类维度。AI 应根据实际情况，在用户结构清晰时，匹配使用用户习惯的分类维度（如倾向于划分子文件夹、使用卡片组或使用 tags）；在用户结构混乱时，合理规范各维度分工（如 JSON 侧通过文件夹进行树状归类，canvas 侧通过卡片组进行空间归类）。

### S8. {{GUIDE_TOOL_PREFIX}}Skill 创建与自升级提醒
- 当用户正常交互 2-3 轮后，应在合适的停顿点提醒用户对话中稳定下来的规则可以创建或更新为专属 {{GUIDE_TOOL_PREFIX}}`SKILL.md`。
- 这个 skill 的作用是把 {{GUIDE_SELF}} 里的约束沉淀成可插入、可复用的能力，方便后续编辑或审查过程中按需启用，减少长对话里的注意力涣散。
- 如果后续新项目或再次读取的 {{GUIDE_SELF_CODE}} 与此前据其约束衍生成的 skill 存在明显冲突或差异，应和用户沟通差异，并询问是否升级、替换或保持该 skill 不变。
- 如果用户连续 5 轮以上都在围绕同一任务、工作流或反复出现的规则集推进，且模式已经足够稳定可复用，应建议创建或升级 skill。
- 创建、更新或替换前必须询问用户是否需要。该提醒不能阻塞当前任务；没有用户明确确认，不得创建或修改 `SKILL.md`。
- **大体量与同步环境下的索引引导**：如果用户在大数据量下长期进行推送与拉取等网络同步操作，AI 在提议创建或更新 Skill 时，应主动提醒用户是否需要结合外部专业工具来构建本地检索索引（以辅助 RAG 快速定位与跨栏目关联）。AI 负责向用户发出该提醒并在 Skill 中提供其引导入口，但具体索引的底层构建实现不属于 AI 协议本身的强制约束范围。
- **GitHub 场景下的历史追溯与深度检索**：若 AI 检测到当前环境为 GitHub 仓库，当用户提到以前的历史数据、需要多版本比对，或在处理需要深度检索/追溯的任务时，AI 可以主动建议或自行利用 Git 的版本管理工具（如 `git log`、`git diff`、commit 历史等）来比对不同版本的书签树或查找过往数据。这作为一种极佳的深度检索工具，能辅助进行版本审计与历史定位。

### S9. 导入前最小自检清单
- 所有 JSON 文件都能正常解析。
- `.canvas` 能正常解析，并保留顶层 `nodes` 与 `edges` 数组。
- 每个 file 节点路径都指向存在的 JSON 文件，且未接入任何外部文件节点（如视频、音频、图片、PDF 等）。
- 每条 edge 的端点都引用存在的节点 ID。
- 永久根目录的 `folderType` / `syncing` 未被改动，除非用户明确要求做浏览器根目录迁移。
- 新增永久节点使用 syncId；新增临时 item 使用 tempId。
- 新增或修改 tag 时，只使用 [R8](#ref-r8) 中支持的调色板色名。
- **GitHub 仓库场景下的无关文件限制**：若 AI 检测到当前环境存在 Git 相关文件（如 `.git` 文件夹，表明当前处于 GitHub 仓库同步目录下），必须检查与规范目录（见 [A1](#ref-a1)）同级的文件名与文件结构。如果发现非书签系统的无关文件/文件夹（如个人笔记、多媒体等），**必须主动提醒用户将其移动到同步目录之外**，以防推送时被远端同步机制彻底清理。

### 导入步骤
1）解压：{{EXPORT_ROOT}}.zip
2）把文件夹 `{{EXPORT_ROOT}}/` 放到仓库：`{{VAULT_DESTINATION}}`。
3）打开导出包根目录中的 .canvas 入口文件。若文件夹或 canvas 文件已改名，以实际 .canvas 文件为准。

注意：如果只拷贝 .canvas 文件而没有同时拷贝对应的 .json 文件，Canvas 会显示关联文件找不到。

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
- 普通链式标号优先使用显式 `label`。没有显式 label 时，兜底顶层标号才是 `{字母}-1`，字母由 `sequenceNumber` 经 `toAlphaLabel()` 得到。示例：sequenceNumber 1 => A-1，2 => B-1，3 => C-1，27 => AA-1。
- 从永久栏目来源创建的普通链式不按裸 `sequenceNumber` 递进，而是按来源族递增：slot A 生成 `A-N`，永久副本/slot B 生成 `B-N`，扫描已有同族标号取 max+1。例如已有 `A-1` 时，另一个 A 来源栏目应为 `A-2`。
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
下面 `identityMap` 里的 tag 条目通过同一个 `syncId` 指向 `tree` 里的书签节点。
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
      "tags": [
        {
          "color": "green",
          "text": "wqe"
        },
        {
          "color": "purple",
          "text": "124"
        }
      ],
      "syncId": "syncId_20260530_hash_2i6f661"
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
        "children": [
          {
            "title": "windsurf promo code - Google 搜索",
            "id": "syncId_20260530_hash_2i6f661",
            "parentId": "syncId_20260530_hash_1c4v645",
            "url": "https://www.google.com/search?q=windsurf+promo+code"
          }
        ],
        "folderType": "bookmarks-bar",
        "syncing": false
      },
      {
        "title": "Other Bookmarks",
        "id": "syncId_20260530_hash_8r5t1v6",
        "parentId": "syncId_20260530_hash_4xl2x2i",
        "children": [],
        "folderType": "other",
        "syncing": false
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
  "descriptionMd": "副本自己的说明。",
  "viewState": {
    "scrollState": { "page": { "top": 0, "left": 0 }, "sidepanel": { "top": 0, "left": 0 } },
    "foldState": { "page": { "expanded": [] }, "sidepanel": { "expanded": [] } },
    "cardState": {}
  }
}
```

<a id="ref-r4"></a>
### R4. 普通链式临时栏目示例
顶层普通链式栏目：
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
          "children": [],
          "tags": [
            {
              "color": "orange",
              "text": "123"
            },
            {
              "color": "blue",
              "text": "蓝色"
            }
          ]
        }
      ]
    }
  ],
  "originPermanent": {
    "copyId": null
  },
  "sequenceNumber": 1
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
  "items": [],
  "originPermanent": {
    "copyId": null
  },
  "sequenceNumber": 1
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
      "children": []
    }
  ],
  "sequenceNumber": 4
}
```

<a id="ref-r6"></a>
### R6. .canvas 示例
file 节点路径是 vault 相对路径，不是相对 `.canvas` 文件本身。新增路径要匹配当前 `.canvas` 已经使用的前缀风格；不要在不同风格之间擅自归一化。
完整导出包有三种前缀形态：放在已有 vault 根目录时是 `<导出包名>/永久栏目/...`；放在已有 vault 子目录时是 `<vault子目录>/<导出包名>/永久栏目/...`；把导出文件夹本身作为独立 vault 时没有导出包名前缀，直接是 `永久栏目/...`。
下面示例里的 `<前缀>` 表示空字符串、`<导出包名>/` 或 `<vault子目录>/<导出包名>/`。
从 `fromNode` 指向 `toNode` 的默认单箭头边省略 `fromEnd` 和 `toEnd`；只有无箭头才写 `toEnd: "none"`，双端箭头才写 `fromEnd: "arrow"`。
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
### R7. 无现成落点时创建 AI 特殊临时栏目
- 只在 AI 需要新增书签建议或新书签树，且用户没有指定已有临时栏目、永久栏目或空白栏目作为落点时使用本规则。
- 不要把这些建议直接写进永久栏目；只有用户明确要求修改永久/浏览器书签时，才编辑永久栏目。
- 如果 `临时栏目/特殊临时栏目/` 不存在，先创建这个文件夹；已存在则复用。
- 在该文件夹写入 `AI <标题>.json`，JSON 结构按 [R5](#ref-r5)：`sectionType: "temporary"`、`label: "AI"`、`tempKind: "special"`、`source: "ai-generated"`、`descriptionMd`、`items`。`id` 默认用 `temp-section-AI`；若冲突则用同标签下一个后缀，如 `temp-section-AI-2`。
- 在入口 `.canvas` 的 `nodes[]` 增加匹配的 file 节点：节点 `id` 与 JSON 栏目 `id` 保持一致，`file` 使用当前包前缀风格下的 vault 相对路径，`x/y/width/height/color` 参考 [R6](#ref-r6) 示例布置，并避开已有节点。
- 只有任务需要时才额外新增 group、text prompt 节点或 edge；新增 edge 时端点必须引用现有节点。

<a id="ref-r8"></a>
### R8. tag 调色板与 tag 对象
- 合法 tag 颜色是 macOS 风格调色板色名：`red`、`orange`、`yellow`、`green`、`blue`、`purple`、`gray`。
- UI 使用的调色板十六进制：`red #ff453a`、`orange #ff9f0a`、`yellow #ffd60a`、`green #30d158`、`blue #0a84ff`、`purple #bf5af2`、`gray #8e8e93`。
- 未输入自定义文字时，UI 默认文字：英文为 `Red`、`Orange`、`Yellow`、`Green`、`Blue`、`Purple`、`Gray`；中文为 `红色`、`橙色`、`黄色`、`绿色`、`蓝色`、`紫色`、`灰色`。
- 标准 tag 对象形态：
```json
{
  "color": "blue",
  "text": "蓝色"
}
```
- 不要把 tag 颜色写成 `#0a84ff`、`colorHex`、Obsidian canvas 颜色编号或 CSS 变量名。导出 JSON 里的 tag 颜色值就是小写英文调色板名。
