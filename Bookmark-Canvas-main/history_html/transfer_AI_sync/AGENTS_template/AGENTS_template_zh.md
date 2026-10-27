# 书签画布 AI Agent 编辑指南 ({{EXPORT_MODE_LABEL}})

> **握手与环境能力检测 (Handshake & Capabilities Detection)**
> - **专用研究插件 (`bookmark-research`)**：先确认当前宿主提供的 Skill / MCP / CLI；有配套 Skill 时先加载，索引、跨栏目检索与批量核验优先使用它。插件只读原包，编辑仍按本指南；写后查询前刷新同一来源的索引。工具未提供不等于未安装，可用性不明时再查宿主状态；不可用则直接读取，不阻塞任务。需要时提示安装：`npx bookmark-research@beta install <codex|claude|dsh> --non-interactive`。
> - **联网检索与网页阅读**：推荐新书签、补充网页事实时，使用宿主已有的搜索、正文读取或浏览器工具核验 URL、标题与摘要，不虚构链接；区分未核验与访问失败。本地结构分析无需联网。协议参考：[Bookmark-Canvas GitHub](https://github.com/Browser-bookmark-hub/Bookmark-Canvas)。
> - **Git 与时间上下文**：确认包是否处于 Git 仓库；需要历史时，用限定包路径的 `git log`、`git diff` 追踪实际变化。Git 仓库不一定是 GitHub 同步包；无 Git 时不推测版本历史。
> - **代码工具与大文件读取**：先看文件字节大小。大栏目或紧凑 `.canvas` 用 Python、Node.js 或 `jq` 解析，只向上下文返回目标节点、必要邻居与摘要；小文件可直接读。修改时按 ID 更新目标字段，保留其余数据；脚本可完整解析和序列化文件，不向对话倾倒整文件，也不盲目字符串替换。ID 生成与几何计算同样交给工具。
> - **规则效力与边界**：本指南仅约束当前数据包。查找、问答、分析与调研默认只读；编辑按用户授权范围执行，遵循本包 Schema 与文件路由。

## 1. 画布包物理结构与实体认知 (Package Structure & Entities)

本数据包以 Obsidian JSON Canvas 为拓扑入口，包含永久浏览器书签与临时沙盒栏目。路径以实际包为准；示例用于识别结构，编辑已有文件时保留其 schemaVersion、ID 与未知字段。当前协议版本：永久主文件为 `schemaVersion: 3`，副本与临时栏目为 `2`，不要统一成同一版本；已有文件保留原值，不要主动升级。

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
  1. **file 节点 (`type: "file"`)**：以 vault 相对路径指向包内永久/临时 JSON，沿用实际路径前缀；不得指向图片、PDF 或音视频；
  2. **group 节点 (`type: "group"`)**：卡片组纯靠几何外接矩形（`x, y, width, height`）判定包含关系，不得写 `children`；子卡片落入组内，**不得向所属 group 连线**；允许组套组，一个节点可同时被多层 group 包含，这是合法拓扑，不要当重复归属去删组或移卡；
  3. **text 节点 (`type: "text"`)**：空白栏目或 Markdown 提示词，支持 `==高亮==` 与安全 HTML；优先沿用现有格式，遇到实际渲染兼容问题时说明并提供替代格式；不得擅自覆盖为书签 JSON。编辑便签时按节点 ID 修改 `text`，不必将整张画布读入上下文；
  4. **几何留白与 CJK 排版**：新增、移动或重排时，非 group 节点不得重叠；历史导入或空白卡占位造成的既有重叠可保留，但不要扩大；包含中文或长文本的节点必须预留充足宽高，避免被挤成狭窄难读竖条；
  5. **edge 连线 (`edges[]`)**：端点必须为现有 node ID，继承已有 `label` 关系文字；
  6. **空间视口与锚点镜头**：`type: "bookmark-canvas-anchor"` 的 `visibleRange` 是世界坐标视野。用矩形相交筛选在屏卡片：`node.x < minX + width && node.x + node.width > minX && node.y < minY + height && node.y + node.height > minY`。在“这里/当前视野”新增时，整张卡片应落在视野留白内；空间不足时说明并调整方案；
  7. **置顶与关系语义**：`workspaceType: "pinned"` 是关注对象切片，不是视野矩形；按 ID/路径回查当前画布，避免照抄占位或过期坐标。分析时结合组、连线方向/label 与邻近文本，空间接近不自动等于内容归属。
```json
{
	"nodes":[
		{"id":"permanent-section","type":"file","file":"<画布数据包根目录>/永久栏目/A书签树（永久栏目）.json","x":0,"y":0,"width":600,"height":600,"color":"4"},
		{"id":"permanent-section-copy-1","type":"file","file":"<画布数据包根目录>/永久栏目/B书签树（永久栏目）.json","x":720,"y":0,"width":600,"height":600,"color":"4"},
		{"id":"card-group-ai","type":"group","x":-40,"y":700,"width":1320,"height":620,"label":"AI 工作区","color":"5"},
		{"id":"temp-section-AI","type":"file","file":"<画布数据包根目录>/临时栏目/特殊临时栏目/AI.json","x":0,"y":760,"width":525,"height":380,"color":"#e9973f"},
		{"id":"md-node-ai-prompt","type":"text","text":"## AI 推荐提示词\n根据当前主题检索高质量开源项目，输出到临时栏目。","x":600,"y":760,"width":420,"height":260,"color":"#888888"}
	],
	"edges":[
		{"id":"edge-ai-1","fromNode":"md-node-ai-prompt","fromSide":"right","toNode":"temp-section-AI","toSide":"left","color":"#999999","label":"生成产物"}
	]
}
```

### 2.2 真实书签树：`永久栏目/A书签树（永久栏目）.json` (`slot: "A"`)
- **文件路径**：`永久栏目/A书签树（永久栏目）.json`（规范真相源）
- **实体形态与 ID 规范**：
  1. **节点 ID 与生成逻辑**：新增树节点用 `syncId_YYYYMMDD_hash_<token7>`；通过本地工具获取当天日期、生成 7 位小写 base36 token，生成后按核心红线校验完整 ID 再写入。移动节点保留 ID，同步维护 `parentId` 与 `children`；导出文件里不要写本机 Chrome 数字 ID；
  2. **根目录保护**：`bookmarks-bar`、`other`、`mobile` 为浏览器顶层根目录，绝对不要增加、删除、移动或修改这些根节点；
  3. **元数据隔离**：`tags`、`note`、`noteColor` 严格存放于 `identityMap` 中并按 `syncId` 关联，保持 `tree` 纯净；仅有 note 无 tags 的条目也必须保留；同一主题 tag 保持同色；
  4. **体量特征与操作策略**：大树按握手中的脚本策略定点提取与修改，不将全树放入上下文；保留未命中条目与元数据。
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

### 2.3 永久视图副本：`永久栏目/B书签树（永久栏目）.json` (`slot: "B"`)
- **文件路径**：`永久栏目/B书签树（永久栏目）.json`（可选副本锚点）
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
- **实体形态与 ID 规范**：
  1. **标号与栏目 ID**：主永久派生 `A-1`、`A-2`，副本派生 `B-1`，子链如 `A-1-1`；同级编号取已用序号 max+1。栏目 ID 为 `temp-section-<label>`（如 `temp-section-A-1`）；导入或旧数据可能保留 `imported - <时间戳> - <随机数>` 形式的 id，原样保留，不要规范化；
  2. **节点 ID 与 sectionId**：新增 item 用 `tempId_YYYYMMDD_hash_<token7>`，日期和 token 按永久树同样通过工具生成，生成后按核心红线校验完整 ID 再写入；各层级 `sectionId` 均指向所属栏目 ID，跨栏目移动时连同后代更新；
  3. **元数据内嵌**：`tags`、`note`、`noteColor` 直接作为 item 并列字段内嵌；分类有序时沿用现有层级，结构混乱时保持克制；
  4. **体量分流与沙盒机制**：小栏目可直接读写；大栏目按握手中的脚本策略处理，不能因为是临时栏目就全量放入上下文；
  5. **兼容与唯一性**：`label` 可重复（例如两个 `A-5`），唯一性由 `id`、`sectionId` 与画布引用保证，不要为去重改 `label` 或 `id`；外部输入缺少 `label` 时补固定协议值 `unknown`。
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
  "items": [
    {
      "id": "tempId_20260530_hash_x6k2d5e",
      "sectionId": "temp-section-A-1",
      "title": "待整理链接",
      "type": "folder",
      "children": [
        {
          "id": "tempId_20260530_hash_8a4c1d2",
          "sectionId": "temp-section-A-1",
          "title": "示例书签",
          "url": "https://example.com/",
          "type": "bookmark",
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
- **文件路径**：`临时栏目/特殊临时栏目/<label>.json`（如 `AI.json`、`导入.json`、`批量.json`）
- **实体形态与 label 规范**：
  1. **label 与栏目 ID**：仅特殊栏目允许自定义名称。`label` 可用系统功能名（搜索、拖入、批量、添加、导入等）、`AI` 或简短主题名（建议 10 字符内）；栏目 ID 为 `temp-section-<label>`，冲突时追加后缀（如 `temp-section-AI-2`），不覆盖已有文件；
  2. **节点 ID 与来源标注**：新增子项用 `tempId_YYYYMMDD_hash_<token7>`，日期和 7 位小写 base36 token 通过工具生成，生成后按核心红线校验完整 ID 再写入；各层级 `sectionId` 指向所属栏目；AI 生成栏目标记 `source: "ai-generated"`，推荐链接须经联网核验；
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
      "type": "folder",
      "children": [
        {
          "id": "tempId_20260530_hash_q7w4e2r",
          "sectionId": "temp-section-AI",
          "title": "Bookmark-Canvas 官方仓库",
          "url": "https://github.com/Browser-bookmark-hub/Bookmark-Canvas",
          "type": "bookmark",
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

## 3. 核心红线与其他规范 (Core Red Lines & Supplemental Context)

修改时遵循以下边界，并按改动范围检查：

- **核心绝对红线 (Core Red Lines)**：
  1. **画布与栏目引用一致**：布局、文本、组与连线改 `.canvas`；书签内容改对应栏目 `.json`。仅改内容不要求改画布；新增、删除、移动或重命名栏目文件时，须同步维护 `file`、受影响的 edges 与副本 `inheritFrom`。修改后验证 JSON、引用及端点，避免悬空卡片或断链。
  2. **永久书签保护**：只读任务不修改包；永久栏目仅按用户明确要求修改，严禁改动浏览器顶层根节点（bookmarks-bar、other、mobile）。
  3. **GitHub 同步仓库纯净性**：用户要求提交/推送同步包时，仅精确暂存本次 `.canvas` 与栏目 `.json`；不混入个人笔记、缓存、PDF、图片或媒体，不删除用户文件来清理工作区。
  4. **调色板与 JSON 读写**：`tags[].color` 与 `noteColor` 仅用 `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`gray`；该限制不适用于 `.canvas` 的 `color`。通过 JSON parser 读写，不靠字符串拼接生成 JSON。
  5. **元数据兼容与保留**：`gray` 不要写 `grey`，不要写 `#rrggbb`/`colorHex`；空 note 不导出，清空 note 时删除 `noteColor`，只有 note 无 tags 的 `identityMap` 条目也要保留；元数据存放位置遵循 §2，不因整理丢失原有数据。
  6. **条目 ID 与永久身份**：AI 新增条目通过工具生成 ID，写入前校验生成结果的前缀、当天日期及恰为 7 位的小写 base36 token，直接使用结果，避免手工重抄错误；这是新增约定，不用于判定已有 ID 能否导入。永久树新增节点使用新的 `syncId`，发现与主树已有节点或本批新增节点重复时重新生成，避免被当作同一书签；临时 item 不要求与全包条目查重。移动或编辑已有条目保留原 ID，不重新编号；栏目、画布节点和连线 ID 不套用条目格式。
- **其他规范与上下文 (Supplemental Context & Guidelines)**：
  1. **tag 与 note 使用**：按内容与整理目标灵活添加：tag 用于分类或筛选，note 用于补充背景、推荐理由或使用提示；有信息价值时可为多条甚至整组条目添加，不需要为每条单独征求许可。避免机械地给所有条目套上同样的 tag 或无信息增量的 note，不用 note 简单重复标题、URL 或 tag。优先复用包内已有 tag 文字与颜色，同一主题同色；已有元数据按本次编辑范围保留或调整。
  2. **时间演化与历史线索**：`dateAdded`（若有）是毫秒收藏时间；ID 日期是生成线索；Git 记录版本变化，不能自动当作收藏或阅读时间。锚点 `timestamp`、置顶切片 `meta.generatedAt` 是复制时间；缺失日期不补猜测。
  3. **空间与配色**：新增、移动、调整尺寸或重排卡片时，用工具检查目标矩形与其他非 group 卡片的重叠；合法 group 包含关系不算重叠，历史重叠按 §2.1 处理。结合指定落点与锚点安排位置；要求在“这里/当前视野”放置时，整张卡片应在 `visibleRange` 的留白内，仅相交不够。为中文和长文本预留可读尺寸，空间不足时调整方案并说明；写后复核最终坐标与尺寸。沿用已有配色，按用户意图调整，不因局部编辑重配无关卡片颜色。
  4. **任务恢复与自检**：长对话恢复后，写前重读目标数据及相关规则；委派宿主子 agent 时提供包路径、本指南路径、目标 ID 与落点。修改后按改动范围复核 JSON 可解析性、新增条目 ID 的生成格式、永久树身份一致性、各层级 `sectionId`、文件引用与 edge 端点；调整布局时一并检查卡片重叠、指定落点及适用的锚点边界。检查差异，确认无意外删项、未知字段丢失或范围外变动，报告未核验事项。
