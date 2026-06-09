# GitHub 推送拉取功能实施计划书

## 1. 目标边界

本轮只实现 GitHub 上的「推送」和「拉取」，不恢复旧 Obsidian-Git 同步系统。

推送和拉取都必须复用当前项目已有的全量导入/导出协议：

- 推送：基于现有全局导出包构建结果，把完整画布包写入 GitHub。
- 拉取：从 GitHub 读取完整画布包，再交给现有导入流程处理。
- 拉取模式只保留两种：导入快照包、覆盖导入。
- 不做自动同步、脏变更、增量文件同步、冲突合并、后台恢复锁、首次同步策略。

旧 commit `fa971ed1fccc1bdd9dbd0baf465cfe7f8542b4bf` 本身是删除提交；可参考的是其父提交里被删除的 GitHub API、仓库配置、路径检测逻辑，但不能整块搬回旧同步模块。

## 2. 产品决策

### 2.1 首次推送需要弹出预检确认

需要。首次推送应参考旧 Obsidian 配置里的仓库/分支/路径判断思路，但做成更轻的「推送预检」。

推送按钮点击后的判断顺序：

1. 本地 GitHub 配置缺失：直接打开配置弹窗。
2. Token / owner / repo / branch 检测失败：停在配置弹窗并显示错误。
3. 分支不存在：提示「首次推送时将自动创建分支」，用户确认后继续。
4. 远端目标路径不存在或为空：弹出「首次推送 / 初始化远端」确认框。
5. 远端目标路径已有合法 `书签画布` 包：按普通推送处理，提示会替换该路径下受管文件。
6. 远端目标路径有文件但没有合法 `.canvas` 包：弹出高风险提示，推荐改路径；默认不继续。

首次推送确认框内容：

- 当前仓库：`owner/repo`
- 当前分支：用户配置分支或仓库默认分支
- 远端路径：`basePath/书签画布`，其中 `basePath` 可为空
- 将写入的包名固定为 `书签画布`
- 将创建的内容：`.canvas`、永久栏目 JSON、临时栏目 JSON、AI 指南文件等
- 如果分支不存在，明确显示「将从默认分支创建」
- 操作按钮：取消、修改路径、确认推送

### 2.2 不做文件大小阈值 UI

不需要产品层的 50MB 警告和 100MB 硬限制配置。

原因：

- 当前需求是完整导入/导出包，不是持续同步大文件。
- 导出内容主要是文本 JSON / canvas / markdown，正常不会接近 GitHub 单文件限制。
- 文件大小阈值会把旧同步系统的复杂度带回来。

实现上只保留必要的 GitHub API 错误处理：如果 GitHub 返回 payload too large、413、422 等错误，按错误文案提示用户，不做提前阈值策略和不做配置项。

### 2.3 名字统一为「书签画布」

GitHub 远端默认目录固定为：

```text
书签画布
```

不再使用 `书签画布-YYYYMMDD`、`bookmark-canvas-sync`、`书签画布同步` 这类同步后缀。

本地手动下载导出仍可保留当前日期命名；GitHub 推送路径必须使用配置中的远端根目录，默认值为 `书签画布`。

### 2.4 不需要同步状态面板

本轮不做同步，因此不需要旧同步系统里的状态栏 / 状态面板。

配置页里只保留一个轻量的「最近操作」信息：

- 上次操作：推送 / 拉取
- 操作时间
- 操作结果：成功 / 失败
- 远端位置：`owner/repo · branch · basePath/书签画布`
- 失败时显示一行错误原因

不保存也不展示：

- 本地 hash
- 远端 hash / sha
- baseline
- dirty 状态
- 冲突状态
- 后台同步状态
- 恢复锁状态

正在推送或拉取时，由对应按钮进入 loading / disabled 状态即可；操作结束后更新最近操作信息。

## 3. 配置 UI 方案

### 3.1 入口

在「画布管理 -> 存储与同步」里，在现有导入、备份、导出按钮下面增加：

- 配置
- 推送
- 拉取

建议 UI 分成两行：

第一行保留当前本地能力：

- 导入
- 备份
- 导出

第二行放 GitHub 能力：

- 配置
- 推送
- 拉取

如果顶部设置菜单的隐藏 `settingsStorageSyncBlock` 继续作为入口，也同步增加这三个按钮，避免窄视图只能从主弹窗操作。

### 3.2 配置弹窗一级 UI

一级 UI 放连接必填项：

