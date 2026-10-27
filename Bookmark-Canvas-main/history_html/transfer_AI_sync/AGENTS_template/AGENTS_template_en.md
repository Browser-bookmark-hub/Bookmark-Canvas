# Bookmark Canvas AI Agent Editing Guide ({{EXPORT_MODE_LABEL}})

> **Handshake & Capabilities Detection**
> - **Dedicated Research Companion (`bookmark-research`)**: Check the Skill / MCP / CLI provided by this host; load the companion Skill when available, and prefer its tools for indexing, cross-section queries and batch verification. It reads the original package without editing it; follow this guide for writes and refresh the same source index before querying after edits. Missing tools do not prove the plugin is uninstalled; check host status if availability is unclear, and read directly if unavailable. When needed, suggest `npx bookmark-research@beta install <codex|claude|dsh> --non-interactive`.
> - **Web Search & Content Reading**: Use the host's available search, page readers or browser tools to verify URLs, titles and summaries for new recommendations or webpage facts. Invent no links; distinguish unverified from inaccessible sources. Local structural analysis needs no web access. Protocol reference: [Bookmark-Canvas GitHub](https://github.com/Browser-bookmark-hub/Bookmark-Canvas).
> - **Git & Temporal Context**: Check whether the package is in a Git repository. When history is needed, use package-scoped `git log` and `git diff` to trace actual changes. A Git repository is not necessarily a GitHub sync package; without Git, do not infer version history.
> - **Code Tools & Large-File Reading**: Check file sizes in bytes first. Parse large sections or compact `.canvas` files with Python, Node.js or `jq`, returning only target nodes, necessary neighbors and summaries; small files can be read directly. Update target fields by ID and preserve other data. Scripts may parse and serialize whole files; avoid full-file conversation dumps and blind string replacement. Generate IDs and compute geometry with tools too.
> - **Rule Authority & Boundaries**: This guide applies only to the current package. Lookup, Q&A, analysis and research are read-only by default; edit within user authorization, following this package's schemas and file routing.

## 1. Package Structure & Entity Orientation

This package uses Obsidian JSON Canvas as its topology entry, with permanent browser bookmarks and temporary sandbox sections. Use actual package paths; examples identify structures. Preserve schemaVersion, IDs and unknown fields when editing existing files. Current protocol versions: permanent primary files use `schemaVersion: 3`; copies and temporary sections use `2`; do not unify them. Keep each existing file's value and do not upgrade it proactively.

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
  1. **file nodes (`type: "file"`)**: Reference internal permanent/temporary section JSONs via vault-relative paths, preserving the actual path prefix; never point to images, PDFs or media;
  2. **group nodes (`type: "group"`)**: Card groups defined purely by geometry (`x, y, width, height`), no `children`; member cards must fit inside group bounds, **never create edges to parent group**; nested groups are allowed and a node may geometrically belong to multiple containing groups—treat this as valid topology, not duplicate ownership to clean up;
  3. **text nodes (`type: "text"`)**: Blank cards or Markdown prompts, supporting `==highlight==` and safe HTML. Prefer existing formatting; explain and offer alternative formatting when an actual rendering compatibility issue arises; never overwrite them with bookmark JSON without authorization; edit `text` by node ID without loading the entire canvas into context;
  4. **Geometry avoidance & CJK sizing**: Non-group nodes must not overlap when adding, moving or reordering cards; preserve pre-existing overlap from imports or blank-card placeholders, but do not extend it; leave padding; provide ample width/height for CJK/long text;
  5. **edges (`edges[]`)**: `fromNode`/`toNode` must reference existing nodes; preserve semantic relationship `label`;
  6. **Spatial Viewports & Anchor Cameras**: For `type: "bookmark-canvas-anchor"`, `visibleRange` is the world-coordinate viewport. Filter intersecting cards with `node.x < minX + width && node.x + node.width > minX && node.y < minY + height && node.y + node.height > minY`. When adding cards "here/in this viewport", fit the whole card in visible whitespace; explain and adjust the plan if space is insufficient;
  7. **Pinned Objects & Relationships**: `workspaceType: "pinned"` is a slice of focus objects, not a viewport rectangle. Resolve IDs/paths against the current canvas instead of copying placeholder or stale coordinates. Interpret groups, edge direction/labels and nearby text together; proximity alone does not establish content ownership.
