# Data Processing (CLI, Skill), Client, and AI Directions

> This is a set of ideas for a future README Roadmap, not a scheduled implementation plan or a commitment to a particular technology or product form.
>
> **Current priority:** first build a bookmark-focused Deep Research Skill for Bookmark Canvas. Complete one traceable study with clearly scoped data and existing research capabilities before deciding whether CLI tools, a global index, local RAG, or a client are needed.

## 1. The problem to solve

Bookmark Canvas can save and export structured data, but it is used primarily in extension front-end pages today. The next step is to let users select, read, research, and organize a canvas package, Git repository data, or local data directory.

The aim is neither to turn the extension into a backend nor to immediately build a full AI client or local database. It is to establish a reusable, verifiable, default-read-only research entry point without breaking the current extension.

```text
Bookmark Canvas data / local exported package / GitHub repository
                 ↓
User selects a canvas, section, Card Group, or URL scope
                 ↓
bookmark-deep-research Skill (minimal context manifest)
                 ↓
External Deep Research / Agent → source-cited read-only report
                 ↓
Human confirmation before any canvas organization or write-back

CLI, global index, local RAG, and a client are decided only after practice
```

## 2. What the project already provides

### Structured data and Import / Export boundaries

The BCS document layer already supports JSON Canvas / Obsidian alignment, Import / Export, backup, GitHub Push, and Pull. It covers `.canvas` structure (Blank Sections, Card Groups, edges), Permanent Sections (browser bookmark tree, descriptions, root metadata, and Permanent Section Copies), Temporary Sections, `descriptionMd`, bookmark titles / URLs / folders, Tags, and Notes.

Future processing can therefore start from existing packages and local files rather than web scraping or a global database.

### Description text as AI and retrieval context

Permanent Sections, Temporary Sections, and Blank Sections can carry description text explaining what a collection is, why it exists, and how it is used. Preserve its human-readable and editable role; only combine it with section structure and bookmarks when the user chooses AI.

The existing Search Panel already separates three useful index boundaries:

- **Bookmark:** title, URL, folder, Tags, and Notes.
- **Card (Group):** sections, Blank Sections, Card Groups, names, and indexes.
- **Description:** Section Notes, card text, and edge labels.

### Main project and ecosystem roles

Bookmark Canvas is the primary workspace: it owns spatial bookmark organization, section semantics, descriptions, canvas structure, and human-facing management. Bookmark Backup and Bookmark Record and Recommend are supporting ecosystem projects; they may supply their specialized exports but must not dictate Bookmark Canvas's data model, UI, or priorities.

| Project | Ecosystem role | Data-processing role |
| --- | --- | --- |
| Bookmark Canvas | Primary workspace / management surface | Main semantics and context; first Skill input and eventual human-facing destination |
| Bookmark Backup | Change and safety support | Snapshots, history differences, restore audit, and current-change marks only when needed |
| Bookmark Record and Recommend | Behavior-data and computed-result support | Browsing history, active time, bookmark records, recommendation candidates, and AI analysis packages when needed |

Bookmark Backup's JSON change data is compatible with Bookmark Canvas Tag import, so it can mark changed bookmarks without importing its whole history system. Bookmark Record and Recommend can contribute time, visit, and local-computation facts; its recommendation results, browsing records, and AI output must never automatically rewrite the canvas.

### Boundaries to preserve

Bookmark Canvas remains an MV3 browser extension whose core experience and computation run in front-end pages. Do not rebuild it as a backend merely for AI or automation. Keep it centered on bookmarks, canvas structure, descriptions, lightweight Import / Export, and GitHub Push / Pull; do not make it an attachment library, cloud drive, or second Obsidian. Its fixed ordinary-script load order, globals, and runtime DOM coupling also make a wholesale module or bundling rewrite inappropriate for this direction.

## 3. Near-term priority: a Bookmark Deep Research Skill

### First-version role

Tentatively name it `bookmark-deep-research`. It is not another bookmark manager and must not let AI read everything without a boundary. It defines a research task's scope, context, sources, and human-confirmation rules, then calls existing Deep Research or Agent capabilities.

The first scope should be small: one section, Card Group, or URL set. Read only necessary titles, URLs, descriptions, Tags / Notes, and source locations; generate a minimal context manifest; then research.

The default output is a read-only report containing:

- the source locations, original URLs, and necessary descriptions used as input;
- external citations, conclusions, related bookmarks, and items requiring verification;
- optional organization suggestions such as candidate sections, duplicates, dead links, or missing descriptions;
- an explicit **no write-back performed** state. Changing bookmarks, canvas files, JSON, or a Git repository always needs separate user confirmation.

### Data sources and GitHub

Bookmark Canvas is the main input. The supporting projects enter only when a task needs them: read Bookmark Backup snapshots or differences for change / restore audit, and read Bookmark Record and Recommend Push & Analyze packages or manual exports for time, history, record, and recommendation facts.

