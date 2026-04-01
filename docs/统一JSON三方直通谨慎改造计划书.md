# 统一 JSON 三方直通执行计划书（无兼容版）

更新时间：2026-03-31  
阶段：测试阶段（未上线）  
执行策略：不做旧版本兼容迁就，直接一次性收敛到新结构。

---

## 1. 最终目标（明确版）

本次改造只做一件事：

**让画布本地存储（BCS 分片）的数据 和 同步到云端的 JSON / 导出的 JSON（兼容模式）一致，使得片段可以直接互换——从云端拿下来的 JSON 块直接替换本地对应块就能用，反过来也一样。**

具体拆分为 4 个结果：

1. **同一份数据在三条链路一致**：本地存储 / 同步云端 / 导出 JSON。  
2. **替换可直通**：从云端拿下来的 JSON 块，能直接替换本地对应块，不再靠中间转换器"猜测修复"。  
3. **功能不降级**：永久副本、右键、拖拽、懒加载、滚动、冲突处理保持可用。
4. **导入与同步行为按域对齐**：  
   - 临时/空白：同输入同结果。  
   - 永久：保留双语义（手动导入=临时快照卡；同步 json 兼容=对齐永久树）。
5. **编辑模型对齐 Obsidian**：`markdownSource/descriptionMd` 作为唯一真相源，HTML 仅作为渲染缓存。

执行红线（本计划新增硬约束）：

- **内部交互链**（编辑器 HTML 渲染 ↔ 运行态）允许做清洗/容错。
- **外部交互链**（导入、导出、同步 push/pull）一律源码直通：以 `markdownSource/descriptionMd` 原文为准，不做隐式二次重写。
- 外部链路允许“解析容错”，但**禁止把容错结果反向写回原文**（除非用户确实编辑了内容）。

---

## 2. 当前对齐状况（已用对比脚本验证）

基于 `docs/存储JSON与导出JSON兼容模式对比脚本.md` 中脚本 F 的结果：

| 域 | 本地存储 | 导出/同步 JSON | 对齐状态 | 说明 |
|----|----------|----------------|----------|------|
| 画布文件 (.canvas) | `bcs:canvas` (string) | `.canvas` 文件 | ✅ **已对齐** | 仅 `file` 路径前缀不同（`书签画布/` vs `书签画布-日期/`），结构+格式化完全一致 |
| 空白栏目 (md cards) | `bcs:md:*` 分片 | `空白栏目/*.md` | ✅ **已对齐** | markdownSource 内容 hash 一致 |
| 临时栏目 (temp sections) | `bcs:section:*` 分片 | `临时栏目/*.json` | ❌ **未对齐** | 见下方详细差异 |
| 永久栏目 (permanent) | `bcs:perm:main` + Chrome API | `永久栏目/*.json` | ❌ **未对齐** | 见下方详细差异 |
| 画布元数据 (meta) | `bcs:meta` + `bcs:canvas:meta` | 不单独导出 | ⚠️ 辅助数据 | 非直通数据，但 `_dirty`/`_signature` 直接影响增量同步 |

### 2.1 临时栏目差异明细

对比 `bcs:section:temp-section-3` 的 payload 与导出的 `A-2-1 2026-03-29 22_16_23.json`：

```
共有字段（一致）:  format、id、items（树结构完全一致）、createdAt、sectionType、
                   schemaVersion、label、title、tempKind、source、
                   descriptionMd、originPermanent、sequenceNumber

BCS 存储侧缺失:   无（BCS payload 与导出 JSON 在结构上已经非常接近）

字段顺序差异:      BCS 侧按 key 字母序排列（createdAt → descriptionMd → format → ...）
                   导出侧按协议定义序排列（format → schemaVersion → sectionType → ...）
```

**结论：临时栏目的数据内容已经对齐，但字段顺序不同导致 raw 字符串不一致 → 直接替换会产生"假差异"→ hash 不同 → 同步认为有变更。**

### 2.2 永久栏目差异明细

| 方面 | BCS 本地 | 导出/同步 JSON | 差异 |
|------|----------|----------------|------|
| 树数据 | 不存储（只存 `descriptionMd` + `rootMeta`） | 完整书签树 JSON | 本地真相来自 Chrome Bookmarks API |
| 副本数据 | `bcs:perm:copy-*` 各存 `descriptionMd`/`copyId` | 导出为独立 `.json` 含 `fileRole: copy-anchor` | 结构壳不同 |
| 动态 ID | Chrome 分配，跨设备不一致 | 导出时去动态 ID | 设计决策 |

