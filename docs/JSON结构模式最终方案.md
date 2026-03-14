# Bookmark-Canvas JSON 结构模式最终方案

> 返回文档索引：[docs/README.md](./README.md)
> 总顺序计划：[存储收敛与 JSON 模式总顺序计划书](./存储收敛与JSON模式总顺序计划书.md)
> 前置文档：[编辑模式彻底下线计划书](./编辑模式彻底下线计划书.md)
> 关联子计划：[书签树协议层统一子计划](./书签树协议层统一子计划.md)
> Obsidian 双链：[[书签树协议层统一子计划]]

> 当前说明：
> “书签树协议层统一、本地存储对齐、永久副本封装” 已单独拆到 `[[书签树协议层统一子计划]]`。
> 其中两条已经先锁定：主永久栏目 / 临时栏目正文不保留额外标题；永久栏目副本继续沿用嵌套引用包装，不改成纯 JSON 引用壳。其余协议层边界以该子计划为准。
> 阶段边界补充：本计划只在轮到总顺序计划里的 `JSON模式（供AI）` 那一刀时统一接入，不倒逼前面步骤提前修改现有本地存储顶层、现有 `visual / visual-no-icon` 顶层，或当前两值格式设置。

## 1. 最终结论

- `editable / 编辑模式` 彻底废弃。
- Obsidian / 同步里的“导出格式（为 Obsidian）”继续使用同一个候选框，但正式变成三选一：
  - `visual`
  - `visual-no-icon`
  - `json`
- 对用户展示时，这第三项固定命名为：
  - 中文：`JSON模式（供AI）`
  - 英文：`JSON Mode (for AI)`
- 这个 `json` 不是新增一套单独的 `.json` 同步文件，而是：
  - 继续输出 `.md` 文件
  - 只是把永久栏目、永久栏目副本、临时栏目里的“书签树正文”改成 JSON 表达
- 面向人阅读，继续保留 `visual` 与 `visual-no-icon`。
- 面向 AI 分析、增删改移、稳定同步，新增 `JSON模式（供AI）`。
- 默认值固定为 `JSON模式（供AI）`。

这次的核心不是“再发明一套额外文件层”，而是在现有 Obsidian / 同步导出链路里，新增第三种 `.md` 正文格式。

### 1.1 UI 结论

当前实现上，不需要把“结构模式”和“展示模式”拆成两层设置。

原因很直接：

- 你现在要的三种模式，本质上都是同一个 `.md` 文件里的不同正文表现形式
- `visual` 与 `visual-no-icon` 是两种可视投影
- `json` 是第三种正文投影
- 它们都属于同一个“Obsidian 导出格式”候选框语义

因此可以直接定为：

- 同步设置里的 `obsidianExportFormat` 保留单字段
- 合法值变为：`visual / visual-no-icon / json`
- 同步二级 UI、首次同步区域、手动导出区域都统一用这一套三选一
- 上面这件事属于 `json` 模式正式接入当次统一修改，不前置到前几刀

### 1.2 默认值

当轮到 `JSON模式（供AI）` 正式接入时，默认行为固定为：

- 首次同步里的结构格式，默认选中 `JSON模式（供AI）`
- 后续同步设置里的导出格式，默认选中 `JSON模式（供AI）`
- 手动导出里如果出现该候选框，默认也选中 `JSON模式（供AI）`
- 首次同步一旦确定导出模式，后续同步默认沿用这一种模式；如果用户中途切换模式，应按“格式迁移 / 重导出 / 本地覆盖云端”处理

### 1.3 说明文案出现位置

`JSON模式（供AI）` 不能只改名字，必须同时补说明。

说明出现位置固定为：

- 同步二级 UI 的“导出格式（为 Obsidian）”下方
- 首次同步区域里对应的结构格式说明处
- 手动导出弹窗里的格式选择区

推荐文案：

- 中文：`JSON模式（供AI）：在 MD 文件中使用结构化 JSON 表示书签树，更适合 AI 分析，以及增加、删除、移动、修改等操作；也更适合稳定同步。`
- 英文：`JSON Mode (for AI): stores the bookmark tree as structured JSON inside the MD file, making AI analysis and add/remove/move/edit operations easier and sync more stable.`

可选补充文案：

- 中文：`更适合机器处理；人类阅读建议使用视觉模式或视觉模式（无图标）。`
- 英文：`Best for machine editing; for human reading, use Visual Mode or Visual Mode (No Icons).`