- GitHub Token
- Owner
- Repository
- Branch
- Base Path
- 测试连接
- 保存

说明：

- Branch 允许为空；为空时读取仓库默认分支。
- Base Path 允许为空；为空表示仓库根目录。
- 实际包目录 = `Base Path / 远端根目录`。
- Token 说明提供内嵌帮助，不再单独打开旧 `github-token-guide.html`。

Token 说明文案要保留旧实现的关键点：

- 推荐 Fine-grained personal access token。
- Repository access 选择目标仓库。
- Permissions:
  - Metadata: Read-only
  - Contents: Read and write

### 3.3 配置弹窗二级 UI

二级 UI 放默认行为和高级路径设置：

- 远端根目录
  - 默认：`书签画布`
  - 修改后作为下次推送和拉取默认路径
  - 需要做路径合法性校验：不能包含空段、`.`、`..`、控制字符、Windows 非法文件名字符
- 默认拉取模式
  - 导入快照包
  - 覆盖导入
- 覆盖默认阈值
  - 默认复用当前 `canvas-import-threshold-v1` 的值
  - 仅当默认拉取模式为「覆盖导入」时可编辑
  - 范围沿用当前实现：`1..100000`
- 首次推送前总是确认
  - 默认开启，不建议提供关闭项

这里的「路径」是 GitHub 仓库内路径，不是本机下载路径。

## 4. 数据与存储设计

新增 GitHub 配置存储建议：

```js
{
  githubRepoToken: string,
  githubRepoOwner: string,
  githubRepoName: string,
  githubRepoBranch: string,
  githubRepoBasePath: string,
  githubCanvasRemoteRoot: "书签画布",
  githubDefaultPullMode: "snapshot" | "overwrite",
  githubOverwriteThreshold: number,
  githubLastOperation: {
    type: "push" | "pull",
    status: "success" | "error",
    at: number,
    remoteLabel: string,
    message: string
  }
}
```

其中：

- `githubOverwriteThreshold` 可直接映射/同步当前 `canvas-import-threshold-v1`。
- `githubCanvasRemoteRoot` 默认 `书签画布`。
- 不增加 `syncEnabled`，避免 UI 暗示有自动同步。
- 不保存 dirty、baseline、lastRemoteSha、lastLocalHash。
- `githubLastOperation` 只用于配置页展示，不参与任何推送/拉取决策。

## 5. 推送流程

### 5.1 构建包

从当前 `exportCanvasPackage()` 中抽出无 UI 的包构建函数，例如：

```js
buildCanvasGlobalExportPackageForTransfer({
  exportRoot: "书签画布",
  exportFormat: "json",
  guideNames
})
```

返回：

```js
{
  rootName: "书签画布",
  files: [
    { name: "书签画布/书签画布.canvas", data: Uint8Array },
    { name: "书签画布/永久栏目/A书签树（永久栏目）.json", data: Uint8Array }
  ]
}
```

该函数必须复用现有导出沙箱：

- `CanvasProtocolBridge.buildExportSandbox()`
- `CanvasProtocolBridge.processExportSandboxForExport()`
- 当前 `.canvas` / section JSON 构建器

不要复制一套导出协议。

### 5.2 远端路径预检

推送前读取：

- 仓库信息
- 分支信息
- `basePath/remoteRoot` 下的文件列表

判断：

- 路径不存在：首次推送。
- 路径为空：首次推送。
- 路径存在且含合法 `.canvas`：普通推送。
- 路径存在但无合法 `.canvas`：高风险路径。

高风险路径默认不继续；用户应点击「修改路径」。

### 5.3 写入策略

只写入和删除远端根目录下的受管文件。

受管文件判断：

- 远端根目录下的 `.canvas`
- `永久栏目/`
- `Permanent/`
- `临时栏目/`
- `Temporary/`
- 导入说明 / AI 指南文件，如 `AGENTS.md`、`CLAUDE.md`

推送时：

1. 构建本地完整文件列表。
2. 读取远端受管文件列表。
3. 本地有的上传/覆盖。
4. 远端受管文件中本地没有的删除。
5. 不删除远端根目录下不认识的非受管文件。

提交信息建议：

```text
书签画布：推送完整画布包
```

## 6. 拉取流程

### 6.1 读取远端包

从配置的 `basePath/remoteRoot` 递归读取文件。

要求：

- 必须存在 `.canvas` 文件。
- 读取结果转成当前导入解析函数能吃的 `Map<string, Uint8Array>`。
- 文件路径需要去掉 GitHub basePath 前缀，保留包内相对结构。