**结论：永久栏目无法像临时/空白那样"存储=导出"直通，因为树数据的唯一真相是 Chrome API。需要的是确保"标准树对象（去动态 id）"在同步/导出端的一致性。**

---

## 3. 已锁定决策（本计划强制执行）

1. 永久栏目副本保留。  
2. 不保留 Chrome 动态 `id` 作为跨端一致性字段。  
3. 不上线前不做旧兼容包袱：  
   - 不保留"旧字段兼容优先"路径。  
   - 不保留"老结构先吃一口再 normalize"主链。  
4. 不做回滚开关。
5. 存储权限无限制（`unlimitedStorage` 已声明），不受单键配额约束。
6. 导出 `.canvas` 的 `file` 路径前缀差异（`书签画布/` vs `书签画布-日期/`）不作为失败标准，本次不改。
7. 永久副本 `inheritFrom` 的根路径前缀差异不作为失败标准，本次不改。
8. 对齐 Obsidian 官方编辑模型：Markdown 源码优先，渲染与存储解耦（避免默认 HTML→Markdown 全量重写）。
9. 外部链路（导入/导出/同步）保持源码直通，不做“先 normalize 再落盘/再推送”的隐式改写。

---

## 4. 当前代码的核心问题（已定位到文件）

### 问题 P1：临时栏目字段序不统一（导致 raw 字符串不一致）

BCS 分片 `bcs:section:*` 写入时按 key 字母序排列，导出侧按协议序排列。  
两边数据内容一致，但 JSON.stringify 输出不同 → hash 不同 → 同步产生假差异。

- 写入：`__saveCanvasTempStateToBcsStorage`（`bookmark_canvas_module.js:38901`）
- 导出：`__buildObsidianSyncFiles`（`bookmark_canvas_module.js:33218`）

### 问题 P2：`pull` 写 `localStorage`，但加载只读 BCS 分片

`applySnapshotToLocal` 写入 `localStorage`（SYNC_KEYS），但 `loadTempNodes` **仅**从 BCS 分片恢复（`__tryRestoreTempNodesFromBcs`），已完全移除 localStorage 回退路径。Pull 下来的数据写到了一个不再被读取的位置。

- Pull 写入：`applySnapshotToLocal`（`obsidian-git-sync.js:11208`）
- 加载读取：`loadTempNodes` → `__tryRestoreTempNodesFromBcs`（`bookmark_canvas_module.js:39270`/`40410`）

### 问题 P3：快照构建仍从 localStorage + 运行态重拼

`buildLocalSnapshot` 先读 `localStorage`（SYNC_KEYS），再通过 `resolveCanvasTempStateRawForSync` 做 normalize。导出侧另走一条路径从 `CanvasState` 重组。两条路数据源不同、序列化方式不同，可能漂移。

- 同步快照：`buildLocalSnapshot`（`obsidian-git-sync.js:8769`）
- 导出路径：`__buildObsidianSyncFiles`（`bookmark_canvas_module.js:33218`）

### 问题 P4：上次上传缓存存 normalize 后字符串

`LAST_UPLOADED_TEMP_STATE_KEY` 存的是 `buildNormalizedCanvasTempStateRawForSync` 的输出，不是实际推送的 raw 字符串。如果 normalize 过程有任何微调，就会造成"内容没变但缓存匹配不上"的假差异。

- 存入：`obsidian-git-sync.js:11895` / `obsidian-git-sync.js:12866`

### 问题 P5：永久栏目本地与同步/导出的数据壳不统一

BCS 本地侧仅存说明 + rootMeta，树走 Chrome Bookmarks API。同步需要标准树对象时每次从 API 实时读取并 normalize，导出也每次从 API 重建。两条路径独立，无单一真相。

- 本地存储：`__buildBcsPermanentPayload`（`bookmark_canvas_module.js:38866`）
- 同步读取：`getPermanentTreeSnapshotForSync`（`obsidian-git-sync.js:4185`）

### 问题 P6：导入与同步不共用解析路径

导入走 `parseCanvasPackageFromFolderFiles` → `__processImportedPackage`，同步走 `applySnapshotToLocal` / `__applyObsidianSyncFilesReplace`。临时/空白在两条路径下同输入可能不同结果。

- 导入入口：`parseCanvasPackageFromFolderFiles`（`bookmark_canvas_module.js:36091`）/ `parseCanvasPackageFromJsonFile`（`bookmark_canvas_module.js:29552`）
- 同步入口：`applySnapshotToLocal`（`obsidian-git-sync.js:11208`）/ `__applyObsidianSyncFilesReplace`（`bookmark_canvas_module.js:36336`）

### 问题 P7：空白卡/说明栏存在“格式化重写”噪音，不符合 Obsidian 源码优先模型