### 1.4 这次只改什么

这次只改下面三类 `.md` 文件里的书签树正文表达方式：

- 永久栏目
- 永久栏目副本
- 临时栏目

下面这些不跟着另起协议，继续沿用现有公共实现：

- `.canvas` 文件
- 空白栏目文件
- README / 导入规则说明（本阶段先不统一改写，后续单独收敛）
- 样式、说明、通用元数据
- 其他非书签树正文部分

也就是说：

- 视觉模式和视觉模式（无图标）继续沿用现有导出框架与解析链路
- `JSON模式（供AI）` 只是在同一候选框里新增第三种正文格式，不要求前两种模式一起切到长期协议中转层
- 真正变化的，只是“书签树在 `.md` 文件里如何表示”
- 永久栏目导出的 JSON 正文来自永久快照 / 协议视图投影，不把永久栏目本地真相源直接改成 JSON 文件存储
- 临时栏目第一版允许进入 `JSON模式（供AI）`，但先通过协议层适配，不要求立刻替换本地运行时 `items`
- 本计划里的 JSON 顶层结构，只约束 `json` 正文协议；不反推当前本地存储顶层，也不要求现有 `visual / visual-no-icon` 顶层跟着改

---

## 2. 为什么不用旧编辑模式

旧编辑模式的问题已经定性，不再继续修补：

- Markdown 标题只有 `H1` 到 `H6`，深层树结构会退化。
- `H6` 之后改列表，用户可读性、折叠性、大纲能力都不稳定。
- 对 AI 来说，标题树 + 列表不是最稳的增删改移协议。
- 导入、导出、同步三条链路一旦继续兼容旧编辑模式，长期维护成本过高。

因此，新协议直接收敛到“`.md` 文件中的 JSON 书签树正文”。

---

## 3. JSON 结构模式的核心原则

### 3.1 载体不是单独 `.json` 文件，而是 `.md`

这里说的 `JSON模式（供AI）`，不是：

- 新增一套和 `.md` 平行的 section `.json` 文件
- 也不是替代现有全量备份 `bookmark-canvas.backup.json`

这里说的是：

- 永久栏目 / 永久栏目副本 / 临时栏目，仍然各自输出 `.md`
- 主永久栏目与临时栏目的书签树正文，不再是视觉 HTML 卡片结构
- 它们改成 JSON 代码块
- 永久栏目副本继续保留特殊包装，详见后文 `4.5`

也就是：

- 文件后缀仍然是 `.md`
- 书签树正文改成 fenced code block：` ```json `

### 3.2 MD 内的推荐正文形式

推荐正文方向固定为：

1. 以 `json` fenced code block 作为书签树正文真相源
2. 解析器优先读取这个 JSON 代码块
3. 其他可能存在的文件外壳文字，不应覆盖 JSON 正文

备注：

- 这里默认指主永久栏目与临时栏目
- 永久栏目副本属于特殊包装，不直接再落第二份完整树 JSON，见 `4.5`
- 主永久栏目 / 临时栏目都不再保留额外标题文字，文件正文直接使用单一代码块承载
- 主永久栏目这里的 JSON 正文，是对永久栏目规范化快照 / 协议视图的投影，不等于插件内部把永久真相源改成 JSON 持久化

示意：

````md
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 1,
  "meta": {
    "sectionType": "permanent",
    "slot": "A"
  },
  "bookmarkTree": {
    "id": "root",
    "parentId": null,
    "kind": "folder",
    "title": "Bookmarks Root",
    "children": [
      {
        "id": "bar",
        "parentId": "root",
        "kind": "folder",
        "title": "Bookmarks Bar",
        "folderType": "bookmarks-bar",
        "syncing": false,
        "children": []
      }
    ]
  }
}
```
````

实现约束固定为：

- 主永久栏目与临时栏目文件里，只允许一个“书签树 JSON 代码块”
- 导入、拉取、同步时，只解析这个代码块
- 若有其他外壳文字，也不是结构真相源
- 具体文件外壳形式，以 `[[书签树协议层统一子计划]]` 定稿为准

### 3.3 这里的 `schemaVersion` 是协议版本，不是 JSON Schema 文件

这里不引入额外的 JSON Schema 校验文件体系。

也就是说：