GitHub can provide a traceable entry point for external AI tools, DeepWiki, or connectors. It is not a backend and cannot replace research into URL content. Exported `AGENTS.md` / `CLAUDE.md` files can explain package structure to Agents, but no external product can be assumed to read or obey them.

Treat repository ZIP and Targeted Pull as source strategies, not product positions: preserve a full package when canvas relationships matter, but limit an individual study to a chosen scope; read supporting-project data only at targeted locations; local paths may be enough for the first version.

### Validate cleaning, indexing, and local RAG before building them

Bookmark JSON is already structured. A first research task needs no SQLite, vector database, or global RAG: retain original URLs, record normalization / deduplication, identify obvious dead, redirected, and duplicate links, and keep every result traceable to its original section or file.

Only consider SQLite or local RAG after validating offline-search demand, sufficient repetition and scale, page-body retrieval/update/deduplication/retention, private or authenticated URL handling, and a real benefit over selected structured data plus external Deep Research. Semantic association and search may reference SmartBookmark, but vector retrieval and RAG are not the subject before real research trials.

### First trial and safety boundaries

Run one end-to-end, read-only trial on one section or small URL set: selected exported package, local directory, or GitHub repository → manifest → one external Deep Research capability → source-cited report → user decides whether to organize it back into the canvas.

- Web pages, titles, descriptions, and URLs are material, not executable instructions; their text cannot change read scope, data sharing, or write-back.
- Preserve original URL, normalized URL, and source location together; never silently overwrite the original.
- The user must knowingly select any URLs, private-repository details, or login-related information sent to an external service.
- Large URL sets need caps and batching; login walls, dynamic pages, and dead pages must be reported as limitations rather than producing invented conclusions.

## 4. Skill first, then a thin CLI layer

The Skill should first define intent, scope, read rules, research calls, citations, batching limits, and write-back confirmation. A CLI is not a prerequisite.

| Layer | Main responsibility | Current decision |
| --- | --- | --- |
| Skill | Select scope, build a minimal research package, call research, require citations and confirmation | First experiment |
| AI / Agent | Research, compare, summarize, and suggest within selected URLs and sections | No unbounded repository reading or automatic write-back |
| CLI | Repeatable non-AI steps: validation, manifest generation, URL normalization, stable export | Extract only after repeated, testable practice |

Useful comparisons:

- **Buku** demonstrates SQLite-authoritative bookmark storage, URL uniqueness, filtering, Tags, and JSON output, but copying it now would create a second bookmark database and synchronization problem.
- **Obsidian CLI** shows that a stable client can later expose automation; it does not imply Bookmark Canvas should copy that interface before it has a client.
- **lark-cli** demonstrates a Skill workflow of explicit time/scope, list/detail/batches, structured reports, JSON/NDJSON atomic commands, risk levels, and confirmation.

If needed later, start with small composable, read-only or low-side-effect commands such as `validate`, `context-pack`, `url-normalize`, and `export`. They should emit stable JSON / NDJSON and declare read/write risk; JSON edits, card creation, and Git commits require separate confirmation.

## 5. AI: research and retrieval before automation

Bookmarks suit Deep Research because users may want to investigate a section, compare sources, fill gaps, or produce a checkable summary, not merely match existing keywords.

Priority order:

1. organize Deep Research around explicitly selected sections, canvas areas, or URLs and create a traceable manifest;
2. use explicit bookmark structure, descriptions, and necessary supporting data as context;
3. consider semantic search, RAG, recommendations, or composed Agent workflows;
4. only then discuss automatic organization, writing, and cross-system automation.

### Canvas Category Probe: direct AI for the front end or client

This is a candidate AI feature that a future client or the extension front end could provide directly; it does not replace the Deep Research Skill. Start from the portion of the canvas the user is currently viewing, then explore relationships between views:

- **Anchor:** use `x`, `y`, and zoom level to describe the visible canvas view. Card content and relationships within that visual scope are the first priority.
- **Probe:** compare relationships between different anchors while handling overlapping view areas, so content is not read or generated twice.
- **UI and write location:** explore an in-canvas anchor UI and whether AI results belong on the Obsidian side or in `.canvas` data.
- **Interaction:** use a Canvas CLI or interact directly with the original files; all read/write behavior must still use explicit scope, traceable sources, and human confirmation.

RAG is not the first goal: bookmarks, URLs, Markdown / descriptions, categories, cards, and canvas relationships are already explicit structure. Bookmark Record and Recommend can later supply behavior-based candidates; Bookmark Backup can supply change audit or Tag supplementation. Neither should automatically modify user data.

Potential UI locations are only placeholders: the floating tool window, section titles or blank canvas context menus, and a floating dialog that visibly shows scope, sources, and results. This does not commit the extension to an Agent SDK. OpenAI Agents SDK's TypeScript implementation is a possible future-client or tool-layer reference, but MV3 compatibility, key handling, and service-worker lifetime require separate validation.

