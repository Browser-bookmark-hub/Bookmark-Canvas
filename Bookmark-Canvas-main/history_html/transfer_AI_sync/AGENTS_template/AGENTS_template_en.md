# Bookmark Canvas Import/Export Rules

This file is written for AI agents that edit an exported Bookmark Canvas package. Keep edits protocol-aware and minimal.

## Part A. Package & View Structure

### A0. Full Workflow Example (Export → Edit → Re-import)
1. Export using {{EXPORT_MODE_LABEL}}.
2. Unzip into your Obsidian vault.
3. Open the package `.canvas` entry file in the export root. It is usually named like the folder, but use the actual `.canvas` filename if it was renamed.
4. Edit Permanent/Temporary `.json` files only when their bookmark data is in scope; edit blank cards directly in `.canvas` text nodes.
5. If any Permanent/Temporary `.json` file is renamed or moved, update every matching `.canvas` file path.
6. Re-import via ZIP or folder.

<a id="ref-a1"></a>
### A1. Generic Package Structure Diagram
```text
<export-root>/
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
        ├── AI <title>.json                (fallback target for AI-generated bookmark sets when no existing target is specified; see R5/R7)
        └── Add/Search/Import <title>.json (other special temporary sections; see R5)
```
- JSON Mode exports section files as `.json`; blank cards are `.canvas` `type: "text"` nodes, not standalone files.
- Example index: permanent main [R2](#ref-r2); permanent copy [R3](#ref-r3); regular temporary [R4](#ref-r4); AI/special temporary [R5](#ref-r5)/[R7](#ref-r7); canvas [R6](#ref-r6); tags [R8](#ref-r8).

### A2. Mode-specific Content Grammar
- {{EXPORT_MODE_LABEL}} stores the bookmark tree as a single plain JSON object body (no fenced code block).
- Permanent/temporary section imports read this JSON body directly.
- Do not wrap section JSON in Markdown fences. Keep each section file parseable as one JSON object.

### A3. Permanent Section Contract
- Permanent sections represent the browser bookmark tree. Treat them as user data with higher risk than temporary sections.
- Main permanent file shape: `format`, `schemaVersion`, `sectionType: "permanent"`, `slot: "A"`, `descriptionMd`, optional `identityMap`, and `tree`. See [R2](#ref-r2).
- `descriptionMd` describes the current bookmark tree. Preserve Markdown source unless the user asks to change the description.
- The exported `tree.id` and `tree.parentId` values are `syncId_*`, not local Chrome numeric IDs. When adding permanent nodes, mint unique IDs shaped like `syncId_YYYYMMDD_hash_<token7>`, where `token7` is lowercase letters/digits only. See [R1.1](#ref-r1-1) and [R1.2](#ref-r1-2).
- Top-level browser roots use `folderType` such as `bookmarks-bar`, `other`, or `mobile`, plus `syncing`. Do not add, delete, move, or edit `folderType` / `syncing` on these roots.
- `identityMap` is exported only for extra metadata such as tags. If present, keep entries keyed by `syncId`; do not invent Chrome local `id` values in exported packages. See [R2](#ref-r2).
- Permanent copies are not duplicate trees. A copy file has `fileRole: "copy-anchor"`, `anchorOnly: true`, `inheritFrom`, `copyId`, its own `descriptionMd`, and view state. Do not add a `tree` to a copy anchor. See [R3](#ref-r3).

### A4. Temporary Section Contract
- Temporary sections are bookmark sandboxes. Editing them does not mean directly editing the browser bookmark tree.
- Regular chain sections live under `Temporary/General Chain/` with labels like `A-1`, `A-1-1`, `B-1`. A derived chain may intentionally carry over many items from its parent chain. See [R4](#ref-r4).
- If a regular section has an explicit `label`, that label is authoritative. Without one, the fallback top-level label is generated from `sequenceNumber` through `toAlphaLabel()`: 1 => A-1, 2 => B-1, 3 => C-1, 27 => AA-1. See [R1.4](#ref-r1-4).
- For sections created from a permanent origin, the label family follows that origin: slot A uses `A-N`, copy/slot B uses `B-N`; scan existing same-family labels and use max+1, so a second slot-A section is `A-2`, not `B-1`.
- Runtime section IDs mirror labels: `temp-section-A-1`, `temp-section-A-1-1`. Every item inside the section must use the same `sectionId`.
- Special temporary sections live under `Temporary/Special temporary/` and use `tempKind: "special"` with a human label such as Drop, Search, Add, Import, or AI. See [R5](#ref-r5).
- For repeated special labels, scan existing same-label IDs and use the next suffix, for example `temp-section-AI`, then `temp-section-AI-2`. See [R1.5](#ref-r1-5).
- Temporary item IDs use `tempId_YYYYMMDD_hash_<token7>`, where `token7` is lowercase letters/digits only. Folders use `type: "folder"` and bookmarks use `type: "bookmark"` with `url`. See [R1.1](#ref-r1-1), [R1.3](#ref-r1-3), and [R4](#ref-r4).

### A5. .canvas Element Contract
- Root keys must remain `nodes[]` and `edges[]`; the file is JSON Canvas compatible. See [R6](#ref-r6).
- File nodes must point ONLY to Permanent/Temporary JSON files through vault-relative `file` paths. Do not connect or reference any external/third-party file nodes (such as videos, audio, images, or PDFs) in the canvas; they are prohibited.
- Text nodes (`type: "text"`) are blank cards and may contain prompt text; edit their `text` field directly.
- Group nodes (`type: "group"`) are card groups. They do not store `children`; nesting and membership are inferred by geometry containment.
- Edge `fromNode` / `toNode` values must reference existing node IDs. Default connectors are single-arrow lines unless the existing edge says otherwise.
- A node already geometrically inside a group should not be connected to that same containing group just to express membership.
- Preserve existing plugin-style IDs such as `permanent-section`, `temp-section-A-1`, `card-group-*`, `md-node-*`, and `edge-*`; do not convert them to generic 16-hex IDs. See [R1.6](#ref-r1-6).

### A6. Tag System Contract
- Tags follow a macOS Finder-like model: one bookmark/folder item can have multiple colored tags, each stored as `{ "color": "<palette>", "text": "<label>" }`. See [R8](#ref-r8).
- Allowed tag `color` values are lowercase palette names only: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `gray`. Use `gray`, not `grey`; do not use hex values, `colorHex`, or canvas color preset numbers for tags.
- Palette display colors: red `#ff453a`, orange `#ff9f0a`, yellow `#ffd60a`, green `#30d158`, blue `#0a84ff`, purple `#bf5af2`, gray `#8e8e93`.
- `text` is the visible tag label. If the UI user only clicks a color, the app uses the localized color name as text; AI edits should write an explicit short `text`.
- Multiple tags are allowed. Keep their order stable, remove exact duplicates by `color + text`, and preserve existing tags unless the task asks to change them.
- Add tags only when the user requests tags or the item/folder is important to the task. Avoid over-tagging large URL sets.
- Permanent tags belong on `identityMap` entries keyed by `syncId`, not inside bookmark tree nodes. See [R2](#ref-r2).
- Temporary tags belong inline on the affected item object, so they move/delete with that item. See [R4](#ref-r4).
- Tag colors are separate from `.canvas` node/edge/section `color` and `colorHex` values. Do not convert between them.
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
- Tags should mark user-requested or especially important items. Avoid adding many tags just because many URLs are present.

### A9. Text Formatting Support
- Blank cards (`.canvas` `text` nodes) and permanent/temporary `descriptionMd` support Obsidian-style Markdown and partial HTML rendering.
- Formatting should primarily follow the habits of the user's current tool. If some tools lack support, adjust based on the user's actual habits, supplementing other tools as needed. There is no need to list all supported tools and formats.
- Recommended Markdown examples (3 types): Highlights `==text==`, blockquotes `> text`, and lists `- item` or `1. item`.
- Recommended HTML examples (2 types): Text color `<span style="color:red;">text</span>` and alignment `<div align="center">text</div>` (supports left/center/right).

-----------------------------------------------------------------------------
## Part B. AI Editing Execution Rules ({{EXPORT_MODE_LABEL}})

### S0. User Intent Confirmation and Execution Strategy

AI should infer the user’s real goal from the user request, current files/directories, project structure, and this protocol. This protocol constrains execution and safety boundaries after the goal is known; it must not decide the goal on the user’s behalf.

When the goal, target object, and risk boundary are clear, execute directly with the minimum necessary file scope.

When the goal, target object, expected result, or edit scope is unclear and multiple reasonable interpretations exist, ask the user for confirmation and wait for the answer before writing any file.

Do not treat a safe fallback route in this protocol as the default interpretation of an ambiguous request. Safe fallbacks still require a confirmed user goal.

Route principle: edit the minimum file set only. Respect the user-specified target for AI-added bookmarks or bookmark trees; use an AI special temporary section only when no target is specified. Edit the permanent browser tree only when the user explicitly asks for that.

### S1. File Routing (what to touch)
- Permanent main content: edit `{{FINAL_PERMANENT_MD_REL}}` only for intentional browser-bookmark-tree changes.
- Permanent copy content: edit optional copy anchors such as `{{PERMANENT_MD_REL_2}}` only for copy description/view state.
- Temporary content: edit `Temporary/General Chain/*.json` or `Temporary/Special temporary/*.json`, then keep matching `.canvas` file nodes in sync.
- Blank content: edit `.canvas` `type: "text"` nodes directly.
- Card groups and layout: edit `.canvas` node geometry/order only.
- Connector lines: edit `.canvas` `edges[]` only.
- Unrelated files: Do NOT add, edit, or copy any external/third-party files (e.g., personal notes, non-schema JSONs, or media files) to the sync directory. Unrelated files in this directory will be permanently deleted during push sync.

### S2. AI-generated Bookmark Routing
- First follow the user/context target: edit the existing temporary section, permanent section, or blank `.canvas` text node only when that exact target is requested or clearly implied.
- For blank cards, edit only the `.canvas` `type: "text"` node. Do not turn blank-card notes into bookmark JSON unless the user asks for a bookmark tree.
- Edit the permanent browser-bookmark tree only when the user explicitly asks to modify permanent/browser bookmarks.
- When AI needs to add new bookmark suggestions or a new bookmark tree and no existing target is specified, create or update a special temporary section with `label: "AI"` and `tempKind: "special"`. See [R5](#ref-r5).
- If no suitable temporary target exists and AI needs to add new bookmark suggestions, create the special-temporary folder/file first, then add a matching file node to `.canvas`. See [R7](#ref-r7).
- For AI-created special temporary sections, use `source: "ai-generated"` and a meaningful `descriptionMd` explaining what the generated bookmark tree contains. See [R5](#ref-r5).

### S3. ID and Numbering Rules
- Permanent new nodes: `syncId_YYYYMMDD_hash_<token7>`; `token7` is lowercase letters/digits only, and `parentId` must point to the parent syncId. See [R1.1](#ref-r1-1) and [R1.2](#ref-r1-2).
- Temporary new items: `tempId_YYYYMMDD_hash_<token7>`; `token7` is lowercase letters/digits only, and every nested item keeps the section ID in `sectionId`. See [R1.1](#ref-r1-1) and [R1.3](#ref-r1-3).
- Regular temporary labels: explicit `label` wins. Only sections without an explicit label use `{Alpha}-1` from `sequenceNumber` by `toAlphaLabel()`; examples: 1 A-1, 2 B-1, 3 C-1, 27 AA-1. See [R1.4](#ref-r1-4).
- Permanent-origin regular sections use the origin family instead: slot A creates `A-N`, copy/slot B creates `B-N`, scanning existing same-family labels and using max+1.
- Derived regular labels can extend the chain, for example `A-1-1`; preserve parent-child chain intent when editing. See [R4](#ref-r4).
- Special temporary IDs use the label and duplicate suffixes, for example `temp-section-AI`, `temp-section-AI-2`. See [R1.5](#ref-r1-5).

### S4. Color Rules
- Keep existing `color` / `colorHex` unless explicit recolor is requested.
- Regular temp color follows chain inheritance: unlocked child follows parent, locked parent breaks inheritance below.
- Special temp sections follow the app appearance defaults unless a task gives a color.
- These section/canvas colors are not tag colors. Tag palette names are defined separately in [R8](#ref-r8).

### S5. Web Research Capability
#### S5.1 Rough Screening Before Research
- First screen targets by task relevance, importance, privacy/authentication sensitivity, cost/time, and whether the actual page substance is needed. For bookmark analysis, organization, deduplication, recommendation, or classification, do not rely only on title, URL, canvas position, folder context, or package metadata when substance matters.
- For account dashboards, mailboxes, consoles, or other private/authenticated pages, do not attempt login or sensitive access. Classify by metadata unless the user explicitly provides a safe access method and scope.
#### S5.2 Judgment, Plan, and User Alignment
- If the user explicitly requests web research, or the task clearly depends on link substance, a small number of public, low-risk targets may be researched directly.
- Ask the user before execution when the research set is large, expensive, slow, privacy-sensitive, or requires broad external access. Confirm scope, priority, sampling strategy, or whether to continue.
#### S5.3 Execution and Constraints
- Use available model, tool, or API research capabilities according to their own constraints and best practices.
- For complex or many-URL work, split research into batches on the main line, or use subagents/parallel review when the environment supports them. Split by importance, folder/topic, tag, connector, or decision risk, then merge the findings.
- Be selective. Do not research every URL just because many are present; prioritize or sample by importance and state the coverage limits.
- If tools or permission are unavailable, state that conclusions are based only on title, URL, canvas/package context, and mark substance-dependent decisions as uncertain.
#### S5.4 Official Reference Sources
- Project open-source repository and documentation: [GitHub - Browser-bookmark-hub/Bookmark-Canvas](https://github.com/Browser-bookmark-hub/Bookmark-Canvas). When developing features, checking design docs, or referencing other related web pages, the AI should treat this repository as one of the primary reference sources for research.

### S6. Complex Workflow
- For small scoped edits, edit the target files directly and run the checklist below.
- For broad or high-risk work touching permanent bookmarks, import/export protocol, tags, `.canvas` topology, or {{GUIDE_RULES}}, first inspect the actual package and relevant references, list the target files, then edit, then validate JSON/canvas integrity.
- For repeated or high-importance long IDs, titles, or URLs, build a temporary alias map during analysis, such as `P1`, `T-A1-3`, or `U2 -> {id,title,url}`. Keep this map out of exported JSON unless the user explicitly asks to add notes.
- If multi-agent or parallel review tools are available and the user permits them, suggest splitting review into protocol/data shape, canvas topology, and implementation/tests. If such tools are not available, run those review passes sequentially yourself; do not claim external agents were used.

### S7. Taxonomy & Categorization Guidelines
- **Conditional Adherence & Organization (Avoid Blindly Replicating Chaos)**:
  - Whether the AI uses the user's existing structure (such as bookmarks, card groups, topology, or tags) as a classification guideline depends dynamically on its logical coherence:
    - **Coherent and Organized**: AI should prioritize extending and reusing the user's existing styles and dimensions to minimize cognitive friction and re-reading side effects.
    - **Messy and Chaotic**: The existing structure **must not** be used as a guideline or justification for categorization. Rather than blindly replicating or conforming to a chaotic layout, the AI should actively reorganize, clean up, and establish a clear, structured classification order.
- **Categorization & Relationship Identification**:
  - **Regular Chain Relationships**: The sequence labels of regular temporary sections (e.g. `A-1` -> `A-1-1` representing a lineage/derived chain) are key indicators of hierarchical categorization. When cards/sections are derived or extended, the AI must inspect this lineage, respect the inheritance, and only inject new themes when requested.
  - **Text Labels on Connectors**: When analyzing the `.canvas` file, pay close attention to the `label` field of edges. Edge texts encode semantic relationships between nodes; preserve or logically extend these relationship descriptions when updating connectors.
  - **Groups and Nesting Topology**: Monospace `.canvas` group nodes (`type: "group"`) and geometric nesting are strong visual classification signals. If bookmark nodes are nested inside a group, the AI must treat them as categorized under that group.
  - **Trees, Folders, and Tags**: Folder nodes (`type: "folder"`) in bookmark JSON files and the inline/identityMap `tags` array are primary taxonomy dimensions. The AI should match the user's preferred style (whether they tend to categorize via JSON folders, canvas card groups, or colored tags) and maintain styling consistency.

### S8. {{GUIDE_TOOL_PREFIX}}Skill Creation and Upgrade Reminder
- After 2-3 normal interaction turns, remind the user at an appropriate pause that stable rules from the conversation can be turned into or updated as a dedicated {{GUIDE_TOOL_PREFIX}}`SKILL.md`.
- The purpose of the skill is to package the constraints in {{GUIDE_SELF}} as an insertable, reusable capability, reducing attention drift during long editing or review sessions.
- If a later project, or a newly read {{GUIDE_SELF_CODE}}, materially conflicts with or differs from an existing skill derived from it, discuss the difference with the user and ask whether to update, replace, or keep the skill unchanged.
- If the user spends 5 or more consecutive turns on the same task, workflow, or recurring rule set, suggest creating or upgrading a skill when the pattern is stable enough to reuse.
- Ask whether the user wants to create, update, or replace that skill before doing so. This reminder must not block the current task, and do not create or modify `SKILL.md` without explicit user confirmation.
- **Indexing Guidance for Large/Sync Environments**: If the user performs long-term network push/pull sync operations under large data volumes, the AI, when suggesting the creation or upgrade of a Skill, should proactively remind the user whether to incorporate external tools to build local search indices (assisting in RAG fast location and cross-section mapping). The AI is responsible for issuing this reminder and defining its entry point within the Skill, while the concrete implementation details of building the index remain outside the scope of this AI protocol.
- **Historical Tracking and Deep Retrieval under GitHub Scenarios**: If AI detects that the current environment is a GitHub repository, when the user mentions previous historical data, needs multi-version comparisons, or is handling tasks requiring deep retrieval/tracking, the AI can proactively suggest or directly leverage Git version control tools (such as `git log`, `git diff`, commit history, etc.) to compare bookmark trees across versions or locate historical data. This serves as an excellent deep retrieval tool to assist in version auditing and historical location.

### S9. Minimal Pre-import Checklist
- All JSON files parse.
- `.canvas` parses and keeps top-level `nodes` and `edges` arrays.
- Every file node path points to an existing JSON file, and no external file nodes (such as videos, audio, images, or PDFs) are referenced in the canvas.
- Every edge endpoint references an existing node ID.
- Permanent root `folderType` / `syncing` values are unchanged unless the user explicitly supplied a browser-root migration task.
- New permanent IDs are syncIds; new temporary item IDs are tempIds.
- New or edited tags use only the supported palette names from [R8](#ref-r8).
- **Unrelated files restriction under GitHub Repository scenarios**: If AI detects that Git-related files (such as a `.git` folder, indicating the current environment is a GitHub repository sync directory) are present, it must check sibling filenames and file structures relative to the canonical structure (see [A1](#ref-a1)). If AI detects any non-bookmark unrelated files/folders (such as personal notes, media, etc.) in the sync directory, **it must proactively remind the user to move them out of the sync directory** (to prevent them from being permanently deleted during push sync).

### Import Steps
1) Unzip: {{EXPORT_ROOT}}.zip
2) Put the folder `{{EXPORT_ROOT}}/` into your vault at: `{{VAULT_DESTINATION}}`.
3) Open the package .canvas entry file in the export root. If the folder or canvas file was renamed, use the actual .canvas file.

If you only copy the .canvas file without the .json files, Canvas will show that linked files could not be found.

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
- Regular labels use explicit `label` first. Without an explicit label, fallback top-level labels use `{Alpha}-1`, where `Alpha = toAlphaLabel(sequenceNumber)`. Examples: sequenceNumber 1 => A-1, 2 => B-1, 3 => C-1, 27 => AA-1.
- Permanent-origin regular sections do not advance by raw `sequenceNumber`: slot A creates `A-N`, copy/slot B creates `B-N`, scanning existing same-family labels and using max+1. Example: if `A-1` exists, another slot-A section becomes `A-2`.
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
The `identityMap` tag entry below points to the bookmark node with the same `syncId` in `tree`.
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
      "tags": [
        {
          "color": "green",
          "text": "wqe"
        },
        {
          "color": "purple",
          "text": "124"
        }
      ],
      "syncId": "syncId_20260530_hash_2i6f661"
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
        "children": [
          {
            "title": "windsurf promo code - Google Search",
            "id": "syncId_20260530_hash_2i6f661",
            "parentId": "syncId_20260530_hash_1c4v645",
            "url": "https://www.google.com/search?q=windsurf+promo+code"
          }
        ],
        "folderType": "bookmarks-bar",
        "syncing": false
      },
      {
        "title": "Other Bookmarks",
        "id": "syncId_20260530_hash_8r5t1v6",
        "parentId": "syncId_20260530_hash_4xl2x2i",
        "children": [],
        "folderType": "other",
        "syncing": false
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
          "children": [],
          "tags": [
            {
              "color": "orange",
              "text": "123"
            },
            {
              "color": "blue",
              "text": "蓝色"
            }
          ]
        }
      ]
    }
  ],
  "originPermanent": {
    "copyId": null
  },
  "sequenceNumber": 1
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
  "items": [],
  "originPermanent": {
    "copyId": null
  },
  "sequenceNumber": 1
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
      "children": []
    }
  ],
  "sequenceNumber": 4
}
```

<a id="ref-r6"></a>
### R6. .canvas Example
Paths in file nodes are vault-relative, not relative to the `.canvas` file. Match the prefix style already used in the current `.canvas`; do not normalize between styles.
Full-package exports can have three prefix styles: existing vault root uses `<export-root>/Permanent/...`; existing vault subfolder uses `<vault-subdir>/<export-root>/Permanent/...`; standalone vault uses `Permanent/...` with no export-root prefix.
In the example below, `<prefix>` means empty, `<export-root>/`, or `<vault-subdir>/<export-root>/`.
For a default single-arrow edge from `fromNode` to `toNode`, omit `fromEnd` and `toEnd`; add `toEnd: "none"` only for no-arrow edges, and `fromEnd: "arrow"` for two-ended arrows.
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
### R7. Create an AI Special Temporary Section When No Target Exists
- Use this only when AI must add new bookmark suggestions or a new bookmark tree and the user did not specify an existing temporary section, permanent section, or blank text node as the target.
- Do not write these suggestions into the permanent section unless the user explicitly asks to modify browser/permanent bookmarks.
- If `Temporary/Special temporary/` does not exist, create that folder first; reuse it if it already exists.
- Write `AI <title>.json` in that folder using the R5 shape: `sectionType: "temporary"`, `label: "AI"`, `tempKind: "special"`, `source: "ai-generated"`, `descriptionMd`, and `items`. Use `id: "temp-section-AI"` unless it collides; then use the next same-label suffix such as `temp-section-AI-2`.
- Add a matching file node to the entry `.canvas` `nodes[]`: use the same node `id` as the JSON section `id`, set `file` to the vault-relative path that matches the package prefix, and set `x/y/width/height/color` following the R6 example while avoiding overlap with existing nodes.
- Add a group, text prompt node, or edge only when it is useful for the task, and keep every edge endpoint valid.

<a id="ref-r8"></a>
### R8. Tag Palette and Tag Object
- Valid tag colors are the macOS-style palette names: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `gray`.
- Palette hex values used by the UI: `red #ff453a`, `orange #ff9f0a`, `yellow #ffd60a`, `green #30d158`, `blue #0a84ff`, `purple #bf5af2`, `gray #8e8e93`.
- UI default text when no custom text is typed: `Red`, `Orange`, `Yellow`, `Green`, `Blue`, `Purple`, `Gray` in English; `红色`, `橙色`, `黄色`, `绿色`, `蓝色`, `紫色`, `灰色` in Chinese.
- Standard tag object shape:
```json
{
  "color": "blue",
  "text": "Blue"
}
```
- Do not write tag colors as `#0a84ff`, `colorHex`, Obsidian canvas color numbers, or CSS variable names. The exported JSON tag value is the lowercase palette name.
