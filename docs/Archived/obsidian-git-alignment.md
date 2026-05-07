# Bookmark-Canvas 与 Obsidian Git 对齐说明

> 返回文档索引：[docs/README.md](./README.md)

## 1. 参考版本

- Bookmark-Canvas 参考提交：`2a5587fe72f183af7271b4059b25090cc7300203`
- Obsidian Git 参考仓库：`Vinzent03/obsidian-git`
- 本地参考目录：`/Users/kk/Downloads/ 参考/obsidian-git-master`

---

## 2. 核心差异（必须明确）

### 2.1 运行环境不同

- Bookmark-Canvas：Chrome 扩展（Manifest V3），运行在浏览器扩展环境。
- Obsidian Git：Obsidian 社区插件，运行在 Obsidian Vault 环境。

### 2.2 同步执行链路不同

- Bookmark-Canvas：通过 GitHub REST API（Contents API）按文件读写与提交。
- Obsidian Git：通过 Git/同构 Git 执行 `commit -> pull -> push`。

### 2.3 仓库配置语义不同

- Bookmark-Canvas 的 `Base Path`：**云端仓库内前缀目录**。
- Obsidian Git 的 `Custom base path (Git repository path)`：**本地仓库路径语义**。

两者名称相似，但含义不同，不可直接等同。

### 2.4 认证模型不同

- Bookmark-Canvas：Owner/Repo/Token 直接访问 GitHub API。
- Obsidian Git：按 Git 云端认证（HTTPS/SSH、用户名+PAT/凭证管理器）。

---

## 3. 对齐原则（Chrome ↔ Obsidian）

要实现两端协作，请确保：

1. 使用同一个云端仓库（Owner/Repo 一致）。
2. 使用同一分支（例如都使用 `main`）。
3. 路径约定一致：
   - Bookmark-Canvas 写入：`<Base Path>/bookmark-canvas/...`
   - Obsidian 端在 Vault 中保留并跟踪该目录。
4. 两端都不要改写对方的目录约定（避免目录漂移造成“看似同步成功、实际不对齐”）。

---

## 4. 推荐安装与配置顺序

1. 先在 GitHub 创建同步仓库（建议私有仓库）。
2. 在 Bookmark-Canvas 中填好 Owner/Repo/Token，点击“测试连接”通过。
3. 在 Obsidian 安装官方 `Obsidian Git` 插件并连接同一仓库。
4. 在 Obsidian 先执行一次手动 `pull`，确认能看到 `bookmark-canvas/` 目录。
5. 再开启双方自动同步策略（先手动验证，再自动化）。

---

## 5. 已对齐与未对齐项

### 已对齐

- 同步流程概念与 Obsidian Git 一致：`commit / pull / push`。
- 合并策略与冲突策略名称保持同类语义（`merge/rebase/reset`、`none/ours/theirs`）。

### 未完全等价（设计上）

- Bookmark-Canvas 不直接调用本地 Git 命令。
- 冲突处理为“扩展内部快照冲突面板”，不是 Git 工作区文件冲突编辑流。

这属于架构差异，不是 bug。
