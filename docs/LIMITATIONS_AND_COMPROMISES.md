# Limitations and Compromises

## Limitations

### 1. Cards cannot directly load a WebView

**Not supported.**

Manifest V3 does not provide a usable WebView for this purpose. This would require building an Obsidian plugin, extending another open-source bookmark-management application, or developing directly on a Chromium-based engine. Chrome itself does not currently provide vertical tabs.

Bookmark Canvas is not intended to become a second Obsidian, and the browser environment does not provide the capability needed here.

#### Why

**Goal:** determine whether an MV3 extension can open external URLs through the Side Panel, a Canvas browser card, or a custom tabbed view.

**Conclusion:** the feature is technically possible but has very little practical value. Each of these approaches ultimately embeds the target page in an `<iframe>`, so all are subject to the same security restrictions and cannot reliably load external websites.

**Core constraints:**

1. **`<iframe>` restriction:** both the Side Panel and a proposed Canvas browser card can only attempt to embed an external URL through an `<iframe>`.
2. **Security policies (CSP / `X-Frame-Options`):** most mainstream sites, including Google and GitHub, deliberately prevent iframe embedding through `X-Frame-Options` or CSP.
3. **Custom-tab limitation:** the browser has no Side Panel tabs API. A custom tabbed UI would only switch between iframes inside the extension page and cannot remove the iframe restriction.
4. **Result:** in most cases, users would see only a "refused to connect" error.

### 2. Browser windows cannot be named automatically

Windows cannot be named automatically, although Tab Groups can be named.

Chrome's `windows` API provides no field for setting or reading a window name. MDN's `windows.Window.title` is also read-only: it represents the displayed window title, not a configurable name.

**Practical alternative:** use the Bookmark Canvas page to name tabs and automatically locate the section that created the window.

### 3. Names of closed Tab Groups cannot be read

The names of Tab Groups that have already been closed cannot be retrieved.

`chrome.tabGroups.*` can access only groups that are still active in an open window. Once a window is closed, its groups are no longer available through that API.

Session and Sync data, including the list of closed windows and cloud-synced Tab Groups, are available only to Chrome itself or the signed-in account; extensions have no API for reading them.

Chrome does retain closed windows and groups as part of Session Restore, but that data is reserved for built-in browser features. The `chrome.sessions` API available to extensions exposes only recently closed windows and tabs. It cannot tell an extension which groups an entry contained or what their original names were.

#### Alternative

**Practical alternative:** add a tab page for direct management of **Same Window + Exclusive Group**, **Same Window**, and **Exclusive Window**.

### 4. Side Panel shortcut wake-state loss

This is a system-level issue. When an open Side Panel has been idle for a while, the shortcut can fail to close it on the first press; the second press succeeds. When the Side Panel is closed, the first press can still open it.

Avoiding a popup page is the current mitigation. The issue is related to waking the Side Panel and restoring its state.

### 5. Edge Side Panel refreshes differently from Chrome

Two related questions arise in Edge:

1. Chrome provides a pinning feature for the Side Panel, while Edge does not. The two browsers therefore expose different Side Panel behavior.
2. When switching tabs in Edge, the Side Panel can refresh every time. Chrome does not behave this way.

#### Chrome: a singleton-like model

Chrome treats the Side Panel as a globally independent window. Once opened, it remains a persistent page. Switching tabs merely changes its neighboring tab; the Side Panel's JavaScript context remains intact.

#### Edge: multiple isolated instances

To integrate its Sidebar Assistant, Edge may create an isolated Side Panel instance for each tab. When the user switches tabs, Edge can destroy the previous Side Panel context and reload one for the current tab.

**Current approach:** use a shell and panel shelf to accommodate this behavior.

### 6. Discrete mouse input on Windows

Discrete mouse input feels more stepped on Windows than on macOS.

Curve tuning improves it to a degree, but it still does not feel as smooth as macOS.

### 7. Flickering when rendering many cards and bookmarks

One of the largest remaining experience limitations is that cards can still flicker when many cards and bookmarks are rendered at the same time.

Several mitigations are already available through performance-related features:

