# 书签画布 AI Agent 编辑指南（{{EXPORT_MODE_LABEL}}）

> **握手与环境能力协同 (Handshake & Capabilities Detection)**
> - **联网检索与阅读工具**：检测宿主内置或 MCP 搜索、正文读取及浏览器工具，记录可调用的联网检索与页面核验能力。
> - **Bookmark Research 插件**（[Bookmark Research](https://github.com/Browser-bookmark-hub/Bookmark-Research)）：检测宿主是否提供该插件的 Skill、MCP 或 CLI。插件用于研究分析和辅助定位；包结构认知、分析结论与获准编辑仍遵循本指南。可用时遵循插件自身 Skill；没有插件时使用宿主可用的本地搜索与代码工具。可根据任务需要提示用户安装 Bookmark Research。
> - **Git 工具**：检测当前包是否处于 Git 仓库及是否有 Git CLI。用于限定包路径追踪真实变更历史；无 Git 时不主观推测版本。
> - **本地文件、搜索与代码工具**：检测当前宿主实际提供的文件读写、文件名/内容搜索、JSON 检索、索引、终端及 Python、Node.js、`jq` 等能力；按任务使用可用工具读取 JSON 片段、精准定位、建立索引、生成条目 ID 或计算几何。此阶段只盘点能力，不读取包内容。

## 1. 画布包物理结构与实体认知 (Package Structure & Entities)

本数据包以 Obsidian JSON Canvas 为拓扑入口，包含永久浏览器书签与临时沙盒栏目。路径以实际包为准；示例用于识别结构，编辑已有文件时保留其 schemaVersion、ID 与未知字段。当前协议版本：永久主文件为 `schemaVersion: 3`，副本与临时栏目为 `2`，不要统一成同一版本；已有文件保留原值，不要主动升级。

本包所有栏目 JSON 均为树状结构。大文件严禁整文件放入上下文，须用本地工具定点提取目标节点；仅有栏目 JSON 而无 `.canvas` 拓扑时，不臆测卡片坐标或空间关系。本包由 [Bookmark-Canvas](https://github.com/Browser-bookmark-hub/Bookmark-Canvas) 导出与维护；若 Agent 对底层数据格式、字段定义、校验兼容或导入导出契约存疑，可查阅该项目源码作为最高真相源。

```text
<画布数据包根目录>/
├── {{GUIDE_PRIMARY_NAME_PAD}}{{GUIDE_PRIMARY_NAME_ALIGN_SPACES}}(当前 AI 编辑指南)
├── <画布入口>.canvas                            (Obsidian JSON Canvas: 顶层宏观拓扑骨架，组织所有卡片、组与连线)
├── 永久栏目/                                    (对应浏览器真实书签树快照)
│   ├── A书签树（永久栏目）.json                   (主永久栏目 slot A，全包规范真相源)
│   └── B书签树（永久栏目）.json                   (可选永久栏目副本锚点 slot B，只存独立视图与说明)
└── 临时栏目/                                    (书签沙盒，用于推演与临时收集)
    ├── 常规链式/                                (链式派生沙盒: A-1, A-2, A-1-1, B-1)
    └── 特殊临时栏目/                            (AI 推荐、搜索、导入等按需创建的沙盒)
```

-----------------------------------------------------------------------------
## 2. 真实数据契约与示例 (Example-Driven Schemas)

### 2.1 入口拓扑：`<画布入口>.canvas` (Obsidian JSON Canvas Topology)
- **文件格式与规范**：`<画布入口>.canvas` 遵循 [JSON Canvas 规范](https://jsoncanvas.org/)，是全包视觉入口；保留已有紧凑排版。
- **实体形态与规范约束**：
  1. **file 节点 (`type: "file"`)**：以 vault 相对路径指向包内永久/临时 JSON，沿用当前 `.canvas` 同类引用的完整实际路径前缀；示例尖括号文字仅为说明占位符，禁止原样写入；不得指向图片、PDF 或音视频；临时栏目卡片 ID 沿用栏目 `id`，永久主卡与副本卡沿用其各自现有 ID 规则；
  2. **group 节点 (`type: "group"`)**：卡片组纯靠几何外接矩形（`x, y, width, height`）判定包含关系，不得写 `children`；子卡片落入组内，**不得向所属 group 连线**；允许组套组，一个节点可同时被多层 group 包含，这是合法拓扑，不要当重复归属去删组或移卡；
  3. **text 节点 (`type: "text"`)**：空白栏目或 Markdown 提示词，支持 `==高亮==` 与安全 HTML；优先沿用现有格式，遇到实际渲染兼容问题时说明并提供替代格式；不得擅自覆盖为书签 JSON。编辑便签时按节点 ID 修改 `text`，不必将整张画布读入上下文；
  4. **几何留白与 CJK 排版**：新增、移动或重排时，非 group 节点不得重叠；历史导入或空白卡占位造成的既有重叠可保留，但不要扩大；包含中文或长文本的节点必须预留充足宽高，避免被挤成狭窄难读竖条；
  5. **edge 连线 (`edges[]`)**：端点必须为现有 node ID，继承已有 `label` 关系文字；默认单箭头省略 `fromEnd` / `toEnd`，无箭头写 `toEnd: "none"`，双端箭头写 `fromEnd: "arrow"`；改边时保留已有箭头语义；
  6. **提示（用户复制输入的提示词）**：用户在对话中粘贴的 `type: "bookmark-canvas-anchor"`（锚点镜头）与 `workspaceType: "pinned"`（置顶工作区）均是用户从应用复制、作为额外提示词输入的，载荷中已自带 `description` 说明，属于外部会话上下文而非 `.canvas` 节点，严禁写进画布文件；仅用于辅助定位在屏视野与重点资产。
```json
{
	"nodes":[
		{"id":"permanent-section","type":"file","file":"<画布数据包根目录>/永久栏目/A书签树（永久栏目）.json","x":0,"y":0,"width":600,"height":600,"color":"4"},
		{"id":"permanent-section-copy-1","type":"file","file":"<画布数据包根目录>/永久栏目/B书签树（永久栏目）.json","x":720,"y":0,"width":600,"height":600,"color":"4"},
		{"id":"card-group-ai","type":"group","x":-40,"y":700,"width":1320,"height":620,"label":"AI 工作区","color":"5"},
		{"id":"temp-section-AI","type":"file","file":"<画布数据包根目录>/临时栏目/特殊临时栏目/AI AI 推荐栏目.json","x":0,"y":760,"width":525,"height":380,"color":"#e9973f"},
		{"id":"md-node-ai-prompt","type":"text","text":"## AI 推荐提示词\n根据当前主题检索高质量开源项目，输出到临时栏目。","x":600,"y":760,"width":420,"height":260,"color":"#888888"}
	],
	"edges":[
		{"id":"edge-ai-1","fromNode":"md-node-ai-prompt","fromSide":"right","toNode":"temp-section-AI","toSide":"left","color":"#999999","label":"生成产物"}
	]
}
```
示例中的 `<画布数据包根目录>` 仅用于说明结构，不是真实路径。新建 file 节点时，从当前 `.canvas` 复制同类 `file` 路径前缀；vault 子目录、包根目录和独立 vault 的前缀可能不同。

### 2.2 真实书签树：`永久栏目/A书签树（永久栏目）.json` (`slot: "A"`)
- **文件路径**：`永久栏目/A书签树（永久栏目）.json`（规范真相源）
- **实体形态与 ID 规范**：
  1. **节点 ID 与生成逻辑**：新增树节点用 `syncId_YYYYMMDD_hash_<token7>`；通过本地工具获取当天日期、生成 7 位小写 base36 token，生成后校验 ID 格式再写入。移动节点保留 ID，同步维护 `parentId` 与 `children`；导出文件里不要写本机 Chrome 数字 ID；
  2. **根目录保护**：`bookmarks-bar`、`other`、`mobile` 为浏览器顶层根目录，绝对不要增加、删除、移动或修改这些根节点；
  3. **元数据隔离**：`tags`、`note`、`noteColor` 严格存放于 `identityMap` 中并按 `syncId` 关联，保持 `tree` 纯净；仅有 note 无 tags 的条目也必须保留；同一主题 tag 保持同色；
  4. **浏览器时间字段**：`dateAdded` 是 Chrome Bookmarks API 返回的节点创建时间（毫秒）；`dateGroupModified`（若有）是文件夹内容最后变更时间，不是书签通用修改时间。Agent 不得新增、补写、计算或修改这两个字段；已有值原样保留，新建节点时省略。Chrome 在创建节点和文件夹内容变化时自行维护这些值；示例中的值只反映已有导出数据，不能抄到新节点；
  5. **永久树读取细节**：无插件时，按目标 ID 遍历 `tree.children` 并向上回溯祖先路径；节点有 `children` 则为文件夹，有 `url` 则为书签，外层 `tree` 容器不是用户目录。仅有标题或 URL 时先列候选并核实路径，再执行操作。永久元数据从 `identityMap` 按 `syncId` 关联读取。
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
        "dateAdded": 1763356913791,
        "folderType": "bookmarks-bar",
        "syncing": true,
        "children": [
          {
            "title": "windsurf promo code - Google 搜索",
            "id": "syncId_20260530_hash_2i6f661",
            "parentId": "syncId_20260530_hash_1c4v645",
            "dateAdded": 1781508287976,
            "url": "https://www.google.com/search?q=windsurf+promo+code"
          }
        ]
      },
      {
        "title": "Other Bookmarks",
        "id": "syncId_20260530_hash_8r5t1v6",
        "parentId": "syncId_20260530_hash_4xl2x2i",
        "dateAdded": 1763356913791,
        "folderType": "other",
        "syncing": true,
        "children": []
      }
    ]
  }
}
```

### 2.3 永久视图副本：`永久栏目/B书签树（永久栏目）.json` (`slot: "B"`)
- **文件路径**：`永久栏目/B书签树（永久栏目）.json`（可选副本锚点）
- **可选副本提示**：永久栏目副本为可选文件，仅当用户在画布中创建了永久副本时存在；若数据包中仅有 A 书签树而无此文件，直接跳过即可，严禁无故新建或视其为缺失异常。
- **实体形态**：副本只保存独立视图和 `descriptionMd`，通过 `inheritFrom` 指向主文件；`fileRole: "copy-anchor"`, `anchorOnly: true`；**严禁包含 `tree` 字段**。
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "permanent",
  "slot": "B",
  "title": "Permanent Bookmarks (Copy)",
  "descriptionMd": "副本说明：用于在另一处视图展示同一书签树。",
  "fileRole": "copy-anchor",
  "anchorOnly": true,
  "inheritFrom": "<画布数据包根目录>/永久栏目/A书签树（永久栏目）.json",
  "copyId": "permanent-copy-01"
}
```