当前空白卡编辑保存链路默认会走 `HTML -> Markdown` 回写，再写入 `markdownSource`；说明栏也会做规范化（含 `trim` / HTML 转 Markdown）。  
这会导致“内容语义不变，但源码字节发生变化”（空行、行尾空格、换行风格），与 Obsidian 官方“Markdown 源码为真相”的体验不一致。

- 空白卡编辑回写：`__syncMdNodeFromEditor`（`bookmark_canvas_module.js:21274`）
- 空白卡导出重写：`__buildMdNodeMarkdown`（`bookmark_canvas_module.js:32083`）
- 说明栏规范化：`__normalizePermanentViewDescriptionMarkdown`（`bookmark_canvas_module.js:13745`）

---

## 5. 目标结构（哪些已经到位、哪些要改）

### 5.1 画布文件 (.canvas) — ✅ 已到位

`bcs:canvas` 存储的 raw string 与导出的 `.canvas` 文件格式完全一致（同一个 `__formatObsidianCanvasJson` 输出）。  
仅路径前缀因导出根目录设置不同，这是正常行为。

**本次不动。**

### 5.2 空白栏目 (md cards) — ⚠️ 语义已对齐，源码保真待收口

`bcs:md:*` 的语义内容与导出 `.md` 基本一致，但在“编辑后保存/导出”链路中仍可能出现格式化重写（换行、空行、行尾空格）。

改法：**按 Obsidian 官方模型收口为“源码优先”**：  
- `markdownSource` 是唯一真相。  
- `html/text` 仅渲染缓存。  
- 默认不做全量 `HTML -> Markdown` 重写。

### 5.3 临时栏目 — ❌ 要改

目标：`bcs:section:*` 分片的 JSON payload 与导出/同步文件里的 JSON **字节级一致**（相同格式化器输出）。

当前差距：字段顺序不同。  
改法：**让 BCS 写入和导出共用同一个 `buildSectionJsonPayload` 函数**，确保字段按协议序生成。

### 5.4 永久栏目 — ❌ 要改

目标：同步/导出的永久树标准 JSON 有单一构建器，副本视图壳在 BCS 和导出端格式统一。

当前差距：  
1. 树数据每次从 Chrome API 实时读取，无本地缓存式真相。  
2. BCS 侧的 `bcs:perm:main` 只存说明，导出侧存完整树。

改法：**定义"标准树对象（去动态 id）"作为同步/导出的唯一树模型**；副本壳格式统一。

### 5.5 同步链路（读/写） — ❌ 要改

目标：`pull` 写入 BCS 分片（不再写 localStorage），`buildLocalSnapshot` 从 BCS 分片读取（不再从 localStorage 拼）。

### 5.6 Obsidian 编辑模型对齐（源码优先） — ❌ 要改

目标：与 Obsidian 编辑体验一致，保证“渲染可变、源码稳定”：

1. 空白卡 `markdownSource` / 说明栏 `descriptionMd` 为唯一真相源。  
2. 渲染层（HTML）可变化，但无内容改动时不应导致源码字节漂移。  
3. 导出优先输出源码，不做无必要的格式重排。

---

## 6. 执行阶段（直接改，不做旧兼容过渡）

### 阶段 A：临时栏目格式对齐（字段序统一）

- [ ] A1. 提取公共的 `buildTempSectionJsonPayload(section)` 函数，按协议序排列字段（format → schemaVersion → sectionType → id → label → ...）。
- [ ] A2. `__saveCanvasTempStateToBcsStorage` 写入 BCS 时使用此函数。
- [ ] A3. `__buildObsidianSyncFiles` 导出时使用同一函数。
- [ ] A4. `buildLocalSnapshot` 构建同步快照时使用同一函数。

涉及文件：

- `history_html/bookmark_canvas_module.js`
- `history_html/sync/obsidian-git-sync.js`

验收：

1. 对比脚本 F 的 `temporaryProtocolsMatch === true`。
2. 无改动连续 push 第二次变更数为 0。

---

### 阶段 B：同步写路径修复（pull 写入 BCS、读取走 BCS）

- [ ] B1. `applySnapshotToLocal` 改为将临时/空白/画布数据直接写入 BCS 分片（而不是 `localStorage`）。
- [ ] B2. `buildLocalSnapshot` 改为从 BCS 分片读取（不再从 `localStorage` 读 SYNC_KEYS 拼接）。
- [ ] B3. `LAST_UPLOADED_TEMP_STATE_KEY` 存实际推送的 raw 字符串，不再 normalize。
- [ ] B4. `normalizeSnapshot` 只校验数据有效性，不改变字段顺序或重建对象结构。

