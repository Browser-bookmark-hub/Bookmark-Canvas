# 书签树 note 功能实施计划

## Summary

- 新增 `note` 与 `noteColor` 作为书签/文件夹节点元数据，永久栏目存入 `bcs:perm:main.identityMap[*].note/noteColor`，临时栏目存入节点内联 `item.note/noteColor`。
- `note` 行为全面对齐现有 tag：跟随节点新增、删除、移动、修改，参与本地存储、导入、导出、GitHub 推送/拉取、搜索索引和 UI 刷新；颜色系统复用 tag 的 7 色调色板。
- 本阶段不修改 `AGENTS_template`，不做批量 note 编辑。

## Data And Sync

- `note` 为纯文本字符串；保存时保留换行并整体 trim；`noteColor` 为 `red/orange/yellow/green/blue/purple/gray`，默认 `orange`。
- 空字符串删除 `note` 和 `noteColor`，不导出空 note；旧数据只有 `note` 没有 `noteColor` 时按橙色展示。
- 扩展 `storageBCS_core.js` 的 `__normalizeIdentityMapEntry`，让 identityMap 规范化保留非空 `note` 及合法 `noteColor`。
- 增加永久 note Bridge API：`normalizeNoteInput`、`normalizeNoteColorInput`、`read/writePermanentNodeNoteMeta`、`getPermanentNodeNoteMetaFromContent`、`setPermanentNodeNoteMetaInContent`，保留旧字符串 API 兼容。
- 增加临时 note helper：`getTempItemNoteMeta(sectionId,itemId)`、`setTempItemNote(sectionId,itemId,note,{ noteColor })`；保存后刷新树、写入 temp state，并标记搜索 dirty。
- 导出沙盒保留 `{ syncId, note, noteColor }`；导入覆盖/增量分支复用现有 identityMap extras 管线，并对 note/noteColor 做规范化。
- 永久快照降级为临时栏目时，把 `identityMap.note/noteColor` 映射为内联 `item.note/noteColor`，补齐协议树转换、Chrome tree snapshot 转换、HTML/JSON 临时导入转换点。
- GitHub push/pull 继续走现有 package/export sandbox；note 进入导出包和导入 extras 后自然参与同步。

## Search And Indexing

- `#` 继续搜索 tag；`*` 搜索 note。单独输入 `*` 或 `{*}` 时打开 note 浏览面板，规则对齐 `#` tag 面板：先按颜色与 A-Z/0-9 note 文本分桶浏览，再进入对应书签/文件夹结果；`*关键词` 和 `*/关键词` 只匹配 note 内容。
- 普通书签搜索不默认匹配 note，避免结果噪声；但候选项和结果行只要有 note 就显示 note 标识/摘要。
- 临时索引项写入 `note`、`noteColor`、`__note`；永久索引项通过 identityMap note 元数据缓存读取，模式对齐现有 tag。
- 在 `search.js` 增加 note 缓存、失效、匹配和渲染：`getCanvasBookmarkNoteForSearchCached`、`doesCanvasBookmarkItemNoteMatchQuery`、`invalidateCanvasNoteSearchCaches`、`updateCanvasSearchBookmarkNotes`。
- note 编辑后标记 IndexedDB dirty：永久节点 key 为 `bcs:perm:main`，临时节点 key 为 `bcs:section:<sectionId>`；已加载内存索引同步更新。
- 搜索 UI 增加 `*` note 提示；候选条目包含 note 浏览面板，bookmark result、group child、domain/group 聚合结果在有 note 时显示带颜色的笔图标和摘要。

## UI And Interaction

- 右键「信息」二级面板新增元数据区：tag 只读展示，note 为普通 textarea，退出 note 编辑区时自动保存。
- 在「NOTE」文字右侧增加颜色选择，复用 tag 调色板；选择颜色只改变输入框 UI，退出 note 编辑区后随 note 一起写入 `noteColor`；默认橙色。
- hover 快捷面板把「临时溯源」按钮替换为「信息」按钮：使用 `.tree-info-icon` 与 `data-action="info-submenu-trigger"` 打开现有信息面板；右键菜单里的「临时溯源」入口保留。
- 有 note 的树条目显示带颜色的笔图标标识，使用项目现有 Font Awesome 图标体系；hover 标识展示纯文本 note 气泡，不解析 markdown。
- 外观设置新增 `bookmarkTreeNotePosition` 和 `bookmarkTreeNotePositionThreshold`：支持 `left/right/auto`，默认 `left`，auto 阈值行为参考 tag。
- tag 与 note 同时存在时，note 标识放在更靠内容的一侧：左侧标识组中 note 在 tag 右边；右侧标识组中 note 在 tag 左边。
- 信息面板尺寸、定位、层级、关闭行为复用现有二级面板/tag 面板规则，避免新增弹层体系。

## Tests And Acceptance

- 存储：永久/临时书签与文件夹新增、修改、清空 note 后刷新仍正确；删除节点后 note/noteColor 消失；移动/改名不丢 note 和颜色。
- 导入导出：完整导出包包含 note/noteColor；覆盖导入、增量导入按 `syncId` 保留 note 及颜色；永久快照导入为临时栏目后 note 及颜色仍在对应节点上。
- 同步：GitHub push 后远端包包含 note/noteColor；pull snapshot/overwrite 后本地永久和临时 note 与颜色与包内容一致。
- 搜索：`#tag` 原行为不变；`*` 打开 note 浏览面板并可按颜色/note 文本进入结果；`*关键词` 命中 note；note 编辑后不重启页面也能搜到。
- UI：信息面板 tag 只读、note 退出编辑后自动保存、颜色选择默认橙色并即时改变输入框 UI；hover 信息按钮打开信息面板；笔标识左右/auto 生效且不和 tag、删除、标签按钮重叠。
- 回归：运行现有静态检查/语法检查；重点手测永久栏目、临时栏目、搜索面板、导入导出、GitHub package 生成路径。

## Assumptions

- `note` 不设硬性长度上限，只做纯文本存储和 HTML escape 展示；`noteColor` 不参与 `*` 文本搜索。
- 空 note 删除 `note` 和 `noteColor` 字段。
- `*` 搜索只作用于 bookmark mode 的书签/文件夹节点，不扩展到卡片说明或 markdown 节点。
- 暂不做批量 note 编辑；暂不修改两个 `AGENTS_template` 文件。