- low-detail mode;
- low detail outside the viewport;
- lazy loading;
- virtualization and chunked rendering both inside and outside the viewport.

These measures substantially improve usability for large canvases, large bookmark trees, and many-card scenarios. However, a viewport containing too many elements can still flicker because of DOM rendering, icon loading, card updates, and browser paint pressure.

This is an inherent limitation of a browser-extension-plus-DOM-Canvas implementation, not a problem that one switch can eliminate. The current strategy is to reduce its frequency through performance mode, low detail, lazy loading, and virtualization, rather than promise unlimited cards and bookmarks without flickering.

## Compromises



### 1. No attachment support

One of the major product compromises is that Bookmark Canvas does not support attachments.

This affects long-term capability, especially for GitHub Push / Pull. Supporting arbitrary attachments, images, PDFs, audio, video, or other file nodes would quickly enlarge persistent packages and make the remote directory difficult to manage. Push / Pull would stop being a lightweight transfer of canvas structure and bookmark data and instead become a form of file synchronization.

Rendering or referencing other file nodes might be possible as a workaround, but the scope immediately becomes much more complex:

- packages could become very large;
- GitHub Push / Pull would become noticeably slower and less reliable;
- the remote directory would effectively become a file repository;
- file preview, caching, updates, deletion, conflicts, and cross-device consistency would all require additional systems;
- users could reasonably expect attachment management comparable to Obsidian or a cloud drive.

Conclusion: attachment support is intentionally not included.

Bookmark Canvas is neither a replacement Obsidian client nor a file manager. For long-term attachment, media, PDF, or large-library management, use a tool designed for that purpose. Bookmark Canvas remains focused on bookmarks, canvas structure, descriptions, Import / Export, and lightweight GitHub Push / Pull.

### 2. Dragging to create Temporary Sections

Bookmarks in the Edge Side Panel cannot be dragged into Bookmark Canvas.

In Chrome and Edge, dragging from the horizontal bookmark bar supports only regular bookmarks and links.

### 3. No pinch zoom in the Side Panel

#### Why does pinch zoom work in a normal tab but not in the Side Panel?

- On an ordinary HTML page, trackpad pinching is commonly delivered as a `wheel` event with `ctrlKey=true`.
- The Side Panel is a browser-UI-hosted page. If the host handles or intercepts the gesture, the page never receives that pinch-zoom signal.
- Therefore the same code can work in a normal tab but fail in the Side Panel.

`Ctrl` + two-finger scrolling was added as the compatible alternative.

### 4. GitHub cannot package and download a single directory

GitHub has long had community requests for single-directory downloads:

<https://github.com/orgs/community/discussions/178419>

GitHub's `/zipball` API has a deliberately narrow design: it accepts only `owner`, `repo`, and `branch` / ref, and cannot accept a path. In other words, GitHub cannot create a ZIP containing only the `remoteRoot` directory.

**Practical alternative:** provide a **Pull Package Method** option above the default package import method.

- **Full Repo ZIPball:** faster, but requires filtering. Use it when there are many Permanent Section / Temporary Section cards and the repository is clean.
- **Targeted Pull:** potentially slower, but precise. Use it when there are fewer cards or the repository contains unrelated files, especially large ones.

### 5. GitHub App, web authorization, and QR-code sign-in

Should the project use a GitHub App, web-based authorization, or QR-code sign-in? The trade-off is the same one faced by typical Chrome extensions.

| Approach | Authorization experience (QR / one-click) | Fine-grained access (select repositories) | Secure frontend-only implementation (no server) |
| --- | --- | --- | --- |
| Traditional OAuth / QR-style flow | Excellent | No, broad account access | Yes |
| Fine-grained PAT entered manually | Cumbersome | Yes, tightly scoped | Yes |
| GitHub App | Excellent | Yes, precise | No, requires a backend server |

### 6. Whether description boxes should switch to CodeMirror 6

Should Blank Section cards, which use `.canvas` `text` nodes, and the description boxes for Permanent Sections and Temporary Sections, which use `descriptionMd`, move to CodeMirror 6?

They could, but there is no current need.