关键函数位点（要改）：

- `applySnapshotToLocal`（`obsidian-git-sync.js:11208`）
- `buildLocalSnapshot`（`obsidian-git-sync.js:8769`）
- `normalizeSnapshot`（`obsidian-git-sync.js:8519`）

验收：

1. Pull 后 `loadTempNodes` 能直接从 BCS 读到刚写入的数据。
2. Pull 后立即 push 为 0 内容差异。

---

### 阶段 C：永久栏目对齐

- [ ] C1. 定义永久树标准对象构建器（去动态 `id`），作为同步/导出的唯一树模型。
- [ ] C2. 永久副本视图壳在 BCS (`bcs:perm:copy-*`) 和导出 JSON 中使用相同格式生成器。
- [ ] C3. `getPermanentTreeSnapshotForSync` 和 `__buildObsidianSyncFiles` 中的永久树构建共用同一函数。

关键函数位点（要改）：

- `__buildBcsPermanentPayload`（`bookmark_canvas_module.js:38866`）
- `getPermanentTreeSnapshotForSync`（`obsidian-git-sync.js:4185`）
- `__buildObsidianSyncFiles`（`bookmark_canvas_module.js:33218` 内永久栏目部分）

验收：

1. 对比脚本 F 的 `permanentTreeMatch === true`。
2. 永久副本文件导出后可通过同步直接回灌。

---

### 阶段 D：导入链路收口

- [ ] D1. 临时/空白复用同一"解析 → 应用"管线（导入和同步共用落盘器）。
- [ ] D2. 永久栏目按导入/同步双语义分流：  
  - 手动导入 = 永久 → 临时快照卡。  
  - 同步 JSON 兼容 = 直接对齐永久树。
- [ ] D3. 删除旧兼容主链（保留错误提示，不做旧结构自动修复）。
- [ ] D4. 空白卡改为源码优先：`markdownSource` 为唯一真相，默认不做全量 `HTML -> Markdown` 重写。
- [ ] D5. 说明栏改为源码优先：`descriptionMd` 默认不做无必要规范化重写。
- [ ] D6. 导出优先写源码（无内容改动时保持字节稳定），仅渲染缓存可变。

关键函数位点（要改）：

- `parseCanvasPackageFromJsonFile`（`bookmark_canvas_module.js:29552`）
- `parseCanvasPackageFromFolderFiles`（`bookmark_canvas_module.js:36091`）
- `__applyObsidianSyncFilesReplace`（`bookmark_canvas_module.js:36336`）
- `__syncMdNodeFromEditor`（`bookmark_canvas_module.js:21274`）
- `__buildMdNodeMarkdown`（`bookmark_canvas_module.js:32083`）
- `__normalizePermanentViewDescriptionMarkdown`（`bookmark_canvas_module.js:13745`）

验收：

1. 临时/空白：同一份 JSON 通过"导入"和"同步拉取"落地后关键键签名一致。
2. 永久：导入生成临时快照卡、同步对齐永久树，行为符合预期。
3. 空白卡/说明栏：无内容改动保存后源码字节不变（仅渲染缓存允许变化）。

---

### 阶段 E：回归验收（影响范围分析 + 针对性校验）

#### 架构结论：运行态功能不受存储格式影响

经代码追踪确认，画布的**运行态功能全部从内存 `CanvasState` 对象读取数据**，不直接读 BCS 存储：

```
数据流：BCS 存储 → [加载] → CanvasState（内存） → [运行态功能全部在这里读]
                                    ↓
                              [保存] → BCS 存储
```

| 功能模块 | 文件 | 数据来源 | 是否直接读 BCS | 影响 |
|----------|------|----------|---------------|------|
| **搜索** | `search.js` | `CanvasState.tempSections` / `.mdNodes` / `.edges` | ❌ 不读 | **不受影响** |
| **右键菜单** | `bookmark_tree_context_menu.js` | DOM 元素 + `CanvasState`（仅读 `bcs:perm:copies` 查副本列表） | ❌ 不读临时/空白 BCS | **不受影响** |
| **拖拽** | `bookmark_tree_drag_drop.js` / `pointer_drag.js` | DOM 事件 + `CanvasState` | ❌ 完全不读 BCS | **不受影响** |
| **侧边栏目录** | `canvas_sidebar_directory.js` | `CanvasState`（仅定义了 `bcs:perm:copies` 等常量用于永久栏目展示） | ❌ 不读临时/空白 BCS | **不受影响** |
| **滚动条/缩放** | `bookmark_canvas_module.js` | `CanvasState.zoom` / `.panOffsetX` / `.panOffsetY` | ❌ 不读 BCS | **不受影响** |
| **连接线** | `bookmark_canvas_module.js` | `CanvasState.edges` | ❌ 不读 BCS | **不受影响** |
| **懒加载/休眠** | `bookmark_canvas_module.js` | `CanvasState.tempSections` + DOM 可见性 | ❌ 不读 BCS | **不受影响** |
| **永久栏目说明** | `history.js` | 仅读 `bcs:perm:tip-main`（localStorage） | ⚠️ 读了一个 perm key | **不受影响**（本次不改 tip 存储） |

