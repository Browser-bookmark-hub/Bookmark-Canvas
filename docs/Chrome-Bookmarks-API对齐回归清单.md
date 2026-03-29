# Chrome Bookmarks API 对齐回归清单

版本：2026-03-29  
对应计划：`docs/Chrome-Bookmarks-API严格对齐执行计划书.md` 第 D 阶段

## 自动校验（已完成）

1. `node --check history_html/bookmark_canvas_module.js` 通过。
2. `node --check history_html/sync/obsidian-git-sync.js` 通过。

## D1 永久栏目交互

1. 在永久栏目右键书签与文件夹，验证菜单可正常弹出。
2. 分别验证：打开、编辑、删除、剪切、复制、粘贴。
3. 对书签栏/其他书签/移动书签根下节点执行一次移动与重命名。

期望结果：

1. 无报错弹窗或控制台阻断错误。
2. 操作后树刷新正确，节点结构不丢失。

## D2 临时栏目交互

1. 创建临时栏目，导入一份普通 JSON 书签文件。
2. 再导入一份 temporary section JSON（`sectionType: "temporary"`）。
3. 在临时栏目里执行拖拽移动、层级调整、分裂/合并相关操作。

期望结果：

1. temporary section JSON 可正常恢复 `items` 树结构。
2. 拖拽与层级操作行为与改造前一致。

## D3 监听链路

1. 在浏览器原生书签管理器中创建/删除/移动/重命名书签。
2. 回到插件页面观察永久栏目自动刷新。

期望结果：

1. `onCreated/onRemoved/onChanged/onMoved` 对应行为都能反映到 UI。
2. 不出现节点重复、幽灵节点、错位父子关系。

## D4 同步链路

1. 触发一次 push，检查远端快照中的 `permanentTreeSnapshot`。
2. 触发一次 pull（含有变更），分别验证 incremental 与 overwrite 路径。
3. 如果有冲突弹窗，走一遍确认流程。

期望结果：

1. 同步链路不再引入额外的树字段改写。
2. push/pull 后本地永久树与远端结构保持一致。

## D5 导入导出链路

1. 导出画布快照（JSON/ZIP/Folder）后再导入，验证布局与数据恢复。
2. 导出并导入书签 HTML/JSON，验证临时栏目生成正确。
3. 使用“书签文件 -> JSON”入口导入 temporary section JSON。

期望结果：

1. 画布快照入口仍只接受备份 JSON。
2. 书签 JSON 入口同时支持通用书签 JSON + temporary section JSON。
3. `.canvas` / 空白栏目镜像 / 临时栏目文件结构与导入规则文档一致。

## 结果记录模板

- D1：通过 / 不通过（问题说明）
- D2：通过 / 不通过（问题说明）
- D3：通过 / 不通过（问题说明）
- D4：通过 / 不通过（问题说明）
- D5：通过 / 不通过（问题说明）