1. CodeMirror 6 is a Markdown source editor, not the current HTML-rich-text DOM editor. Its primary data model is a text document. Many existing tools directly modify `innerHTML`, DOM selections, `document.execCommand`, checkbox DOM, and `span` styles. They cannot be reused directly with CM6; the implementation would need to move to Markdown-text edits or CM6 extensions and decorations.

Obsidian's official development documentation and blog confirm that its editor is based on CodeMirror, now entirely CM6. A renderer change can be reconsidered later.

There is no need to add it now because the current description boxes primarily display content and require only basic editing and rendering capabilities.

#### Should Mermaid rendering be added?

No. Bookmark Canvas is already a canvas. Adding Mermaid would create a canvas within a canvas, bringing nested rendering and zoom behavior. The implementation cost and user experience trade-off are not justified.

### 7. Do not retrofit general bundling or advanced minification

The project no longer aims to hand its existing codebase to a build tool and completely rewrite its output shape. Build tools themselves are not the problem, but retrofitting bundling or advanced minification into Bookmark Canvas creates more risk than value.

Research findings:

- esbuild's `bundle` recursively inlines imported dependencies into output files;
- esbuild's `minify` is not merely whitespace removal: it combines whitespace removal, syntax compression, and local-variable shortening;
- esbuild explicitly notes that JavaScript minification cannot be guaranteed safe for every codebase. Code that relies on function source strings, function or class names, or assumptions about built-in behavior may break;
- esbuild explicitly warns that `mangle props` can cause subtle breakage. It should not be used unless its impact on this project and all dependencies is fully understood;
- Chrome MV3 extension pages have fixed constraints around script declarations, resource paths, `web_accessible_resources`, service workers, and messaging between extension pages. This is not a content-script-injection project; the main risk comes from the fixed load order and global-API coupling of many ordinary scripts within extension pages.

This project contains substantial coupling of that kind:

- `history.html` loads more than twenty ordinary scripts in a fixed order, including `storageBCS_core.js`, import/export code, `bookmark_canvas_module.js`, Card Groups, search, Tag / Note, and `history.js`;
- many modules communicate through globals such as `window.CanvasModule`, `window.CanvasProtocolBridge`, `window.TagSystem`, `window.NoteSystem`, `window.BookmarkCanvasGithubTransfer`, and `window.__...`;
- the code extensively uses `document.getElementById()`, `querySelector()`, `classList`, `dataset`, fixed DOM IDs, classes, data attributes, and event delegation;
- the canvas, settings dialogs, performance panels, Import / Export, GitHub dialogs, bookmark tree, and search results all construct runtime `innerHTML` or template strings;
- CSS is spread across `history.css`, `bookmark_canvas.css`, `canvas_modals.css`, `tag_system.css`, `search.css`, and other files. Load order and selector precedence affect the resulting UI;
- the bookmark tree, Canvas cards, connectors, lazy loading, low detail, virtualization, favicons, search highlighting, and context menus all depend on stable DOM structures and class/data attributes;
- some files are large and carry substantial historical complexity, including `bookmark_canvas_module.js`, `history.js`, and `bookmark_tree_context_menu.js`. They were not originally divided along ES-module, tree-shaking, or minifier-safe boundaries.

This type of project is especially vulnerable to a build process silently changing code shape. Even `--minify-whitespace` can alter output layout and debugging locations. Features may still appear to work, while script order, exposed globals, dialog templates, CSS precedence, tooltips, layout, selector matches, event delegation, and displayed strings subtly stop behaving as before. Advanced minification adds variable-name shortening, property mangling, tree shaking, cross-file merging, or module wrapping, increasing the risk further.

Current policy:

- do not broadly refactor existing main code for marginal compression gains;
- do not use property-name mangling;
- do not pass legacy code with extensive runtime DOM/CSS assembly through advanced compression;
- if compression becomes necessary, use only a very conservative level and manually validate critical UI;
- reserve build tools for future modules that start with clear boundaries and modular design.

The sounder direction is to design a future client, major module, or architecture split from the beginning around module boundaries, import/export relationships, build artifacts, source maps, preserved global APIs, and visual-regression tests. Introducing esbuild, Vite, or Rollup is appropriate in that context.

