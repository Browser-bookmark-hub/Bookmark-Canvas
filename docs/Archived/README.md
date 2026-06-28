# Bookmark-Canvas 文档索引

- [项目概览](./project-overview.md)
- [冒烟测试](./smoke-tests.md)
- [Canvas 同步开发指南](./sync-guide.md)
- [编辑模式彻底下线计划书](./编辑模式彻底下线计划书.md)
- [JSON 结构模式最终方案](./JSON结构模式最终方案.md)
- [存储收敛与 JSON 模式总顺序计划书](./存储收敛与JSON模式总顺序计划书.md)
- [空白栏目与.canvas边界对齐执行计划书](./空白栏目与.canvas边界对齐执行计划书.md)
- [书签树协议层统一子计划](./书签树协议层统一子计划.md)
- [第三刀永久栏目主栏副本实施计划](./第三刀永久栏目主栏副本实施计划.md)
- [第三刀永久栏目共享树模型兼容性补充计划](./第三刀永久栏目共享树模型兼容性补充计划.md)
- [导入规则说明](./说明导入规则.md)
- [Obsidian 双向同步计划（V1）](./obsidian-sync-plan-v1.md)
- [颗粒度同步计划书（V1）](./sync-plan-granular-dirty.md)
- [Remotely Save 同步计划书](./sync-plan-remotely-save.md)
- [简化同步与崩溃恢复规划书](./sync-plan-simplified-sync-and-crash-recovery.md)
- [Markdown-First 同步数据模型规划书](./sync-plan-markdown-first-data-model.md)
- [Obsidian Git 主同步计划书](./sync-plan-obsidian-git.md)
- [Obsidian Git 对齐说明](./obsidian-git-alignment.md)
- [永久栏目拉取方式（最终方案）](./permanent-pull-mode.md)
- [永久栏目 `folderType` / 折叠态 / 首次同步计划（讨论稿）](./permanent-root-meta-plan.md)
- [三个同步面板 UI 统一方案（首次同步 / 云端不一致 / 冲突）](./sync-panels-ui-plan.md)
- [Canvas 同步验收清单](./sync-validation-checklist.md)
- [视觉模式无图标与目录结构对齐任务书](./视觉模式无图标与目录结构对齐任务书.md)
- [bookmark-canvas-skills 任务书](./bookmark-canvas-skills-任务书.md)
- [拆分对照全量报告](./report-split-audit-split-audit-20260201-214732.md)

- [sourceID 统一替换 originalId 与同步导入导出改造计划书（2026-04-20）](./sourceID统一替换originalId与同步导入导出改造计划书-2026-04-20.md)
- [永久栏目 JSON 真相源与 sourceID 嵌入式存储改造计划书（2026-04-26）](./永久栏目JSON真相源与sourceID嵌入式存储改造计划书-2026-04-26.md)
- [永久栏目 Chrome 校准与嵌入字段跟随计划书（2026-04-28）](./永久栏目Chrome校准与嵌入字段跟随计划书-2026-04-28.md)
- [第五刀导入/导出/同步合并实施计划（2026-04-21）](./第五刀导入导出同步合并实施计划-2026-04-21.md)
- [执行记录（2026-04-20）：originalId 清理 + 同步守门](./执行记录-2026-04-20-sourceID-originalId-sync-guard.md)
- [本轮一键验收脚本](../tools/run-sync-guard-acceptance.sh)

## 本轮一键验收脚本

- 在仓库根目录运行：`bash tools/run-sync-guard-acceptance.sh`
- 或先赋予执行权限后运行：`./tools/run-sync-guard-acceptance.sh`
- 脚本会一次性执行：
  - 语法检查（`bookmark_canvas_module.js`、`search.js`、`obsidian-git-sync.js`）
  - `originalId` / `sourceID` 回检
  - 关键 hook 命中检查（一致性预检、push fail-closed、恢复锁阈值、P2 审计上下文、抑制窗口保险丝）

## 维护约定

- 新增文档请放在 `docs/` 目录。
- 文档标题建议与文件名语义保持一致。
- 涉及开发流程的文档，建议在文首添加回到本索引的链接。
