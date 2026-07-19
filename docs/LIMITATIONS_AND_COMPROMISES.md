# Limitations and Compromises

## Limitations

### 1. Cards cannot directly load a WebView

❌ **Not supported.** Manifest V3 has no practical WebView for this purpose. A reliable implementation would require an Obsidian plugin, another open-source bookmark-management app, or a Chrome-engine-based application; Chrome itself does not currently provide vertical tabs either.

Bookmark Canvas will not become a second Obsidian, and the browser environment does not provide this capability.

#### Why

The goal was to validate opening external URLs through the Side Panel, a Canvas browser card, or custom tabs. These are technically possible only through `<iframe>`, but are impractical:

1. A Side Panel or proposed Canvas browser card can only embed an external URL through `<iframe>`.
2. Most mainstream sites, including Google and GitHub, intentionally prohibit iframe embedding through CSP or `X-Frame-Options`.
3. The browser has no Side Panel tabs API; custom tabs would merely switch between iframes and cannot remove the iframe restriction.
4. In most cases users would only see “refused to connect”.

### 2. Browser windows cannot be named automatically

Chrome's `windows` API has no writable or readable window-name field. MDN's `windows.Window.title` is read-only and represents a displayed title rather than a settable name. Tab Groups can be named, but windows cannot.

**Workaround:** use the Bookmark Canvas page to name tabs and locate the section that generated a window.

### 3. Closed Tab Group names cannot be read

`chrome.tabGroups.*` can access only groups still active in an open window. Once the window closes, the group is no longer available through that API. Session / Sync data, including closed-window lists and cloud-synced Tab Groups, are internal to Chrome or the signed-in account; extensions cannot read their group membership or original names. `chrome.sessions` can expose recently closed windows or tabs, but not those group details.

**Workaround:** manage **Same Window + Exclusive Group**, **Same Window**, and **Exclusive Window** through a tab page.

### 4. Side Panel shortcut wake-state loss

This is a system-level behavior. When an already open Side Panel is left idle and the user returns, the first shortcut press can fail to close it while the second succeeds. When the Side Panel is closed, the first press can still open it. Avoiding a popup page is the current mitigation.

### 5. Edge Side Panel refreshes differently from Chrome

Chrome treats the Side Panel as one persistent global page: switching tabs changes its neighbor but not its JavaScript context. Edge can create an isolated Side Panel instance for each tab as part of its Sidebar Assistant integration; switching tabs may destroy the previous context and reload the next one. The current approach uses a shell / panel shelf to work within that behavior.

### 6. Windows discrete-mouse feel

Discrete mouse input on Windows feels more step-based than macOS. Curve tuning improves it, but does not fully match the macOS feel.

### 7. Flicker with many cards and bookmarks

With many cards or bookmarks rendered at once, flicker can still occur. Low-detail mode, out-of-viewport low detail, lazy loading, and viewport virtualization / chunked rendering substantially improve large canvases, bookmark trees, and multi-card scenarios. They cannot eliminate DOM rendering, favicon loading, card updates, and browser-paint pressure when too many elements are visible.

This is a practical constraint of a browser extension plus DOM Canvas. The strategy is to reduce the chance of it through performance mode, low detail, lazy loading, and virtualization rather than promise unlimited, flicker-free cards and bookmarks.

## Compromises

### 1. Dragging to create Temporary Sections

Edge Side Panel bookmarks cannot be dragged into Bookmark Canvas. In Chrome and Edge, drag operations from the horizontal bar are limited to ordinary bookmarks / links.

### 2. Side Panel pinch zoom

On ordinary HTML pages, trackpad pinch usually maps to `wheel` with `ctrlKey=true`. A Side Panel is browser-hosted UI, where the gesture can be handled or intercepted by the host before the page receives it. Therefore the same implementation can work in a tab page while failing in the Side Panel.

`Ctrl +` two-finger scrolling was added as the later compatible solution.

### 3. GitHub cannot download one directory as a package

GitHub's `/zipball` API takes only `owner`, `repo`, and `branch` / ref; it cannot package only a `remoteRoot` directory. See <https://github.com/orgs/community/discussions/178419>.

**Workaround:** choose a **Pull Package Method** above the default package Import mode:

- **Full Repo ZIPball:** faster but requires filtering; suitable for many Permanent Section / Temporary Section cards and a clean repository.
- **Targeted Pull:** potentially slower but precise; suitable for fewer cards or repositories containing unrelated large files.

### 4. GitHub App, web authorization, and QR-code sign-in

| Approach | Authorization experience | Fine-grained repository access | Pure frontend, no server |
| --- | --- | --- | --- |
| Traditional OAuth / QR-style flow | Excellent | No, broad account exposure | Yes |
| Fine-grained PAT entered manually | More cumbersome | Yes | Yes |
| GitHub App | Excellent | Yes | No, requires a backend |

### 5. Do not replace description boxes with CodeMirror 6

Blank Sections use `.canvas` text nodes, while Permanent Sections and Temporary Sections use `descriptionMd`. CodeMirror 6 is a Markdown source editor rather than the current HTML-rich-text DOM editor. Existing tools directly manipulate `innerHTML`, DOM selections, `document.execCommand`, checkbox DOM, and `span` styling; CM6 would require a Markdown-document model or extensions / decorations.

Obsidian uses CodeMirror 6, and a renderer change can be reconsidered later. It is not necessary now because description boxes primarily need basic display and editing.

#### Mermaid rendering

Not planned. A Mermaid renderer would create a canvas inside the canvas, with nested rendering and zoom concerns, without enough benefit.

### 6. No attachments

Attachments are intentionally out of scope. Supporting arbitrary files, images, PDFs, audio, video, or other file nodes would rapidly enlarge packages and make GitHub Push / Pull resemble a file-sync system. It would also require preview, cache, update, deletion, conflict, and cross-device-consistency systems, and users could reasonably expect an Obsidian- or cloud-drive-like attachment manager.

Bookmark Canvas is not a replacement Obsidian client or file manager. Use a more appropriate tool for long-term attachments, media, PDFs, or large libraries; keep Bookmark Canvas focused on bookmarks, canvas structure, descriptions, Import / Export, and lightweight GitHub Push / Pull.

### 7. No retrofitted general bundling or advanced minification

The project does not aim to rewrite its existing output around a build tool. Build tools are valid, but retrofitting bundling or advanced compression into this codebase carries more risk than benefit.

- esbuild `bundle` recursively inlines imports; `minify` combines whitespace removal, syntax compression, and local-name shortening.
- esbuild explicitly warns that minification cannot be safe for every codebase, especially when code relies on function source strings, function/class names, or assumptions about built-ins. `mangle props` can introduce subtle breakage.
- MV3 extension pages impose fixed constraints on script declarations, resource paths, `web_accessible_resources`, service workers, and messaging bridges.
- `history.html` loads many ordinary scripts in a fixed order, including `storageBCS_core.js`, transfer code, `bookmark_canvas_module.js`, Card Groups, search, Tag / Note, and `history.js`.
- Modules communicate through globals such as `window.CanvasModule`, `window.CanvasProtocolBridge`, `window.TagSystem`, `window.NoteSystem`, and `window.BookmarkCanvasGithubTransfer`; the runtime also depends heavily on fixed DOM IDs, classes, datasets, event delegation, templates, and CSS load order.

The project is especially vulnerable to a build step silently changing code shape. Even whitespace-only minification can complicate visual debugging; advanced name/property mangling, tree shaking, cross-file merging, or module wrapping further risks script order, exposed globals, dialogs, selectors, events, and UI behavior.

Current policy:

- do not broadly refactor existing main code for small compression gains;
- do not mangle properties;
- do not send DOM/CSS-template-heavy legacy code through advanced compression;
- if compression is unavoidable, use only a conservative level and manually verify critical UI;
- reserve build tooling for future modules designed from the outset with clear boundaries.

For a future client, major module, or true re-architecture, design ESM boundaries, import/export relationships, build artifacts, source maps, preserved global APIs, tests, and visual regression coverage from the start. React, Vite, Rollup, and esbuild belong to that future context, not a risky retroactive rewrite.

References:

- <https://esbuild.github.io/api/#bundle>
- <https://esbuild.github.io/api/#minify>
- <https://esbuild.github.io/api/#keep-names>
- <https://esbuild.github.io/api/#mangle-props>
- <https://developer.chrome.com/docs/extensions/reference/manifest>
- <https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources>
- <https://developer.chrome.com/docs/extensions/develop/concepts/service-workers>