- 当前只需要在正文 JSON 里保留 `format`
- 再保留 `schemaVersion`
- 用来表示“这是哪一类 section、使用哪一版协议”

不要求：

- 引入 `$schema`
- 引入外部 schema 地址
- 维护一整套 JSON Schema 文档系统

当前阶段，这样太重了，也没有必要。

### 3.4 总体结构

统一采用：

- 官方风格的嵌套 `children`
- 节点保留 `id`
- 节点保留 `parentId`
- 节点保留 `kind`

也就是：

```json
{
  "tree": {
    "id": "root",
    "parentId": null,
    "kind": "folder",
    "title": "Bookmarks Root",
    "children": [
      {
        "id": "bar",
        "parentId": "root",
        "kind": "folder",
        "title": "Bookmarks Bar",
        "folderType": "bookmarks-bar",
        "syncing": false,
        "children": [
          {
            "id": "bar/f1",
            "parentId": "bar",
            "kind": "folder",
            "title": "Work",
            "children": [
              {
                "id": "bar/f1/b1",
                "parentId": "bar/f1",
                "kind": "bookmark",
                "title": "Example",
                "url": "https://example.com"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

采用嵌套树，原因很直接：

- 这里讨论的是 `json` 正文自己的顶层与树结构，不等于要求当前本地存储顶层或现有 `visual` 文件顶层现在就改成同一种形状。

- 更贴近 Chrome `BookmarkTreeNode.children` 的语义。
- 永久栏目与临时栏目都能共用同一种树结构。
- 从 JSON 还原成插件里的永久栏目卡片、临时栏目卡片更直接。
- 人和 AI 直接阅读某个文件夹内容时，更像真正的书签树。

需要做批量编辑、比对、同步判断时，可以在实现层临时把嵌套树拍平成索引表；但协议本身不需要落成扁平表。

### 3.5 协议边界

本协议只描述“书签树内容结构真相源”，不描述运行时 UI：

- 不写布局坐标：`x / y / width / height`
- 不写颜色、缩放、边、拖拽态
- 不写临时运行态同步状态
- 不把视图层折叠表现当协议主体
- 不把 `.canvas` 布局塞进 section 的 JSON 正文

### 3.6 节点 `id` 怎么定

这里的 `id`，作用只有一个：

- 用来表达当前树路径
- 用来做节点定位
- 用来让 AI 和程序精确指向当前节点

它不是：

- Chrome 原生书签 `id` 的永久镜像
- 长期稳定身份号
- `n-1001` 这类独立编号

因此规则固定为：

#### 3.6.1 `id` 直接就是路径型 `id`

不单独引入 `pathId`。

结论固定为：

- `id` 本身就是路径型 `id`
- `parentId` 指向父节点的路径型 `id`
- 不再额外维护一套独立“稳定身份 id”

也就是说：

- 不要：
  - `id = n-1001`
  - `pathId = bar/f1/b2`
- 要直接写成：
  - `id = bar/f1/b2`

#### 3.6.2 永久栏目根目录怎么表达

永久栏目用一个虚拟根节点包住浏览器标准根，保持和 Chrome `getTree()` 返回结果接近。

建议：

- 虚拟根：
  - `id: "root"`
  - `kind: "folder"`
  - `parentId: null`
- 它的直接子节点才是浏览器标准根：
  - `bar`
  - `other`
  - `mobile`
  - `managed`

这里要写死：

- 虚拟根本身只负责承载整棵永久书签树
- 虚拟根有 `kind`
- 虚拟根不承担 `folderType`
- 虚拟根不承担 `syncing`
- `folderType` 与 `syncing` 只出现在标准根节点上

标准根示例：

```json
{
  "id": "bar",
  "parentId": "root",
  "kind": "folder",
  "title": "Bookmarks Bar",
  "folderType": "bookmarks-bar",
  "syncing": false,
  "children": []
}
```

#### 3.6.3 普通文件夹与普通书签怎么表达路径

普通节点使用“根别名 + 路径段”的路径型 `id`。

推荐风格：

- 文件夹段：`f1`、`f2`
- 书签段：`b1`、`b2`

例如：

- `bar/f1`
- `bar/f1/b1`
- `bar/f1/f2`
- `bar/f1/f2/b1`

这套 `id` 的含义是：

- `bar/f1/f2/b1`
- 表示：
  - 在 `bar` 这个标准根下
  - 第 1 个文件夹 `f1`
  - 下面第 2 个文件夹 `f2`
  - 下面第 1 个书签 `b1`

因此：

- `id` 一眼就能看出树路径
- `parentId` 也天然可推导
- `kind` 继续保留，避免只靠 `id` 文本猜节点类型

#### 3.6.4 临时栏目怎么表达路径

临时栏目也沿用同一套路径规则，只是根前缀换成临时栏目自己的根。

例如：

- 临时栏目根：`tmp/A-1`
- 其下第 1 个文件夹：`tmp/A-1/f1`
- 其下第 1 个书签：`tmp/A-1/b1`
- 更深层：`tmp/A-1/f1/b2`

不要为了临时栏目另起一套完全不同的树节点字段结构。

#### 3.6.5 增加、删除、移动、修改时怎么处理 `id`

这套 `id` 是路径型 `id`，不是稳定身份 id。

因此规则固定为：

- 增加节点：生成新的路径型 `id`
- 删除节点：对应 `id` 消失
- 移动节点：相关分支的 `id` 与 `parentId` 一起重算
- 插入、删除、重排同级节点：受影响兄弟节点的 `id` 一起重算
- 修改标题、URL、说明：如果树位置没变，`id` 不改

最重要的一条：

- AI 不应手工维护 `f1 / f2 / b1` 这类编号
- AI 主要改树结构
- 系统根据最新树结构自动重算受影响分支的 `id / parentId`

#### 3.6.6 为什么不直接用 Chrome `id`

因为 Chrome / 恢复 / 导入 / 重新建树后，原生 `id` 不具备你现在要的“树路径定位”语义。

所以结论固定为：

- Chrome 原生 `id` 属于运行时实现细节
- JSON 正文里的 `id` 属于路径型结构定位
- 两者不要直接绑定成一回事

### 3.7 注释块策略

JSON 结构模式下：

- `BC_EDITABLE_RULE` 彻底删除
- 永久栏目如果 JSON 本身已带根信息，则不再依赖单独的“编辑模式规则注释块”
- `description` 直接进入 JSON 字段，不再靠注释块保存
- `BC_NATIVE_TEXT_META` 只保留给旧空白栏目镜像规则使用，不再是书签树正文协议主体

---

## 4. 永久栏目协议

### 4.1 必须字段

- `format`
- `schemaVersion`
- `sectionType: "permanent"`
- `slot`
- `title`
- `descriptionMd`
- `tree`

### 4.2 根节点额外字段

浏览器内建根目录继续保留：

- `folderType`
- `syncing`

但约束要写死：

- 虚拟根 `root` 不写 `folderType`
- 虚拟根 `root` 不写 `syncing`
- `syncing` 不参与“过滤导出”
- `syncing` 只用于顶层内建根身份识别
- `syncing` 不扩散到普通文件夹或普通书签
- `syncing` 是“这次快照的匹配提示”，不是长期稳定主键

### 4.3 根匹配优先级

永久栏目恢复、导入、同步时，先进入虚拟根 `root` 的直接子节点，再对这些标准根做匹配。

标准根匹配优先级固定为：

1. `folderType + syncing`
2. `folderType`
3. 旧 `id / title`

也就是说：

- 全量备份永远保留完整节点，不因为 `syncing` 为 `true/false` 就过滤内容
- `syncing` 只参与“怎么识别这是哪个内建根”
- 真正的树内容仍然全量备份

### 4.4 永久栏目示例

下面这个 JSON 示例，表示“导出 / 同步时的协议正文”，不是把插件内部永久真相源直接替换成 JSON 文件存储。

```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 1,
  "sectionType": "permanent",
  "slot": "A",
  "title": "书签树（永久栏目）",
  "descriptionMd": "",
  "tree": {
    "id": "root",
    "parentId": null,
    "kind": "folder",
    "title": "Bookmarks Root",
    "children": [
      {
        "id": "bar",
        "parentId": "root",
        "kind": "folder",
        "title": "Bookmarks Bar",
        "folderType": "bookmarks-bar",
        "syncing": false,
        "children": [
          {
            "id": "bar/f1",
            "parentId": "bar",
            "kind": "folder",
            "title": "当前项目/方向 待整理",
            "children": [
              {
                "id": "bar/f1/b1",
                "parentId": "bar/f1",
                "kind": "bookmark",
                "title": "OneDrive",
                "url": "https://onedrive.live.com"
              }
            ]
          },
          {
            "id": "bar/b1",
            "parentId": "bar",
            "kind": "bookmark",
            "title": "Google",
            "url": "https://www.google.com"
          }
        ]
      },
      {
        "id": "other",
        "parentId": "root",
        "kind": "folder",
        "title": "Other Bookmarks",
        "folderType": "other",
        "syncing": false,
        "children": []
      }
    ]
  }
}
```

### 4.5 永久栏目副本

永久栏目副本不应成为独立真相源。

结论固定为：

- 正文结构仍然共享同一份永久书签树语义
- 副本最多承载视图位置或说明差异
- 副本不重新发明一套树节点 `id`
- 副本里的树节点继续复用原永久树的路径型 `id`
- 副本是共享内容源的视图壳，不是共享同一个 DOM 实例
- 每个副本独立保留 `descriptionMd / scrollState / foldState / cardState`

副本文件的包装形式继续特殊处理：

- 副本文件仍然是 `.md`
- 副本不再单独落一份新的树 JSON
- 副本继续作为主永久栏目正文的包装 / 引用层
- `#A` 主永久栏目文件承载真实书签树 JSON 正文
- `#B / #C / ...` 副本文件只负责包装与引用，不复制第二份树正文

