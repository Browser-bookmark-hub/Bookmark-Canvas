# 永久栏目 `folderType` / 折叠态 / 首次同步计划（讨论稿）

> 返回文档索引：[docs/README.md](./README.md)

## 1. 本文目的

本文只讨论永久栏目（浏览器真实书签树）相关协议调整，聚焦 3 件事：

- 在永久栏目 Markdown 中补充 `folderType` 元数据
- 停止把折叠态 `BC_FOLD_STATE` 作为导出 / 导入 / 同步协议内容
- 在首次同步、覆盖恢复、增量同步中统一使用 `folderType`

说明：

- 本文是实现计划，不代表所有行为都已完成上线。
- 本文重点是把“手动导出导入层”和“同步层”分开说清楚。

---

## 2. 分层结论

### 2.1 手动导出 / 导入层

这一层指的是设置里的手动按钮以及与之直接对应的兼容导入链路。

范围包括：

- 手动导出永久栏目 Markdown
- 编辑模式导出
- 视觉模式导出
- 视觉模式无图标导出
- 手动导出全量备份 `bookmark-canvas.backup.json`
- 手动导入兼容

当前结论：

- 这整层都要统一兼容 `folderType`
- 只要导出的对象是永久栏目，就要把根目录身份信息一起带出去
- 只要导入的对象是永久栏目，就要优先读取 `folderType`
- `BC_FOLD_STATE` 不再作为这层协议的一部分

也就是说：

- 手动导出出去的永久栏目主 Markdown，要带 `folderType`
- 手动导入进来的永久栏目主 Markdown，要识别 `folderType`
- 全量备份导出 / 恢复，也要把 `folderType` 视为永久根目录身份信息的一部分

---

### 2.2 同步层

这一层指的是 Obsidian / 云端同步主链路。

范围包括：

- 推送到云端
- 从云端拉取
- 首次同步
- 覆盖恢复
- 增量同步
- 进入 mismatch / conflict 之后的云端优先路径

当前结论：

- 这整层也都要统一兼容 `folderType`
- 首次同步、覆盖恢复、增量同步三条路径统一按 `folderType` 匹配标准根目录
- `BC_FOLD_STATE` 不再作为同步协议内容参与 pull / push / import / apply

也就是说：

- 首次同步：先按 `folderType` 配准标准根，再判断 `same / 增量 / 覆盖恢复`
- 覆盖恢复：按 `folderType` 对标准根目录定向恢复
- 增量同步：按 `folderType` 先配准根目录，再做树级 diff 和阈值判断

---

### 2.3 统一原则

手动导出导入层与同步层虽然入口不同，但永久栏目协议要保持一致：

- 都统一吃 `folderType`
- 都统一忽略 `BC_FOLD_STATE`
- 都统一采用“`folderType` 优先，旧标题归一规则兜底”的兼容策略

当前结论：

- 只需要 `folderType`
- 当前不把 `syncing` 纳入云端协议和永久栏目同步核心模型

---

## 3. `folderType` 放哪

当前讨论结论：

- 不新增独立 JSON 文件
- 直接写进永久栏目 Markdown
- 放在文件末尾
- 使用注释块，不进入正文标题层级

原因：

- 不污染正文结构
- 不影响编辑模式 / 视觉模式 / 视觉模式无图标 的正文显示
- 与现有注释块模式一致
- 一个文件自带自己的根目录身份信息，便于跟随内容移动

建议格式：

```md
<!-- BC_ROOT_META_START -->
{
  "schemaVersion": 1,
  "standardRoots": {
    "bookmark_bar": {
      "present": true,
      "sectionTitle": "Bookmarks Bar",
      "folderType": "bookmarks-bar"
    },
    "other": {
      "present": true,
      "sectionTitle": "Other Bookmarks",
      "folderType": "other"
    },
    "mobile": {
      "present": false,
      "sectionTitle": "Mobile Bookmarks",
      "folderType": "mobile"
    }
  }
}
<!-- BC_ROOT_META_END -->
```

说明：

- 当前只记录标准根目录
- `present` 用于明确表达“该根是否在本次导出中存在”
- `sectionTitle` 用于保留当前 Markdown 中真实 section 名称
- `folderType` 用于导入、首次同步、覆盖恢复、增量同步时做稳定身份匹配

---

## 4. 写到哪些文件里

当前建议：

- 只写到**承载永久栏目正文**的主永久栏目 Markdown 文件里
- 不写到临时栏目 Markdown
- 不写到仅做嵌入引用的永久栏目副本文件里

原因：

- `folderType` 只对永久栏目根目录身份有意义
- 临时栏目没有浏览器标准根目录语义
- 引用文件重复携带同一份根元数据，容易制造歧义

---

## 5. 兼容规则

### 5.1 本地侧

