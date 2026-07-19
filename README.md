## Switch to [中文文档](docs/README/README.zh.md)...

[![Linux.do](https://img.shields.io/badge/Linux.do-Portfolio-FFD700?logo=discourse&logoColor=white)](https://linux.do/u/kk1/activity/portfolio)
[![GitHub Releases](https://img.shields.io/github/v/release/Browser-bookmark-hub/Bookmark-Canvas?logo=github&logoColor=white&label=GitHub+Releases)](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/releases)

### Overview

`Bookmark Canvas` is a Manifest V3 bookmark manager for Chrome / Edge. It combines browser bookmarks with a visual workspace built on JSON Canvas: browser-backed **Permanent Sections**, independent **Temporary Sections**, **Blank Sections**, **Card Groups**, and directional connections can live together on one canvas.

Use the canvas to keep bookmark trees spatially organized without turning it into a second file manager. Canvas packages can be imported and exported locally, or **Push**ed to and **Pull**ed from a GitHub repository. The exported package includes [AI rule templates](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template) so compatible AI clients can understand the data boundary before working with it.

### Initial Guide

When an empty canvas first opens, three guide cards are visible: **Canvas Basics**, **Quick Actions**, and **Features**. The complete three-part [Initial Guide](docs/INITIAL_GUIDE.md) covers Canvas Basics, Quick Actions, and Features, and we recommend becoming familiar with these five rules first:

1. **Basic interaction:** Permanent Sections directly represent the browser bookmark tree. <ins>Drag a bookmark or folder from a Permanent Section or Temporary Section onto a blank canvas area to create a new Temporary Section</ins>. Permanent Sections use an object-copy rule; Temporary Sections use move semantics in both directions. <ins>Bookmarks and folders can also be dragged between sections</ins>.
2. **Side Panel and HTML Page:** click the extension icon to open the Side Panel, where <ins>card fullscreen is especially useful</ins>. Click **HTML Page** to open or locate the Bookmark Canvas tab, or use:
   - `Ctrl + Shift + X` (`Command + Shift + X` on macOS): open the Side Panel through the extension action.
   - `Ctrl + Shift + Space` (`Command + Shift + Space` on macOS): open or locate the Bookmark Canvas tab.
3. **Zoom and pan:** use `Ctrl + Scroll` to zoom and `Space + Left Click` to pan the canvas; on a trackpad, pinch zooms and two-finger scrolling pans. `Shift + Scroll` moves horizontally and bypasses section-level vertical-scroll capture.
4. **Mouse rules:**
   - **`Ctrl + Left Click`:** pan the canvas or move a card.
   - **`Ctrl + Right Click`:** resize a card; use `Ctrl + Right Click` again to finish.
   - **Left-drag on a blank area:** select elements into a temporary selection group.
   - **Ordinary right-click:** open the current object's menu (Permanent Section, Permanent Section Copy, Temporary Section, Special Temporary Section, Blank Section, Card Group, connection line, temporary selection group, or blank canvas area) for fullscreen, locate, pin, color, rename, delete, or <ins>export</ins>.
5. **Push / Pull safety:** Push cleans the configured remote sync directory. ⚠️ <ins>Do **not** keep unrelated notes or media there: they can be permanently deleted. External file nodes such as video, audio, image, and PDF nodes are not supported</ins>. See [Limitations and Compromises](docs/LIMITATIONS_AND_COMPROMISES.md).

### Preview

#### Screenshot Preview

| Canvas workspace | Search, Tags & Notes |
| :---: | :---: |
| Screenshot slot reserved | Screenshot slot reserved |

| Import / Export | GitHub Push / Pull |
| :---: | :---: |
| Screenshot slot reserved | Screenshot slot reserved |

Screenshot assets will be added under [`Screenshots and videos/`](Screenshots%20and%20videos/). The naming and embedding slots are prepared there so media can be added without rewriting this README.

#### Video Preview

Video slots are reserved in [`Screenshots and videos/`](Screenshots%20and%20videos/) for a canvas walkthrough and an import/export or GitHub sync walkthrough.

### Roadmap

#### Near-term

- [ ] **Default rule-file co-building**: improve the `AGENTS.md` / `CLAUDE.md`-style rules included with exported and pushed packages, so AI clients can safely understand canvas structure, data protocols, and editing boundaries. Start from [AGENTS_template](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template).
- [ ] **Generation, analysis, and ecosystem co-building**: keep Bookmark Canvas as the primary project and first create standalone Skills for generating and analyzing it; the two directions remain separate for now.
  - **Generation Skill**: keep generated outputs centered on the Bookmark Canvas data model, as a single JSON file or a single data package that includes a `.canvas` file.
  - **Analysis Skill**: first analyze Bookmark Canvas itself and scoped canvas data; expand into index building, RAG, or Deep Research (external or internal) only after practice.
  - **Integrated Skill**: share the basic formats and Skill directions, and invite [Bookmark Backup](https://github.com/Browser-bookmark-hub/Bookmark-Backup) and [Bookmark Record and Recommend](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend) to participate; generated outputs remain primarily carried by Bookmark Canvas.
  - **Other capability explorations (to be completed)**: see [`docs/ROADMAP_OUTLOOK_DATA_PROCESSING_CLI_SKILL_CLIENT_AI.md`](docs/ROADMAP_OUTLOOK_DATA_PROCESSING_CLI_SKILL_CLIENT_AI.md).
- [ ] **Tags and Notes exploration**: the Search Panel already provides browsing and viewing. A separate management page is not a committed feature yet: it needs a clear answer for bulk management and export, rather than duplicating the current viewer.

#### Long-term

- [ ] **Settings persistence and backend/cloud research**: settings, anchors, appearance, section copies, folder-collapse state, and scroll position currently have different persistence boundaries from canvas packages. Import/export or cloud support for all of them is deliberately not planned until its complexity and restore semantics are justified. Data processing remains the current focus; even if a client or deployment option is considered later, cloud hosting is not a near-term priority. See [`docs/ROADMAP_OUTLOOK_DATA_PROCESSING_CLI_SKILL_CLIENT_AI.md`](docs/ROADMAP_OUTLOOK_DATA_PROCESSING_CLI_SKILL_CLIENT_AI.md).
- [ ] **Performance follow-up**: continue improving the path that uses the browser's practical CPU/GPU and rendering capacity as Chrome and hardware evolve. Existing low-detail, out-of-viewport, lazy-loading, and virtualization strategies remain necessary trade-offs today; future browser APIs and platform changes should be evaluated rather than assuming a fixed ceiling.
- [ ] **More languages and UI QA**: the current UI is built around Simplified Chinese and English. Traditional Chinese, French, Russian, Spanish, Arabic, Japanese, Korean, and other languages need complete copy coverage and layout QA. README translations can be added under [`docs/README/`](docs/README/). See [`docs/LIMITATIONS_AND_COMPROMISES.md`](docs/LIMITATIONS_AND_COMPROMISES.md). Much of the UI is hard-coded rather than a complete i18n system, so this either requires an i18n refactor or careful extraction/indexing of existing Chinese and English strings.
- [ ] **Limits, compromises, and external-change tracking**: keep documenting browser boundaries and intentional scope decisions, including the decision <ins>not to turn Bookmark Canvas into an attachment manager, file manager, or second Obsidian</ins>; continue following Chrome / Edge behavior, browser API changes and bug fixes, plus GitHub API and hash constraints that affect GitHub Push / Pull. See [`docs/LIMITATIONS_AND_COMPROMISES.md`](docs/LIMITATIONS_AND_COMPROMISES.md) and [`docs/FOLLOW_UP_BROWSER_ROOT_MODEL_GITHUB_HASH.md`](docs/FOLLOW_UP_BROWSER_ROOT_MODEL_GITHUB_HASH.md).

### Docs

- [Documentation](docs/)
- [Archive index](docs/Archived/00--%E5%BD%92%E6%A1%A3%E7%B4%A2%E5%BC%95-%E8%AF%B7%E5%85%88%E8%AF%BB.md)

### References

**Bookmark ecosystem**

- [Bookmark Canvas](https://github.com/Browser-bookmark-hub/Bookmark-Canvas)
- [Bookmark Record and Recommend](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend)
- [Bookmark Backup](https://github.com/Browser-bookmark-hub/Bookmark-Backup)

**External projects**

- [JSON Canvas](https://github.com/obsidianmd/jsoncanvas)
- [Obsidian JSON Canvas Skill](https://github.com/kepano/obsidian-skills/tree/main/skills/json-canvas)
- [xyflow](https://github.com/xyflow/xyflow)
- [Obsidian Editing Toolbar](https://github.com/PKM-er/obsidian-editing-toolbar)
- [AltSnap](https://github.com/RamonUnch/AltSnap)

### Data & Privacy

- Canvas data, settings, local indexes, and caches are stored in the browser extension's local storage / IndexedDB by default; this project does not operate a dedicated backend service.
- GitHub Push / Pull is optional and only accesses the repository configured by the user.
- Permissions include bookmarks, storage, downloads, tabs, tab groups, windows, active-tab access, favicon access, idle state, and host access; they support bookmark management, canvas interaction, favicon display, and related browser integration.
- See the [Privacy Policy](PRIVACY_POLICY.md) for the complete data-handling and permission explanation.

---

## License

[GPL-3.0](Bookmark-Canvas-main/LICENSE).

## [Back to top](#switch-to-中文文档)
