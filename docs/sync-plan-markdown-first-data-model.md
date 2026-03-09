# Bookmark-Canvas Markdown-First 同步数据模型规划书

> 返回文档索引：[docs/README.md](./README.md)

## 1. 这份规划书要解决什么问题

当前同步中的一个核心问题，不是“云端突然自己变了”，而是：

- 本地导出出来的受管文件集合，与云端现有文件集合不一致；
- 这种不一致里，包含一部分**真实业务变化**；
- 也包含一部分**导出漂移 / 序列化漂移 / 内置模板漂移**。

结果就是：

- 面板会提示“其他同步数据有变化”；
- 用户点击 `Use Local` / `仅上传` 时，会把这种“本地导出漂移”也提交成 commit；
- 从用户感知看，像是“我没改业务数据，为什么还出现 diff / commit”。

本规划书的目标，是为后续改造定义一个更稳定的数据模型：

- 文本型卡片尽量使用 **Markdown-first** 作为真相源；
- 同步比较尽量基于 **canonical content**，而不是每次导出时重新临时生成的字符串；
- 把“真正的内容变化”和“导出格式漂移”尽可能区分开。

---

## 2. 当前实现现状（基于代码梳理）

## 2.1 空白栏目 / Markdown 卡片当前更接近 HTML-first

当前 `md node` 导出逻辑：

- 优先读取 `node.html`
- 如果没有再退回 `node.text`
- 再走 `__htmlToMarkdown(...)`
- 最终导出 markdown 文件

相关代码入口：

- `history_html/bookmark_canvas_module.js` 中 `__buildMdNodeMarkdown(...)`
- `history_html/bookmark_canvas_module.js` 中 `__htmlToMarkdown(...)`

这意味着当前很多 Markdown 卡片的真实来源并不是稳定的 Markdown 文本，而是：

- HTML / 富文本内容
- 在导出阶段再转换为 Markdown

因此只要：

- 模板更新
- 富文本 DOM 结构有变化
- HTML -> Markdown 归一化策略有变化
- 同一语义内容重新渲染再导出

就可能出现文件文本漂移。

## 2.2 同步比较当前仍以文件文本为主

当前同步比较逻辑中：

- `.canvas` 文件会做 JSON 规范化再比较；
- `.md` 文件则主要按文本内容比较；
- 文本归一化目前只有：
  - 去 BOM
  - 统一换行

相关代码入口：

- `history_html/sync/obsidian-git-sync.js` 中 `normalizeManagedSyncTextContent(...)`
- `history_html/sync/obsidian-git-sync.js` 中 `normalizeManagedSyncComparableContent(...)`
- `history_html/sync/obsidian-git-sync.js` 中 `compareManagedSyncFileMaps(...)`

也就是说，当前 `.md` 比较还没有做到：

- Markdown 语义归一化
- 说明模板稳定化
- 空白卡片导出稳定化

## 2.3 受影响的不只是内置说明卡片

这类问题不是只会出现在：

- `Keyboard Shortcuts`
- `User Guide`

它还可能映射到：

- 其他空白栏目卡片
- 其他 Markdown 文本卡片
- 临时栏目里的文本字段 / 描述字段
- 导入后再导出的文本卡片

因此，简单把“内置 guide 文件排除同步”只能缓解一部分表象，不能真正解决“导出不稳定”问题。

---

## 3. 核心判断

当前问题的本质，不是：

- 云端自己变了；
- 恢复锁导致 commit 残缺；
- 比较面板完全误报。

当前问题更接近：

- **本地导出结果不稳定**；
- **同步比较仍以导出后的文本结果为准**；
- **文本型卡片缺少 canonical source（稳定真相源）**。

所以后续改造的关键，不是继续给比较逻辑打补丁，而是：

- 重新定义“文本卡片的真相源”；
- 重新定义“同步比较应该比较什么”。

---

## 4. 目标方向：Markdown-first + Canonical Sync

## 4.1 总体原则

后续推荐把数据分成两类：

### A. 结构型真相源

这些对象不应改成 Markdown-first：

- 永久栏目（浏览器书签树）
- 临时栏目主体结构（标题、items 树、位置、尺寸、颜色、折叠态等）
- 画布结构（`.canvas` / JSON）

它们的真相源应继续保持结构化数据。

### B. 文本型真相源

这些对象适合改成 Markdown-first：

- 空白栏目卡片（Markdown 文本卡片）
- 说明型卡片 / guide 卡片
- 用户自由编辑的富文本卡片（如果本质上是文档内容）
- 临时栏目中的“长文本字段 / 描述字段”

对于这些对象，应尽量改成：

- `markdownSource` 作为真相源
- `htmlCache` / 渲染 HTML 作为派生结果
- 导出时直接使用 `markdownSource`
- 比较时优先比较 `markdownSource` 的 canonical form

---

## 5. 推荐数据模型

## 5.1 空白栏目 / Markdown 卡片

当前建议的未来模型：

```json
{
  "id": "md-node-xxx",
  "type": "md-node",
  "markdownSource": "## Title\n\nBody...\n",
  "htmlCache": "<h2>Title</h2><p>Body...</p>",
  "renderVersion": 1,
  "x": 0,
  "y": 0,
  "width": 360,
  "height": 240,
  "color": null,
  "colorHex": "#ffffff"
}
```