#### 真正受影响的只有 4 条管线

| 管线 | 改了什么 | 需要校验什么 |
|------|----------|-------------|
| **加载** | BCS payload 字段顺序变了 → `__applyCanvasTempStateObject` 按字段名读取（`sourceState.sections`），不依赖顺序 | 加载后画面正确显示 |
| **保存** | `saveTempNodes` → `__saveCanvasTempStateToBcsStorage` 使用新格式化器 | 保存后重新加载数据不丢 |
| **同步** | `buildLocalSnapshot` / `applySnapshotToLocal` 改读写路径 | push/pull 循环无假差异 |
| **导入导出** | 导出和存储用同一个格式化器 | 导出文件可重新导入 |

#### 需要校验的（精简版）

- [ ] E1. **加载校验**：改完后刷新页面，临时/空白/永久/连接线全部正确显示。
- [ ] E2. **保存校验**：编辑→保存→刷新→数据不丢不变形。
- [ ] E3. **同步校验**：
  - 首次同步上传→拉取→内容一致。
  - 无改动连续 push 第二次变更数为 0。
  - Pull 后立即 push 为 0 差异。
  - 冲突处理（local/remote 选择后正确应用）。
- [ ] E4. **导入导出校验**：JSON 导出后重新导入，数据完整。
- [ ] E5. **三方对齐脚本校验**：全 5 项 `=== true`。
- [ ] E6. **脚本 G 直通校验**：`semanticEqual === true`。

#### 不需要专门回归的

> 搜索、右键菜单、拖拽排序、滚动条、缩放、连接线绘制、懒加载、快捷键——这些全部从内存 `CanvasState` 读数据，只要 E1（加载校验）通过，它们就不会受影响，不需要逐个测试。

---

## 7. 交付物（每阶段都要有）

1. 代码改动列表（文件 + 函数）。
2. 对比脚本结果（写入 `docs/存储JSON与导出JSON兼容模式对比脚本.md`）。
3. 临时/空白导入-同步一致性对比结果（同输入签名对比）。
4. 永久双语义验收记录。
5. 阶段验收结论（通过/不通过 + 问题单）。

---

## 8. 执行顺序（固定）

1. A 临时栏目格式对齐（字段序统一）
2. B 同步写路径修复（pull/push 直通 BCS）
3. C 永久栏目对齐
4. D 导入链路收口
5. E 回归验收

---

## 9. 执行记录

- [ ] A 完成（日期：____）
- [ ] B 完成（日期：____）
- [ ] C 完成（日期：____）
- [ ] D 完成（日期：____）
- [ ] E 完成（日期：____）

### 检查节点（源码优先收口）

- [x] D-Checkpoint-1（2026-03-30）：空白卡/临时说明/永久说明写入链路改为“等价内容保留原源码”，并去除同步链路中的 `descriptionMd.trim()` 被动重写点。  
  待你执行脚本 F/G 做下一步验收：重点看“无内容改动保存后源码字节稳定”。

### 临时栏目专项补充（常规链式 + 特殊临时，2026-03-30）

参考专项文档：`docs/临时栏目（常规链式+特殊临时）三方对齐计划书.md`。  
本补充用于确保“像上次改造一样，改动可控且不外溢”。

#### 本轮只改

- 临时栏目协议三方统一（本地 `bcs:section:*` / 导出 JSON / 云端同步 JSON）。
- 常规链式与特殊临时统一进入同一 temporary 协议壳，差异仅由 `tempKind/source` 表达。
- 顺序稳定与比较稳定（节点顺序、文件集合顺序、canonical 比较口径）。

#### 本轮不改（强约束）

- 不改永久栏目主模型（继续以 Chrome API 书签树为真相源）。
- 不改空白栏目与 `.canvas` 协议边界。
- 不把临时栏目强行改成 Chrome 原生动态字段模型（不引入 `parentId/index/dateAdded` 为协议必填）。
- 不改导入双语义总策略（永久导入=临时快照、同步=永久树对齐）。

#### 不受影响守门清单（每次提交前必过）