因此这里要写清楚：

- `JSON模式（供AI）` 下，永久栏目副本仍属于 JSON 模式导出的 `.md` 文件体系
- 但它的正文实现不是“再写一份完整 JSON”
- 它应当继续引用主永久栏目的正文
- 视觉模式 / 视觉模式（无图标）继续走原公共导出链路；`json` 只是新增第三种正文投影
- 副本最终固定为继续沿用 Obsidian 的嵌套引用 / 嵌套块包装，不改成纯 JSON 引用包装

---

## 5. 临时栏目协议

### 5.1 必须字段

- `format`
- `schemaVersion`
- `sectionType: "temporary"`
- `label`
- `title`
- `tempKind`
- `source`
- `createdAt`
- `descriptionMd`
- `tree`

### 5.2 可选字段

- `originPermanent`
- `updatedAt`
- `sequenceNumber`

其中：

- `createdAt` 建议保留
- `updatedAt` 可以有，但只允许程序维护
- `sequenceNumber` 用于稳定排序与 UI 连续编号，不承担完整链式语义

### 5.3 链式结构怎么表示

临时栏目的链式结构，不改成 Obsidian 双链。

主协议固定为：

- `label` 表示链路标识，例如 `A-1`
- `sequenceNumber` 表示创建序号
- `originPermanent` 表示它来自哪个永久栏目或副本
- `source` 表示是否属于特殊临时栏目来源

