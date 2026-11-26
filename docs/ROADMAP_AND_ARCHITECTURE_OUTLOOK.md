# Roadmap and Architecture Outlook

> Positioning: Key evolution directions and trade-offs memo (not a committed implementation schedule).

---

## 1. Canvas Architecture & Performance Evolution

- **From DOM Virtualization to Shell-vs-Payload Memory Separation (Viewport-Driven JS Heap & BCS):**
  - **Current Bottlenecks:** Off-screen DOM pruning (`lowDetailDomPruned`) and virtualization are in place, yet `__loadCanvasTempStateBundleFromBcs()` in `storageBCS_core.js` still reads every `bcs:section:<id>` shard at startup; `bcs:canvas` lacks lightweight shell summaries (`title`, `label`, `itemCount`), and over a hundred call sites across `bookmark_canvas_module.js`, `canvas_sidebar_directory.js`, `search.js`, and `history.js` iterate `CanvasState.tempSections` synchronously (fallback saves, search slice updates, directory tree, provenance, exports), assuming all `items` stay resident in memory.
  - **Key Directions:**
    - Store minimal shell metadata (`title`, `label`, item counts) alongside canvas layout so initial load renders zoomed-out outlines, edges, and the sidebar directory immediately without reading off-screen shards;
    - Leverage the existing `__loadTempSectionsFromBcs(sectionIds)` loader to stream `items` into memory by viewport, clear both DOM and JS references for GC after prolonged idle off-screen time, and strictly guard save paths so unloaded shards never overwrite disk;
    - Route cross-section queries (search, global tags, provenance, visit stats) to IndexedDB indexes rather than scanning full in-memory section arrays.
- **Low-Detail Zoom-Threshold Flicker Mitigation:**
  - After zooming out into low-detail mode and triggering DOM pruning, repeatedly pausing and oscillating across the zoom threshold (roughly 40%–50%–100%) can trigger repeated prune/restore flicker.
  - Introduce explicit enter/exit zoom hysteresis and coordinate prune/restore timers with active zoom keyframes.