- 分裂链操作：从永久分裂、继续分裂、跨临时栏目移动后，层级与顺序保持一致。
- 特殊临时操作：`browser-drop/search-result/batch/quick-add/file-import/import-*` 创建与导出路径保持一致。
- 说明与源码稳定：`descriptionMd` 无语义变更时不产生额外重写。
- 同步冲突面板行为保持可用（仅数据源收口，不改交互语义）。
- 对比脚本通过：`temporaryProtocolsMatch === true`，并补充 `regular/special` 分组断言。

---

## 10. 同步冲突分层策略改造计划（2026-03-31 新增）

目标：按“仅空白栏目卡片源码走 merge、其余一律结构化覆盖/时间优先”的规则收口，并把该规则显式体现在策略页与状态面板中。

### 10.1 规则总览（本次新增的统一语义）

1. 单边变化（仅本地变或仅云端变）：直接沿原方向同步，不触发冲突面板。  
2. 双边变化：
   - 空白栏目卡片源码（`markdownSource`）：优先走 merge。  
   - 结构化数据（永久树、临时树、`.canvas`、永久/临时说明字段）：走覆盖决策。  
3. 结构化默认策略：`按最近修改时间决定（newer）`。  
4. 永久栏目在“云端 -> 本地”时继续保留阈值逻辑：  
   - 先按结构化策略判方向；  
   - 命中“使用云端覆盖本地”后，再由 `permanentPullMode=auto` 判“增量/覆盖”。  
5. 首次同步方向（auto/cloud/local）保留现有机制，不与冲突策略混用。

补充红线（与 1/3 节一致）：

- 冲突决策只决定“采用哪份源码/是否生成冲突副本”，不对源码做额外格式重排。
- 外部路径上的 `markdownSource/descriptionMd` 允许原样带回，渲染层差异不作为改写理由。

#### 10.1.1 冲突域分类硬规则（强制执行）

1. `.canvas` 一律归类为“结构化数据”，不做 merge。  
2. `.canvas` 中 `type:"text"` 节点归类为“结构化数据”，不做 merge。  
3. 永久栏目（含副本）`descriptionMd` 归类为“结构化数据”，不做 merge。  
4. 临时栏目 `descriptionMd` 归类为“结构化数据”，不做 merge。  
5. 仅空白卡 `markdownSource` 进入 merge。  
6. “右侧冲突副本卡片”仅允许用于空白卡 `markdownSource`；永久/临时说明冲突禁止生成右侧冲突卡片。

### 10.2 策略页改造（Behavior）

新增设置组（在“策略”页）：

- [ ] `空白卡源码双端都改处理方式`（默认：`自动合并`）  
  可选值：`merge` / `local` / `remote` / `conflict-copy`
- [ ] `空白卡源码合并失败兜底`（默认：`conflict-copy`）  
  可选值：`conflict-copy` / `manual`
- [ ] `结构化冲突策略`（默认：`newer`）  
  可选值：`newer` / `local` / `remote` / `manual`

落盘与默认值：

- [ ] 新增 settings 键并给默认值（仅按当前版本字段集生效）。
- [ ] 保留现有 `firstSyncMode`、`permanentPullMode`、阈值配置。

### 10.3 状态页/冲突面板改造（Status）

状态区新增摘要：

- [ ] 新增“本轮策略摘要”行，展示：
  - 空白卡源码：`merge x 条 / fallback y 条`
  - 结构化：`newer/local/remote/manual`
  - 永久栏目：`auto -> incremental/overwrite（含阈值与时间判据）`

冲突面板分区：

- [ ] 空白卡源码冲突区（仅 merge 失败或策略=manual 时显示）
  - 动作：`用本地源码`、`用云端源码`、`生成冲突副本卡片`
- [ ] 结构化冲突区（沿用现有 3 按钮）
  - `使用云端覆盖本地`
  - `保留本地并覆盖云端`
  - `按最近修改时间决定`

展示文案：

- [ ] 明确标注“空白卡源码已自动 merge，以下仅为结构化冲突决策”。
- [ ] 明确标注“永久栏目若选云端方向，仍会进入阈值判定（增量/覆盖）”。
- [ ] 明确标注“永久/副本/临时说明字段归结构化覆盖，不生成右侧冲突副本卡片”。

### 10.4 执行阶段（新增 F/G/H）

#### 阶段 F：设置模型与默认值收口

- [ ] F1. 增加 `blankCardSourceConflictPolicy`、`blankCardSourceMergeFallback`、`structuredConflictPolicy`。
- [ ] F2. `loadSettings/saveSettings/applySettingsToForm/pullSettingsFromForm` 全链打通。

验收：

1. 当前版本用户进入策略页后能看到默认值。
2. 刷新后设置不丢失，且不影响首次同步与永久栏目既有设置。

