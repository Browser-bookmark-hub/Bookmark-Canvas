# Pele.js 架构构建工具

运行环境：Node.js 18+

```sh
node build.js
```

产物路径：`Bookmark-Canvas-main/history_html/vendor/pele.min.js`

## 介绍与用途

Pele.js 是 Obsidian 创始人兼 CEO `kepano` 亲手打造的超轻量级 Mermaid 渲染引擎（v1.13.0）。
- **零外部运行时依赖**（Zero-dependency），不依赖庞大的 D3 或 dagre。
- **纯同步 SVG 生成**：调用 `pele.render(code).svg` 瞬间产生自适应矢量图，单图渲染耗时 0.2ms~3ms。
- **天然驱动 CSS 变量**：通过 `--pele-bg`, `--pele-fg`, `--pele-line`, `--pele-surface`, `--pele-accent` 等变量驱动换色，与 Bookmark Canvas 主题及卡片预设强调色（`--section-color`）完美契合。