This does not reject build tools. It recognizes that the current project was not originally organized for safe advanced minification. Retrofitting that property now for a small compression benefit would require broad refactoring and introduce extensive UI-regression risk.

References:

- <https://esbuild.github.io/api/#bundle>
- <https://esbuild.github.io/api/#minify>
- <https://esbuild.github.io/api/#keep-names>
- <https://esbuild.github.io/api/#mangle-props>
- <https://developer.chrome.com/docs/extensions/reference/manifest>
- <https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources>
- <https://developer.chrome.com/docs/extensions/develop/concepts/service-workers>

### 8. Temporary Section empty placeholders are not sanitized destructively; resolved via constraint templates and companion plugin derived index projections

❌ **Intentional main-branch compromise: No low-level BCS historical data sanitization or destructive runtime migration is performed.**

Temporary Section source JSON has long contained placeholder fields left behind by legacy serialization shapes: `folder` nodes typically carry an empty `url: ""` and `bookmark` nodes typically carry an empty `children: []`. These redundant fields can cause semantic confusion when processed by LLMs / Agents (why does a folder have a URL? why does a bookmark have children?) and waste approximately 15%~25% of context tokens.

Although upgrading storage protocols and executing aggressive full sanitization is technically possible, after in-depth evaluation and experimentation, the main branch adopted an intentional architecture compromise: **preserve existing BCS storage protocols and historical source data completely intact, avoiding introducing catastrophic data corruption risks into production, and resolve the issue non-invasively at higher layers via constraint files + new companion plugin derived index projections.**

#### Why choose this compromise? (Fatal risks of low-level blanket sanitization)

1. **Runtime crashes and fatal `TypeError` hazards:**
   Substantial legacy logic across the codebase (such as drag-and-drop insertions, cross-section moves, and bookmark-tree expansions) implicitly assumes the presence of node fields. If the underlying data strips `children: []` from bookmark nodes, subsequent drag-and-drop actions that access `bookmark.children.length` or `bookmark.children.push(...)` without rigorous guards will trigger a fatal runtime `TypeError` that crashes canvas interactions. In cross-section moves, removing the original node before validating the target could also cause silent data loss.
2. **Tight full-pipeline coupling and excessive maintenance cost:**
   Temporary Sections touch dozens of touchpoints: the BCS storage protocol (`bcs:section:*`), runtime restoration logic, the automatic backup slot (`bcs:backup:slot`), clipboard history (`bcs:clipboard-history`), legacy section snapshots (`bcs:temp-snapshot`), GitHub Push / Pull, JSON / HTML / ZIP import and export routines, multiple clone/paste handlers, and over six serialization functions. Any missed entry would cause dirty data to resurface or break backward compatibility.
3. **Startup timing and race conditions:**
   During extension startup and initialization, asynchronous BCS reads, backup slot protection, and in-memory flushes can race. Executing sanitizers before in-memory state is fully ready risks misidentifying sections as empty, potentially wiping or overwriting valid historical data.

#### Explicitly non-implemented actions (Compromise boundaries)

- **Do not modify the BCS storage protocol, runtime recovery logic, or standard save routines.**
- **Do not perform one-time data sanitization on historical sections, backup slots, or clipboard history.**
- **Do not rewrite source data during backup, import, export, GitHub Push / Pull, JSON / HTML / ZIP, or cross-type conversion.**
- **Do not individually re-engineer every legacy serializer, clone, paste, drag/drop handler, or constructor.**
- **Do not treat constraint templates or plugin index projections as a new source file format, nor force-migrate legacy user data accordingly.**

#### ✅ Practical solution: constraint templates + companion plugin derived index projections

The system adopts a non-invasive two-layer boundary that cleanly resolves the issue with zero risk:

1. **Low-level source data remains as-is with explicit type checking:**
   Source data retains `url: ""` on `folder` nodes and `children: []` on `bookmark` nodes. All application logic and Agent read/write operations strictly check the explicit `type` (`folder` / `bookmark`) rather than inferring types from field presence. An empty `children: []` on a folder represents a valid empty-folder state and is preserved.