### 2.4 普通链式临时栏目 (`tempKind: "regular"`)
- **文件路径**：`临时栏目/常规链式/*.json`（沙盒推演）
- **类型与占位字段**：判型以显式 `type` 为准。临时栏目源文件中的 folder 可带 `url: ""`，bookmark 可带 `children: []`；这是系统同构占位字段，不是损坏。工具、索引或插件返回时可能依然保留这些空占位，也可能省略；这不代表源文件已被清洗。读取时一律以显式 `type` 为准，不要将空占位视为异常；修改源文件时应以原节点为准，无关编辑时保留原字段，不要擅自删除或补齐。
- **实体形态与 ID 规范**：
  1. **标号与栏目 ID**：主永久派生 `A-1`、`A-2`，副本派生 `B-1`，子链如 `A-1-1`；同级编号取已用序号 max+1。栏目 ID 为 `temp-section-<label>`（如 `temp-section-A-1`）；导入或旧数据可能保留 `imported - <时间戳> - <随机数>` 形式的 id，原样保留，不要规范化；
  2. **节点 ID 与 sectionId**：新增 item 用 `tempId_YYYYMMDD_hash_<token7>`，日期和 token 按永久树同样通过工具生成，生成后校验 ID 格式再写入；各层级 `sectionId` 均指向所属栏目 ID，跨栏目移动时连同后代更新；
  3. **元数据内嵌**：`tags`、`note`、`noteColor` 直接作为 item 并列字段内嵌；分类有序时沿用现有层级，结构混乱时保持克制；
  4. **临时树读取细节**：按目标 ID 遍历 `items` 并向上回溯祖先路径；判型以显式 `type` 为准，不以 `url` 或 `children` 是否存在判断。不能因为是临时栏目就全量放入上下文；
  5. **兼容与唯一性**：`label` 可重复（例如两个 `A-5`），唯一性由 `id`、`sectionId` 与画布引用保证，不要为去重改 `label` 或 `id`；外部输入缺少 `label` 时补固定协议值 `unknown`。`source` 是栏目来源信息；编辑已有栏目时保留原值，来源未指定的新栏目按实际协议处理，不要清空已有值。功能名 label（如 `添加`、`存档`）的栏目在常规链式与特殊临时栏目两个目录都可能存在，判型以实际文件位置为准，不要按 label 推测目录。
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "temporary",
  "id": "temp-section-A-1",
  "label": "A-1",
  "title": "临时栏目 A-1",
  "tempKind": "regular",
  "descriptionMd": "说明当前临时栏目的用途。",
  "source": "",
  "items": [
    {
      "id": "tempId_20260530_hash_x6k2d5e",
      "sectionId": "temp-section-A-1",
      "title": "待整理链接",
      "url": "",
      "type": "folder",
      "children": [
        {
          "id": "tempId_20260530_hash_8a4c1d2",
          "sectionId": "temp-section-A-1",
          "title": "示例书签",
          "url": "https://example.com/",
          "type": "bookmark",
          "children": [],
          "note": "调研后补充分类",
          "noteColor": "blue",
          "tags": [
            {
              "color": "purple",
              "text": "待读"
            }
          ]
        }
      ]
    }
  ]
}
```

### 2.5 特殊临时栏目 (`tempKind: "special"`)
- **文件路径**：`临时栏目/特殊临时栏目/<label> <title>.json`（文件名由栏目标签、空格和标题组成；如 `添加 token测量.json`）。非法文件名字符由导出器规范化；新建时参照邻近文件及当前导出协议，不自行省略标题。
- **类型与占位字段**：判型以显式 `type` 为准。临时栏目源文件中的 folder 可带 `url: ""`，bookmark 可带 `children: []`；这是系统同构占位字段，不是损坏。工具、索引或插件返回时可能依然保留这些空占位，也可能省略；这不代表源文件已被清洗。读取时一律以显式 `type` 为准，不要将空占位视为异常；修改源文件时应以原节点为准，无关编辑时保留原字段，不要擅自删除或补齐。
- **实体形态与 label 规范**：
  1. **label 与栏目 ID**：仅特殊栏目允许自定义名称。`label` 可用系统功能名（搜索、拖入、批量、添加、导入等）、`AI` 或简短主题名（建议 10 字符内）；栏目 ID 为 `temp-section-<规范化label>`，冲突时追加后缀（如 `temp-section-AI-2`），不覆盖已有文件。生成 ID 前先沿用应用的 label 规范化：仅保留英文字母、数字、中文、`_`、`-`，其他字符替换为 `_`；功能名 label（如 `添加`、`存档`）的栏目在常规链式与特殊临时栏目两个目录都可能存在，判型以实际文件位置为准；
  2. **节点 ID 与来源标注**：新增子项用 `tempId_YYYYMMDD_hash_<token7>`，日期和 7 位小写 base36 token 通过工具生成，生成后校验 ID 格式再写入；各层级 `sectionId` 指向所属栏目；AI 生成栏目标记 `source: "ai-generated"`，推荐链接须经联网核验；
  3. **推荐落点**：先用用户指定落点，再用上下文明确的已有临时栏目；均无落点时才新建 AI 栏目及画布 file 卡片，保留独立提示词卡片。
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "temporary",
  "id": "temp-section-AI",
  "label": "AI",
  "title": "AI 推荐栏目",
  "tempKind": "special",
  "source": "ai-generated",
  "descriptionMd": "AI 自动调研并推荐的高质量书签。",
  "items": [
    {
      "id": "tempId_20260530_hash_m3k9p1a",
      "sectionId": "temp-section-AI",
      "title": "AI 推荐资源",
      "url": "",
      "type": "folder",
      "children": [
        {
          "id": "tempId_20260530_hash_q7w4e2r",
          "sectionId": "temp-section-AI",
          "title": "Bookmark-Canvas 官方仓库",
          "url": "https://github.com/Browser-bookmark-hub/Bookmark-Canvas",
          "type": "bookmark",
          "children": [],
          "note": "核心开源设计与文档基准",
          "noteColor": "green",
          "tags": [
            {
              "color": "blue",
              "text": "官方推荐"
            }
          ]
        }
      ]
    }
  ]
}
```