#### 阶段 G：冲突决策器分层

- [ ] G1. 冲突分类器：区分“空白卡源码冲突”与“结构化冲突”。
- [ ] G2. 空白卡源码冲突先执行 merge（或按策略直接 local/remote）。
- [ ] G3. merge 失败按 `blankCardSourceMergeFallback` 执行（冲突副本卡片或人工）。
- [ ] G4. 结构化冲突走 `structuredConflictPolicy`，默认 `newer`。
- [ ] G5. 永久栏目在结构化方向命中 remote->local 时，继续走 auto 阈值判定。

验收：

1. “双边都改”的场景下，空白卡源码先 merge，结构化再决策。
2. 结构化默认行为为按时间优先，不再默认手动阻塞。
3. 永久栏目仍保留“auto 阈值增量/覆盖”能力。

#### 阶段 H：面板与可观测性

- [ ] H1. 状态页加入策略摘要与分项统计。
- [ ] H2. 冲突面板拆分“空白卡源码区”与“结构化区”。
- [ ] H3. 成功/失败 toast 与运行日志补充“空白卡源码 merge 结果”。

验收：

1. 用户能看懂每次同步到底做了什么（merge 了哪些、覆盖了哪些）。
2. 冲突面板操作与实际执行一致，不出现“按钮语义和结果不一致”。

### 10.5 回归与脚本检查（新增）

- [ ] 三类双边冲突样例：
  - 仅空白卡源码冲突
  - 仅结构化冲突
  - 空白卡源码 + 结构化混合冲突
- [ ] 校验默认策略：
  - 结构化默认 `newer`
  - 空白卡源码默认 `merge`
  - 永久 auto 仅按阈值判定增量/覆盖（不再有独立“先看时间”开关）
- [ ] 现有三方对齐脚本继续通过（不回退已完成的临时栏目对齐结果）。

### 10.6 本节完成标记

- [ ] F 完成
- [ ] G 完成
- [ ] H 完成

说明：由于本节范围已收口为“仅空白卡源码 merge”，状态按新口径重置；最终签收以 10.7 门禁与对比脚本回归结果为准。

### 10.7 强制门禁（哈希/变脏/时间/初始基线）

以下 4 项为本次改造的硬门禁，任一不满足不得标记阶段完成：

- [ ] 哈希门禁  
  - 同步、推送、拉取成功结束后，必须持久化最新 `lastRemoteSha`。  
  - `lastCheckRemoteSha` 与运行态展示保持一致。  
  - 无改动二次 push 变更数必须为 0。

- [ ] 变脏门禁  
  - 仅在语义变更时置脏；纯格式/键序变化不得置脏。  
  - 空白卡源码 merge 成功后，若合并结果与本地等价，不得产生额外脏标记。  
  - 冲突处理中断/恢复后，dirty 状态不得“提前清空”或“长期脏死”。

- [ ] 最新修改时间门禁  
  - 结构化默认 `newer` 决策必须基于可靠 `updatedAt`。  
  - `updatedAt` 缺失或相等时，不允许伪造“时间优先”结果，必须走降级策略（manual 或配置兜底）。  
  - 永久栏目 `auto` 的时间判别仅用于方向辅助，不得绕过阈值增量/覆盖判定。

- [ ] 初始情况门禁（首次同步/无基线）  
  - 无共同基线时禁止静默自动覆盖，必须进入首次同步方向策略（auto/cloud/local）或显式确认。  
  - 云端为空、云端有文件但快照缺失、路径待校验三类初始场景必须分流处理。  
  - 建立首个基线后再允许常规“时间优先 + 分层冲突”路径。

### 10.8 空白卡源码 Merge 与冲突副本卡片（2026-03-31 补充）

目标：仅对空白卡 `markdownSource` 执行 merge；冲突副本卡片仅在空白卡源码冲突时生成，且不改写原字段。

- [ ] M1. 空白卡源码 merge 入口使用三方语义 `mergeDescriptionTexts(base, local, remote)`。  
  - 先判单边改动（`base===local` / `base===remote`）。  
  - 再尝试 `diff_match_patch`（若运行时可用），失败后走保守兜底。  
- [ ] M2. `policy=conflict-copy` 不把 `<<<<<<< LOCAL` 写回 `markdownSource`。  
- [ ] M3. 空白卡源码 merge 失败且 fallback=`conflict-copy` 时，新建“冲突副本卡片”。  
- [ ] M4. 冲突副本卡片默认放在源卡片右侧（无锚点时放到画布最右侧列）。  
- [ ] M5. 冲突副本卡片内容包含：`source/scope/reason/generatedAt` + `LOCAL/REMOTE` 双源码块。  
- [ ] M6. 永久/副本/临时说明字段冲突不走冲突副本卡片，统一归结构化策略。  
- [ ] M7. 若需强制对齐 Google `diff-match-patch` 版本行为：下一轮把库内置到插件包并锁定版本（避免依赖运行时是否注入）。

