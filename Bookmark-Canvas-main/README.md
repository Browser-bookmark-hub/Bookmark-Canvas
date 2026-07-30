## Switch to [中文文档](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/blob/main/docs/README/README.zh.md)...

[![Linux.do](https://img.shields.io/badge/Linux.do-Portfolio-FFD700?logo=discourse&logoColor=white)](https://linux.do/u/kk1/activity/portfolio)[![GitHub Releases](https://img.shields.io/github/v/release/Browser-bookmark-hub/Bookmark-Canvas?logo=github&logoColor=white&label=GitHub+Releases)](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/releases) [![GitHub Bookmark-Backup](https://img.shields.io/badge/GitHub-Bookmark--Backup-181717?logo=github&logoColor=white)](https://github.com/Browser-bookmark-hub/Bookmark-Backup) [![GitHub Bookmark-Record-Recommend](https://img.shields.io/badge/GitHub-Bookmark--Record--Recommend-181717?logo=github&logoColor=white)](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend)

### Overview

`Bookmark-Canvas` is a Manifest V3 bookmark manager for Chrome / Edge. It combines browser bookmarks with a visual workspace built on JSON Canvas: browser-backed **Permanent Sections**, independent **Temporary Sections**, **Blank Sections**, **Card Groups**, and directional connections can live together on one canvas.

Canvas packages (sample data packages are available from selected [Releases](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/releases)) can be imported and exported locally, or **Push**ed to and **Pull**ed from a GitHub repository. Exported and pushed packages include [AGENTS_template](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template) so compatible AI clients can understand the data boundary before working with them.

### Preview

Screenshot and video assets are intentionally kept at the repository root in [Media and icons](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Media%20and%20icons). Open that folder for current media when it is available.

### Initial Guide

When an empty canvas first opens, three guide cards are visible: **Canvas Basics**, **Quick Actions**, and **Features**. The complete three-part [Initial Guide](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/blob/main/docs/INITIAL_GUIDE.md) covers Canvas Basics, Quick Actions, and Features, and we recommend becoming familiar with these six rules first:

1. **Basic interaction:** Permanent Sections directly represent the browser bookmark tree. <ins>Drag a bookmark or folder from a Permanent Section or Temporary Section onto a blank canvas area to create a new Temporary Section</ins>. Permanent Sections use an object-copy rule; Temporary Sections use move semantics in both directions. <ins>Bookmarks and folders can also be dragged between sections</ins>.
2. **Side Panel and HTML Page:** click the extension icon to open the Side Panel, where <ins>card fullscreen is especially useful</ins>. Click **HTML Page** to open or locate the Bookmark Canvas tab, or use:
   - `Ctrl + Shift + X` (`Command + Shift + X` on macOS): open the Side Panel through the extension action.
   - `Ctrl + Shift + Space` (`Command + Shift + Space` on macOS): open or locate the Bookmark Canvas tab.
3. **Zoom and pan:**
   - **`Ctrl + Scroll`:** zoom the canvas.
   - **`Space + Left Click`:** pan the canvas.
   - **Trackpad pinch / two-finger scroll:** zoom / pan respectively.
   - **`Shift + Scroll`:** move horizontally and bypass section-level vertical-scroll capture.
4. **Batch / selection operations (Batch Mode):**
   - **`Shift | Option/Alt + Left Click`:** select bookmarks/folders in batch or single-selection mode; left click also selects items in batch mode.
   - **`Ctrl / Command + A`:** select all bookmark and folder items in the card under the cursor.
   - **`Ctrl / Command + X`:** cut selected items.
   - **`Ctrl / Command + C`:** copy selected items.
   - **`Ctrl / Command + V`:** paste at the cursor: inside a folder, below a bookmark at the same level, at a Temporary Section root, at the Bookmarks Bar root for a blank Permanent Section, or in a new `Paste` Temporary Section on blank canvas.
   - **Text:** keep native browser paste behavior.
5. **Mouse rules:**
   - **`Ctrl + Left Click`:** pan the canvas or move a card.
   - **`Ctrl + Right Click`:** resize a card; use `Ctrl + Right Click` again to finish.
   - **Left-drag on a blank area:** select elements into a temporary selection group.
   - **Ordinary right-click:** open the current object's menu (Permanent Section, Permanent Section Copy, Temporary Section, Special Temporary Section, Blank Section, Card Group, connection line, temporary selection group, or blank canvas area) for fullscreen, locate, pin, color, rename, delete, or <ins>export</ins>.
6. **Push / Pull safety:** Push cleans the configured remote sync directory. ⚠️ <ins>Do **not** keep unrelated notes or media there: they can be permanently deleted. External file nodes such as video, audio, image, and PDF nodes are not supported</ins>. See [Limitations and Compromises](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/blob/main/docs/LIMITATIONS_AND_COMPROMISES.md).

### Roadmap

#### Near-term

- [ ] **Default rule-file co-building**: improve the `AGENTS.md` / `CLAUDE.md`-style rules included with exported and pushed packages, so AI clients can safely understand canvas structure, data protocols, and editing boundaries. Start from [AGENTS_template](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template).
- [ ] **Generation, analysis, and ecosystem co-building**: keep Bookmark Canvas as the primary project and first create standalone Skills for generating and analyzing it; the two directions remain separate for now.
  - **Generation Skill**: keep generated outputs centered on the Bookmark Canvas data model, as a single JSON file or a single data package that includes a `.canvas` file.
  - **Analysis Skill**: first analyze Bookmark Canvas itself and scoped canvas data; expand into index building, RAG, or Deep Research (external or internal) only after practice.
  - **Integrated Skill**: share the basic formats and Skill directions, and invite [Bookmark Backup](https://github.com/Browser-bookmark-hub/Bookmark-Backup) and [Bookmark Record and Recommend](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend) to participate; generated outputs remain primarily carried by Bookmark Canvas.
  - **Other capability explorations (to be completed)**: see [Roadmap Outlook: Data Processing, CLI, Skill, Client, and AI](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/blob/main/docs/ROADMAP_OUTLOOK_DATA_PROCESSING_CLI_SKILL_CLIENT_AI.md).
- [ ] **Tags and Notes exploration**: the Search Panel already provides browsing and viewing. A separate management page is not a committed feature yet: it needs a clear answer for bulk management and export, rather than duplicating the current viewer.

#### Long-term

- [ ] **Settings persistence and backend/cloud research**: settings, anchors, appearance, section copies, folder-collapse state, and scroll position currently have different persistence boundaries from canvas packages. Import/export or cloud support for all of them is deliberately not planned until its complexity and restore semantics are justified. Data processing remains the current focus; even if a client or deployment option is considered later, cloud hosting is not a near-term priority. See [Roadmap Outlook: Data Processing, CLI, Skill, Client, and AI](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/blob/main/docs/ROADMAP_OUTLOOK_DATA_PROCESSING_CLI_SKILL_CLIENT_AI.md).
- [ ] **Performance follow-up**: continue improving the path that uses the browser's practical CPU/GPU and rendering capacity as Chrome and hardware evolve. Existing low-detail, out-of-viewport, lazy-loading, and virtualization strategies remain necessary trade-offs today; future browser APIs and platform changes should be evaluated rather than assuming a fixed ceiling.
- [ ] **More languages and UI QA**: the current UI is built around Simplified Chinese and English. Traditional Chinese, French, Russian, Spanish, Arabic, Japanese, Korean, and other languages need complete copy coverage and layout QA. README translations can be added under the [README documentation directory](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/docs/README). See [Limitations and Compromises](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/blob/main/docs/LIMITATIONS_AND_COMPROMISES.md). Much of the UI is hard-coded rather than a complete i18n system, so this either requires an i18n refactor or careful extraction/indexing of existing Chinese and English strings.
- [ ] **Limits, compromises, and external-change tracking**: keep documenting browser boundaries and intentional scope decisions, including the decision <ins>not to turn Bookmark Canvas into an attachment manager, file manager, or second Obsidian</ins>; continue following Chrome / Edge behavior, browser API changes and bug fixes, plus GitHub API and hash constraints that affect GitHub Push / Pull. See [Limitations and Compromises](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/blob/main/docs/LIMITATIONS_AND_COMPROMISES.md) and [Browser Root Model and GitHub Hash Follow-up](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/blob/main/docs/FOLLOW_UP_BROWSER_ROOT_MODEL_GITHUB_HASH.md).

### Docs

- [Documentation](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/docs)
- [Archive index](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/blob/main/docs/Archived/00--%E5%BD%92%E6%A1%A3%E7%B4%A2%E5%BC%95-%E8%AF%B7%E5%85%88%E8%AF%BB.md)

### References

**Bookmark ecosystem**

- [Bookmark-Canvas](https://github.com/Browser-bookmark-hub/Bookmark-Canvas)
- [Bookmark-Record-Recommend](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend)
- [Bookmark-Backup](https://github.com/Browser-bookmark-hub/Bookmark-Backup)

**External projects**

- [JSON Canvas](https://github.com/obsidianmd/jsoncanvas)
- [Obsidian JSON Canvas Skill](https://github.com/kepano/obsidian-skills/tree/main/skills/json-canvas)
- [xyflow](https://github.com/xyflow/xyflow)
- [Obsidian Editing Toolbar](https://github.com/PKM-er/obsidian-editing-toolbar)
- [AltSnap](https://github.com/RamonUnch/AltSnap)

## Format

The following R2-R7 format examples are mirrored from [AGENTS_template](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template). Sample data packages are available from selected [Releases](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/releases).

<ins>If an Agent reads this section, it must read both linked materials above and must not skip AGENTS_template.</ins>

### R2. Permanent Main JSON Example
Use this shape only when the user explicitly asks to edit the permanent browser-bookmark tree.
The `identityMap` metadata entry below points to the bookmark node with the same `syncId` in `tree`; `tags` may contain multiple entries, while `note` is a single note and `noteColor` is its sibling field.
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 3,
  "sectionType": "permanent",
  "slot": "A",
  "title": "Permanent Bookmarks",
  "descriptionMd": "Describe what this permanent bookmark tree contains.",
  "fileRole": "primary",
  "fileNote": "Primary permanent file: canonical bookmark tree source.",
  "identityMap": [
    {
      "syncId": "syncId_20260530_hash_2i6f661",
      "note": "Check whether this promo-code search is still useful before keeping it.",
      "noteColor": "orange",
      "tags": [
        {
          "color": "green",
          "text": "coupon"
        },
        {
          "color": "purple",
          "text": "promo"
        }
      ]
    }
  ],
  "tree": {
    "title": "",
    "id": "syncId_20260530_hash_4xl2x2i",
    "children": [
      {
        "title": "Bookmarks Bar",
        "id": "syncId_20260530_hash_1c4v645",
        "parentId": "syncId_20260530_hash_4xl2x2i",
        "folderType": "bookmarks-bar",
        "syncing": false,
        "children": [
          {
            "title": "windsurf promo code - Google Search",
            "id": "syncId_20260530_hash_2i6f661",
            "parentId": "syncId_20260530_hash_1c4v645",
            "url": "https://www.google.com/search?q=windsurf+promo+code"
          }
        ]
      },
      {
        "title": "Other Bookmarks",
        "id": "syncId_20260530_hash_8r5t1v6",
        "parentId": "syncId_20260530_hash_4xl2x2i",
        "folderType": "other",
        "syncing": false,
        "children": []
      }
    ]
  }
}
```

<a id="ref-r3"></a>
### R3. Permanent Copy Anchor Example
A permanent copy is a view anchor, not another bookmark tree.
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "permanent",
  "slot": "B",
  "title": "Permanent Bookmarks",
  "fileRole": "copy-anchor",
  "anchorOnly": true,
  "fileNote": "Permanent copy anchor file: tree content is inherited from primary file; this file keeps per-copy description and canvas anchor.",
  "inheritFrom": "<vault-relative path to slot A json>",
  "copyId": "permanent-copy-1780113045642-gtjhd",
  "descriptionMd": "Copy-specific notes."
}
```

<a id="ref-r4"></a>
### R4. Regular Temporary Section Examples

Top-level regular chain section:
The child bookmark below shows `tags` and `note`/`noteColor` as sibling metadata on the same temporary item; omit these fields when an item has no metadata.
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "temporary",
  "id": "temp-section-A-1",
  "label": "A-1",
  "title": "Research set",
  "tempKind": "regular",
  "source": "",
  "descriptionMd": "A sandbox bookmark tree. This does not directly edit browser bookmarks.",
  "items": [
    {
      "id": "tempId_20260530_hash_6u3p4w4",
      "sectionId": "temp-section-A-1",
      "title": "AI",
      "url": "",
      "type": "folder",
      "children": [
        {
          "id": "tempId_20260530_hash_1z42o1g",
          "sectionId": "temp-section-A-1",
          "title": "GitHub Trending · JavaScript",
          "url": "https://github.com/trending/javascript?since=daily",
          "type": "bookmark",
          "note": "Daily JavaScript trending page; useful for discovery.",
          "noteColor": "blue",
          "tags": [
            {
              "color": "orange",
              "text": "trends"
            },
            {
              "color": "blue",
              "text": "JavaScript"
            }
          ],
          "children": []
        }
      ]
    }
  ]
}
```
Derived chain section:
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "temporary",
  "id": "temp-section-A-1-1",
  "label": "A-1-1",
  "title": "Research set - refined",
  "tempKind": "regular",
  "source": "",
  "descriptionMd": "Derived from A-1; keep only the refined subset.",
  "items": []
}
```

<a id="ref-r5"></a>
### R5. AI Special Temporary Section Example
Use this when AI adds suggested bookmarks or a generated bookmark tree and no existing target was specified. If the user or context names an existing target, follow [S2](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/blob/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template/AGENTS_template_en.md#s2-ai-generated-bookmark-routing).
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "temporary",
  "id": "temp-section-AI",
  "label": "AI",
  "title": "AI title here",
  "tempKind": "special",
  "source": "ai-generated",
  "descriptionMd": "Describe the generated bookmark tree and why these links were grouped.",
  "items": [
    {
      "id": "tempId_20260530_hash_x6k2d5e",
      "sectionId": "temp-section-AI",
      "title": "Generated links",
      "url": "",
      "type": "folder",
      "children": [
        {
          "id": "tempId_20260530_hash_8a4c1d2",
          "sectionId": "temp-section-AI",
          "title": "Example generated bookmark",
          "url": "https://example.com/",
          "type": "bookmark",
          "note": "Explain why this generated link is useful.",
          "noteColor": "blue",
          "tags": [
            {
              "color": "purple",
              "text": "AI"
            }
          ],
          "children": []
        }
      ]
    }
  ]
}
```

<a id="ref-r6"></a>
### R6. .canvas Example
Paths in file nodes are vault-relative, not relative to the `.canvas` file; `inheritFrom` in permanent copy anchors uses the same vault-relative path convention. When file references are added, deleted, moved, renamed, or edited, match the prefix style already used in the current `.canvas` and update every affected `file` / `inheritFrom` reference; follow Obsidian JSON Canvas path handling.
Complete canvas data package root directories can have three prefix styles: existing vault root uses `<canvas-data-package-root-name>/Permanent/...`; existing vault subfolder uses `<vault-subdir>/<canvas-data-package-root-name>/Permanent/...`; using the canvas data package root directory itself as a standalone vault uses `Permanent/...` with no canvas-data-package-root-name prefix.
In the example below, `<prefix>` means empty, `<canvas-data-package-root-name>/`, or `<vault-subdir>/<canvas-data-package-root-name>/`.
For a default single-arrow edge from `fromNode` to `toNode`, omit `fromEnd` and `toEnd`; add `toEnd: "none"` only for no-arrow edges, and `fromEnd: "arrow"` for two-ended arrows.
This is only a structural example. In real edits, do not treat `.canvas` as a text template; parse it as JSON, modify the object, and serialize it back so quotes, backslashes, and multilingual text cannot corrupt the JSON.
```json
{
  "nodes": [
    { "id": "permanent-section", "type": "file", "file": "<prefix>Permanent/A-PermanentBookmarks.json", "x": 0, "y": 0, "width": 600, "height": 600, "color": "4" },
    { "id": "permanent-section-copy-permanent-copy-1780113045642-gtjhd", "type": "file", "file": "<prefix>{{PERMANENT_MD_REL_2}}", "x": 720, "y": 0, "width": 600, "height": 600, "color": "4" },
    { "id": "card-group-ai", "type": "group", "x": -40, "y": 700, "width": 1320, "height": 620, "label": "AI workspace", "color": "5" },
    { "id": "temp-section-AI", "type": "file", "file": "<prefix>Temporary/Special temporary/AI title.json", "x": 0, "y": 760, "width": 525, "height": 380, "color": "#e9973f" },
    { "id": "md-node-ai-prompt", "type": "text", "text": "Prompt or notes for this generated bookmark set.", "x": 600, "y": 760, "width": 420, "height": 260, "color": "#888888" }
  ],
  "edges": [
    { "id": "edge-ai-1", "fromNode": "md-node-ai-prompt", "fromSide": "right", "toNode": "temp-section-AI", "toSide": "left", "color": "#999999", "label": "generated set" }
  ]
}
```

<a id="ref-r7"></a>
### R7. Tag Palette and Note Metadata
```json
{
  "note": "Plain-text bookmark/folder note.",
  "noteColor": "orange",
  "tags": [
    {
      "color": "blue",
      "text": "design reference"
    }
  ]
}
```
- In the example above, `tags[].color` and `noteColor` are lowercase English palette names only: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `gray`.
- The exported color value must be the lowercase English name only; do not write hex values (such as `#0a84ff`), `colorHex`, Obsidian canvas color numbers, or CSS variable names.
- Permanent `identityMap` entries add `syncId` to the same shape; temporary items inline these fields directly.
- `noteColor` is a sibling field of `note` and `tags`, not part of a tag object; do not write it as `{ "color": "...", "text": "..." }`.

## Data & Privacy

- Canvas data, settings, local indexes, and caches are stored in the browser extension's local storage / IndexedDB by default; this project does not operate a dedicated backend service.
- GitHub Push / Pull is optional and only accesses the repository configured by the user.
- Permissions include bookmarks, storage, downloads, tabs, tab groups, windows, active-tab access, favicon access, idle state, and host access; they support bookmark management, canvas interaction, favicon display, and related browser integration.
- See the [Privacy Policy](PRIVACY_POLICY.md) for the complete data-handling and permission explanation.

## License
[GPL-3.0](LICENSE).

## [Back to top](#switch-to-中文文档)