### 5.4 为什么不能只靠永久栏目 ID 推导

`originPermanent` 很重要，但它只能表达“来源”，不能完整替代链式结构。

原因：

- 一个临时栏目可能来自永久原栏，也可能来自永久副本
- 后续还会发生分裂、继续分裂、链内整理
- 只知道“起点来自哪个永久栏目”，并不能唯一恢复链上位置
- 链式关系本身仍然要显式保留

所以最终结论是：

- `originPermanent` 保留
- 但不把它当链式结构唯一依据

### 5.5 `originPermanent` 建议结构

```json
{
  "copyId": null,
  "displayIndex": 1
}
```

含义：

- `copyId: null` 表示来自原始永久栏目
- `copyId: "xxx"` 表示来自某个永久副本
- `displayIndex` 用于恢复 A/B/C 这类展示级别时做辅助

### 5.6 特殊临时栏目

特殊临时栏目继续通过 `source` 区分，例如：

- `browser-drop`
- `search-result`
- `batch`
- `quick-add`
- `file-import`
- `import-html-bookmarks`
- `import-json-bookmarks`

这类值继续保留，因为它们属于现有真实功能流，不应在 JSON 化时丢掉。

### 5.7 临时栏目示例

```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 1,
  "sectionType": "temporary",
  "label": "A-1",
  "title": "2026-03-14 17:25:30",
  "tempKind": "regular",
  "source": "",
  "createdAt": "2026-03-14T09:25:30.000Z",
  "descriptionMd": "",
  "originPermanent": {
    "copyId": null,
    "displayIndex": 1
  },
  "sequenceNumber": 1,
  "tree": {
    "id": "tmp/A-1",
    "parentId": null,
    "kind": "folder",
    "title": "Imported",
    "children": [
      {
        "id": "tmp/A-1/b1",
        "parentId": "tmp/A-1",
        "kind": "bookmark",
        "title": "AI 大型项目讨论",
        "url": "https://linux.do/t/topic/1120309/21"
      },
      {
        "id": "tmp/A-1/f1",
        "parentId": "tmp/A-1",
        "kind": "folder",
        "title": "Bookmarks Bar",
        "children": []
      }
    ]
  }
}
```