-----------------------------------------------------------------------------

## 3. 约束体系 (Constraint System)

按决策域分组：结构与权限约束在任何写操作前检查；数据格式约束在写条目或元数据时检查；操作规范贯穿全任务。

### 3.1 结构与权限约束
- **只读默认与授权编辑**：查找、问答和研究默认只读，不修改包；编辑须在用户明确授权范围内执行。
- **画布与栏目引用一致**：布局、文本、组与连线改 `.canvas`；书签内容改对应栏目 `.json`。仅改内容不要求改画布；新增、删除、移动或重命名栏目文件时，须同步维护 `file`、受影响的 edges 与副本 `inheritFrom`。删除画布 file 卡片只移除该 node 和关联 edges，不等于删除栏目 JSON 或其中的书签；删除栏目文件则须同步移除/改写引用。删除永久书签时同步清理对应 `identityMap` 条目；跨栏目移动临时 item 时保留 ID 并更新整棵移动子树的 `sectionId`。重命名时先核对应用实际 ID 规则，不因 label 改动而盲目重算 ID。仅在栏目用途确实改变时更新 `descriptionMd`，保留原 Markdown/HTML。修改后验证 JSON、引用及端点，避免悬空卡片或断链。
- **永久书签保护**：只读任务不修改包；永久栏目仅按用户明确要求修改，严禁改动浏览器顶层根节点（bookmarks-bar、other、mobile）。
- **GitHub 同步仓库纯净性**：用户要求提交/推送同步包时，仅精确暂存本次 `.canvas` 与栏目 `.json`；不混入个人笔记、缓存、PDF、图片或媒体，不删除用户文件来清理工作区。