本地浏览器书签树读取后，先为每个标准根目录建立逻辑 key：

- `bookmark_bar`
- `other`
- `mobile`

优先级：

1. 运行时若能拿到 `folderType`，优先用 `folderType`
2. 若拿不到，再回退到旧标题归一规则

---

### 5.2 文件侧

无论是：

- 手动导出的永久栏目 Markdown
- 云端同步下来的永久栏目 Markdown

文件读取时都采用同一优先级：

1. 优先读取 Markdown 末尾 `BC_ROOT_META`
2. 若没有该块，再回退到 section 标题归一规则

---

### 5.3 `same` 判断

`same` 不再只按原始标题做比较，而是：

- 先按 `folderType` / 逻辑根 key 对齐标准根
- 再构造 canonical tree
- 再计算 hash

只有 canonical tree 一致时，才认为本地与云端永久栏目完全一致。

---

## 6. 三条主链路怎么用 `folderType`

### 6.1 首次同步

首次同步（云端为准）需要继续保留这三种结果：

- `same`：跳过永久栏目恢复
- `incremental`：执行永久栏目增量同步
- `overwrite`：执行永久栏目覆盖恢复

新的判断顺序应为：

1. 读取本地浏览器永久根目录身份
2. 读取云端永久栏目 `BC_ROOT_META`
3. 判断标准根是否能稳定配准
4. 若可配准，则继续 `same / 增量 / 阈值 / 覆盖恢复`
5. 若不可配准，则回退覆盖恢复

---

### 6.2 覆盖恢复

覆盖恢复时：

- 按 `folderType` 匹配本地标准根和云端标准根
- 只对匹配到的标准根执行恢复
- 未识别或未纳入协议的根，保持保守处理

---

### 6.3 增量同步

增量同步时：

- 先按 `folderType` 匹配根目录
- 再在同一标准根内部做树级 diff
- 再做阈值判断

也就是：

- `bookmark_bar` 只对 `bookmark_bar`
- `other` 只对 `other`
- `mobile` 只对 `mobile`

不再把“标题不同但只是语言不同”的场景误判成不同根。

---

## 7. 阈值计划

当前结论：保留阈值机制，但把它放在 `folderType` 匹配之后。

也就是：

1. 先匹配标准根
2. 再生成增量计划
3. 再计算 `logicalChangeCount`
4. 再与阈值比较
5. 超阈值则回退覆盖恢复

这样阈值统计才建立在“根目录已正确配准”的前提上。

---

## 8. 折叠态 `BC_FOLD_STATE`

当前讨论结论：

- 折叠态先从这轮永久栏目协议中移除
- 不再随手动导出写出
- 不再随同步导出写出
- 导入 / 云端拉取时忽略旧的 `BC_FOLD_STATE`
- 本地折叠态继续只保存在本地视图存储中

原因：

- 编辑模式本身不天然对应同一种折叠语义
- 视觉模式 / 视觉模式无图标 / 编辑模式三者不统一
- 当前从云端拉回时会直接覆盖本地折叠态，不适合作为稳定的跨端同步内容
- 它更接近本地视图状态，而不是当前阶段要强同步的核心内容

---

## 9. 实施顺序建议

### 第 1 步：手动导出 / 导入层

- 永久栏目主 Markdown 末尾新增 `BC_ROOT_META`
- 手动导出三个模式统一写出该块
- 手动导入优先读取该块
- 全量备份恢复链路显式兼容 `folderType`
- 手动导出 / 导入不再处理 `BC_FOLD_STATE`

### 第 2 步：同步层

- 同步导出写出 `BC_ROOT_META`
- 云端读取优先识别 `BC_ROOT_META`
- 首次同步、覆盖恢复、增量同步三条路径统一复用 `folderType` 匹配逻辑
- 同步链路不再处理 `BC_FOLD_STATE`

### 第 3 步：兼容旧数据

- 没有 `BC_ROOT_META` 的旧永久栏目文件，继续回退到旧标题归一规则
- 带旧 `BC_FOLD_STATE` 的历史文件，读取时忽略其折叠态内容，不再写回本地视图状态

---

## 10. 备注

本轮计划重点不是增加更多新策略，而是先把永久栏目协议整理清楚：

- 手动导出 / 导入层统一兼容 `folderType`
- 同步层统一兼容 `folderType`
- 折叠态退出这轮协议
- 首次同步 / 覆盖恢复 / 增量同步统一根目录身份判断


---

## 11. 三个面板 UI 统一方案（首次同步 / 云端不一致 / 冲突）

已独立拆分到：

- [docs/sync-panels-ui-plan.md](./sync-panels-ui-plan.md)

该文档包含：

- 三个面板的统一结构要求
- 时间信息摆放规则
- 首次同步 / 云端不一致 / 冲突 三个示意图