---

## 6. 空白栏目协议

空白栏目不跟着这次一起切到 JSON 书签树协议。

原因：

- 空白栏目不是书签树
- 它的结构目标和永久栏目 / 临时栏目不同
- 当前已有自己的导入导出语义

因此这次结论固定为：

- `JSON模式（供AI）` 主要作用于书签树 section
- 空白栏目继续走现有单独协议

### 6.1 插件空白卡片建议结构

```json
{
  "format": "bookmark-canvas-blank",
  "schemaVersion": 1,
  "blankKind": "plugin-markdown",
  "id": "md-node-1",
  "title": "我的备注",
  "markdownSource": "## Notes\n\nhello\n",
  "createdAt": "2026-03-14T09:25:30.000Z"
}
```

### 6.2 原生 text 镜像建议结构

```json
{
  "format": "bookmark-canvas-blank",
  "schemaVersion": 1,
  "blankKind": "obsidian-native-text",
  "id": "native-text-1",
  "nodeId": "canvas-node-123",
  "markdownSource": "这是原生 text 节点镜像正文\n"
}
```

### 6.3 `BC_NATIVE_TEXT_META` 怎么处理

结论：

- 如果空白栏目原生 text 镜像仍有现有规则，就继续按原规则保存
- 它不进入书签树 JSON 主协议
- 不要把它和永久栏目 / 临时栏目的 JSON 书签树正文混在一起

---

## 7. 不采用 Obsidian 双链作为主协议

当前不把 `[[wikilink]]`、backlink、Obsidian 双链语义引入主协议。

原因很明确：

- 这不是 Chrome bookmarks tree 的天然结构
- 双链更适合笔记引用，不适合书签树的父子恢复
- 双链文本容易被用户手改，稳定性不如显式字段
- 它不适合做导入、导出、同步三条链路的唯一匹配依据

最终结论：

- Obsidian 链接只能做展示增强或附加能力
- 不能替代 `parentId / children / originPermanent`
- 不能拿来承载临时栏目链式关系主协议

---

## 8. 哪些字段保留，哪些字段删除

### 8.1 必保留

- 永久栏目：`folderType`
- 永久栏目内建根：`syncing`
- 书签树节点：路径型 `id`
- 书签树节点：`parentId`
- 书签树节点：`children`
- 书签树节点：`kind`
- 永久/临时栏目：`descriptionMd`
- 临时栏目：`label`
- 临时栏目：`sequenceNumber`
- 临时栏目：`createdAt`
- 临时栏目：`originPermanent`
- 特殊临时栏目：`source`
- 空白栏目原生镜像：`nodeId`

### 8.2 明确禁止写进新协议

- `BC_EDITABLE_RULE`
- H6 以后列表缩进规则
- `ICON / base64`
- `dateAdded / dateGroupModified / dateLastUsed`
- Chrome 原生书签 `id` 直接充当协议 `id`
- `n-1001` 这类独立身份 id
- 单独再存一份 `pathId`
- 视图布局字段：`x / y / width / height`
- 颜色、边、运行时临时状态
- 任何把 `syncing` 扩散到普通节点的做法

---

## 9. 导入、导出、同步三条链路的统一要求

### 9.1 导出

- 不再导出编辑模式正文
- 同步 / Obsidian 的 `.md` section 文件支持三种正文格式：
  - `visual`
  - `visual-no-icon`
  - `json`
- `json` 时，只替换书签树正文表达，不额外新增平行 section `.json` 文件
- `.canvas`、空白栏目、通用说明文件继续走现有公共链路
- 用户可见命名统一显示为 `JSON模式（供AI） / JSON Mode (for AI)`
- 手动导出里的格式说明必须包含“适合 AI 分析与增删改移”这层语义

### 9.2 导入