原则：

- `markdownSource` 是长期存储主字段；
- `htmlCache` 只是渲染缓存，可以重建；
- 导出 `.md` 文件时不再依赖 `node.html -> markdown`；
- 同步比较时也基于 `markdownSource`。

## 5.2 临时栏目

临时栏目不建议整体改成单一 Markdown 文本。

更合理的方向是：

- 保持结构化 JSON 作为真相源；
- 其中会导出为 Markdown 的文本字段，改成 canonical markdown；
- 导出时由结构数据 + canonical markdown 拼出稳定文件。

例如：

```json
{
  "id": "temp-section-xxx",
  "title": "A 临时栏目",
  "descriptionMarkdown": "这里是说明\n",
  "items": [...],
  "foldState": {...},
  "layout": {...}
}
```

## 5.3 永久栏目

永久栏目不建议 Markdown-first。

原因：

- 它的真相源本质是 Chrome bookmarks tree；
- Markdown 文件只是同步协议中的投影格式；
- 因此它应继续保持：
  - 结构化书签树为主
  - Markdown 仅作为导出 / 同步表示

---

## 6. Canonical Content 设计

为了避免“看起来没变，但导出字符串漂了”，后续同步比较要引入 **canonical content**。

## 6.1 Markdown canonical 目标

建议至少统一以下规则：

- 统一换行：LF（`\n`）
- 去 BOM
- 去文末多余空行，只保留一个结尾换行
- 统一 heading 与正文之间的空行策略
- 统一列表块前后的空行策略
- 去除尾随空格
- 对 HTML 片段的最小化保留策略做统一

## 6.2 比较层改造

当前比较逻辑建议后续升级为：

- `.canvas`：继续 JSON 稳定排序比较
- Markdown 文本卡片：比较 `canonicalMarkdown(markdownSource)`
- 结构型对象导出文件：比较 canonical export result

也就是说，比较层不要再直接比较“当前导出出来的原始字符串”，而要比较：

- **经过统一规范后的内容**

---

## 7. 同步面板文案调整建议

当前“云端不一致”很容易被用户理解成：

- 云端自己发生了变化
- 或云端先变了

但很多场景其实是：

- 本地导出结果与云端文件集合不一致

因此后续建议把相关文案逐步改成更准确的表达，例如：

- `本地与云端受管文件存在差异`
- `本地导出结果与云端文件不一致`
- `检测到同步文件差异，请确认处理方向`

这样可以减少“明明云端没动，为什么说云端不一致”的误解。

---

## 8. 分阶段实施建议

## Phase 1：只做方案，不改行为

本阶段目标：

- 锁定方向
- 不改现有运行逻辑
- 把后续改造拆成明确步骤

## Phase 2：空白栏目 / Markdown 卡片改成 Markdown-first

本阶段目标：

- 为 `md node` 引入 `markdownSource`
- 渲染层从 `markdownSource -> htmlCache`
- 导出层直接使用 `markdownSource`
- 同步比较层优先比较 canonical markdown

这是收益最大、风险最可控的一步。

## Phase 3：内置说明卡片改成稳定文本源

本阶段目标：

- Guide/demo 卡片不再依赖 HTML 再导出
- 模板改动不再轻易造成无意义 commit

## Phase 4：临时栏目文本字段 canonical 化

本阶段目标：

- `description` 等文本字段引入稳定 markdown 源
- 导出结果更稳定
- mismatch/conflict 更接近“真实业务变化”

## Phase 5：同步比较层统一 canonical compare

本阶段目标：

- `compareManagedSyncFileMaps(...)` 的输入不再是“原始导出字符串”
- 而是 canonical content map

---

## 9. 与当前恢复锁方案的关系

这份规划书与现有恢复锁方案并不冲突。

两者解决的问题不同：

- 恢复锁：解决“操作做到一半崩溃后，如何继续同一个方向”
- Markdown-first：解决“为什么明明没改业务数据，却仍然出现文件 diff / commit”

也就是说：

- 恢复锁负责**安全继续操作**
- Markdown-first 负责**减少无意义变化**

两者都需要，但阶段顺序可以分开推进。

---

## 10. 当前阶段的最终结论

当前建议正式锁定为：

1. 同步主方向继续沿用当前 GitHub-only 远端存储方案；
2. 崩溃恢复继续沿用强制恢复锁方案；
3. 后续文本卡片同步方向改为 **Markdown-first + canonical compare**；
4. 永久栏目保持结构化真相源，不走 Markdown-first；
5. 临时栏目保持结构化主体，只对文本字段做 canonical markdown 化；
6. 面板文案后续要从“云端不一致”向“本地与云端文件差异”逐步校正。

---

## 11. 当前阶段不做

本规划书阶段明确不做：

- 不修改当前数据模型
- 不修改当前导出逻辑
- 不重写编辑器
- 不直接改变同步判定逻辑
- 不引入新的后端

本阶段只产出：

- 方向方案
- 术语统一
- 后续实施分期