### 6.2 模式选择

拉取按钮默认行为：

- 如果配置里默认拉取模式是「导入快照包」：直接进入快照包导入确认。
- 如果配置里默认拉取模式是「覆盖导入」：直接进入覆盖确认，并显示当前阈值。

建议仍提供一次拉取确认弹窗，内容包括：

- 远端仓库
- 分支
- 路径
- 远端包 `.canvas` 文件名
- 本次模式：导入快照包 / 覆盖导入
- 按钮：取消、改为快照包、改为覆盖、继续

### 6.3 复用现有导入

拉取后不写新的导入逻辑。

导入快照包：

- 调用现有 `parseCanvasPackageFromFolderFiles()`
- 再调用 `__processImportedPackage()`

覆盖导入：

- 调用现有 `parseCanvasPackageFromFolderFiles(..., { importMode: "overwrite" })`
- 再调用 `__performOverwriteImport()`
- 阈值使用配置里的 `githubOverwriteThreshold`，并和当前导入阈值保持一致

## 7. 需要搬运或重写的旧代码

从父提交中裁剪：

- `github/repo-api.js`
  - token 规范化
  - GitHub 请求封装
  - 错误归一化
  - 测试仓库连接
  - 解析默认分支
  - 分支不存在时创建
  - list/read 文件
  - 批量 commit 写入

不搬：

- `history_html/sync/obsidian-git-sync.js` 的同步状态机
- dirty 追踪
- 冲突合并
- 自动同步
- 恢复锁
- 后台定时同步
- 旧 Obsidian Git 配置整页 UI

## 8. 文件改造范围

预计新增：

- `github/repo-api.js`
- `history_html/transfer_AI_sync/github-package-transfer.js`

预计修改：

- `history_html/history.html`
  - 增加配置、推送、拉取按钮
  - 加载新脚本
- `history_html/history.css`
  - 补充 GitHub 配置弹窗、预检弹窗、按钮布局样式
- `history_html/history.js`
  - 增加必要 i18n 文案
- `history_html/transfer_AI_sync/import-export-transfer-ui-support.js`
  - 绑定新增按钮
- `history_html/transfer_AI_sync/import-export-transfer-feature.js`
  - 抽出无 UI 的全局包构建函数
  - 暴露远端拉取复用的包解析入口
- `manifest.json`
  - 如当前权限不足，需要确认 GitHub API 请求权限；优先不扩大无关权限

## 9. 验收清单

### 9.1 配置

- 未配置时点击推送/拉取会打开配置弹窗。
- Token 错误时显示明确错误。
- 仓库不存在或 token 无仓库权限时显示明确错误。
- Branch 为空时使用默认分支。
- Branch 不存在时提示将自动创建。
- 二级 UI 修改远端根目录后，下次推送/拉取使用新路径。
- 默认拉取模式能持久化。
- 覆盖阈值能持久化，并与现有覆盖导入阈值一致。

### 9.2 推送

- 首次推送远端路径不存在时弹出初始化确认。
- 远端路径有合法包时可覆盖受管文件。
- 远端路径有非包文件时默认阻止并建议改路径。
- 推送后 GitHub 上出现 `书签画布/书签画布.canvas` 和对应栏目 JSON。
- 改路径后推送到新路径，不影响旧路径。
- 不删除非受管文件。

### 9.3 拉取

- 默认快照包模式会把远端包作为分组导入当前画布。
- 默认覆盖模式会进入覆盖导入，覆盖前写备份槽。
- 覆盖失败时沿用现有回滚能力。
- 拉取缺少 `.canvas` 的路径时提示路径不是有效书签画布包。
- 拉取路径为空或不存在时提示远端没有可拉取内容。

### 9.4 回归

- 本地导入、备份、导出按钮行为不变。
- 现有快照包导入、覆盖导入、备份恢复行为不变。
- 不出现旧同步相关 UI 文案。
- 不新增自动同步状态或后台同步定时器。

## 10. 实施顺序

1. 新增 GitHub API 精简层。
2. 抽出全局导出包构建函数，保持本地下载导出行为不变。
3. 暴露远端文件 Map 解析和导入入口。
4. 实现配置弹窗和配置存储。
5. 实现推送预检弹窗。
6. 实现完整包推送。
7. 实现完整包拉取。
8. 接入画布管理按钮和顶部设置入口按钮。
9. 做手动回归验证。
