# Privacy Policy for Bookmark Canvas

**Last Updated:** 2026-07-19

This Privacy Policy explains how Bookmark Canvas (the “Extension”) handles information. The Extension is designed around a local-first principle: **your bookmark and canvas data remain under your control.**

## 1. Information We Handle

The Extension handles the following information only to provide its bookmark-canvas features:

- **Bookmarks and bookmark metadata:** bookmark titles, URLs, folder structure, Tags, and Notes. This information is needed to display, organize, search, import, export, and update bookmarks in the canvas.
- **Canvas data and settings:** Permanent Sections, Temporary Sections, Blank Sections, Card Groups, connections, descriptions, layout, local indexes, and related preferences.
- **GitHub configuration and credentials:** if you choose GitHub Push/Pull, the configured repository details and Personal Access Token are handled so the Extension can authenticate directly with GitHub.
- **Favicon-related data:** bookmark URLs may be used to display favicon images; favicon data may be cached locally by the browser or Extension.

The Extension does not request the `history`, `cookies`, `webNavigation`, `identity`, `management`, or `scripting` permissions.

## 2. How Your Data Is Handled

**We do not operate a developer backend and do not collect your data on our own servers.**

- **Local processing and storage:** bookmark processing, canvas rendering, search indexing, settings, and caches are handled locally in your browser. Extension data is stored through browser extension storage and IndexedDB, including `chrome.storage.local` / `unlimitedStorage` where applicable.
- **Local exports:** when you export a canvas package, the Extension uses the browser download flow to save it to your device.
- **Optional GitHub Push/Pull:** when you configure and initiate GitHub Push or Pull, data is sent directly between your browser and the GitHub API for the repository you selected. Your GitHub token is used only for that direct request flow; the project does not proxy it through a developer-operated server.
- **No analytics or sale of data:** the Extension does not include a developer analytics service and does not sell, rent, trade, or share your bookmark or canvas data with third parties.

Data stored in a GitHub repository is subject to GitHub's own privacy policy, security practices, repository visibility settings, and access controls.

## 3. Permissions Justification

The Extension requests the following permissions only for its declared functionality:

- `sidePanel`: display Bookmark Canvas in the browser Side Panel.
- `bookmarks`: read and update bookmarks, folders, and bookmark-tree structure.
- `storage` and `unlimitedStorage`: persist canvas documents, settings, indexes, and caches locally.
- `downloads`: export canvas packages to your device.
- `tabs`, `activeTab`, `tabGroups`, and `windows`: support canvas navigation and browser-tab, tab-group, and window-related interactions initiated through the Extension.
- `commands`: provide the Extension's keyboard shortcuts.
- `favicon`: display bookmark favicons.
- `idle`: support relevant browser idle-state behavior.
- `<all_urls>` host permission: allow the Extension's declared URL and favicon-related integration to work across bookmarked sites and allow direct network access for user-configured GitHub Push/Pull. The manifest does not declare a content script that injects into web pages.

## 4. Your Controls and Data Deletion

You control your data:

- You can delete exported files from your device.
- You can remove or revoke the GitHub Personal Access Token you configured, and delete synchronized files or repositories through GitHub.
- You can remove the Extension to remove its local extension data under your browser's normal extension-uninstall behavior.

Before clearing local data or uninstalling, export any canvas packages you want to keep.

## 5. Changes to This Policy

We may update this Privacy Policy when the Extension's data handling or browser-platform requirements change. The latest version will be published in this repository with an updated “Last Updated” date.

## 6. Contact

For questions about this Privacy Policy, please open an issue in the [Bookmark Canvas GitHub repository](https://github.com/Browser-bookmark-hub/Bookmark-Canvas/issues).