- **Long-Term Rendering & Modular Boundaries:**
  - Track GPU-accelerated canvas approaches such as [gpucanvas](https://github.com/berkantay/gpucanvas) as long-term rendering inspiration;
  - Keep the compromise against a high-risk wholesale ESM/bundler rewrite of legacy scripts; isolate only **new complex subsystems** using the `tools/build-tiptap-bundle/` pattern (TypeScript + clean module boundaries + compiled bundle).

---

## 2. External Research Direction (Top Priority: Bookmark-Research & Ecosystem)

- **Why External Analysis Comes First (Pragmatic Compromise):**
  - Export (`.canvas` / JSON / snapshots) and GitHub Push/Pull are already deeply built out in the extension. Delegating analysis to external hosts over exported or pushed packages delivers the highest capability-to-effort ratio without building an in-extension Agent harness.
- **Primary Carrier & Multi-Host Support:**
  - Anchored by the standalone companion plugin [Bookmark-Research](https://github.com/Browser-bookmark-hub/Bookmark-Research) (Skill + local MCP + CLI), targeting and validating four Agent hosts: **Codex, Claude Code, DeepSeek Harness (dsh), and Pi**;
  - Evolution path: **standalone Skill → Skill + local MCP aggregation → Agent Plugin bundling multiple Skills/MCPs**; bundled `AGENTS.md` files also assist GitHub connectors and web-side research tools.
  - Ecosystem roles: `Bookmark-Canvas` (primary workspace & destination) + `Bookmark-Research` (external read-only research layer) + `Bookmark-Record-Recommend` (time/behavior & Push & Analyze data support, prioritized over backup) + `Bookmark-Backup` (snapshots, change audit, and web-archive support).
- **Two Native Context Layers in Canvas Packages:**
  - **Spatial Context:** `.canvas` layout, Card Group nesting, directed edges, regular section split lineage (`A-1` → `A-1-1`), duplicate bookmark placements across cards, and anchor `visibleRange` snapshots.
  - **Temporal & Interaction Context:** Git commit history, node timestamps, `@hot` visit frequency, pin/collapse states, plus human-authored semantics in `descriptionMd`, `note`, and `tags`.
- **Three-Tier Research & LLM Wiki Persistence:**
  1. **Direct Fetch / Non-reasoning:** Direct page retrieval when explicit URLs are given;
  2. **Agentic Search:** Host Agents run multi-step search, cross-section comparison, deduplication, and synthesis;
  3. **Deep Research:** Authorized Deep Research APIs or connectors generate source-cited reports;
  - Persist findings as Markdown / **LLM Wiki** knowledge notes, and import back into the canvas (e.g., R5 AI Special Temporary Section) only after explicit human confirmation.
- **Latency Optimization & Pragmatic SQLite / RAG Trade-offs:**
  - **Tool Performance:** Apply lessons from [codegraph](https://github.com/colbymchenry/codegraph), `smartsearch`, and `aether-search` to flatten deep Python script indirection and eliminate serial tool bottlenecks (e.g., concurrency and payload efficiency around frequent tools like `research_record`).
  - **Native JSON First, No Premature Heavy RAG:** Bookmarks are time-sensitive URL pointers whose target pages constantly change or sit behind logins; maintaining full vector embeddings, rerankers, or GraphRAG incurs high staleness and crawl cost. Query explicit JSON / `.canvas` structure first.
  - **Lightweight Enrichment Candidates:** Evaluate JEV / small-model retrieval scoring and a dedicated retrieval-summary `info` field separate from user-authored `note` (must handle thousands of legacy bookmarks incrementally rather than scraping only on bookmark creation); consider SQLite local indexing only after recurring offline research needs are proven.

---

## 3. Browser Automation & AI Engineering-Cost Gradient (CDP / MCP / Harness)

### Engineering Cost Gradient: External Package Analysis < Specialized CDP Handshake < Extension-Hosted MCP < In-Extension Harness

- **1. Rely on External Browser Agents via CDP (Key Browser Channel):**
  - **Why CDP Specifically:** Content-script-based browser agents cannot inject into `chrome-extension://` pages due to browser extension origin isolation. Virtually all external tools able to inspect and drive live extension pages rely on **CDP** under the hood (raw CDP, `chrome-devtools-mcp` with `--categoryExtensions`, or CDP-backed Playwright / Puppeteer / browser-use tools).
  - **Bottleneck & Specialization Needed:** Agents can already drive canvas actions (creating blank cards, moving temporary/permanent sections) via CDP/F12, but currently must read source code and write ad-hoc scripts on the fly. Speeding this up requires **page-side specialization**: stable scoped read primitives + deterministic canvas commands paired with a browser-agent `AGENTS.md` (reading Permanent / Temporary / Blank sections, spatio-temporal context, and search slices by active viewport or selection rather than dumping everything).
  - **Setup Friction:** Still bounded by remote-debugging enablement (`chrome://inspect/#remote-debugging` / `edge://inspect/#remote-debugging`) and `--categoryExtensions` flags for everyday users.
- **2. Extension-Hosted Specialized MCP (Secondary Option):**
  - Exposing the extension's own specialized MCP avoids generic DOM scripting, yet still depends on external browser ports / a local bridge process plus MV3 foreground/background coordination.
- **3. Cloud Agent APIs + Local Extension Harness (Heaviest Cost, Deferred):**
  - Even when integrating managed cloud Agent runtimes/APIs (such as OpenAI Agents API / Responses API, Cloudflare Agents, AWS Bedrock AgentCore, or direct DeepSeek / Gemini APIs), cloud sandboxes cannot directly touch local `chrome.bookmarks` or canvas DOM—the extension still has to build and maintain a local **Agent harness** (tool bindings, state sync, MV3 background lifetime, key isolation, and human-confirmation UI).
  - That engineering weight is why external package analysis (`Bookmark-Research`) remains the intentional near-term priority compromise.

---

## 4. Explicit Non-Goals

- **No Standalone Desktop Client:** Do not build a separate desktop client or rewrite the canvas into React + XYFlow, SQLite WASM, or an Obsidian plugin.
- **No Persistent Background Scraper or Global History Spying:** Do not turn the extension into a continuous web crawler or replicate `Bookmark-Record-Recommend`'s persistent browsing-stream listener.
- **No Attachment or File Management:** Stay focused on bookmarks, lightweight notes, and canvas topology—not an asset vault or second Obsidian (see [LIMITATIONS_AND_COMPROMISES.md](LIMITATIONS_AND_COMPROMISES.md)).
- **No Silent Write-Back:** AI outputs remain read-only by default; modifying permanent bookmarks or remote sync targets always requires explicit scope selection and user confirmation.

---

## Related Documents

- Platform limits and scope compromises: [LIMITATIONS_AND_COMPROMISES.md](LIMITATIONS_AND_COMPROMISES.md)
- Browser root model & GitHub hash tracking: [FOLLOW_UP_BROWSER_ROOT_MODEL_GITHUB_HASH.md](FOLLOW_UP_BROWSER_ROOT_MODEL_GITHUB_HASH.md)
- Initial user guide: [INITIAL_GUIDE.md](INITIAL_GUIDE.md)
- Versioned historical archive index: [Archived/00--归档索引-请先读.md](Archived/00--%E5%BD%92%E6%A1%A3%E7%B4%A2%E5%BC%95-%E8%AF%B7%E5%85%88%E8%AF%BB.md)