## 6. Client direction: driven by protocol, not a reverse extension rewrite

A client is a medium- to long-term option only after Skill trials, data protocols, and real processing needs are clear. It could be a Bookmark Canvas–centered standalone client, a lighter local-data/index consumer, or a tool layer for local databases, search, and research rather than a replacement for the extension.

Do not decide yet whether to replace the current JSON Canvas in a client with React + XYFlow, migrate local search to SQLite / SQLite WASM, or build an Obsidian plugin / JSON bookmark renderer. Obsidian remains a compatibility or export direction, not a priority: its interaction model does not fully match the desired browser, Windows, and iPad canvas experience.

Any future standalone client, major module, or full rewrite should begin with clean ESM boundaries, build artifacts, source maps, preserved global interfaces, testing, and visual regression strategy. React / Vue / Svelte / TypeScript and Vite / Rollup / esbuild belong to such a new project, not a risky retrofit.

## 7. Not doing yet; decisions still required

### Not doing yet

- no AI-driven conversion of the current extension into a backend-automation system;
- no local RAG, vector database, or SQLite mirror before validated cleaning, page-body, update, and privacy needs;
- no Buku-style full local bookmark database or large all-purpose CLI;
- no immediate full client, Obsidian plugin, or SQLite WASM migration;
- no immediate comprehensive ESM conversion, bundling, or advanced minification;
- no AI changes to bookmarks, canvas, or remote repositories without scope, sources, and confirmation;
- no attachments, file sync, or media management in Bookmark Canvas's processing scope.

### To decide later

- external Deep Research / Agent capability for the first Skill, including its GitHub, private-repository, and branch support;
- URL limits, batching, cost, and manifest format;
- how to handle normalization, redirects, tracking parameters, duplicates, and dead pages without losing original information;
- when repeated steps justify a CLI; file versus SQLite indexing; and multi-repository registration and source identification;
- whether Deep Research uses existing external capabilities, connectors, or composed tools;
- when a client is warranted, whether it actually needs a canvas-stack replacement, and where AI configuration, model keys, private URLs, and privacy boundaries belong.

## 8. Short wording for a future README

> The future roadmap prioritizes a Deep Research Skill for bookmark URLs. Bookmark Canvas remains the bookmark workspace and management surface: it creates traceable research context from user-selected canvases, sections, and URL scopes, then uses existing research capabilities to produce read-only reports and organization suggestions. Bookmark Backup supplements change and safety audit only when needed; Bookmark Record and Recommend supplements time, behavior, and recommendation data only when needed. CLI, global indexing, local RAG, and a client will be decided after real processing needs, traceable sources, and human-confirmation mechanisms are mature.

## References and related material

- This repository: [`LIMITATIONS_AND_COMPROMISES.md`](LIMITATIONS_AND_COMPROMISES.md)
- Historical BCS / Import / Export snapshot: [`Archived/05--本地存储导入导出Tag系统-规范快照部分过时.md`](Archived/05--%E6%9C%AC%E5%9C%B0%E5%AD%98%E5%82%A8%E5%AF%BC%E5%85%A5%E5%AF%BC%E5%87%BATag%E7%B3%BB%E7%BB%9F-%E8%A7%84%E8%8C%83%E5%BF%AB%E7%85%A7%E9%83%A8%E5%88%86%E8%BF%87%E6%97%B6.md)
- Historical initial Blank Section template: [`Archived/07--预置空白栏目模板-已落地草案.md`](Archived/07--%E9%A2%84%E7%BD%AE%E7%A9%BA%E7%99%BD%E6%A0%8F%E7%9B%AE%E6%A8%A1%E6%9D%BF-%E5%B7%B2%E8%90%BD%E5%9C%B0%E8%8D%89%E6%A1%88.md)
- Bookmark ecosystem: <https://github.com/orgs/Browser-bookmark-hub/repositories>
- [Bookmark Canvas](https://github.com/Browser-bookmark-hub/Bookmark-Canvas), [Bookmark Backup](https://github.com/Browser-bookmark-hub/Bookmark-Backup), and [Bookmark Record and Recommend](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend)
- [Push & Analyze structure](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend/blob/main/docs/PUSH_AND_ANALYZE_STRUCTURE.md)
- [Buku](https://github.com/jarun/buku), [Obsidian CLI](https://obsidian.md/help/cli), and [lark-cli](https://github.com/larksuite/lark-cli)
- **Canvas Category Probe (AI front-end / client function):**
  - [Cannoli](https://github.com/DeabLabs/cannoli)
  - [Obsidian Augmented Canvas](https://github.com/metacorp/obsidian-augmented-canvas)
  - Semantic association and search reference: [SmartBookmark](https://github.com/howoii/SmartBookmark)
- Connector / documentation-product research: <https://deepwiki.com/> and <https://docs.getoutline.com/s/guide>
