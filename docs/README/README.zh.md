## Switch to [English](../../README.md)...

[![Linux.do](https://img.shields.io/badge/Linux.do-Portfolio-FFD700?logo=discourse&logoColor=white)](https://linux.do/u/kk1/activity/portfolio) [![Chrome 应用商店](https://img.shields.io/chrome-web-store/v/phfcempdjanpkhejmlhaokkpnkmbinao?color=0F9D58&logo=googlechrome&logoColor=white&label=Chrome+Web+Store)](https://chromewebstore.google.com/detail/bookmark-canvas/phfcempdjanpkhejmlhaokkpnkmbinao) [![GitHub Releases](https://img.shields.io/github/v/release/Browser-bookmark-hub/Bookmark-Canvas?logo=github&logoColor=white&label=GitHub+Releases)](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/releases) [![GitHub Bookmark-Backup](https://img.shields.io/badge/GitHub-Bookmark--Backup-181717?logo=github&logoColor=white)](https://github.com/Browser-bookmark-hub/Bookmark-Backup) [![GitHub Bookmark-Record-Recommend](https://img.shields.io/badge/GitHub-Bookmark--Record--Recommend-181717?logo=github&logoColor=white)](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend)

### 简介

`书签画布（Bookmark-Canvas）` 是一款面向 Chrome / Edge 的 Manifest V3 书签管理器。它把浏览器书签与基于 JSON Canvas 的可视化工作区结合：浏览器书签对应的**永久栏目**、独立的**临时栏目**、**空白栏目**、**卡片组**和有方向的连接线，可以共同组织在同一张画布中。

画布数据包（示例数据包可参考 [Releases](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/releases) 的部分版本）可在本地导入导出，也可推送到或从个人 GitHub 仓库拉取。导出和推送的数据包会附带 [AGENTS_template](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template)，供兼容的 AI 客户端在处理前理解数据边界。

### 预览

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

#### 视频预览

[`Media and icons/`](../../Media%20and%20icons/) 中已预留画布工作流、导入导出和 GitHub 同步演示的视频位置。

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

- [ ] **默认约束文件共建完善**：完善随导出和推送数据包附带的 `AGENTS.md` / `CLAUDE.md` 风格约束，让不同 AI 客户端理解画布结构、数据协议与编辑边界。模板入口见 [AGENTS_template](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template)。
- [ ] **生成、分析与生态共建**：以书签画布为主，优先创建服务于本项目的独立 Skill，分别处理生成与分析；两者暂不合并。
  - **生成 Skill**：生成结果集中在书签画布的数据模型中，支持单个 JSON，或包含 `.canvas` 的单个数据包。
  - **分析 Skill**：优先分析书签画布本项目与范围明确的画布数据；索引建立、RAG 与 Deep Research（外部或内部）均待实践后再扩展。
  - **综合 Skill**：开放基础格式与 Skill 方向，并邀请生态项目 [书签备份（Bookmark Backup）](https://github.com/Browser-bookmark-hub/Bookmark-Backup) 与 [书签记录与推荐（Bookmark Record and Recommend）](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend) 参与；生成结果仍以书签画布为主要承载。
  - **R5 生态参考**：[R5 AI 特殊临时栏目示例](#ref-r5)提供了 AI 生成书签建议或书签树时可复用的参考形状。其他插件或工具向书签画布贡献生成、推荐或处理结果时也可参考；书签备份与书签记录与推荐是当前生态中的参考方向。
  - **其他能力探索（待完善）**：详见 [`../路线图前瞻-数据处理CLI-Skill-客户端-AI化.md`](../%E8%B7%AF%E7%BA%BF%E5%9B%BE%E5%89%8D%E7%9E%BB-%E6%95%B0%E6%8D%AE%E5%A4%84%E7%90%86CLI-Skill-%E5%AE%A2%E6%88%B7%E7%AB%AF-AI%E5%8C%96.md)。
- [ ] **标签与备注管理探索**：目前搜索面板已经可以直接浏览和查看标签、备注。独立管理页暂不作为确定功能；它需要先解决批量管理和导出的问题，而不是重复现有查看器。

#### 长期路线

- [ ] **设置持久化与后端上云调研**：锚点、外观、永久栏目及副本、临时栏目文件夹折叠状态、垂直滚动等设置，与画布数据包目前存在不同的持久化边界。完整导入导出或云端支持涉及复杂状态与恢复语义，暂不建议贸然承诺。当前重点仍在数据处理；即使未来考虑客户端或部署方案，上云也不是近期重点。相关前瞻见 [`../路线图前瞻-数据处理CLI-Skill-客户端-AI化.md`](../%E8%B7%AF%E7%BA%BF%E5%9B%BE%E5%89%8D%E7%9E%BB-%E6%95%B0%E6%8D%AE%E5%A4%84%E7%90%86CLI-Skill-%E5%AE%A2%E6%88%B7%E7%AB%AF-AI%E5%8C%96.md)。
- [ ] **性能持续跟进**：持续让实现尽可能吃满浏览器可用的 CPU / GPU 与渲染能力，并跟进 Chrome、硬件与相关 API 的变化。当前低细节、视野外降级、懒加载、视野内外虚拟化等策略仍是现实的必要妥协；未来不应把今天的性能上限当成固定结论。
- [ ] **语言增加与调试**：当前界面主要围绕简体中文与英文实现；繁体中文、法语、俄语、西班牙语、阿拉伯语、日语、韩语等语言需要补齐文案并逐页调试布局；README 翻译文档可以继续放在 [`./`](./)。详见 [`../限制与妥协.md`](../%E9%99%90%E5%88%B6%E4%B8%8E%E5%A6%A5%E5%8D%8F.md)。项目大量界面文案仍是硬编码，并非完整 i18n 系统：要么重构语言系统，要么通过索引和检索现有中英文文案逐项补齐。
- [ ] **限制、妥协与外部变化持续跟踪**：持续记录浏览器平台边界与主动的范围取舍，例如<ins>不把书签画布做成附件管理器、文件管理器或第二个 Obsidian</ins>；同时跟进 Chrome / Edge 行为、浏览器 API 变化与 bug 修复，以及 GitHub API、哈希等外部约束。见 [`../限制与妥协.md`](../%E9%99%90%E5%88%B6%E4%B8%8E%E5%A6%A5%E5%8D%8F.md) 与 [`../后续跟踪-浏览器根模型与GitHub哈希.md`](../%E5%90%8E%E7%BB%AD%E8%B7%9F%E8%B8%AA-%E6%B5%8F%E8%A7%88%E5%99%A8%E6%A0%B9%E6%A8%A1%E5%9E%8B%E4%B8%8EGitHub%E5%93%88%E5%B8%8C.md)。

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
