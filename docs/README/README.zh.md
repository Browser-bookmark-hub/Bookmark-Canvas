## Switch to [English](../../README.md)...

[![Linux.do](https://img.shields.io/badge/Linux.do-Portfolio-FFD700?logo=discourse&logoColor=white)](https://linux.do/u/kk1/activity/portfolio)
[![GitHub Releases](https://img.shields.io/github/v/release/Browser-bookmark-hub/Bookmark-Canvas?logo=github&logoColor=white&label=GitHub+Releases)](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/releases)

### 简介

`书签画布（Bookmark Canvas）` 是一款面向 Chrome / Edge 的 Manifest V3 书签管理器。它把浏览器书签与基于 JSON Canvas 的可视化工作区结合：浏览器书签对应的**永久栏目**、独立的**临时栏目**、**空白栏目**、**卡片组**和有方向的连接线，可以共同组织在同一张画布中。

画布数据包可在本地导入导出，也可推送到或从个人 GitHub 仓库拉取。导出和推送的数据包会附带 [AI 约束模板](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template)，供兼容的 AI 客户端在处理前理解数据边界。

### 初始引导

空画布首次打开时，可见三张说明卡片：**画布基础**、**快捷操作**、**特色功能**。完整的三部分内容见 [`初始引导.md`](../%E5%88%9D%E5%A7%8B%E5%BC%95%E5%AF%BC.md)，建议优先熟悉以下五条规则：

1. **基本交互**：永久栏目直接对应浏览器书签树。<ins>将永久栏目或临时栏目中的书签、文件夹拖动到画布空白区域，可生成新的临时栏目</ins>；永久栏目采用对象复制的副本规则，临时栏目采用可进可出的移动规则。<ins>书签和文件夹也可在栏目之间相互拖动</ins>。
2. **侧边栏与 HTML 页面**：点击扩展图标可打开侧边栏，<ins>侧边栏适合使用卡片全屏模式</ins>。点击「HTML 页面」可打开或定位书签画布标签页，也可使用：
   - `Ctrl + Shift + X`（macOS 为 `Command + Shift + X`）：通过扩展 action 打开侧边栏。
   - `Ctrl + Shift + Space`（macOS 为 `Command + Shift + Space`）：打开或定位书签画布标签页。
3. **缩放与平面滚动**：`Ctrl + 滚轮` 缩放，`空格 + 左键` 拖动画布；触控板双指捏合缩放、双指滑动拖动画布。`Shift + 滚轮` 横向滚动，可避开栏目内部的垂直滚动捕获。
4. **鼠标规则**：
   - **`Ctrl + 左键`**：拖动画布或移动卡片。
   - **`Ctrl + 右键`**：调整卡片大小；再次 `Ctrl + 右键` 完成调整。
   - **空白处左键拖动**：框选元素，形成临时选区组。
   - **普通右键**：打开当前对象的菜单（永久栏目、永久栏目副本、临时栏目、特殊临时栏目、空白栏目、卡片组、连接线、临时选区组、画布空白区域），可进行全屏、定位、置顶、设置颜色、重命名、删除或<ins>导出</ins>。
5. **推送 / 拉取安全**：推送会清理已配置的远端同步目录。⚠️ <ins>请勿在其中放入无关笔记或媒体，否则可能被彻底删除；画布不支持视频、音频、图片、PDF 等外部文件节点</ins>。详见 [`限制与妥协.md`](../%E9%99%90%E5%88%B6%E4%B8%8E%E5%A6%A5%E5%8D%8F.md)。

### 预览

#### 截图预览

| 画布工作区 | 搜索、标签与备注 |
| :---: | :---: |
| 截图位置预留 | 截图位置预留 |

| 导入 / 导出 | GitHub 推送 / 拉取 |
| :---: | :---: |
| 截图位置预留 | 截图位置预留 |

截图资源将放在 [`Screenshots and videos/`](../../Screenshots%20and%20videos/)；其中已预留命名与嵌入位置，后续添加媒体时无需重写 README。

#### 视频预览

[`Screenshots and videos/`](../../Screenshots%20and%20videos/) 中已预留画布工作流、导入导出和 GitHub 同步演示的视频位置。

### 路线图

#### 近期路线

- [ ] **默认约束文件共建完善**：完善随导出和推送数据包附带的 `AGENTS.md` / `CLAUDE.md` 风格约束，让不同 AI 客户端理解画布结构、数据协议与编辑边界。模板入口见 [AGENTS_template](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template)。
- [ ] **生成、分析与生态共建**：以书签画布为主，优先创建服务于本项目的独立 Skill，分别处理生成与分析；两者暂不合并。
  - **生成 Skill**：生成结果集中在书签画布的数据模型中，支持单个 JSON，或包含 `.canvas` 的单个数据包。
  - **分析 Skill**：优先分析书签画布本项目与范围明确的画布数据；索引建立、RAG 与 Deep Research（外部或内部）均待实践后再扩展。
  - **综合 Skill**：开放基础格式与 Skill 方向，并邀请生态项目 [书签备份（Bookmark Backup）](https://github.com/Browser-bookmark-hub/Bookmark-Backup) 与 [书签记录与推荐（Bookmark Record and Recommend）](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend) 参与；生成结果仍以书签画布为主要承载。
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

**生态项目**

- [书签画布（Bookmark Canvas）](https://github.com/Browser-bookmark-hub/Bookmark-Canvas)
- [书签记录与推荐（Bookmark Record and Recommend）](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend)
- [书签备份（Bookmark Backup）](https://github.com/Browser-bookmark-hub/Bookmark-Backup)

**外部参考**

- [JSON Canvas](https://github.com/obsidianmd/jsoncanvas)
- [Obsidian JSON Canvas Skill](https://github.com/kepano/obsidian-skills/tree/main/skills/json-canvas)
- [xyflow](https://github.com/xyflow/xyflow)
- [Obsidian Editing Toolbar](https://github.com/PKM-er/obsidian-editing-toolbar)
- [AltSnap](https://github.com/RamonUnch/AltSnap)

### 数据与隐私

- 画布数据、设置、本地索引和缓存默认保存在浏览器扩展的本地存储 / IndexedDB；本项目不运营专用后端服务。
- GitHub 推送 / 拉取为可选功能，只会访问用户自行配置的仓库。
- 书签、存储、下载、标签页、标签组、窗口、当前标签页、favicon、idle 状态与站点访问等权限，用于书签管理、画布交互、图标显示及相关浏览器集成。
- 完整的数据处理与权限说明见英文版 [Privacy Policy](../../PRIVACY_POLICY.md)。

---

## License

[GPL-3.0](../../Bookmark-Canvas-main/LICENSE)。

## [返回顶部](#switch-to-english)
