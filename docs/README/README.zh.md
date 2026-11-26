# Bookmark-Canvas

[![Linux.do](https://img.shields.io/badge/Linux.do-Portfolio-FFD700?logo=discourse&logoColor=white)](https://linux.do/u/kk1/activity/portfolio) [![GitHub Releases](https://img.shields.io/github/v/release/Browser-bookmark-hub/Bookmark-Canvas?logo=github&logoColor=white&label=GitHub+Releases)](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/releases) [![Chrome 应用商店](https://img.shields.io/chrome-web-store/v/phfcempdjanpkhejmlhaokkpnkmbinao?color=0F9D58&logo=googlechrome&logoColor=white&label=Chrome+Web+Store)](https://chromewebstore.google.com/detail/bookmark-canvas/phfcempdjanpkhejmlhaokkpnkmbinao) [![Microsoft Edge Add-ons](https://img.shields.io/badge/Edge_Add--ons-Available-0078D7?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/aghognidifljbnchpnnfddjccodjaigg) [![GitHub Bookmark-Backup](https://img.shields.io/badge/GitHub-Bookmark--Backup-181717?logo=github&logoColor=white)](https://github.com/Browser-bookmark-hub/Bookmark-Backup) [![GitHub Bookmark-Record-Recommend](https://img.shields.io/badge/GitHub-Bookmark--Record--Recommend-181717?logo=github&logoColor=white)](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend)

## Switch to [English](../../README.md)...

### 书签聚合研究插件

专为书签画布导出包打造的配套只读研究插件（Skill + 本地 MCP）。方便各类 Coding Agent 宿主（**Claude Code**、**Codex**、**DeepSeek Harness** 等 harness 运行环境）直接索引、检索与调研书签内容，无需手动解析大型画布 JSON 且不修改包结构。

[插件仓库与安装说明（Codex、Claude Code、DeepSeek Harness (dsh)）→](https://github.com/Browser-bookmark-hub/Bookmark-Research)

### AI Agent 编辑数据的约束文件

如需供 AI Agent 编辑的约束文件，或了解本项目导出数据的格式与处理边界：
  - **对于 `.canvas` 数据包**（包括整张画布、卡片组或临时选区导出的数据包），使用包内附带的约束文件（示例：`AGENTS.md`）。
  - **对于单独导出的 JSON 或 HTML**，请复制下方与任务语言对应的模板链接地址，直接提供给 Agents 即可。

`AGENTS_template_en.md`：

```text
https://raw.githubusercontent.com/Browser-bookmark-hub/Bookmark-Canvas/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template/AGENTS_template_en.md
```

`AGENTS_template_zh.md`：

```text
https://raw.githubusercontent.com/Browser-bookmark-hub/Bookmark-Canvas/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template/AGENTS_template_zh.md
```

### 简介

`书签画布（Bookmark-Canvas）` 是一款面向 Chrome / Edge 的 Manifest V3 书签管理器。它把浏览器书签与基于 JSON Canvas 的可视化工作区结合：浏览器书签对应的**永久栏目**、独立的**临时栏目**、**空白栏目**、**卡片组**和有方向的连接线，可以共同组织在同一张画布中。

画布数据包（示例数据包可参考 [Releases](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/releases/download/v1.0.0/bookmark-canvas-selection-20260730-122655_example.zip) 的部分版本）可在本地导入导出，也可推送到或从个人 GitHub 仓库拉取。导出和推送的数据包会附带 [AGENTS_template](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template)，供兼容的 AI 客户端在处理前理解数据边界。

### 预览

#### 视频预览

[![观看 Bookmark Canvas 演示视频](https://img.youtube.com/vi/aOxFcbBQD98/maxresdefault.jpg)](https://www.youtube.com/watch?v=aOxFcbBQD98)

#### 截图预览

<p align="center"><strong>侧边栏（卡片全屏）与标签页（全局状态）</strong></p>

![侧边栏（卡片全屏）与标签页（全局状态）](../../Media%20and%20icons/v1.0.0/%E7%94%BB%E5%B8%83%E7%A4%BA%E4%BE%8B%E5%9B%BE%20zh.png)

<p align="center"><strong>GitHub 配置</strong></p>

![GitHub 配置](../../Media%20and%20icons/v1.0.0/GitHub%E9%85%8D%E7%BD%AE%20zh.png)

#### 书签生态项目

<table>
  <tr>
    <th width="33.33%"><a href="https://github.com/Browser-bookmark-hub/Bookmark-Canvas">书签画布</a></th>
    <th width="33.33%"><a href="https://github.com/Browser-bookmark-hub/Bookmark-Backup">书签备份</a></th>
    <th width="33.33%"><a href="https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend">书签记录与推荐</a></th>
  </tr>
  <tr>
    <td><img width="100%" alt="书签画布经过 Codex 处理示例" src="../../Media%20and%20icons/v1.0.0/生态--书签画布--经过codex处理%20zh%20en.png"></td>
    <td><img width="100%" alt="书签备份导出示例" src="../../Media%20and%20icons/v1.0.0/生态--书签备份--画布示例--当前变化%20zh%20en.png"></td>
    <td><img width="100%" alt="书签记录与推荐关联记录示例" src="../../Media%20and%20icons/v1.0.0/生态--书签记录与推荐--画布示例--关联记录zh%20en.png"></td>
  </tr>
</table>

### 初始引导

空画布首次打开时，可见三张说明卡片：**画布基础**、**快捷操作**、**特色功能**。完整的三部分内容见 [`初始引导.md`](../%E5%88%9D%E5%A7%8B%E5%BC%95%E5%AF%BC.md)，建议优先熟悉以下六条规则：

1. **基本交互**：永久栏目直接对应浏览器书签树。<ins>将永久栏目或临时栏目中的书签、文件夹拖动到画布空白区域，可生成新的临时栏目</ins>；永久栏目采用对象复制的副本规则，临时栏目采用可进可出的移动规则。<ins>书签和文件夹也可在栏目之间相互拖动</ins>。
2. **侧边栏与 HTML 页面**：点击扩展图标可打开侧边栏，<ins>侧边栏适合使用卡片全屏模式</ins>。点击「HTML 页面」可打开或定位书签画布标签页，也可使用：
   - `Ctrl + Shift + X`（macOS 为 `Command + Shift + X`）：通过扩展 action 打开侧边栏。
   - `Ctrl + Shift + Space`（macOS 为 `Command + Shift + Space`）：打开或定位书签画布标签页。
3. **缩放与平面滚动**：
   - **`Ctrl + 滚轮`**：缩放画布。
   - **`空格 + 左键`**：拖动画布。
   - **触控板双指捏合 / 双指滑动**：分别缩放 / 拖动画布。
   - **`Shift + 滚轮`**：横向滚动，可避开栏目内部的垂直滚动捕获。
4. **批量/选中操作（批量模式）**：
   - **`Shift | Option/Alt + 左键单击`**：在批量或单个选中模式下选中书签/文件夹；进入批量模式后，直接左键单击也可以选中。
   - **`Ctrl / Command + A`**：选中光标所在栏目中的全部书签/文件夹。
   - **`Ctrl / Command + X`**：剪切已选项目。
   - **`Ctrl / Command + C`**：复制已选项目。
   - **`Ctrl / Command + V`**：按光标位置粘贴：文件夹内、书签同级位置下方、临时栏目根部、空白永久栏目的书签栏根部；画布空白会新建「粘贴」临时栏目。
   - **文本**：保持浏览器原生粘贴行为。
5. **鼠标规则**：
   - **`Ctrl + 左键`**：拖动画布或移动卡片。
   - **`Ctrl + 右键`**：调整卡片大小；再次 `Ctrl + 右键` 完成调整。
   - **空白处左键拖动**：框选元素，形成临时选区组。
   - **普通右键**：打开当前对象的菜单（永久栏目、永久栏目副本、临时栏目、特殊临时栏目、空白栏目、卡片组、连接线、临时选区组、画布空白区域），可进行全屏、定位、置顶、设置颜色、重命名、删除或<ins>导出</ins>。
6. **推送 / 拉取安全**：推送会清理已配置的远端同步目录。⚠️ <ins>请勿在其中放入无关笔记或媒体，否则可能被彻底删除；画布不支持视频、音频、图片、PDF 等外部文件节点</ins>。详见 [`限制与妥协.md`](../%E9%99%90%E5%88%B6%E4%B8%8E%E5%A6%A5%E5%8D%8F.md)。

### 路线图

#### 近期路线

- [x] **AI 约束规范与伴侣插件（`AGENTS_template` + `Bookmark Research`）**：随导出和推送包附带 [AGENTS_template](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template) 规范数据结构与编辑边界；只读伴侣插件 [Bookmark Research](https://github.com/Browser-bookmark-hub/Bookmark-Research)（Skill + 本地 MCP + CLI，支持 Codex、Claude Code、DeepSeek Harness）已发布。支持通过 [R5 规范](#ref-r5) 与 [书签备份](https://github.com/Browser-bookmark-hub/Bookmark-Backup)、[书签记录与推荐](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend) 协同。
- [x] **搜索多维视图、浏览统计与富文本升级（`v1.5.0`）**：搜索面板已落地多维表格视图（Tabulator）与按天分桶的本地浏览统计（`@热度` / `@最近`）；空白卡与备注已迁移至 TipTap v3 富文本并支持离线 Mermaid 渲染与浮层大图。
- [ ] **生态与 Agent Plugin 集成**：继续围绕 [Agent Plugin specification](https://agent-plugins.org/specification)（参考 [Claude Code Plugin 文档](https://code.claude.com/docs/en/plugins)）完善 Skill 与 MCP 组合能力。详见 [`../路线图与架构演进思考.md`](../%E8%B7%AF%E7%BA%BF%E5%9B%BE%E4%B8%8E%E6%9E%B6%E6%9E%84%E6%BC%94%E8%BF%9B%E6%80%9D%E8%80%83.md)。

#### 长期路线

- [x] 🔄 **设置分离与伴随上下文输出（半✅ 阶段性进展）**：已支持一键复制侧边栏锚点视野（`visibleRange`，`type: "bookmark-canvas-anchor"`）；后续规划独立 `setting.json` 持久化，以及按需导出只读「时空上下文」（访问热度、锚点视野、置顶/折叠状态），赋能 [Bookmark Research](https://github.com/Browser-bookmark-hub/Bookmark-Research) 且保持核心 `.canvas`/`.json` 数据纯净。
- [x] 🔄 **性能与内存架构演进（阶段性进展）**：已完成大树懒加载、强制回流治理、低细节降级与视野外 DOM 虚拟化；后续研究「壳肉分离」（按视口按需加载 `bcs:section` 与释放 JS 内存）及低细节缩放阈值滞回防闪烁。详见 [`../路线图与架构演进思考.md`](../%E8%B7%AF%E7%BA%BF%E5%9B%BE%E4%B8%8E%E6%9E%B6%E6%9E%84%E6%BC%94%E8%BF%9B%E6%80%9D%E8%80%83.md)。
- [ ] **语言增加与界面适配**：在简中/英文外继续补齐更多语言文案与排版测试（翻译 README 可放于 [`./`](./)）。详见 [`../限制与妥协.md`](../%E9%99%90%E5%88%B6%E4%B8%8E%E5%A6%A5%E5%8D%8F.md)。
- [ ] **限制、妥协与外部变化跟踪**：坚持范围边界（不做附件管理器或第二个 Obsidian），并持续跟踪 Chrome / Edge 书签 API、GitHub 哈希规范及浏览器协同能力变化。见 [`../限制与妥协.md`](../%E9%99%90%E5%88%B6%E4%B8%8E%E5%A6%A5%E5%8D%8F.md) 与 [`../后续跟踪-浏览器根模型与GitHub哈希.md`](../%E5%90%8E%E7%BB%AD%E8%B7%9F%E8%B8%AA-%E6%B5%8F%E8%A7%88%E5%99%A8%E6%A0%B9%E6%A8%A1%E5%9E%8B%E4%B8%8EGitHub%E5%93%88%E5%B8%8C.md)。

### 相关文档

- [文档目录](../)
- [归档索引](../Archived/00--%E5%BD%92%E6%A1%A3%E7%B4%A2%E5%BC%95-%E8%AF%B7%E5%85%88%E8%AF%BB.md)

### 参考

**外部参考**

- [JSON Canvas](https://github.com/obsidianmd/jsoncanvas)
- [Obsidian JSON Canvas Skill](https://github.com/kepano/obsidian-skills/tree/main/skills/json-canvas)
- [xyflow](https://github.com/xyflow/xyflow)
- [Obsidian Editing Toolbar](https://github.com/PKM-er/obsidian-editing-toolbar)
- [AltSnap](https://github.com/RamonUnch/AltSnap)

## 格式

以下 R2-R7 格式示例来自 [AGENTS_template](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template)。示例数据包可参考 [Releases](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/releases) 的部分版本。

<ins>若 Agent 读取到此处，请务必阅读上述两个链接，至少不可跳过 AGENTS_template。</ins>

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
临时项以显式 `type` 区分文件夹与书签；不要根据空 `url` 或 `children` 数组等占位字段推断条目类型。
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
AI 新增书签建议或生成书签树且没有现成指定落点时，使用这种栏目；若用户或上下文已经指定已有落点，按 [S2](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/blob/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template/AGENTS_template_zh.md#s2-ai-%E7%94%9F%E6%88%90%E4%B9%A6%E7%AD%BE%E7%9A%84%E8%B7%AF%E7%94%B1%E4%BC%98%E5%85%88%E7%BA%A7) 路由。

R5 同时也是生态共建参考：其他插件或工具向书签画布贡献生成、推荐或处理结果时，可参考这一结构。相关生态方向可见[书签备份（Bookmark-Backup）](https://github.com/Browser-bookmark-hub/Bookmark-Backup)与[书签记录与推荐（Bookmark-Record-Recommend）](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend)。

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

## 数据与隐私

- 画布数据、设置、本地索引和缓存默认保存在浏览器扩展的本地存储 / IndexedDB；本项目不运营专用后端服务。
- GitHub 推送 / 拉取为可选功能，只会访问用户自行配置的仓库。
- 书签、存储、下载、标签页、标签组、窗口、当前标签页、favicon、idle 状态与站点访问等权限，用于书签管理、画布交互、图标显示及相关浏览器集成。
- 完整的数据处理与权限说明见英文版 [Privacy Policy](../../PRIVACY_POLICY.md)。

## License
[GPL-3.0](../../Bookmark-Canvas-main/LICENSE)。

## [返回顶部](#switch-to-english)
