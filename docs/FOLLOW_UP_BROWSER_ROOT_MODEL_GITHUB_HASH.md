# Follow-up: Browser Root Model and GitHub Hashes

Research date: 2026-07-04

## 1. Chromium's New Dual-Storage Root Model

### Official changes

Chrome's Bookmarks API now documents two important `BookmarkTreeNode` fields:

- `folderType` (Chrome 134+): identifies special folder types added by the browser that users and extensions cannot directly modify.
- `syncing` (Chrome 134+): distinguishes the account-synced and local variants under the same `folderType`.

The important point is not a root node's ID or title:

- One `folderType` may have zero, one, or multiple nodes.
- Browsers may add or remove these special folders, while extension APIs cannot create or delete them.
- `syncing` may change after user actions and must not be assumed permanently stable.

Official reference: <https://developer.chrome.com/docs/extensions/reference/api/bookmarks>

### Impact on Bookmark Canvas

The current code is already largely modeled this way:

- `__normalizeBookmarkFolderType()` normalizes `folderType`.
- `__folderTypeToPermanentRootKey()` derives a stable root key from `folderType`; unknown types fall back to `custom:<type>`.
- `__getPermanentRootMatchKey()` prioritizes `folderType`, then falls back to legacy ID and title matching.
- `__normalizePermanentRootMeta()` and `__buildPermanentRootMeta()` preserve `rootDescriptors`, which can carry new roots.

Relevant source: `Bookmark-Canvas-main/history_html/storageBCS/storageBCS_core.js`, including `__canPersistBookmarkRootSyncing`, `__folderTypeToPermanentRootKey`, `__getPermanentRootMatchKey`, `__normalizePermanentRootMeta`, and `__buildPermanentRootMeta`.

Current allowlist:

```js
function __canPersistBookmarkRootSyncing(folderType) {
    const normalized = __normalizeBookmarkFolderType(folderType);
    return normalized === 'bookmarks-bar'
        || normalized === 'other'
        || normalized === 'mobile'
        || normalized === 'managed';
}
```

### Edge Workspace follow-up

If Edge officially exposes a stable Workspace marker, for example:

```json
{
  "folderType": "workspace",
  "syncing": true
}
```

the core Import / Export flow should not need a redesign: `__folderTypeToPermanentRootKey()` already stores unknown types as `custom:workspace`. The smallest physical change would be adding `workspace` to the `syncing` allowlist.

Consider that change only when all conditions hold:

1. Edge / Chromium officially confirms a stable `folderType`, such as `workspace`.
2. `chrome.bookmarks.getTree()` actually returns that field.
3. Its `syncing` value matters to Import / Export restore behavior.

Do not rely on fixed root IDs or titles, add guessed Workspace business logic, or hard-code ordinary folders as Workspaces before an official `folderType` exists.

## 2. GitHub Push Hash Calculation

### Current official status

When the GitHub Contents API updates a file, its `sha` remains the blob SHA of the file being replaced. The Git Blobs API likewise describes blobs as storing file content and using a SHA-1 hash.

Official references:

- <https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28>
- <https://docs.github.com/en/rest/git/blobs?apiVersion=2022-11-28>
- <https://docs.github.com/en/rest/overview/api-versions>
- <https://git-scm.com/docs/hash-function-transition>

The project currently fixes `X-GitHub-Api-Version` at `2022-11-28`. As of 2026-07-04, GitHub documents `2026-03-10` as the latest REST API version, while `2022-11-28` remains supported through 2028-03-10. No immediate version change is needed; the meaning of `sha` must be checked when upgrading.

Relevant source: `github-repo-api.js` and `github-package-transfer.js` under `history_html/transfer_AI_sync/`.

### Current implementation

Before Push, Bookmark Canvas calculates a Git blob SHA to skip files whose remote content is already identical:

```js
async function calculateGitBlobSha(content) {
    const bodyBytes = textToUtf8Bytes(content);
    const headerBytes = textToUtf8Bytes(`blob ${bodyBytes.byteLength}\0`);
    const payload = new Uint8Array(headerBytes.byteLength + bodyBytes.byteLength);
    payload.set(headerBytes, 0);
    payload.set(bodyBytes, headerBytes.byteLength);
    return await sha1Hex(payload);
}
```

This matches Git's SHA-1 blob naming rule: SHA-1 over `blob <size>\0<content>`.

Its scope is deliberately limited:

- compare local and remote content to avoid unnecessary uploads;
- use GitHub's returned remote `sha` for actual remote updates;
- treat a future change in GitHub object hashes or API response fields as the first risk to the local skip logic.

### Follow-up points

Git already has a SHA-256 transition design, while GitHub's current REST documentation still describes blob SHA-1. Track whether GitHub:

1. adds a blob hash-algorithm field;
2. keeps the Contents API `sha` guaranteed as a SHA-1 blob SHA;
3. introduces a REST API version whose breaking changes alter `sha` semantics; or
4. exposes SHA-256 repositories, dual-hash mappings, or a new object format through APIs.

### If GitHub changes hash semantics

Do not spread a new hash calculation across business logic. Keep an adapter point such as:

```js
async function calculateGitBlobSha(content, options = {}) {
    // Current: SHA-1 over `blob <size>\0<content>`.
    // Future: branch by GitHub-returned hash algorithm / API version.
}
```

Recommended migration order:

1. retain SHA-1 as the default;
2. read a hash-algorithm field or returned field length from GitHub responses;
3. choose an algorithm from the remote `sha` length or official field;
4. on comparison failure, fall back to upload and let GitHub validate the remote `sha` rather than blocking Push;
5. add hash-algorithm, compared, and skipped metrics to Push logs for regression analysis.

### Current conclusion

No Push hash change is needed now: GitHub still documents SHA-1 blobs; Contents updates still require the replaced file's blob SHA; the project explicitly uses `X-GitHub-Api-Version: 2022-11-28`; and GitHub API versioning provides new versions and migration windows for breaking changes. Keep tracking, but do not change behavior pre-emptively.

## 3. Future API Support and Touch Devices

### Conditions for future touch support

Do not add a separate Android touch interaction implementation yet. Bookmark Canvas currently targets the desktop browser-extension environment; its existing trackpad, pointer-event, and drag support is not equivalent to full mobile touch adaptation.

Future touch requirements should be considered only after Android officially supports Chrome extensions and the relevant extension APIs. Once the official support scope, page lifecycle, Side Panel / tab capabilities, and pointer / gesture event model are stable enough, evaluate:

- touch hit areas for the mobile canvas layout, floating tools, and secondary UI;
- one-finger dragging, two-finger panning, pinch zoom, and conflicts with system gestures;
- card editing, dragging, scrolling, fullscreen, and alternatives when no physical keyboard is available;
- performance, sleep / resume behavior, and extension-page lifecycle on Android devices;
- touch accessibility, orientation changes, and different screen sizes.

Before that official support exists, do not introduce Android-specific extension APIs, a mobile-only branch, or a touch-first UI rewrite for a hypothetical Chrome extension environment. Continue maintaining the existing desktop Chrome / Edge extension behavior and track Chromium's official API changes.