验收补充：

- [ ] C1. 双端都改 + 空白卡源码 fallback=conflict-copy：源字段不变，且生成右侧冲突卡。  
- [ ] C2. 双端都改 + 空白卡源码 policy=conflict-copy：源字段不变，且生成右侧冲突卡。  
- [ ] C3. 双端都改 + 永久/临时说明字段：不生成右侧冲突卡，按结构化策略落地。  
- [ ] C4. 生成冲突卡后：`mdNodeCounter`、`timestamp`、`dirty/hash` 行为符合 10.7 门禁。  
- [ ] C5. 冲突卡导出/回拉后仍可正常渲染，不影响原空白栏目与临时栏目结构。

### 10.9 GitHub BASE 三方 Merge 计划（v1，先不做本地 BASE）

目标：在“双端都改”场景里，空白卡源码 merge 的 `base` 统一来自 **GitHub 上次已对齐版本**，不再用“当前快照值”充当伪 base。

#### 10.9.1 共同基线来源（文件级）

- `runtime.lastRemoteSha`：记录“最近一次已确认的云端总版本”。
- `prevSyncIndex.files[path].sha`：记录“每个同步文件在上次对齐点的 GitHub blob sha”。
- 当两端都改时，按 `path -> sha` 从 GitHub 回读 base 文件，再提取空白卡 `markdownSource` 字段做三方 merge。

#### 10.9.2 流程图（GitHub-only BASE）

```mermaid
flowchart TD
  A[开始同步] --> B[计算 localChanged / remoteChanged]
  B --> C{是否双端都改?}
  C -- 否 --> Z[走现有单边路径]
  C -- 是 --> D[收集空白卡源码目标 key]
  D --> E[key 映射到文件 path]
  E --> F[从 prevSyncIndex 读取每个 path 的 base sha]
  F --> G{base sha 是否齐全?}
  G -- 否 --> H[按 fallback: conflict-copy 或 manual]
  G -- 是 --> I[按 sha 从 GitHub 读取 base 文件内容]
  I --> J[解析 base/local/remote 空白卡源码 map]
  J --> K[mergeDescriptionTexts(base, local, remote)]
  K --> L{merge 是否成功?}
  L -- 否 --> H
  L -- 是 --> M[写回合并结果到待应用快照]
  M --> N[结构化冲突按 structuredConflictPolicy 决策]
  N --> O[完成 push/pull]
  O --> P[更新 runtime 哈希 + prevSyncIndex(path->sha)]
```

补充约束：

- 仅提取并回写空白卡 `markdownSource` 字段。  
- 永久/副本/临时说明字段不参与 merge，统一按结构化策略决策。

#### 10.9.3 落地改造点（先做 GitHub）

- [ ] GB1. `github/repo-api.js` 增加“按 blob sha 读取文件”API（直接走 `/git/blobs/{sha}`）。
- [ ] GB2. `background.js` 增加消息动作：`canvasGitReadBlobBySha`（返回 `contentBase64`）。
- [ ] GB3. `obsidian-git-sync.js` 增加 `fetchBaseFilesBySha(pathShaPairs)`。
- [ ] GB4. 空白卡源码冲突入口新增 `baseMap` 覆盖参数：优先用 GitHub base map；无 base 才走 fallback。
- [ ] GB5. 仅在 `provider=GitHub` 且 `path->sha` 可用时启用此逻辑；其余 provider 暂不启用。

#### 10.9.4 失败降级策略（必须明确）

- base sha 缺失 / 读取失败 / 文件已删除：不做静默自动 merge，走 `blankCardSourceMergeFallback`。
- 默认 fallback 仍为 `conflict-copy`，保持“源字段不改写”。
- 首次同步未建立基线时，不进入 GitHub BASE merge（沿用首次同步分流策略）。

#### 10.9.5 验收清单

- [ ] R1. 双端都改 + base 可用：空白卡源码三方 merge 结果稳定，且不再误用当前值作 base。
- [ ] R2. 双端都改 + base 缺失：正确进入 `conflict-copy/manual`，不出现静默覆盖。
- [ ] R3. 同步成功后 `prevSyncIndex.files[path].sha` 与 `runtime.lastRemoteSha` 正确推进。
- [ ] R4. 第二次无改动 push 变更数为 0（哈希与基线一致）。
