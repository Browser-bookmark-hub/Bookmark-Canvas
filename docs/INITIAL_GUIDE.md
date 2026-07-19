# Initial Guide

> This document preserves the three initial guide cards shown when a canvas has no saved canvas state: **Canvas Basics**, **Quick Actions**, and **Features**. The cards can be edited or deleted in the canvas; this file remains a complete static reference.

## Canvas Basics

1. **Drag bookmarks or folders to a blank area** to create bookmark-type Temporary Sections.
2. Temporary Section changes are **not saved to the core data**, making them useful for comparison and organization.
3. **Drag or paste between sections** as needed.

### Basic Operations

- **Create a Temporary Section:** drag a bookmark or folder from the bookmark tree onto a blank canvas area.
- **Create a Blank Section:** double-click a blank canvas area.
- **Create a Card Group:** drag-select multiple elements and create a group, or right-click a blank canvas area to create an empty group.
- **Canvas elements:** Permanent Sections and Permanent Section Copies, Temporary Sections, Blank Sections, Card Groups, and connection lines.

### Connection Lines

- **Create a connection:** drag from a section-edge anchor to another section.
- **Edit a connection:** click a line to change its color, direction, or label.
- **Preset colors:** blue, red, orange, yellow, green, cyan, and purple.

### Card Groups

- **Nested groups:** place sections, Blank Sections, or other groups inside a group frame to create a nesting relationship.
- **Group organization:** Card Groups are stored through `.canvas` geometric containment; no manual `children` maintenance is needed.
- **Group export:** export a Card Group or temporary selection as a smaller canvas package.

### Markdown / HTML Editing

- **Double-click to edit:** both Blank Sections and description boxes can be edited by double-clicking.
- **Formatting toolbar:** headings, lists, quotes, bold, italic, underline, font color, alignment, and highlighting are supported.
- **Safe HTML:** HTML created by paste or toolbar actions is stored and rendered through a safe subset.
- **Markdown examples:** `**bold text**`, `==highlight text==`, quotes, and lists.
- **HTML examples:** `<font color="#fb464c">red text</font>`, `<span style="color:#66bbff">blue text</span>`, and `<u>underline</u>`.
- **Images/icons:** lightweight HTML / Markdown icon support accepts drag-and-drop, URLs, and Base64, with a 20 KB limit. Images are generally not recommended.

## Quick Actions

- Click **Locate** in the top-left floating tool window to locate the Permanent Section.
- Click **HTML Page** at bottom-right to open or locate the tab (`Ctrl+Shift+Space`; `Command+Shift+Space` on macOS).

### Ctrl Key Operations

- **Hold `Ctrl + Left Click`:** drag the canvas or a section card.
- **`Ctrl + Scroll`** (or a trackpad two-finger gesture): zoom the canvas.
- **`Ctrl + Right Click`:** resize a section card.

### Shift Key Operations

- **`Shift + Scroll`:** scroll horizontally. This bypasses Permanent Section / Temporary Section vertical-scroll capture; release Shift to resume vertical canvas scrolling.
- **`Shift` / `Option` / `Alt + Left Click`:** select bookmarks individually or in batches. In batch mode, a normal left click also selects.

### Space Key Operation

- **Hold `Space + Left Click`:** pan the global canvas.

### Trackpad Operations

- **Pinch:** zoom the canvas.
- **`Ctrl` + two-finger scroll:** zoom, including in the Side Panel.
- **Two-finger scroll:** pan the canvas.

### Left-Click Selection

- **Drag with the left mouse button on a blank canvas area:** select multiple elements into a temporary group. The group can be moved, recolored, pinned, deleted, or converted into a Card Group.

### Element Right-Click

- **Right-clickable elements:** Permanent Sections and Permanent Section Copies, Temporary Sections, Blank Sections, connection lines, Card Groups, temporary selection groups, and blank canvas areas.
- **Common actions:** fullscreen, locate, pin, color, rename, delete, copy source, and export current.

Shortcuts can be customized through **Manage** at top-left.

## Features

### Fullscreen and Navigation

- **Fullscreen mode:** expand the current section card to fullscreen, especially useful in the Side Panel.
- **Navigation:** while fullscreen, use the Directory Side Panel or **Card (Group)** search results to switch and locate cards quickly.

### One-Click Continuous Open

- **Set a default open mode:** select and check the preferred mode in a bookmark right-click menu.
- **Left-click to open:** later left-clicks open bookmarks with that selected mode.
- **Right-click open modes:** choose a new tab, tab group, window, incognito window, and related modes.

### Available Open Modes

- New Tab / Same Group / Exclusive Group.
- New Window / Same Window / Exclusive Window / Incognito.
- **Same Window + Exclusive Group:** open in an exclusive tab group in the current window.
- **Manual Select…:** choose the destination window and tab group each time.

### Batch Operations

- **Select (Batch):** enter multi-select mode and select across sections.
- **Automatic folder grouping:** folders create tab groups during batch open.

### Search

- **Bookmark mode:** search bookmark titles, URLs, folder names, and `#` Tags.
- **Card (Group) mode:** search indexes, titles, group names, and times for Permanent Sections and Permanent Section Copies, Temporary Sections, Blank Sections, and Card Groups.
- **Description mode:** search Section Notes, Blank Section text, and edge labels.

### Import / Export

- **Global export:** export `.canvas`, section JSON / Markdown, Blank Sections, and connection lines.
- **Group export:** export Card Groups and temporary selection groups separately; imports restore them as ordinary Card Groups.
- **Snapshot Package Import:** import a folder or ZIP as a canvas snapshot package to restore or compare a full canvas structure.
- **Full Overwrite (Overwrite Import):** clear the current local target and write the imported package when you explicitly intend to restore that backup.
- **Import at this position:** right-click a blank canvas area or an element to import a folder / ZIP snapshot package near that position.
- **Drag and Drop:** drag files or bookmarks onto a blank canvas area. This includes single JSON / HTML recovery detection and folders dragged from the bookmarks bar. Edge Side Panel bookmarks cannot be dragged into Bookmark Canvas; Chrome supports this. In Chrome and Edge, horizontal bookmarks-bar dragging supports ordinary bookmarks or links only.
- **AI guide:** exported packages can generate `AGENTS.md` or `CLAUDE.md` to constrain AI edits while preserving package structure.

### Push / Pull

> [!WARNING]
> **Safety warning (critical):** Push cleans the remote sync directory. Do **not** keep unrelated files there, including personal notes or media, because they can be **permanently deleted**. Bookmark Canvas also does not support external file nodes such as videos, audio, images, or PDFs.