```json
{
	"nodes":[
		{"id":"permanent-section","type":"file","file":"<Canvas Package Root>/Permanent/A-PermanentBookmarks.json","x":0,"y":0,"width":600,"height":600,"color":"4"},
		{"id":"permanent-section-copy-1","type":"file","file":"<Canvas Package Root>/Permanent/B-PermanentBookmarks.json","x":720,"y":0,"width":600,"height":600,"color":"4"},
		{"id":"card-group-ai","type":"group","x":-40,"y":700,"width":1320,"height":620,"label":"AI Workspace","color":"5"},
		{"id":"temp-section-AI","type":"file","file":"<Canvas Package Root>/Temporary/Special temporary/AI.json","x":0,"y":760,"width":525,"height":380,"color":"#e9973f"},
		{"id":"md-node-ai-prompt","type":"text","text":"## AI Prompt\nSearch for high-quality open-source projects on this topic and output into temporary section.","x":600,"y":760,"width":420,"height":260,"color":"#888888"}
	],
	"edges":[
		{"id":"edge-ai-1","fromNode":"md-node-ai-prompt","fromSide":"right","toNode":"temp-section-AI","toSide":"left","color":"#999999","label":"generated output"}
	]
}
```

### 2.2 Canonical Bookmark Tree: `Permanent/A-PermanentBookmarks.json` (`slot: "A"`)
- **File Path**: `Permanent/A-PermanentBookmarks.json` (canonical source of truth)
- **Entity Schema & ID Specification**:
  1. **Node ID & Generation Logic**: New tree nodes use `syncId_YYYYMMDD_hash_<token7>`. Obtain today's date and generate seven lowercase base36 characters with local tools, then validate the complete generated ID under the core red lines before writing. Preserve IDs when moving nodes, maintaining `parentId` and `children` consistently; never write local Chrome numeric IDs into the export;
  2. **Root Folder Protection**: `bookmarks-bar`, `other`, `mobile` are top-level browser roots; never add, delete, move, or alter these root nodes;
  3. **Metadata Isolation**: `tags`, `note`, `noteColor` are strictly maintained in `identityMap` keyed by `syncId` to keep `tree` clean; entries with only notes must be preserved; keep consistent colors for the same theme;
  4. **Scale Characteristics & Strategy**: Extract and edit large trees using the handshake's script strategy, keeping full trees out of context and preserving unrelated entries and metadata.
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

