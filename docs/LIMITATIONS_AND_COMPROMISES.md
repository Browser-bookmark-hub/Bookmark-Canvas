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