### 3.2 数据格式约束
- **格式与 tag/note 使用**：`tags[].color` 与 `noteColor` 仅用 `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`gray`（不要写 `grey`，不要写 `#rrggbb`/`colorHex`）；该限制不适用于 `.canvas` 的 `color`。判型规则区分两套体系：永久书签树（无 `type` 字段）依据结构判型（持有有效 `url` 为书签，持有 `children` 为文件夹）；临时栏目树（必带显式 `type` 字段）判型唯一依据显式 `type`，字段存在与否不构成判型依据（folder 带有 `url: ""` 或 bookmark 带有 `children: []` 均为合法同构占位，严禁因存在这些字段而误判类型）。空 note 不导出，清空 note 时删除 `noteColor`，只有 note 无 tags 的 `identityMap` 条目也要保留；通过 JSON parser 读写，不靠字符串拼接生成 JSON；元数据按本文件的永久树规则存放，不因整理丢失原有数据。按内容与整理目标灵活添加 tag 与 note：tag 用于分类或筛选，note 用于补充背景、推荐理由或使用提示；有信息价值时可为多条甚至整组条目添加，不需要逐条征求许可。避免机械套用或无信息增量的 note，不用 note 重复标题、URL 或 tag；优先复用包内已有 tag 文字与颜色，同一主题同色。
- **条目 ID 与永久身份**：AI 新增条目通过工具生成 ID，写入前校验生成结果的前缀、当天日期及恰为 7 位的小写 base36 token，直接使用结果，避免手工重抄错误；这是新增约定，不用于判定已有 ID 能否导入。永久树新增节点使用新的 `syncId`，发现与主树已有节点或本批新增节点重复时重新生成，避免被当作同一书签；临时 item 不要求与全包条目查重。移动或编辑已有条目保留原 ID，不重新编号；栏目、画布节点和连线 ID 不套用条目格式。