### 2.3 Permanent View Copy: `Permanent/B-PermanentBookmarks.json` (`slot: "B"`)
- **File Path**: `Permanent/B-PermanentBookmarks.json` (optional copy anchor)
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
- **Entity Schema & ID Specification**:
  1. **Derivation & Section ID**: Primary derivations use `A-1`, `A-2`; copies use `B-1`; subchains use `A-1-1`. Allocate the next sibling with max+1 of used sequence numbers. Section IDs use `temp-section-<label>` (e.g., `temp-section-A-1`); imports or legacy data may keep IDs shaped `imported - <timestamp> - <random>`; preserve them as-is and do not normalize them;
  2. **Item IDs & sectionId**: New items use `tempId_YYYYMMDD_hash_<token7>`, with dates and tokens generated by tools as for permanent trees; validate the complete generated ID under the core red lines before writing. Every descendant's `sectionId` identifies its containing section; update descendants too when moving across sections;
  3. **Inlined Metadata**: `tags`, `note`, `noteColor` are inlined directly on items; adopt user categorization when organized, stay restrained when messy;
  4. **Scale Differentiation & Sandbox Mechanism**: Small sections can be read and edited directly; large ones follow the handshake's script strategy. Temporary status does not justify full-file context dumps;
  5. **Compatibility & Uniqueness**: `label` may repeat (e.g., two `A-5`); uniqueness is guaranteed by `id`, `sectionId` and canvas references, so never rename labels or IDs just to deduplicate. When imported input lacks a label, use the fixed protocol value `unknown`.
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
  "items": [
    {
      "id": "tempId_20260530_hash_x6k2d5e",
      "sectionId": "temp-section-A-1",
      "title": "Unorganized Links",
      "type": "folder",
      "children": [
        {
          "id": "tempId_20260530_hash_8a4c1d2",
          "sectionId": "temp-section-A-1",
          "title": "Example Bookmark",
          "url": "https://example.com/",
          "type": "bookmark",
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
- **File Path**: `Temporary/Special temporary/<label>.json` (e.g., `AI.json`, `Import.json`, `Batch.json`)
- **Entity Schema & label Specification**:
  1. **label & Section ID**: Only special sections allow custom names. Labels may be functional presets (`Search`, `Drop`, `Batch`, `Add`, `Import`), `AI`, or short topics (preferably <= 10 characters). Section IDs use `temp-section-<label>`; append a suffix on conflict (e.g., `temp-section-AI-2`) without overwriting existing files;
  2. **Item IDs & Source Attribute**: New items use `tempId_YYYYMMDD_hash_<token7>`, with dates and seven lowercase base36 characters generated by tools; validate the complete generated ID under the core red lines before writing. Every descendant's `sectionId` identifies its containing section. Set `source: "ai-generated"` on AI-generated sections and verify recommendation links online;
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
      "type": "folder",
      "children": [
        {
          "id": "tempId_20260530_hash_q7w4e2r",
          "sectionId": "temp-section-AI",
          "title": "Bookmark-Canvas Official Repo",
          "url": "https://github.com/Browser-bookmark-hub/Bookmark-Canvas",
          "type": "bookmark",
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

## 3. Core Red Lines & Supplemental Context

Apply these boundaries and validate the affected scope:

- **Core Absolute Red Lines**:
  1. **Canvas & Section Reference Consistency**: Edit `.canvas` for layout, text, groups and edges; edit the section `.json` for bookmark content. Content-only edits need no canvas change. When creating, deleting, moving or renaming section files, maintain `file`, affected edges and copy `inheritFrom` together. Validate JSON, references and endpoints to prevent orphaned cards or broken links.
  2. **Permanent Bookmark Protection**: Read-only tasks do not modify the package. Modify permanent sections only when explicitly requested; never add, delete, move, or modify browser root nodes (bookmarks-bar, other, mobile).
  3. **GitHub Sync Repository Purity**: When the user requests a sync package commit/push, stage only this task's `.canvas` and section `.json` files. Exclude personal notes, caches, PDFs, images and media; do not delete user files to clean the workspace.
  4. **Palette & JSON Read/Write**: `tags[].color` and `noteColor` allow only `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `gray`; this restriction does not apply to `.canvas` color fields. Use a JSON parser rather than string concatenation to generate JSON.
  5. **Metadata Compatibility & Preservation**: Use `gray`, never `grey`, and never write `#rrggbb`/`colorHex`; do not export empty notes, delete `noteColor` when clearing a note, and keep `identityMap` entries that have a note but no tags. Store metadata as specified in §2 and do not lose existing data while organizing it.
  6. **Item IDs & Permanent Identity**: Generate IDs for new AI-authored items with tools. Before writing, check the generated prefix, today's date and exactly seven lowercase base36 token characters; use the result directly to avoid transcription errors. This is a generation convention, not an import acceptance rule for existing IDs. Use a new `syncId` for each new permanent tree node; regenerate a duplicate found against the primary tree or other new nodes in the batch to avoid treating it as the same bookmark. Temporary items need no package-wide ID deduplication. Preserve IDs when moving or editing existing items. Item formats do not apply to section, canvas node or edge IDs.
- **Supplemental Context & Guidelines**:
  1. **Using Tags & Notes**: Add them flexibly according to content and the organizing goal: tags support classification or filtering, while notes add context, recommendation reasons or usage tips. When useful, annotate multiple items or an entire group without seeking permission for each item. Avoid mechanically applying the same tags or notes with no added information to every item; do not merely repeat titles, URLs or tags in notes. Reuse existing tag text and colors where possible and keep one color per theme; preserve or adjust existing metadata within the task's scope.
  2. **Temporal Context & Evolution**: `dateAdded`, when present, is collection time in milliseconds; ID dates indicate generation. Git records version changes, not necessarily collection or reading. Anchor `timestamp` and pinned slice `meta.generatedAt` record copying time; do not guess missing dates.
  3. **Layout & Colors**: When adding, moving, resizing or rearranging cards, use tools to check target rectangles for overlap with other non-group cards. Valid group containment is not overlap; handle existing overlap under §2.1. Choose positions using the specified destination and anchor context. For placement "here/in the current viewport," the entire card should fit in blank space within `visibleRange`; intersection alone is insufficient. Keep CJK and long text readable, explain and adjust if space is insufficient, and recheck final coordinates and sizes after writing. Reuse existing colors and follow user requests; do not recolor unrelated cards during local edits.
  4. **Task Resumption & Checks**: After a long conversation resumes, reread target data and relevant rules before writing. Pass package and guide paths, target IDs and destinations to native host subagents. After editing, check the affected scope for parseable JSON, new item ID generation format, permanent tree identity consistency, `sectionId` at every level, file references and edge endpoints. When changing layout, also check card overlap, specified destinations and applicable anchor bounds. Inspect the diff for accidental deletions, lost unknown fields or changes outside the task scope, and report unverified points.
