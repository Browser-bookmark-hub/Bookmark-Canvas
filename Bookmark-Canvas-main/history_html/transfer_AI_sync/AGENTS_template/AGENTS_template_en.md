# Bookmark Canvas AI Agent Editing Rules

This file helps AI agents and coding agents edit an exported Bookmark Canvas package. Before modifying files, read and follow this protocol. Changes to bookmarks, sections, `.canvas` nodes/edges, and tag/note metadata should stay minimal and compatible with plugin import. This package is not a generic Obsidian or JSON Canvas project, so avoid rewriting it by general Canvas assumptions.

## Guide Structure
```text
{{GUIDE_SELF_CODE}}
├── Part A. Package & View Structure
│   ├── A0 Basic workflow
│   ├── A1 Generic package structure diagram example
│   ├── A2 Mode-specific content grammar (JSON)
│   ├── A3 Permanent section contract
│   ├── A4 Temporary section contract
│   ├── A5 .canvas element contract
│   ├── A6 Tag / note metadata contract
│   ├── A7 Import recognition priority
│   ├── A8 Signal and relationship use
│   └── A9 Text formatting support
├── Part B. AI Editing Execution Rules ({{EXPORT_MODE_LABEL}})
│   ├── S0 User intent confirmation and execution strategy
│   ├── S1 File routing
│   ├── S2 AI-generated bookmark routing
│   ├── S3 Create an AI special temporary section when no target exists
│   ├── S4 ID and numbering rules
│   ├── S5 Color rules
│   ├── S6 Web research capability
│   ├── S7 Complex workflow
│   └── S8 Taxonomy and categorization guidelines
├── Reference
│   ├── R1 ID and number generation rules
│   ├── R2 Permanent main JSON example
│   ├── R3 Permanent copy anchor example
│   ├── R4 Regular temporary section examples
│   ├── R5 AI special temporary section example
│   ├── R6 .canvas example
│   └── R7 Tag palette and note metadata
└── Closing: Long-term Rules and Post-edit Check
    ├── P1 SKILL and long-term preferences
    └── P2 Minimal post-edit checklist
```

## Part A. Package & View Structure