- 新协议优先读取 `.md` 文件里的 JSON 代码块
- 需要新增一条独立的 JSON 解析链路，不复用当前视觉模式 HTML 解析器
- 解析器不再支持旧编辑模式
- 视觉模式与视觉模式（无图标）继续走现有解析链路
- `json` 模式下，永久栏目和临时栏目都直接解析嵌套 `children` 树
- 导入、同步、恢复 `json` 模式正文时，统一复用这条 JSON 解析器
- 临时栏目第一版先走 `JSON -> bookmarkTree -> 当前 items` 的适配恢复链路
- 临时栏目本地 `items` 继续保留现有字段结构，不要求直接改成和 JSON 协议层同名

### 9.3 同步

- 当前工作区后续同步只按首次同步时确定的单一模式运行，不要求三种模式在同一轮同步里混跑
- `visual / visual-no-icon` 继续沿用现有同步解析链路
- `json` 走新增 JSON 解析器与协议层恢复链路
- 永久栏目增量同步与覆盖同步，继续沿用现有“统一树快照 -> 树比较 -> 应用计划”的流程
- 永久栏目先进入虚拟根 `root`，再按 `folderType` 和可选 `syncing` 匹配标准根
- 临时栏目按显式字段恢复链式关系，不依赖 Obsidian 双链
- 临时栏目第一版只要求同步链路支持 `json`，不要求立刻整体改写本地运行时结构
- 路径型 `id` 只属于 JSON 文本协议层 / 协议快照层，不单独改写现有永久栏目比对算法，也不要求本地运行时直接改成这套 id
- 当结构发生移动、插入、删除、重排时，受影响分支的 `id / parentId` 由系统自动重算
- 空白栏目继续按现有独立协议恢复
- 如果用户中途切换 `visual / visual-no-icon / json` 模式，按格式迁移处理：重新导出，并以本地覆盖云端

### 9.4 设置

实现层设置结论固定为：

- `obsidianExportFormat` 只允许：
  - `visual`
  - `visual-no-icon`
  - `json`
- 不再保留 `editable`
- 也不再做旧 `editable` 文件或旧 `editable` 设置值兼容

原因：

- 目前项目尚未进入生产版本
- 旧编辑模式已经正式下线
- 没必要为了未发布历史再保留兼容成本

---

## 10. JSON 模式接入阶段的实施顺序

整体项目总顺序仍以 [存储收敛与 JSON 模式总顺序计划书](./存储收敛与JSON模式总顺序计划书.md) 为准。

本节只描述“轮到 JSON 模式这一刀时”，它内部应按什么顺序接入。

推荐按这个顺序落地：

1. 先定稿 `[[书签树协议层统一子计划]]`
2. 先补永久栏目 / 临时栏目的协议层与必要适配器
3. 导出链路为永久栏目、永久栏目副本、临时栏目新增 `json` 分支
4. 导入链路新增独立 JSON 解析器
5. 同步与恢复链路复用这条 JSON 解析器，把正文先还原成统一树快照
6. 同步 UI、首次同步 UI、手动导出 UI 的候选框统一改成三选一：`visual / visual-no-icon / json`
7. 所有说明文案统一改成 `JSON模式（供AI）`
8. 协议层稳定后，再把默认值统一切到 `json`
9. 结构改动完成后，由系统统一重算受影响分支的路径型 `id / parentId`
10. 最后清理旧编辑模式遗留说明与代码分支

---

## 11. 最终定性

这次不是“把编辑模式修到还能用”，而是直接收敛成三种 `.md` 正文模式：

- 人看，用 `visual`
- 人看但更轻，用 `visual-no-icon`
- AI 改，用 `JSON模式（供AI）`

并且：

- 默认格式就是 `JSON模式（供AI）`
- JSON 写在 `.md` 文件里，不另起 section `.json`
- 只改永久栏目、永久栏目副本、临时栏目这三类书签树正文
- `.canvas`、空白栏目、通用文件继续沿用现有公共实现
- 书签树采用嵌套 `children`，更接近 Chrome 官方书签树
- 节点 `id` 直接使用路径型 `id`
- 结构变更后，相关分支的 `id / parentId` 由系统自动重算
- 永久栏目根匹配继续保留 `folderType + syncing`
- Obsidian 双链不进入主协议

这就是 Bookmark-Canvas 后续导入、导出、同步的统一收敛方向。