2. **Constraint files (AGENTS templates) guide model behavior:**
   Self-contained bilingual `AGENTS_template` files inform Agents that these two empty placeholders are historical serialization shapes rather than corruption. Agents must ignore empty `url`s on folders and empty `children` on bookmarks, and must not rewrite source files solely to clean placeholders; when writing back, Agents must re-read original nodes to preserve unmodified and unknown attributes.
3. **New companion plugin [Bookmark Research](https://github.com/Browser-bookmark-hub/Bookmark-Research) derived index projections (Already Implemented):**
   This derived indexing capability has already been fully delivered by the official standalone companion plugin [Bookmark Research](https://github.com/Browser-bookmark-hub/Bookmark-Research) (supporting Codex, Claude Code, DeepSeek Harness (dsh), etc., via Skill + local MCP + CLI). The plugin builds read-only derived indices outside exported canvas packages without modifying canvas data. When projecting targeted searches (`search_bookmarks`), context queries (`get_context`), or tree outlines (`inventory`) for models, the plugin automatically omits redundant empty `url`s on folders and empty `children` on bookmarks, outputting flattened, compact representations. This completely eliminates model confusion and saves 15%~25% token overhead without touching user source packages.

#### Development branch (dev) exploration and commit records

In the experimental development branch (`feat/experimental-schema-v3-sanitization`, the dev experimental branch), full low-level sanitization and protocol upgrade were fully implemented and validated:

- **Core implementation commit:**
  - **Commit ID:** `808e20bf5394b85f53b9886e5f408beb2b5b57d6`
  - **Branch:** `feat/experimental-schema-v3-sanitization`
  - **Commit title:** `feat(test): 临时栏目数据清洗`
  - **Explorations:**
    - Designed storage schemaVersion 5→6 migration routine;
    - Refactored 6 serialization functions to conditional assignment (bookmarks only write `url`, folders only write `children`);
    - Added normalizers at all import/recovery entry points to block legacy dirty data;
    - Implemented runtime guards (preventing `TypeError` when dragging into bookmarks and preventing premature deletion before move validation);
    - Implemented startup timing protection (`skipRuntimeFlush` mode reading persisted BCS, deduplicated in-flight promises, and `__canvasTempStateBcsLoadInProgress` write-lock guard with 15s watchdog);
    - Produced comprehensive review documentation and automated tests: `tests/sanitize_and_bcs.test.js`, `tools/check-bcs-local-storage.js`, etc.
- **Specification and documentation evolution commits:**
  - **Commit ID:** `cd280a78952b6442d53d3e762064404602972438` / `f74c2f5cf2d296713c5d36a8e407cd6742e3b803`
  - **Commit title:** `feat: 模板文件 与 临时栏目空字段问题docs`
  - **Note:** Following evaluation, the main branch decided against merging invasive low-level data cleaning, converging instead on the boundary of "constraint templates + derived index projections".
- **Historical preparatory refactoring commit:**
  - **Commit ID:** `cc520ae01bc7217878a9f3800b2c1d0e3b73df1b` (Tag: `重构--临时栏目--清除两个字段`)
  - **Commit title:** `refactor: 清除「"originPermanent""sequenceNumber"」`, removing legacy sequence numbers and permanent origin relations from Temporary Sections.

### 9. Browsing history visit statistics and deletion reconciliation architectural compromise

❌ **Intentional main-branch compromise: No 24/7 `chrome.history.onVisited` full-web tracking like companion project "Bookmark Record and Recommend"; instead, maintain a two-stage bookmark-whitelist IndexedDB ledger (`schemaVersion: 4`, day-bucketed recent visits + archived historical base + 30-day soft retention) with tiered deletion reconciliation (500-URL overflow threshold).**

When introducing bookmark visit frequency (`@热度` / `@frequency`) and recent visit timestamps (`@最近` / `@recent`), the system faced constraints from the browser platform API and data synchronization boundaries. Following architectural evaluation and empirical Chrome CDP verification, the main branch established the following compromises and boundaries:

#### 1. Why we intentionally do NOT run a 24/7 full-browsing `onVisited` tracker like "Bookmark Record and Recommend"

In the bookmark ecosystem, [Bookmark Record and Recommend](https://github.com/Browser-bookmark-hub/Bookmark-Record-Recommend) tracks browsing journeys continuously to generate recommendations. However, for **Bookmark Canvas**, the main branch explicitly **rejects** continuous background `onVisited` tracking:

- **Minimalist performance and zero idle battery drain:**
  Listening to `chrome.history.onVisited` wakes the background Service Worker on every navigation, redirect, and reload across all tabs, adding continuous CPU and disk I/O overhead. Bookmark Canvas keeps canvas page open at zero history scan cost and incurs work only when searching or inspecting folder stats.
- **Compact two-stage bookmark-whitelist ledger, zero ephemeral junk URLs:**
  Users visit hundreds of thousands of non-bookmark URLs each year. Only during idle warmup, search, or folder stats inspection does Bookmark Canvas sync: short-gap incremental updates (`< 21` days) filter `history.search` against the authoritative live bookmark whitelist (permanent tree + temporary sections, requiring dual-source readiness before marking removals) and batch-fetch `getVisits`, whereas cold start, `overflow_at` (`> 500` deletions), long-gap (`>= 21` days) rebuilds, and batch bookmark additions (`> 50`) route through an adaptive dual-engine scheduler (`<= 3500` URLs run a `maxResults: 1` empty-history check then batch `getVisits` at 100 URLs/batch with yields; larger sets probe with `maxResults: 3000` and use batched `getVisits` up to `10000` URLs when truncated, falling back to full `history.search` above `10000`; `0`-bookmark synced snapshots fast-path directly from IndexedDB) to persist a `schemaVersion: 4` ledger (releasing memory after 10 minutes of inactivity):
  - `archiveMap`: the first step of every reconciliation rolls buckets `>= 95` days old into `archiveMap`, preserving historical counts even after months without searching;
  - `recentDayBuckets`: stores lightweight `[visitCount, lastVisitTime]` per UTC integer day for the recent 95 days;
  - `variantsMap`: stores up to 15 raw URL variants per canonical URL strictly for bookmarks with confirmed valid visits (zero-visit and reload-only entries are omitted);
  - `missingSinceMap`: hides unbookmarked items from search immediately while soft-retaining underlying counts for a 30-day grace period so cut/search/paste workflows or accidental deletes do not lose old counts.
- **Visit quality filtering and cross-context safety:**
  Excludes `reload` and `auto_subframe` transitions, deduplicates same-canonical redirect chains (`referringVisitId` delta `< 500ms`) while preserving normal repeat clicks (`>= 500ms`), clamps abnormal future timestamps to `anchorTime`, overlaps short delta sync by 24 hours (never crossing `lastPurgedAt`) to capture delayed mobile/cross-device syncs, and coordinates concurrent Tab + Side Panel instances via `BroadcastChannel('bcs_visit_stats_v4')` and pre-write `savedAt` conflict checks. **Boundary note:** during `< 21`-day delta updates, new visits to redirect-source bookmarks remain hidden from `history.search` (`CHAIN_END` filtering) until the next long-gap or overflow `getVisits` rebuild (while single-bookmark and cold folder "Info" queries remain immediately accurate); likewise, pre-install historical URL variants are learned incrementally post-install rather than forced through an unbounded 90-day `history.search` burst on first cold start.
- **Pragmatic boundary around partial history deletions:**
  Due to browser `onVisitRemoved` blind spots (detailed below), individual historical visits already rolled into `archiveMap` (> 95 days) and purged by Chrome cannot be verified individually after Chrome drops them. For the recent 89 full days (`rebuildStartDay = floor((anchorTime - 90d) / 864e5) + 1`, avoiding partial-day expiration on day 90), the system clears affected recent buckets and refills them from `getVisits`.

#### 2. Browser platform API (`chrome.history`) hard limits and compromises

- **Physical 90-day retention ceiling on cold start:**
  Chromium-based browsers physically expire history older than ~90 days in their local SQLite database. Regardless of `startTime`, cold-start `history.search` can recover at most ~90 days of prior visits; once captured in `recentDayBuckets` and rolled into `archiveMap`, accumulated bookmark statistics persist across quarters without count regression when Chrome expires older rows.
- **Blindness to deleted time ranges:**
  `onVisitRemoved` delivers only `{ allHistory: boolean, urls: string[] }`, **never telling the extension what time window was cleared** (e.g., last hour, last 24 hours, last 7 days).
- **Empty `urls` notifications on partial range deletions and auto-expiration:**
  When a partial `deleteRange` leaves earlier visits intact in SQLite—or during Chrome's 90-day auto-expiration—`chrome.history.onVisitRemoved` can fire with `allHistory: false` and `urls: []`. It populates `urls` only when all remaining visits for a URL are completely removed. Bookmarks revisited or touched inside the 24-hour overlap window are cleared and rebuilt from `getVisits` during delta sync; untouched partial deletions remain bounded by the platform's lack of per-range signals until bulk reconciliation or revisit.
- **Tiered background deletion queue (500-URL overflow threshold):**
  - **`allHistory: true` (full history purge)**: Background writes `canvas_history_purged_at`; foreground clears `archiveMap`, `recentDayBuckets`, `variantsMap`, and `missingSinceMap`, records `lastPurgedAt`, and syncs only visits with `visitTime >= purgedAt`.
  - **Discrete URLs (`<= 500` accumulated tuples)**: Background debounces (300ms) and stores `[url, deletedAt]` tuples in `canvas_history_deleted_urls`. Foreground surfaces (Tab and Side Panel) read `deleted_urls` without directly clearing it and persist `canvas_history_stats_synced_at` after snapshot writes so the background prunes consumed tuples (`ts <= max(purged_at, overflow_at, synced_at)`) on its next flush. Signal checks trigger reconciliation only when a deleted URL hits an existing ledger entry; reconciliation filters by `deletedAt > lastSyncTime`, skips non-bookmark URLs, skips entries with no recent buckets and `lastVisitTime` older than 85 days (protecting pre-90d counts against Chrome auto-expiry events), and clears + recomputes only `>= rebuildStartDay` buckets via `getVisits` (falling back cleanly to the `archiveMap` base when all recent visits are cleared).
  - **Overflow (`> 500` accumulated URLs)**: Background clears `canvas_history_deleted_urls` and records `canvas_history_overflow_at`. Foreground preserves `archiveMap` and `< rebuildStartDay` buckets 100%, clears and refills only `>= rebuildStartDay` (recent 89 full days) using the adaptive dual-engine scan (`<= 3500` URLs batch `getVisits` directly after empty-history probe; larger libraries probe with `maxResults: 3000` and switch to batched `getVisits` up to `10000` URLs when truncated), and still reconciles soft-retention and newly added bookmarks.
  - **Empty notification (`allHistory: false`, `urls: []`)**: Ignored so partial range wipes or expiration notifications do not force full rebuilds.

#### 3. Entrypoint separation and on-demand synchronization

- **Canvas page open = idle warmup without redundant disk writes:**
  First-frame canvas initialization remains unblocked; after idle frames, the page warms the search index and stats ledger in the background without writing IndexedDB or broadcasting when data is unchanged and the persisted watermark is under 1 hour old.
- **Search / Folder Info = snapshot + delta sync:**
  `@热度`, `@最近`, and folder right-click "Info" (as well as background idle warmup) load the `v4` bucketed snapshot and run the ordered pipeline (roll up expired buckets -> tiered deletion signals -> whitelist soft-retention -> 24h-overlap delta sync) to project `urlMap`. Folder stats and grouped search results deduplicate by canonical URL so duplicate bookmarks do not inflate folder totals.
- **Single-bookmark right-click "Info" = direct lookup with archived base merge:**
  Queries `chrome.history.getVisits` directly (filtering `reload`/`auto_subframe` and deduplicating `< 500ms` redirect chains) **without calling `history.search` or loading the full index into memory**. In parallel, it checks warm memory or a fast single-key IndexedDB snapshot read for the `< rebuildStartDay` archived base and checks `canvas_history_purged_at` (zeroing immediately after `deleteAll`), merging the `< rebuildStartDay` base with live `>= rebuildStartDay` `getVisits` results so single-bookmark Info stays completely consistent with `@热度` search results.



