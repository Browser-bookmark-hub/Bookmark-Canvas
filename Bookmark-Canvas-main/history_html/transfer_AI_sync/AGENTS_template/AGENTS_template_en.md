# Bookmark Canvas AI Agent Editing Guide ({{EXPORT_MODE_LABEL}})

> **Handshake & Capabilities Detection**
> - **Web Search & Reading Tools**: Detect host-native or MCP search, content reading, and browser tools; record available external search and web-verification capabilities.
> - **Bookmark Research Plugin** ([Bookmark Research](https://github.com/Browser-bookmark-hub/Bookmark-Research)): Detect whether the host provides its Skill, MCP, or CLI. It supports research, analysis, and retrieval; package understanding, conclusions, and authorized edits remain governed by this guide. When available, follow the plugin's own Skill. Without it, use the host's available local search and code tools. Suggest installing Bookmark Research when useful.
> - **Git Tools**: Detect whether the package is inside a Git repository and if the Git CLI is available. Trace actual changes via package-scoped logs; do not infer history without Git.
> - **Local File, Search & Code Tools**: Detect the file read/write, file-name/content search, JSON search, indexing, terminal, and code execution capabilities (Python, Node.js, `jq`, etc.) actually available in the host. Use available tools as needed to read JSON snippets, locate entries, build indexes, generate item IDs, or calculate geometry. Inventory capabilities only; do not read package contents at this stage.

## 1. Package Structure & Entity Orientation

This package uses Obsidian JSON Canvas as its topology entry, with permanent browser bookmarks and temporary sandbox sections. Use actual package paths; examples identify structures. Preserve schemaVersion, IDs and unknown fields when editing existing files. Current protocol versions: permanent primary files use `schemaVersion: 3`; copies and temporary sections use `2`; do not unify them. Keep each existing file's value and do not upgrade it proactively.

All section JSONs in this package are tree-structured. Do not feed large files into context whole — use local tools to extract target nodes on demand; without `.canvas` topology, never speculate on card coordinates or spatial relationships. This package is exported and maintained by [Bookmark-Canvas](https://github.com/Browser-bookmark-hub/Bookmark-Canvas); when in doubt regarding underlying schemas, field definitions, or export/import contracts, consult the project source code as the authoritative source of truth.

```text
<Canvas Package Root>/
├── {{GUIDE_PRIMARY_NAME_PAD}}{{GUIDE_PRIMARY_NAME_ALIGN_SPACES}}(this AI editing guide)
├── <Canvas Entry>.canvas                        (Obsidian JSON Canvas: macro topology entry organizing cards, groups, edges)
├── Permanent/                                  (corresponds to real browser bookmark tree snapshot)
│   ├── A-PermanentBookmarks.json               (primary permanent section slot A, canonical source of truth)
│   └── B-PermanentBookmarks.json               (optional copy-anchor slot B, view/description only)
└── Temporary/                                  (bookmark sandbox for deductions and staged research)
    ├── General Chain/                          (chained derivation sandboxes: A-1, A-2, A-1-1, B-1)
    └── Special temporary/                      (feature sandboxes created on demand: AI recommendations, search, import)
```

-----------------------------------------------------------------------------
## 2. Example-Driven Schemas & Contracts

### 2.1 Entry Topology: `<Canvas Entry>.canvas` (Obsidian JSON Canvas Topology)
- **File Format & Specification**: `<Canvas Entry>.canvas` follows the [JSON Canvas specification](https://jsoncanvas.org/) and is the package's visual entry; preserve existing compact formatting.
- **Entity Schema & Invariants**:
  1. **file nodes (`type: "file"`)**: Reference internal permanent/temporary section JSONs via vault-relative paths, preserving the full actual prefix used by equivalent references in the current `.canvas`; angle-bracket text in examples is explanatory and must never be written literally. Never point to images, PDFs or media. Temporary section cards reuse the section `id`; permanent primary/copy cards follow their respective existing ID rules;
  2. **group nodes (`type: "group"`)**: Card groups defined purely by geometry (`x, y, width, height`), no `children`; member cards must fit inside group bounds, **never create edges to parent group**; nested groups are allowed and a node may geometrically belong to multiple containing groups—treat this as valid topology, not duplicate ownership to clean up;
  3. **text nodes (`type: "text"`)**: Blank cards or Markdown prompts, supporting `==highlight==` and safe HTML. Prefer existing formatting; explain and offer alternative formatting when an actual rendering compatibility issue arises; never overwrite them with bookmark JSON without authorization; edit `text` by node ID without loading the entire canvas into context;
  4. **Geometry avoidance & CJK sizing**: Non-group nodes must not overlap when adding, moving or reordering cards; preserve pre-existing overlap from imports or blank-card placeholders, but do not extend it; leave padding; provide ample width/height for CJK/long text;
  5. **edges (`edges[]`)**: `fromNode`/`toNode` must reference existing nodes; preserve semantic relationship `label`. The default single arrow omits `fromEnd` and `toEnd`; use `toEnd: "none"` for no arrow and `fromEnd: "arrow"` for arrows at both ends. Preserve existing arrow semantics when editing edges;
  6. **Hint (User-Copied Prompts)**: Objects pasted with `type: "bookmark-canvas-anchor"` (anchor camera) or `workspaceType: "pinned"` (pinned workspace) are copied from the app and input by the user as additional prompts. Their payloads already include an embedded `description`. They serve as external conversation context, not `.canvas` nodes, and must never be written into `.canvas` files; use them only to help locate on-screen viewports or focal assets.
```json
{
	"nodes":[
		{"id":"permanent-section","type":"file","file":"<Canvas Package Root>/Permanent/A-PermanentBookmarks.json","x":0,"y":0,"width":600,"height":600,"color":"4"},
		{"id":"permanent-section-copy-1","type":"file","file":"<Canvas Package Root>/Permanent/B-PermanentBookmarks.json","x":720,"y":0,"width":600,"height":600,"color":"4"},
		{"id":"card-group-ai","type":"group","x":-40,"y":700,"width":1320,"height":620,"label":"AI Workspace","color":"5"},
		{"id":"temp-section-AI","type":"file","file":"<Canvas Package Root>/Temporary/Special temporary/AI AI Recommendations.json","x":0,"y":760,"width":525,"height":380,"color":"#e9973f"},
		{"id":"md-node-ai-prompt","type":"text","text":"## AI Prompt\nSearch for high-quality open-source projects on this topic and output into temporary section.","x":600,"y":760,"width":420,"height":260,"color":"#888888"}
	],
	"edges":[
		{"id":"edge-ai-1","fromNode":"md-node-ai-prompt","fromSide":"right","toNode":"temp-section-AI","toSide":"left","color":"#999999","label":"generated output"}
	]
}
```
`<Canvas Package Root>` in the example paths is explanatory, not a real path. For a new file node, copy the full path prefix from an equivalent `file` reference in the current `.canvas`; vault subfolders, package-root exports and standalone vaults can use different prefixes.

### 2.2 Canonical Bookmark Tree: `Permanent/A-PermanentBookmarks.json` (`slot: "A"`)
- **File Path**: `Permanent/A-PermanentBookmarks.json` (canonical source of truth)
- **Entity Schema & ID Specification**:
  1. **Node ID & Generation Logic**: New tree nodes use `syncId_YYYYMMDD_hash_<token7>`. Obtain today's date and generate seven lowercase base36 characters with local tools, then validate the ID format before writing. Preserve IDs when moving nodes, maintaining `parentId` and `children` consistently; never write local Chrome numeric IDs into the export;
  2. **Root Folder Protection**: `bookmarks-bar`, `other`, `mobile` are top-level browser roots; never add, delete, move, or alter these root nodes;
  3. **Metadata Isolation**: `tags`, `note`, `noteColor` are strictly maintained in `identityMap` keyed by `syncId` to keep `tree` clean; entries with only notes must be preserved; keep consistent colors for the same theme;
  4. **Browser Time Fields**: `dateAdded` is the node creation time returned by Chrome Bookmarks API, in milliseconds. `dateGroupModified`, when present, is the last content-change time for a folder, not a generic bookmark modification time. Agents must not add, fill in, calculate or modify either field; preserve existing values and omit both on new nodes. Chrome manages these values when nodes are created or folder contents change. Values in the example reflect existing exported data and must not be copied into new nodes;
  5. **Permanent Tree Reading Details**: Without the plugin, traverse `tree.children` by target ID and work upward to reconstruct the ancestor path; a node with `children` is a folder, a node with `url` is a bookmark — do not treat the outer `tree` container as a user folder. When given only a title or URL, enumerate candidate matches and verify their paths before acting. Resolve permanent metadata from `identityMap` by `syncId`.
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 3,
  "sectionType": "permanent",
  "slot": "A",
  "title": "Permanent Bookmarks",
  "descriptionMd": "Explains what the permanent bookmark tree contains.",
  "fileRole": "primary",
  "fileNote": "Primary permanent section: canonical source of truth.",
  "identityMap": [
    {
      "syncId": "syncId_20260530_hash_2i6f661",
      "note": "Verify whether promo code search is still active.",
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
        "dateAdded": 1763356913791,
        "folderType": "bookmarks-bar",
        "syncing": true,
        "children": [
          {
            "title": "windsurf promo code - Google Search",
            "id": "syncId_20260530_hash_2i6f661",
            "parentId": "syncId_20260530_hash_1c4v645",
            "dateAdded": 1781508287976,
            "url": "https://www.google.com/search?q=windsurf+promo+code"
          }
        ]
      },
      {
        "title": "Other Bookmarks",
        "id": "syncId_20260530_hash_8r5t1v6",
        "parentId": "syncId_20260530_hash_4xl2x2i",
        "dateAdded": 1763356913791,
        "folderType": "other",
        "syncing": true,
        "children": []
      }
    ]
  }
}
```

### 2.3 Permanent View Copy: `Permanent/B-PermanentBookmarks.json` (`slot: "B"`)
- **File Path**: `Permanent/B-PermanentBookmarks.json` (optional copy anchor)
- **Optional Copy Note**: Permanent view copies are optional files that exist only when the user explicitly created a permanent copy on the canvas. If the package only contains A-PermanentBookmarks.json and lacks this file, simply skip it; do not treat its absence as an error or create one unnecessarily.
- **Entity Invariants**: Copies only store independent view state and `descriptionMd`, pointing to the primary section via `inheritFrom`; `fileRole: "copy-anchor"`, `anchorOnly: true`; **strictly forbidden to include a `tree` property**.
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "permanent",
  "slot": "B",
  "title": "Permanent Bookmarks (Copy)",
  "descriptionMd": "Copy description: displays the same tree in an alternate viewport.",
  "fileRole": "copy-anchor",
  "anchorOnly": true,
  "inheritFrom": "<Canvas Package Root>/Permanent/A-PermanentBookmarks.json",
  "copyId": "permanent-copy-01"
}
```

### 2.4 Regular Chained Temporary Section (`tempKind: "regular"`)
- **File Path**: `Temporary/General Chain/*.json` (sandbox reasoning)
- **Type and Placeholder Fields**: Classify by explicit `type`. A temporary folder in the source file may carry `url: ""`, and a bookmark may carry `children: []`; these are homogeneous system placeholders, not corruption. Tools, indexes, or plugins may still retain or omit these empty placeholders when returning records; this does not mean the source file was cleaned. When reading, always rely on the explicit `type` and do not treat placeholders as corruption; for source edits, base changes on the original node and preserve existing fields during unrelated edits without arbitrarily deleting or supplementing them.
- **Entity Schema & ID Specification**:
  1. **Derivation & Section ID**: Primary derivations use `A-1`, `A-2`; copies use `B-1`; subchains use `A-1-1`. Allocate the next sibling with max+1 of used sequence numbers. Section IDs use `temp-section-<label>` (e.g., `temp-section-A-1`); imports or legacy data may keep IDs shaped `imported - <timestamp> - <random>`; preserve them as-is and do not normalize them;
  2. **Item IDs & sectionId**: New items use `tempId_YYYYMMDD_hash_<token7>`, with dates and tokens generated by tools as for permanent trees; validate the ID format before writing. Every descendant's `sectionId` identifies its containing section; update descendants too when moving across sections;
  3. **Inlined Metadata**: `tags`, `note`, `noteColor` are inlined directly on items; adopt user categorization when organized, stay restrained when messy;
  4. **Temporary Tree Reading Details**: Traverse `items` by target ID and work upward to reconstruct the ancestor path; classify nodes by explicit `type`, never by whether `url` or `children` is present. Do not dump a temporary section into context in full just because it is temporary;
  5. **Compatibility & Uniqueness**: `label` may repeat (e.g., two `A-5`); uniqueness is guaranteed by `id`, `sectionId` and canvas references, so never rename labels or IDs just to deduplicate. When imported input lacks a label, use the fixed protocol value `unknown`. `source` records the section origin; preserve it when editing existing sections and do not clear an existing value. Sections with functional-name labels (e.g. `添加`, `存档`, `Add`, `Archive`) may exist in either the General Chain or Special temporary directory; determine the section type from the actual file location, never by inferring from the label.
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "temporary",
  "id": "temp-section-A-1",
  "label": "A-1",
  "title": "Temporary Section A-1",
  "tempKind": "regular",
  "descriptionMd": "Explains sandbox purpose.",
  "source": "",
  "items": [
    {
      "id": "tempId_20260530_hash_x6k2d5e",
      "sectionId": "temp-section-A-1",
      "title": "Unorganized Links",
      "url": "",
      "type": "folder",
      "children": [
        {
          "id": "tempId_20260530_hash_8a4c1d2",
          "sectionId": "temp-section-A-1",
          "title": "Example Bookmark",
          "url": "https://example.com/",
          "type": "bookmark",
          "children": [],
          "note": "Classify after research",
          "noteColor": "blue",
          "tags": [
            {
              "color": "purple",
              "text": "to-read"
            }
          ]
        }
      ]
    }
  ]
}
```

### 2.5 Special Temporary Section (`tempKind: "special"`)
- **File Path**: `Temporary/Special temporary/<label> <title>.json` (the filename is the section label, a space, and its title; e.g., `Add Token Measurement.json`). The exporter normalizes invalid filename characters. Follow nearby filenames and the active export protocol; do not omit the title arbitrarily.
- **Type and Placeholder Fields**: Apply the type and placeholder rules from the regular temporary section guidelines to this example too. A folder may carry `url: ""`, and a bookmark may carry `children: []`; these placeholders are not corruption. Tools, indexes, or plugins may still retain or omit these empty placeholders when returning records; this does not mean the source file was cleaned. When reading, always rely on the explicit `type` and do not treat placeholders as corruption; for source edits, base changes on the original node and preserve existing fields during unrelated edits without arbitrarily deleting or supplementing them.
- **Entity Schema & label Specification**:
  1. **label & Section ID**: Only special sections allow custom names. Labels may be functional presets (`Search`, `Drop`, `Batch`, `Add`, `Import`), `AI`, or short topics (preferably <= 10 characters). Section IDs use `temp-section-<normalized-label>`; append a suffix on conflict (e.g., `temp-section-AI-2`) without overwriting existing files. Before forming the ID, follow the app's label normalization: retain ASCII letters, digits, CJK characters, `_` and `-`; replace other characters with `_`; sections with functional-name labels may exist in either the General Chain or Special temporary directory — determine the section type from the actual file location, not by inferring from the label;
  2. **Item IDs & Source Attribute**: New items use `tempId_YYYYMMDD_hash_<token7>`, with dates and seven lowercase base36 characters generated by tools; validate the ID format before writing. Every descendant's `sectionId` identifies its containing section. Set `source: "ai-generated"` on AI-generated sections and verify recommendation links online;
  3. **Recommendation Destination**: Use the user's specified destination, then an existing temporary section clearly identified by context; otherwise create an AI section and canvas file card. Preserve separate prompt cards.
```json
{
  "format": "bookmark-canvas-section",
  "schemaVersion": 2,
  "sectionType": "temporary",
  "id": "temp-section-AI",
  "label": "AI",
  "title": "AI Recommendations",
  "tempKind": "special",
  "source": "ai-generated",
  "descriptionMd": "High-quality bookmarks recommended by AI research.",
  "items": [
    {
      "id": "tempId_20260530_hash_m3k9p1a",
      "sectionId": "temp-section-AI",
      "title": "AI Resources",
      "url": "",
      "type": "folder",
      "children": [
        {
          "id": "tempId_20260530_hash_q7w4e2r",
          "sectionId": "temp-section-AI",
          "title": "Bookmark-Canvas Official Repo",
          "url": "https://github.com/Browser-bookmark-hub/Bookmark-Canvas",
          "type": "bookmark",
          "children": [],
          "note": "Core open-source design and documentation ground truth",
          "noteColor": "green",
          "tags": [
            {
              "color": "blue",
              "text": "recommended"
            }
          ]
        }
      ]
    }
  ]
}
```

-----------------------------------------------------------------------------

## 3. Constraint System

Grouped by decision domain: check structural/permission constraints before any write; check data-format constraints when writing items or metadata; operating guidelines apply throughout.

### 3.1 Structural & Permission Constraints
- **Read-Only Default & Authorized Edits**: Lookup, Q&A and research are read-only by default and do not modify the package; make edits only within the user's explicit authorization.
- **Canvas & Section Reference Consistency**: Edit `.canvas` for layout, text, groups and edges; edit the section `.json` for bookmark content. Content-only edits need no canvas change. When creating, deleting, moving or renaming section files, maintain `file`, affected edges and copy `inheritFrom` together. Deleting a canvas file card removes only that node and its connected edges; it does not delete the section JSON or its bookmarks. Deleting the section file requires updating its references. When deleting a permanent bookmark, also remove its `identityMap` entry. When moving temporary items across sections, preserve IDs and update `sectionId` throughout the moved subtree. Before renaming, check the app's actual ID rules; do not recalculate IDs merely because a label changed. Update `descriptionMd` only when the section's purpose changes, preserving existing Markdown/HTML. Validate JSON, references and endpoints to prevent orphaned cards or broken links.
- **Permanent Bookmark Protection**: Read-only tasks do not modify the package. Modify permanent sections only when explicitly requested; never add, delete, move, or modify browser root nodes (bookmarks-bar, other, mobile).
- **GitHub Sync Repository Purity**: When the user requests a sync package commit/push, stage only this task's `.canvas` and section `.json` files. Exclude personal notes, caches, PDFs, images and media; do not delete user files to clean the workspace.

### 3.2 Data-Format Constraints
- **Format & Tag/Note Usage**: `tags[].color` and `noteColor` allow only `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `gray` (never `grey`, never `#rrggbb`/`colorHex`); this restriction does not apply to `.canvas` color fields. Two distinct classification systems apply: permanent bookmark trees (no `type` field) classify by structure (valid `url` indicates bookmark, `children` indicates folder); temporary section trees (with explicit `type` field) classify strictly by explicit `type`, and field presence must never be used as classification criteria (a folder with `url: ""` or a bookmark with `children: []` is a valid homogeneous placeholder, and must not cause type misclassification). Do not export empty notes; delete `noteColor` when clearing a note; keep `identityMap` entries that have a note but no tags. Use a JSON parser rather than string concatenation to generate JSON; store metadata under this file's permanent-tree rules and do not lose existing data while organizing it. Add tags and notes flexibly according to content and the organizing goal: tags support classification or filtering, while notes add context, recommendation reasons or usage tips; annotate multiple items or an entire group when useful without seeking per-item permission. Avoid mechanically applying the same tags or content-free notes; do not repeat titles, URLs or tags in notes. Reuse existing tag text and colors where possible and keep one color per theme.
- **Item IDs & Permanent Identity**: Generate IDs for new AI-authored items with tools. Before writing, check the generated prefix, today's date and exactly seven lowercase base36 token characters; use the result directly to avoid transcription errors. This is a generation convention, not an import acceptance rule for existing IDs. Use a new `syncId` for each new permanent tree node; regenerate a duplicate found against the primary tree or other new nodes in the batch to avoid treating it as the same bookmark. Temporary items need no package-wide ID deduplication. Preserve IDs when moving or editing existing items. Item formats do not apply to section, canvas node or edge IDs.

### 3.3 Operating Guidelines
- **Search & Locate Large JSON**: Avoid loading a large JSON file into context. When Bookmark Research is available, follow its own Skill; otherwise use the host's available local search tools. Use indexing capabilities when available; an index is not required for a one-time query. Read only the matching source entries and needed context. Track each target's source path, item ID and ancestor path, and use the source file as the authority when editing.
- **Temporal Context & Evolution**: ID dates indicate generation. Git records version changes, not necessarily collection or reading. Anchor `timestamp` and pinned slice `meta.generatedAt` record copying time; do not guess missing dates. Follow this file's permanent-tree rules for Chrome time fields. The `syncing` value shown for browser roots is illustrative and read-only; use the exported value.
- **Layout & Colors**: When adding, moving, resizing or rearranging cards, use tools to check target rectangles for overlap with other non-group cards. Valid group containment is not overlap; handle existing overlap under this file's canvas rules. Choose positions using the specified destination and anchor context. For placement "here/in the current viewport," the entire card should fit in blank space within `visibleRange`; intersection alone is insufficient. Keep CJK and long text readable, explain and adjust if space is insufficient, and recheck final coordinates and sizes after writing. Reuse existing colors and follow user requests; do not recolor unrelated cards during local edits.
- **Task Resumption & Checks**: After a long conversation resumes, reread target data and relevant rules before writing; when delegating to native host (sub-)agents, provide package and guide paths, target IDs and destinations. After editing, verify targeted changes within scope against the corresponding explanations and examples in `## 2. Example-Driven Schemas & Contracts` and applicable rules in `## 3. Constraint System`: check JSON validity and placeholder structures, generated ID formats, and hierarchy consistency; if the edit involves canvas layout, verify card overlap, target bounds, and reference endpoints. Inspect the diff for accidental deletions, lost unknown fields or changes outside the task scope, and report unverified points.