### A0. Basic Workflow (Export → Edit → Re-import)
1. Export using {{EXPORT_MODE_LABEL}}, then unzip the ZIP into your Obsidian vault.
2. Open the `.canvas` entry file in the canvas data package root directory. It is usually named like the root directory; if renamed, use the actual `.canvas` filename. See [A1](#ref-a1) / [R6](#ref-r6).
3. Edit Permanent/Temporary `.json` files only when their bookmark data is in scope; edit blank cards, groups, layout, and edges directly in `.canvas`. See [A3](#ref-a3) / [A4](#ref-a4) / [A5](#ref-a5) / [S1](#ref-s1).
4. Whenever Permanent/Temporary `.json` file references are added, deleted, moved, renamed, or edited, maintain every path reference: `.canvas` node `file` values and permanent copy-anchor `inheritFrom` values. See [A5](#ref-a5) / [R6](#ref-r6).
5. Run local checks for the touched scope, and use [P2](#ref-p2) when sync safety checks are needed.
6. Re-import via ZIP or folder.

<a id="ref-a1"></a>
### A1. Generic Package Structure Diagram Example
```text
<canvas-data-package-root>/
├── {{GUIDE_PRIMARY_NAME_PAD}}{{GUIDE_PRIMARY_NAME_ALIGN_SPACES}}(this AI editing guide)
├── <canvas-entry>.canvas                  (canvas entry: nodes, edges, file mappings, text cards, groups, connectors; see R6)
├── Permanent/                             (permanent section JSON folder; Chinese export: 永久栏目/)
│   ├── A-PermanentBookmarks.json          (main permanent section, slot A; browser bookmark-tree snapshot; see R2)
│   └── B-PermanentBookmarks.json          (optional permanent copy anchor, slot B; description/view only; see R3)
└── Temporary/                             (temporary section JSON folder; Chinese export: 临时栏目/)
    ├── General Chain/                     (regular chain bookmark sandboxes; Chinese export: 常规链式/)
    │   ├── A-1 <title>.json               (regular chain from permanent slot A or fallback sequence label; see R4/R1.4)
    │   ├── A-2 <title>.json               (next same-origin A chain; scan existing A-N and use max+1; see R4/R1.4)
    │   ├── A-1-1 <title>.json             (derived chain; may inherit most content from A-1; see R4/R1.4)
    │   └── B-1 <title>.json               (regular chain from permanent copy/slot B; see R4/R1.4)
    └── Special temporary/                 (special bookmark sandboxes; Chinese export: 特殊临时栏目/)
        ├── AI <title>.json                (fallback target for AI-generated bookmark sets when no existing target is specified; see R5/S3)
        └── Add/Search/Import <title>.json (other special temporary sections; see R5)
```
- JSON Mode exports section files as `.json`; blank cards are `.canvas` `type: "text"` nodes, not standalone files.
- Example index: permanent main [R2](#ref-r2); permanent copy [R3](#ref-r3); regular temporary [R4](#ref-r4); AI/special temporary [R5](#ref-r5)/[S3](#ref-s3); canvas [R6](#ref-r6); tag/note metadata [R7](#ref-r7).

### A2. Mode-specific Content Grammar
- {{EXPORT_MODE_LABEL}} stores the bookmark tree as a single plain JSON object body (no fenced code block).
- Permanent/temporary section imports read this JSON body directly.
- Do not wrap section JSON in Markdown fences. Keep each section file parseable as one JSON object.

<a id="ref-a3"></a>
### A3. Permanent Section Contract
- Permanent sections represent the browser bookmark tree. Treat them as user data with higher risk than temporary sections.
- Main permanent file shape: `format`, `schemaVersion`, `sectionType: "permanent"`, `slot: "A"`, `descriptionMd`, optional `identityMap`, and `tree`. See [R2](#ref-r2).
- `descriptionMd` describes the current bookmark tree. Preserve Markdown source unless the user asks to change the description.
- The exported `tree.id` and `tree.parentId` values are `syncId_*`, not local Chrome numeric IDs. When adding permanent nodes, mint unique IDs shaped like `syncId_YYYYMMDD_hash_<token7>`, where `token7` is lowercase letters/digits only. See [R1.1](#ref-r1-1) and [R1.2](#ref-r1-2).
- Top-level browser roots use `folderType` such as `bookmarks-bar`, `other`, or `mobile`, plus `syncing`. Do not add, delete, move, or edit `folderType` / `syncing` on these roots.
- `identityMap` is exported only for extra metadata such as `tags` and `note`/`noteColor`. If present, keep entries keyed by `syncId`; do not invent Chrome local `id` values in exported packages, and do not put permanent metadata inside `tree` nodes. See [R2](#ref-r2).
- Permanent copies are not duplicate trees. A copy file has `fileRole: "copy-anchor"`, `anchorOnly: true`, `inheritFrom`, `copyId`, its own `descriptionMd`, and view state. Do not add a `tree` to a copy anchor. See [R3](#ref-r3).

<a id="ref-a4"></a>
### A4. Temporary Section Contract
- Temporary sections are bookmark sandboxes. Editing them does not mean directly editing the browser bookmark tree.
- Regular chain sections live under `Temporary/General Chain/` with labels like `A-1`, `A-1-1`, `B-1`. A derived chain may intentionally carry over many items from its parent chain. See [R4](#ref-r4).
- Every temporary section must carry an explicit `label`; if an external input omits it, use the fixed protocol value `unknown`. See [R1.4](#ref-r1-4).
- For sections created from a permanent origin, choose the label family at creation only: slot A uses `A-N`, copy/slot B uses `B-N`; scan existing same-family labels and use max+1, so a second slot-A section is `A-2`, not `B-1`. Do not persist a permanent-origin reference after creation.
- Runtime section IDs mirror labels: `temp-section-A-1`, `temp-section-A-1-1`. Every item inside the section must use the same `sectionId`.
- Special temporary sections live under `Temporary/Special temporary/` and use `tempKind: "special"` with an explicit human label such as `New`, `Drop`, `Search`, `Import`, or AI. Their splits append `-N` to the parent label and remain `special`. See [R5](#ref-r5).
- For repeated special labels, scan existing same-label IDs and use the next suffix, for example `temp-section-AI`, then `temp-section-AI-2`. See [R1.5](#ref-r1-5).
- Temporary item IDs use `tempId_YYYYMMDD_hash_<token7>`, where `token7` is lowercase letters/digits only. Folders use `type: "folder"` and bookmarks use `type: "bookmark"` with `url`. See [R1.1](#ref-r1-1), [R1.3](#ref-r1-3), and [R4](#ref-r4).

<a id="ref-a5"></a>
### A5. .canvas Element Contract
- Root keys must remain `nodes[]` and `edges[]`; the file is JSON Canvas compatible. See [R6](#ref-r6).
- File nodes must point ONLY to Permanent/Temporary JSON files through vault-relative `file` paths. Do not connect or reference any external/third-party file nodes (such as videos, audio, images, or PDFs) in the canvas; they are prohibited.
- Obsidian path baseline: `.canvas` `file` values and permanent copy-anchor `inheritFrom` values are vault-relative paths, not paths relative to the `.canvas` file or the current JSON file. Whenever file references are added, deleted, moved, renamed, or edited, keep the prefix style already used in the current `.canvas` and update every affected reference; follow Obsidian JSON Canvas path handling.
- Text nodes (`type: "text"`) are blank cards and may contain prompt text; edit their `text` field directly.
- Group nodes (`type: "group"`) are card groups. They do not store `children`; nesting and membership are inferred by geometry containment.
- `.canvas` `x/y/width/height` values are part of the view structure, not decorative coordinates. When adding, moving, resizing, or rearranging file/text/group nodes, preserve readable spacing and avoid rectangle overlap between non-group nodes; place a node fully inside a group only when that containment is meant to express membership.
- When adding or rearranging text/file nodes that contain substantial Chinese, Japanese, Korean, or other CJK text, do not estimate width from short English phrases. Give the node more width or height so titles, descriptions, and lists do not collapse into hard-to-read narrow columns, while still preserving non-overlap and intended group containment.
- Edge `fromNode` / `toNode` values must reference existing node IDs. Default connectors are single-arrow lines unless the existing edge says otherwise.
- A node already geometrically inside a group should not be connected to that same containing group just to express membership.
- Preserve existing plugin-style IDs such as `permanent-section`, `temp-section-A-1`, `card-group-*`, `md-node-*`, and `edge-*`; do not convert them to generic 16-hex IDs. See [R1.6](#ref-r1-6).

### A6. Tag / Note Metadata Contract
- Tags follow a macOS Finder-like model: one bookmark/folder item can have multiple colored tags, each stored as `{ "color": "<color>", "text": "<label>" }`, where `color` must be one of: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `gray`. See [R7](#ref-r7).
- A note is one plain-text note on a bookmark/folder item. Each item has at most one note; store it as sibling fields `note` and `noteColor` (where `noteColor` must also be one of: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `gray`), not as a tag object or array. See [R7](#ref-r7).
- Use `gray`, not `grey`; do not use hex values (such as `#0a84ff`), `colorHex`, or canvas color preset numbers.
- `text` is the visible tag label and may be Chinese, English, or another custom short string. Do not confuse `text` with `color` / `noteColor`.
- `note` is a plain-text string; it preserves line breaks and is trimmed as a whole. Empty notes should not be exported, and clearing a note also removes `noteColor`. Old data with `note` but no `noteColor` is treated as `orange`.
- Multiple tags are allowed. Keep their order stable, remove exact duplicates by `color + text`, and preserve existing tags unless the task asks to change them. Add tags only when requested or when the item/folder is important to the task; avoid over-tagging large URL sets.
- Before organizing or adding tags, inspect existing folders, card groups, tags, and notes. Reuse the text, color, and semantics of existing tags where possible. A new tag must express a stable, reusable theme, state, or relationship and make its connection to existing or newly organized items clear. Do not create synonymous, duplicate, or isolated tags with no future reuse value for one link alone.
- Add a note only when the user explicitly asks, the bookmark/folder is important, or useful context cannot be clearly conveyed by its title, URL, folder, and tags. Do not add notes to every new or organized item, and do not repeat the title, URL, existing tags, or obvious classification in a note. Keep notes concise and relevant to user intent, such as rationale, source, limitation, trade-off, or next action.
- Use tag and note colors sparingly and with consistent meaning: preserve the existing `text`-to-color mapping; use the same color for tags with the same theme or relationship; and reuse the package's small existing palette before introducing a new color. Do not assign a different color to every tag, bookmark, or note, and do not use color as the only taxonomy signal; avoid a rainbow-like marking system that is hard to scan.
- Permanent metadata belongs on `identityMap` entries keyed by `syncId`: put `tags`, `note`, and `noteColor` on the same `syncId` metadata entry, not inside bookmark tree nodes. See [R2](#ref-r2).
- Temporary metadata belongs inline on the affected item object: `tags`, `note`, and `noteColor` move/delete with that item. See [R4](#ref-r4).
- During import, export, push, pull, backup, or restore, treat `tags` and `note`/`noteColor` as the same item metadata family; keep `identityMap` entries that have a note even when they have no tags, and do not prune them as tagless.
- Tag/note colors are separate from `.canvas` node/edge/section `color` and `colorHex` values. Do not convert between them.
- Preserve unknown metadata fields unless the task explicitly targets them.

### A7. Import Recognition Priority
- Type recognition uses `.canvas` file references plus folder paths.
- Permanent `slot` in JSON and any header/filename slot hint must stay aligned; import can fall back to filename/order when needed.
- Temporary labels are resolved by explicit JSON `label`, then header/filename prefix.
- In normal import flow, permanent files are restored as snapshot sections. Browser-tree overwrite is a separate high-risk import mode.

### A8. Signal and Relationship Use
- Permanent/temporary `descriptionMd` and `.canvas` text nodes are notes or prompts about the nearby bookmark tree. Use them as context, but do not treat them as bookmark items.
- For first-pass analysis of a regular chain section, inspect its likely source family and parent chain first, such as `#A`, `#B`, `A-1`, `A-1-1`, or `B-1`. If lineage is ambiguous, match by `title` or `url` with local search/tools.
- Edge direction can encode relationship semantics. Canonical export form: single arrow from `fromNode` to `toNode` omits both ends; no arrow sets `toEnd: "none"`; two-ended arrow sets `fromEnd: "arrow"` and relies on the default `toEnd` arrow. Preserve existing direction unless the task asks to change the relationship.
- Tags should mark user-requested or especially important items and express a reusable theme, state, or relationship to existing or newly organized items. Notes should add only context that materially helps explain user intent for an individual bookmark/folder item. Do not add tags or notes in bulk merely because many URLs are present, and do not substitute a rainbow of colors for clear categorization and relationships.

### A9. Text Formatting Support
- Blank cards (`.canvas` `text` nodes) and permanent/temporary `descriptionMd` support Obsidian-style Markdown and a safe HTML rendering subset.
- When AI edits these texts, it must first follow the formatting habits already present in the current file/current section. If there is no clear formatting habit, use only the small set of simple formats recommended below. Do not proactively use complex HTML, images, callouts, wiki links, task lists, multi-level headings, decorative colors, or large rich-text blocks just because the editor toolbar or some external tool supports them.
- If the user explicitly requests a format outside the recommended list, AI may write it, but must first warn that the format may only be editable or visible in some tools, may not render after import into Bookmark Canvas, may be stripped by the safe HTML subset, or may display differently from the original tool. When practical, also provide a fallback using the recommended formats.
- Formatting should improve readability, not decoration. Unless the user explicitly asks or the existing text already uses many formats, avoid mixing too many formats; prefer 1-2 emphasis styles in one description box.
- Recommended Markdown examples: Highlights `==text==`, blockquotes `> text`, and lists `- item` or `1. item`.
- Recommended HTML examples: Text color `<span style="color:red;">text</span>`, alignment `<div align="center">text</div>` (supports left/center/right), and underline `<u>text</u>`.

-----------------------------------------------------------------------------
## Part B. AI Editing Execution Rules ({{EXPORT_MODE_LABEL}})

<a id="ref-s0"></a>
### S0. User Intent Confirmation and Execution Strategy

AI should infer the user's real goal from the user request, earlier context, current files/directories, project structure, and this protocol. This protocol constrains execution and safety boundaries for confirmed tasks; it must not decide the goal on the user's behalf.

Execution rules:
- When the goal, target object, and risk boundary are clear, act directly within the minimum necessary file scope.
- When the goal, target object, expected result, or edit scope is unclear and multiple reasonable interpretations exist, ask the user for confirmation and wait for the answer; before confirmation, do not write files or treat a safe fallback route in this protocol as the user's intent.
- In multi-turn conversations, follow the user's latest instruction. When a new instruction changes the target object, risk boundary, target location, or long-term preference, re-check the relevant sections; when long-term personal rules, Skills, or external rules are involved, also consult [P1](#ref-p1).
- Routing principle: respect the user-specified target for AI-added bookmarks or bookmark trees; use an AI special temporary section only when no target is specified; edit the permanent/browser bookmark tree only when the user explicitly asks for that.

<a id="ref-s1"></a>
### S1. File Routing (what to touch)
- Permanent main content: edit `{{FINAL_PERMANENT_MD_REL}}` only for intentional browser-bookmark-tree changes.
- Permanent copy content: edit optional copy anchors such as `{{PERMANENT_MD_REL_2}}` only for copy description/view state.
- Temporary content: edit `Temporary/General Chain/*.json` or `Temporary/Special temporary/*.json`, then keep matching `.canvas` file nodes in sync.
- Blank content: edit `.canvas` `type: "text"` nodes directly.
- Card groups and layout: edit `.canvas` node geometry/order only; whenever cards/groups are added, moved, resized, or rearranged, treat geometry containment and non-group node collisions as part of the edit scope.
- Connector lines: edit `.canvas` `edges[]` only.
- Unrelated files: Do NOT add, edit, or copy any external/third-party files (e.g., personal notes, non-schema JSONs, or media files) to the sync directory. Unrelated files in this directory will be permanently deleted during push sync.

### S2. AI-generated Bookmark Routing
- First follow the user/context target: edit the existing temporary section, permanent section, or blank `.canvas` text node only when that exact target is requested or clearly implied.
- For blank cards, edit only the `.canvas` `type: "text"` node. Do not turn blank-card notes into bookmark JSON unless the user asks for a bookmark tree.
- Edit the permanent browser-bookmark tree only when the user explicitly asks to modify permanent/browser bookmarks.
- When AI needs to add new bookmark suggestions or a new bookmark tree and no existing target is specified, create or update a special temporary section with `label: "AI"` and `tempKind: "special"`. See [R5](#ref-r5).
- If no suitable temporary target exists and AI needs to add new bookmark suggestions, create the special-temporary folder/file first, then add a matching file node to `.canvas`. See [S3](#ref-s3).
- For AI-created special temporary sections, use `source: "ai-generated"` and a meaningful `descriptionMd` explaining what the generated bookmark tree contains. See [R5](#ref-r5).

<a id="ref-s3"></a>
### S3. Create an AI Special Temporary Section When No Target Exists
- Use this only when AI must add new bookmark suggestions or a new bookmark tree and the user did not specify an existing temporary section, permanent section, or blank text node as the target.
- Do not write these suggestions into the permanent section unless the user explicitly asks to modify browser/permanent bookmarks.
- If `Temporary/Special temporary/` does not exist, create that folder first; reuse it if it already exists.
- Write `AI <title>.json` in that folder using the R5 shape: `sectionType: "temporary"`, `label: "AI"`, `tempKind: "special"`, `source: "ai-generated"`, `descriptionMd`, and `items`. Use `id: "temp-section-AI"` unless it collides; then use the next same-label suffix such as `temp-section-AI-2`.
- Add a matching file node to the entry `.canvas` `nodes[]`: use the same node `id` as the JSON section `id`, set `file` to the vault-relative path that matches the package prefix, and set `x/y/width/height/color` following the R6 example while avoiding overlap with existing nodes. If group or text nodes are added too, plan the parent group bounds first, then place child cards fully inside the group with spacing; do not let file/text nodes cover each other.
- Add a group, text prompt node, or edge only when it is useful for the task, and keep every edge endpoint valid.

### S4. ID and Numbering Rules
- Permanent new nodes: `syncId_YYYYMMDD_hash_<token7>`; `token7` is lowercase letters/digits only, and `parentId` must point to the parent syncId. See [R1.1](#ref-r1-1) and [R1.2](#ref-r1-2).
- Temporary new items: `tempId_YYYYMMDD_hash_<token7>`; `token7` is lowercase letters/digits only, and every nested item keeps the section ID in `sectionId`. See [R1.1](#ref-r1-1) and [R1.3](#ref-r1-3).
- Regular temporary labels are explicit and required. For external input without one, use the fixed protocol value `unknown`. See [R1.4](#ref-r1-4).
- Permanent-origin regular sections choose their family only while being created: slot A creates `A-N`, copy/slot B creates `B-N`, scanning existing same-family labels and using max+1.
- Derived regular labels can extend the chain, for example `A-1-1`; preserve parent-child chain intent when editing. See [R4](#ref-r4).
- Special temporary IDs use the label and duplicate suffixes, for example `temp-section-AI`, `temp-section-AI-2`. See [R1.5](#ref-r1-5).

### S5. Color Rules
- Keep existing `color` / `colorHex` unless explicit recolor is requested.
- Use color sparingly and semantically. When adding section cards, blank cards, card groups, connector lines, or doing a larger layout/taxonomy refactor, prefer ordinary light, dark, and neutral colors as low-noise backgrounds or weak signals; use only a small set of basic red, yellow, blue, and green colors for clear meanings, so the canvas does not become visually noisy.
- Do not recolor randomly for decoration. Each prominent color should have a stable purpose, for example: permanent sections and their copies should keep the permanent-section color already present in the current exported package. Only when creating a new permanent section/copy and no package-local reference exists, use the JSON Canvas/Obsidian green preset as a fallback (commonly `color: "4"` in `.canvas`). Do not casually change permanent-section colors to a hex green or another color; warning/pending can use red or yellow; information/reference can use blue. If there is no clear meaning, keep the existing color or use a low-noise neutral color.
- This color-governance rule mainly applies when AI creates new sections, card groups, connector lines, or performs larger layout/taxonomy refactors. For small edits, wording fixes, or adding one bookmark, do not proactively recolor the whole canvas.
- These section/canvas colors are not tag/note colors. Tag palette names and `noteColor` values are defined separately in [R7](#ref-r7).

### S6. Web Research Capability
#### S6.0 Research Tool Routing and Priority
- Before starting web research, AI must first identify Deep Research, web-search Agents, MCP services, or Skills that the user has provided or the current environment has configured and permitted. When a suitable capability exists for the task, use it preferentially, subject to the user's authorization, the service's permissions, privacy boundaries, and this section's scope controls; do not disregard it and rely only on basic search capability.

#### S6.1 Rough Screening Before Research
- First screen targets by task relevance, importance, privacy/authentication sensitivity, cost/time, and whether the actual page substance is needed. For bookmark analysis, organization, deduplication, recommendation, or classification, do not rely only on title, URL, canvas position, folder context, or package metadata when substance matters.
- For account dashboards, mailboxes, consoles, or other private/authenticated pages, do not attempt login or sensitive access. Classify by metadata unless the user explicitly provides a safe access method and scope.
#### S6.2 Judgment, Plan, and User Alignment
- If the user explicitly requests web research, or the task clearly depends on link substance, a small number of public, low-risk targets may be researched directly.
- Ask the user before execution when the research set is large, expensive, slow, privacy-sensitive, or requires broad external access. Confirm scope, priority, sampling strategy, or whether to continue.
#### S6.3 Execution and Constraints
- Use available model, tool, or API research capabilities according to their own constraints and best practices.
- For complex or many-URL work, split research into batches on the main line, or use subagents/parallel review when the environment supports them. Split by importance, folder/topic, tag, connector, or decision risk, then merge the findings.
- Be selective. Do not research every URL just because many are present; prioritize or sample by importance and state the coverage limits.
- If tools or permission are unavailable, state that conclusions are based only on title, URL, canvas/package context, and mark substance-dependent decisions as uncertain.
#### S6.4 Official Reference Sources
- Project open-source repository and documentation: [GitHub - Browser-bookmark-hub/Bookmark-Canvas](https://github.com/Browser-bookmark-hub/Bookmark-Canvas). When developing features, checking design docs, or referencing other related web pages, the AI should treat this repository as one of the primary reference sources for research.

### S7. Complex Workflow
- For small scoped edits, edit the target files directly and run the checklist below.
- For broad or high-risk work touching permanent bookmarks, import/export protocol, tag/note metadata, `.canvas` topology, or {{GUIDE_RULES}}, first inspect the actual package and relevant references, list the target files, then edit, then validate JSON/canvas integrity.
- When editing `.canvas` or section `.json` files, use a JSON parser/serializer or equivalent structured edit path instead of manually concatenating JSON strings; this is especially important for quotes, backslashes, line breaks, CJK text, titles, paths, descriptions, tag text, notes, and edge labels.
- For edits touching `.canvas` layout, card groups, node coordinates, dimensions, or batch-added nodes, first identify existing visual regions, group containment, and connector semantics. After editing, check that non-group node rectangles do not overlap, expected child nodes are fully inside their group bounds, and all edge endpoints still exist.
- For repeated or high-importance long IDs, titles, or URLs, build a temporary alias map during analysis, such as `P1`, `T-A1-3`, or `U2 -> {id,title,url}`. Keep this map out of exported JSON unless the user explicitly asks to add notes.
- If multi-agent or parallel review tools are available and the user permits them, suggest splitting review into protocol/data shape, canvas topology, and implementation/tests. If such tools are not available, run those review passes sequentially yourself; do not claim external agents were used.

### S8. Taxonomy & Categorization Guidelines
- **Conditional Adherence & Organization (Avoid Blindly Replicating Chaos)**:
  - Whether the AI uses the user's existing structure (such as bookmarks, card groups, topology, or tags) as a classification guideline depends dynamically on its logical coherence:
    - **Coherent and Organized**: AI should prioritize extending and reusing the user's existing styles and dimensions to minimize cognitive friction and re-reading side effects.
    - **Messy or Ambiguous**: Do not mechanically treat the existing structure as a reliable categorization guide. First identify which signals are trustworthy and keep changes as small as possible; if reorganization is needed, propose the approach first or stay within the scope the user explicitly requested, avoiding speculative rewrites of user data.
- **Categorization & Relationship Identification**:
  - **Regular Chain Relationships**: The sequence labels of regular temporary sections (e.g. `A-1` -> `A-1-1` representing a lineage/derived chain) are key indicators of hierarchical categorization. When cards/sections are derived or extended, the AI must inspect this lineage, respect the inheritance, and only inject new themes when requested.
  - **Text Labels on Connectors**: When analyzing the `.canvas` file, pay close attention to the `label` field of edges. Edge texts encode semantic relationships between nodes; preserve or logically extend these relationship descriptions when updating connectors.
  - **Groups and Nesting Topology**: Monospace `.canvas` group nodes (`type: "group"`) and geometric nesting are strong visual classification signals. If bookmark nodes are nested inside a group, the AI must treat them as categorized under that group.
  - **Trees, Folders, Tags, and Notes**: Folder nodes (`type: "folder"`) in bookmark JSON files and the inline/identityMap `tags` array are primary taxonomy dimensions; `note` is an item-level context signal. The AI should match the user's preferred style (whether they tend to categorize via JSON folders, canvas card groups, or colored tags), preserve styling consistency, and use notes as explanatory context rather than bulk categorization. When the structure is unclear, treat folders, card groups, tags, and notes as separate signals and propose a clearer division of roles first; perform broader restructuring only when the user asks for it.

-----------------------------------------------------------------------------
## Reference

<a id="ref-r1"></a>
### R1. ID and Number Generation Rules
<a id="ref-r1-1"></a>
#### R1.1 Hashed Data IDs
- Hashed data IDs use `<prefix>_YYYYMMDD_hash_<token>`. The normal generator mints a 7-character lowercase base36 token; a rare collision fallback may mint 10. Uppercase letters are not valid for the hash token. For AI/manual edits, use 7 lowercase alphanumeric characters and keep them unique within the package.
- If an AI agent can run local commands, generate the 7-character token with a tool instead of inventing it. Node example: `node -e 'const c=require("crypto");let s="";while(s.length<7){s+=Array.from(c.randomBytes(8),b=>b.toString(36)).join("").replace(/[^a-z0-9]/g,"")}console.log(s.slice(0,7))'`.
<a id="ref-r1-2"></a>
#### R1.2 Permanent Tree syncIds
- Permanent tree nodes use `syncId_*`. A child bookmark/folder must set `parentId` to its parent syncId. Do not use local Chrome numeric IDs in exported files.
<a id="ref-r1-3"></a>
#### R1.3 Temporary Item tempIds
- Temporary bookmark/folder items use `tempId_*`. Every item in one temporary section, including nested children, must keep `sectionId` equal to that section id.
<a id="ref-r1-4"></a>
#### R1.4 Regular Temporary Section Labels and IDs
- Regular temporary section ids are label-based: `temp-section-A-1`, `temp-section-A-1-1`, `temp-section-B-1`.
- Regular labels are explicit and required. Missing external labels use the fixed protocol value `unknown`.
- Permanent-origin regular sections choose their family only at creation: slot A creates `A-N`, copy/slot B creates `B-N`, scanning existing same-family labels and using max+1. Example: if `A-1` exists, another slot-A section becomes `A-2`.
- Regular derived labels can extend the chain, for example `A-1-1`. Treat chain inheritance as semantic: derived sections may intentionally reuse most of the parent section, but they do not have to be identical.
<a id="ref-r1-5"></a>
#### R1.5 Special Temporary Section IDs
- Special temporary section ids use the visible label family. Existing first items may be unsuffixed, such as `temp-section-AI` or `temp-section-添加`; if another same-label section is needed, scan existing ids and use the next suffix, such as `temp-section-AI-2`.
<a id="ref-r1-6"></a>
#### R1.6 Canvas Node and Edge IDs
- Canvas node and edge ids only need to be unique and stable. Preserve existing ids; for new objects use readable ids such as `md-node-ai-note`, `card-group-ai-1`, `edge-ai-1`.

<a id="ref-r2"></a>
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
Use this when AI adds suggested bookmarks or a generated bookmark tree and no existing target was specified. If the user or context names an existing target, follow [S2](#s2-ai-generated-bookmark-routing).
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

-----------------------------------------------------------------------------
## Closing: Long-term Rules and Sync Safety

<a id="ref-p1"></a>
### P1. Long-term Personal Rules and {{GUIDE_TOOL_PREFIX}}SKILL
- {{GUIDE_SELF_CODE}} is a generated guide file inside an export/sync package, not the storage location for long-term personal rules; do not store long-term personal preferences only in this file.
- When the user asks to add, edit, or replace the current {{GUIDE_SELF_CODE}} / guide file, AI should first warn that this file is generated and direct edits usually affect only the current package; if the package is inside a Git repository or sync directory, the next push may regenerate this file from the template and overwrite it, so use [P2](#ref-p2) to judge sync risk. Then follow the user's choice: do not edit this guide; temporarily edit the current package only; or, after explicit confirmation, preserve the rule in long-term personal rules, a Skill, an external rule file, or the plugin template source.
- If the user wants to change future guide files generated from the plugin template, change or contribute to the plugin template source rather than only editing the current package. Open-source template directory: [AGENTS_template](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/tree/main/Bookmark-Canvas-main/history_html/transfer_AI_sync/AGENTS_template); users can contribute through issues or pull requests.
- Priority order: the user's current natural-language instruction > the user's long-term personal rules, such as {{GUIDE_TOOL_PREFIX}}SKILLs, external Markdown rule files, plugin-level AI custom rules, or indexing/retrieval tool preferences > this file's behavior preferences and fallback suggestions. However, this file's JSON schema, path structure, ID rules, tag/note write locations, import/export protocol, and sync-directory safety rules are hard constraints for the current package and cannot be overridden by personal rules.
- External general-purpose Skills / AI tool rules are only auxiliary references and must not override this package's hard constraints. In particular, the general [JSON Canvas Skill](https://github.com/kepano/obsidian-skills/blob/main/skills/json-canvas/SKILL.md) may allow 16-character hex IDs, regular link nodes, external file nodes, or attachment/PDF/image references; Bookmark-Canvas export packages must still preserve plugin-style IDs, keep file nodes limited to in-package permanent/temporary JSON files, and follow the permanent section, temporary section, identityMap, import/export, and sync-safety protocols.
- For creating or upgrading Skills, use these references: [Anthropic Skills](https://github.com/anthropics/skills) and [OpenAI Skills](https://github.com/openai/skills/tree/main). A Skill's `name` and `description` are the trigger surface; keep them short, stable, and clear about when to use the Skill. Keep the body concise, put complex rules in `references/`, deterministic/repetitive workflows in `scripts/`, and reusable templates/resources in `assets/`.
- When a preference, workflow, or validation method is likely to be reused, AI may briefly suggest writing it into or upgrading a Skill / long-term rule. This reminder should not block the current task, and AI should get user confirmation before actually creating, updating, or replacing related SKILLs / rule files.
- Good Skill contents include user habits such as categorization, naming, tag/note, and web-research strategy, plus tool workflows such as Node.js, SQL/SQLite, full-text search, `git log` / `git diff`, URL sampling, validation scripts, and multi-agent review. These are auxiliary capabilities, not part of the package protocol itself.

<a id="ref-p2"></a>
### P2. Minimal Git / Sync-directory Safety Check
1. First decide whether sync safety checks are needed
   1.1 First determine whether the current package is inside a Git repository or sync directory: for example, `.git` exists, `git status` works, the user is about to ask AI to commit/push/pull, or the current task explicitly involves GitHub push/pull.
   1.2 If the package is not inside a Git repository or sync directory, and it is only a regular manual import/export package, dedicated checks for external file nodes such as videos, audio, images, or PDFs are usually unnecessary; the plugin will not parse those external files as bookmark data.
   1.3 If the current package is inside a Git repository or sync directory, AI should warn the user about sync-cleanup risk. Whenever AI is responsible for commit/push/pull or organizing the sync directory, complete section 2's minimal safety check first.

2. Minimal structure and `.canvas` check
   2.1 Use the [A1](#ref-a1) package structure diagram as the baseline, and only check whether existing content falls outside the Bookmark Canvas package structure. Use `git status` / `git diff` / recent commits to help locate newly added or changed files, but Git does not replace structure judgment.
   2.2 Do not force-fill missing permanent sections, temporary sections, nodes, or edges, because the package may be a partial export. Only check that existing JSON files parse, and that the entry `.canvas` parses and keeps top-level `nodes` / `edges` arrays.
   2.3 The canvas data package root directory may only keep the A1-allowed entry `.canvas`, AI editing guide, permanent-section JSON files, temporary-section JSON files, and their expected subdirectories. If personal notes, media, MP3, MP4, PDFs, images, or external `.canvas` file nodes are found, handle them under 2.4.
   2.4 Prefer quarantine instead of deletion: treat the directory containing the current {{GUIDE_SELF_CODE}} as the canvas data package root directory. Move non-bookmark files inside that root directory to a sibling `<canvas-data-package-root-name>-quarantine/` folder; if they are referenced by `.canvas`, also remove the corresponding file nodes and related edges. For files outside the canvas data package root directory that are referenced by `.canvas`, remove only the `.canvas` node and related edges; do not move the external source file.
   2.5 Every `.canvas` or permanent/temporary section `.json` file changed in this edit must be parsed again with a JSON parser. For the entry `.canvas`, also confirm top-level `nodes` / `edges` are still arrays and every edge endpoint still exists.
   2.6 If this edit changed `.canvas` node coordinates, dimensions, card groups, or added file/text/group nodes, also run a minimal geometry check: every edge endpoint must exist; non-group nodes should not have rectangle overlap; nodes expected to belong to a group should be fully inside their group bounds; nodes not intended for any group should not accidentally fall inside one.

3. Check frequency
   3.1 For small JSON-only edits, perform the relevant local checks from this guide. Do not expand this P2 into a full internal protocol audit after every small change.
   3.2 If the package is inside a Git repository or sync directory, AI must rerun section 2's minimal safety check after changes that clearly affect file structure, or before commit/push/pull, and remind the user to confirm the canvas data package root directory contains no unrelated files before committing on their own.