### 3.3 操作规范
- **大 JSON 搜索与定位**：避免将大 JSON 整份读入上下文。Bookmark Research 可用时遵循插件自身 Skill；否则使用宿主提供的本地搜索工具。可用索引能力时用于辅助定位；无需为单次查询强制建索引。按命中位置从源文件读取目标条目及必要上下文，记录文件路径、条目 ID 与祖先路径，编辑时以源文件为准。
- **时间演化与历史线索**：ID 日期是生成线索；Git 记录版本变化，不能自动当作收藏或阅读时间。锚点 `timestamp`、置顶切片 `meta.generatedAt` 是复制时间；缺失日期不补猜测。永久书签树的 Chrome 时间字段遵循本文件的永久树规则；浏览器根节点示例中的 `syncing` 仅为示意值，实际只读并以导出值为准。
- **空间与配色**：新增、移动、调整尺寸或重排卡片时，用工具检查目标矩形与其他非 group 卡片的重叠；合法 group 包含关系不算重叠，已有重叠按本文件的画布规则处理。结合指定落点与锚点安排位置；要求在”这里/当前视野”放置时，整张卡片应在 `visibleRange` 的留白内，仅相交不够。为中文和长文本预留可读尺寸，空间不足时调整方案并说明；写后复核最终坐标与尺寸。沿用已有配色，按用户意图调整，不因局部编辑重配无关卡片颜色。
- **任务恢复与自检**：长对话恢复后，写前重读目标数据及相关规则；委派宿主（子）agent 时提供包路径、本指南路径、目标 ID 与落点。修改后按本次改动范围，对照所改文件或实体在 `## 2. 真实数据契约与示例` 中的对应说明与示例，以及 `## 3. 约束体系` 中的适用规则进行定向复核：校验对应 JSON 的可解析性与字段占位、所涉及条目 ID 的生成格式与层级一致性；若改动涉及画布，复核引用端点与重叠落点。检查差异，确认无意外删项、未知字段丢失或范围外变动，报告未核验事项。
