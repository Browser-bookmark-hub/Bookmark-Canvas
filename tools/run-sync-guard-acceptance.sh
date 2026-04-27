#!/usr/bin/env bash
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SYNC_FILE="history_html/sync/obsidian-git-sync.js"
TEMP_FILE="history_html/bookmark_canvas_module.js"
HISTORY_FILE="history_html/history.js"
SEARCH_FILE="history_html/search/search.js"
CONTEXT_MENU_FILE="history_html/bookmark_tree_context_menu.js"
DRAG_DROP_FILE="history_html/bookmark_tree_drag_drop.js"
SELF_PATH="tools/run-sync-guard-acceptance.sh"

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  printf '[PASS] %s\n' "$1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  printf '[FAIL] %s\n' "$1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

section() {
  printf '\n== %s ==\n' "$1"
}

require_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    pass "command available: ${cmd}"
  else
    fail "missing required command: ${cmd}"
  fi
}

run_node_check() {
  local file="$1"
  if node --check "$file" >/dev/null 2>&1; then
    pass "node --check ${file}"
  else
    fail "node --check ${file}"
  fi
}

assert_no_match() {
  local pattern="$1"
  local label="$2"
  local output
  output="$(rg -n --no-heading --pcre2 "$pattern" -g '!docs/**' -g "!${SELF_PATH}" . || true)"
  if [[ -z "$output" ]]; then
    pass "$label"
  else
    fail "$label"
    printf '%s\n' "$output"
  fi
}

assert_pattern() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if rg -n --no-heading --pcre2 "$pattern" "$file" >/dev/null 2>&1; then
    pass "$label"
  else
    fail "$label"
    printf '  missing pattern: %s\n' "$pattern"
  fi
}

assert_pattern_count() {
  local file="$1"
  local pattern="$2"
  local expected="$3"
  local label="$4"
  local count
  count="$(rg -n --no-heading --pcre2 "$pattern" "$file" 2>/dev/null | wc -l | tr -d '[:space:]')"
  if [[ "$count" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label"
    printf '  expected count: %s actual: %s pattern: %s\n' "$expected" "${count:-0}" "$pattern"
  fi
}

assert_original_id_absent() {
  local output
  local hidden_hits
  output="$(rg -n --no-heading --pcre2 '\boriginalId\b' -g '!docs/**' -g "!${SELF_PATH}" . || true)"

  if [[ -n "$output" ]]; then
    fail "originalId back-check (unexpected runtime hit)"
    printf '%s\n' "$output"
    return
  fi

  pass "originalId back-check (no runtime hits)"

  hidden_hits="$(rg -n --no-heading --pcre2 "original['\"]\\s*\\+\\s*['\"]Id|allowLegacyOriginalId|PERMANENT_NODE_LEGACY_ORIGINAL_ID_KEY" -g '!docs/**' -g "!${SELF_PATH}" . || true)"
  if [[ -n "$hidden_hits" ]]; then
    fail "originalId hidden-compat back-check (unexpected fallback/constructed key)"
    printf '%s\n' "$hidden_hits"
    return
  fi

  pass "originalId hidden-compat back-check"
}

assert_source_id_single_field_back_check() {
  local source_id_hits
  local source_id_leak_hits
  source_id_hits="$(rg -n --no-heading --pcre2 '\bsourceID\b' -g '!docs/**' -g "!${SELF_PATH}" . || true)"
  if [[ -z "$source_id_hits" ]]; then
    fail "sourceID single-field back-check (expected sourceID usage, found none)"
    return
  fi

  source_id_leak_hits="$(rg -n --no-heading --pcre2 "\\.sourceId\\b|sourceId\\s*:|'sourceId'|source['\"]\\s*\\+\\s*['\"]Id" -g '!docs/**' -g "!${SELF_PATH}" . || true)"

  if [[ -z "$source_id_leak_hits" ]]; then
    pass "sourceID single-field back-check (sourceID allowed; sourceId field blocked)"
  else
    fail "sourceID single-field back-check (unexpected sourceId runtime leak)"
    printf '%s\n' "$source_id_leak_hits"
  fi
}

main() {
  cd "$REPO_ROOT" || exit 1

  section "Prerequisites"
  require_cmd "node"
  require_cmd "rg"

  section "Syntax check"
  run_node_check "$TEMP_FILE"
  run_node_check "$HISTORY_FILE"
  run_node_check "$SEARCH_FILE"
  run_node_check "$SYNC_FILE"
  run_node_check "$CONTEXT_MENU_FILE"
  run_node_check "$DRAG_DROP_FILE"

  section "originalId/sourceID back-check"
  assert_original_id_absent
  assert_source_id_single_field_back_check

  section "Key hook hit-check"
  assert_pattern "$SYNC_FILE" 'async function verifyPermanentTreeConsistencyBeforePush\(' \
    "consistency precheck: verifier function exists"
  assert_pattern "$SYNC_FILE" 'await verifyPermanentTreeConsistencyBeforePush\(bundle, bridge, \{' \
    "consistency precheck: push pipeline invokes verifier"
  assert_pattern "$SYNC_FILE" 'await verifyPermanentTreeConsistencyBeforePush\(preflightPushBundle, bridge, \{' \
    "consistency precheck: runSync push/full preflight invokes verifier"
  assert_pattern "$SYNC_FILE" 'const stagedPushLock = await stagePushRecoveryLock\(' \
    "push fail-closed: lock staging call exists"
  assert_pattern "$SYNC_FILE" 'if \(!stagedPushLock\) \{' \
    "push fail-closed: staged lock failure branch exists"
  assert_pattern "$SYNC_FILE" '恢复保护创建失败：已取消本次上传' \
    "push fail-closed: staged lock failure blocks upload"
  assert_pattern "$SYNC_FILE" 'const RECOVERY_LOCK_SOFT_WARN_MS = 30 \* 60 \* 1000;' \
    "recovery lock threshold: soft warn is 30 minutes"
  assert_pattern "$SYNC_FILE" 'const RECOVERY_LOCK_MAX_AGE_MS = 24 \* 60 \* 60 \* 1000;' \
    "recovery lock threshold: hard max age is 24 hours"
  assert_pattern "$SYNC_FILE" 'ageMs >= RECOVERY_LOCK_SOFT_WARN_MS && ageMs < RECOVERY_LOCK_MAX_AGE_MS' \
    "recovery lock threshold: soft warn condition wired"
  assert_pattern "$SYNC_FILE" 'getRecoveryLockAgeMs\(current\) > RECOVERY_LOCK_MAX_AGE_MS' \
    "recovery lock threshold: hard timeout guard wired"
  assert_pattern "$TEMP_FILE" 'function __normalizeCanonicalImportAuditContext\(' \
    "canonical shadow: context normalizer exists"
  assert_pattern "$TEMP_FILE" "__runCanonicalImportShadowAudit\\('manual-import'" \
    "canonical shadow: manual import hook exists"
  assert_pattern "$TEMP_FILE" "__runCanonicalImportShadowAudit\\('sync-import'" \
    "canonical shadow: sync import hook exists"
  assert_pattern "$TEMP_FILE" "trigger: \\(options && typeof options\\.trigger === 'string'" \
    "canonical shadow: sync trigger context forwarded"
  assert_pattern "$TEMP_FILE" "trigger: 'sync-parse-remote-snapshot'" \
    "canonical shadow: sync parse trigger context forwarded"
  assert_pattern "$TEMP_FILE" 'async function __applyObsidianSyncFilesReplace\(filesByPath, folderName = .*, options = \{\}\)' \
    "canonical shadow: sync apply accepts options context"
  assert_pattern "$TEMP_FILE" 'const CANVAS_SUPPRESS_SYNC_MARK_DIRTY_SOFT_WARN_MS = 3 \* 1000;' \
    "suppress guard: soft threshold is 3s"
  assert_pattern "$TEMP_FILE" 'const CANVAS_SUPPRESS_SYNC_MARK_DIRTY_HARD_FUSE_MS = 10 \* 1000;' \
    "suppress guard: hard fuse threshold is 10s"
  assert_pattern "$TEMP_FILE" 'function __resolveCanvasSuppressSyncMarkDirtyOption\(' \
    "suppress guard: resolve function exists"
  assert_pattern "$SYNC_FILE" "const allowSnapshotHint = !!\\(options && options.allowSnapshotHint === true\\);" \
    "consistency precheck: realtime api-tree default enforced"
  assert_pattern "$SYNC_FILE" "if \\(text\\.includes\\('push'\\) \\|\\| text\\.includes\\('full'\\) \\|\\| text\\.includes\\('sync'\\)\\) return true;" \
    "push recovery lock: stage trigger coverage widened"

  assert_pattern "$TEMP_FILE" "const PERMANENT_NODE_SOURCE_ID_MAP_STORAGE_KEY = 'bcs:perm:source-id-map';" \
    "permanent sourceID: legacy map key exists only for migration"
  assert_pattern "$TEMP_FILE" "const oldSourceIDMap = __readPermanentNodeSourceIDMap\\(\\);" \
    "permanent sourceID: legacy map read is confined to migration"
  assert_pattern_count "$TEMP_FILE" "__readPermanentNodeSourceIDMap\\(" "2" \
    "permanent sourceID: legacy map has exactly function+迁移 references"
  assert_no_match "source-id-export" \
    "permanent sourceID: old export-key table is disabled"
  assert_pattern "$TEMP_FILE" "function __generateCanvasHighEntropySourceID\\(\\)" \
    "sourceID generation: shared high-entropy generator exists"
  assert_pattern "$TEMP_FILE" "const __CANVAS_SOURCE_ID_RANDOM_LENGTH = 8;" \
    "sourceID generation: compact 8-char random suffix configured"
  assert_pattern "$TEMP_FILE" "cryptoSource\\.getRandomValues\\(bytes\\)" \
    "sourceID generation: getRandomValues path wired"
  assert_no_match "__collectKnownCanvasSourceIDSet" \
    "sourceID generation: no whole-state local ID scan"
  assert_no_match "usedSet\\.has\\(candidate\\)" \
    "sourceID generation: random generation does not scan existing IDs"
  assert_no_match "src-perm-\\$\\{" \
    "sourceID generation: permanent IDs are not chrome-id/path deterministic"
  assert_pattern "$TEMP_FILE" "function __resolveTempItemSourceID\\(primaryValue, options = \\{\\}\\)" \
    "temporary sourceID: resolver has no originalId fallback"
  assert_pattern "$TEMP_FILE" "if \\(options && options\\.allowGenerate === false\\) return '';" \
    "temporary sourceID: import/sync can opt out of generation"
  assert_pattern "$TEMP_FILE" "const generateMissing = !!\\(options && options\\.generateMissing === true\\);" \
    "temporary sourceID: save normalization does not repair missing by default"
  assert_pattern "$TEMP_FILE" "const repairMissing = !!\\(options && options\\.repairMissing === true\\);" \
    "temporary sourceID: integrity validation repair is explicit"
  assert_pattern "$TEMP_FILE" "saveTempNodes\\(\\{ skipSourceIDNormalization: true \\}\\);" \
    "temporary sourceID: manual JSON/HTML import does not repair missing IDs during save"
  assert_pattern "$TEMP_FILE" "function __buildPermanentTreeProtocolNode\\(nodeInput, options = \\{\\}\\)" \
    "permanent sourceID: protocol node builder exists"
  assert_pattern "$TEMP_FILE" "const BCS_PERM_MAIN_STATE_KEY = 'bcs:perm:main:state';" \
    "permanent JSON: main content state key exists"
  assert_pattern "$TEMP_FILE" "const BCS_PERM_COPY_STATE_PREFIX = 'bcs:perm:copy-state:';" \
    "permanent JSON: copy-anchor state key exists"
  assert_pattern "$HISTORY_FILE" "function __isCanvasPermanentTreeContainer\\(treeContainer\\)" \
    "permanent copy view state: canvas permanent tree can be identified"
  assert_pattern "$HISTORY_FILE" "const sourceID = String\\(item\\.getAttribute \\? item\\.getAttribute\\('data-source-id'\\) \\|\\| '' : ''\\)\\.trim\\(\\);" \
    "permanent copy view state: expand state prefers sourceID"
  assert_pattern "$HISTORY_FILE" 'data-source-id="\$\{CSS\.escape\(id\)\}"' \
    "permanent copy view state: rerender restores by sourceID"
  assert_pattern "$HISTORY_FILE" "if \\(preferSourceID\\) \\{" \
    "permanent copy view state: restore path checks sourceID before local id"
  assert_pattern "$TEMP_FILE" "function __buildPermanentMainSyncPayload\\(contentInput\\)" \
    "permanent JSON: shared sync payload builder exists"
  assert_pattern "$TEMP_FILE" "function __stripPermanentLocalIdsFromTree\\(treeInput\\)" \
    "permanent JSON: local Chrome id stripping is structural"
  assert_pattern "$TEMP_FILE" "function __assertPermanentTreeSourceIDs\\(treeInput, context = ''\\)" \
    "permanent JSON: sourceID integrity assertion exists"
  assert_pattern "$TEMP_FILE" "async function __preparePermanentCreateNodeInBcs\\(createInfoInput, options = \\{\\}\\)" \
    "permanent JSON-first ops: create prewrites BCS tree"
  assert_pattern "$TEMP_FILE" "async function __commitPermanentCreatedNodeInBcs\\(pendingIdInput, createdNodeInput, options = \\{\\}\\)" \
    "permanent JSON-first ops: create commits Chrome id"
  assert_pattern "$TEMP_FILE" "async function __updatePermanentNodeInBcs\\(nodeIdInput, updatesInput, options = \\{\\}\\)" \
    "permanent JSON-first ops: update prewrites BCS tree"
  assert_pattern "$TEMP_FILE" "async function __removePermanentNodeFromBcs\\(nodeIdInput, options = \\{\\}\\)" \
    "permanent JSON-first ops: remove prewrites BCS tree"
  assert_pattern "$TEMP_FILE" "async function __movePermanentNodeInBcs\\(nodeIdInput, targetInput, options = \\{\\}\\)" \
    "permanent JSON-first ops: move prewrites BCS tree"
  assert_pattern "$TEMP_FILE" "async function __restorePermanentMainContentSnapshot\\(contentInput, options = \\{\\}\\)" \
    "permanent JSON-first ops: failed Chrome operation can rollback"
  assert_pattern "$CONTEXT_MENU_FILE" "async function createPermanentBookmarkNode\\(createPayload, options = \\{\\}\\)" \
    "permanent JSON-first ops: context menu uses create wrapper"
  assert_pattern "$CONTEXT_MENU_FILE" "await bridge\\.preparePermanentCreateNodeInBcs\\(createPayload" \
    "permanent JSON-first ops: context create wrapper prewrites BCS"
  assert_pattern "$CONTEXT_MENU_FILE" "await bridge\\.updatePermanentNodeInBcs\\(nodeId, updates" \
    "permanent JSON-first ops: context update wrapper prewrites BCS"
  assert_pattern "$CONTEXT_MENU_FILE" "await bridge\\.removePermanentNodeFromBcs\\(nodeId" \
    "permanent JSON-first ops: context remove wrapper prewrites BCS"
  assert_pattern "$CONTEXT_MENU_FILE" "await bridge\\.movePermanentNodeInBcs\\(nodeId, target" \
    "permanent JSON-first ops: context move wrapper prewrites BCS"
  assert_pattern "$DRAG_DROP_FILE" "async function createPermanentBookmarkNode\\(createPayload, options = \\{\\}\\)" \
    "permanent JSON-first ops: drag/drop uses create wrapper"
  assert_pattern "$DRAG_DROP_FILE" "await bridge\\.movePermanentNodeInBcs\\(nodeId, target" \
    "permanent JSON-first ops: drag/drop move prewrites BCS"
  assert_pattern "$HISTORY_FILE" "await bridge\\.preparePermanentCreateNodeInBcs\\(info, \\{\\}\\)" \
    "permanent JSON-first ops: quick-add prewrites BCS before Chrome create"
  assert_pattern "$TEMP_FILE" "const nodeSourceID = String\\(item\\.getAttribute \\? item\\.getAttribute\\('data-source-id'\\) \\|\\| '' : ''\\)\\.trim\\(\\);" \
    "permanent sourceID: drag-out payload reads DOM sourceID"
  assert_pattern "$SEARCH_FILE" "if \\(folderPayload\\.sourceID\\) createOptions\\.sourceID = folderPayload\\.sourceID;" \
    "permanent sourceID: search large-folder root preserves sourceID"
  assert_pattern "$SEARCH_FILE" "tempApi\\.createFolder\\(sectionId, '', folderTitle, createOptions\\)" \
    "permanent sourceID: search large-folder create passes sourceID options"
  assert_pattern "$TEMP_FILE" "async function __readPermanentTreeSnapshotFromBcs\\(options = \\{\\}\\)" \
    "permanent JSON: render/sync reads BCS tree source"
  assert_pattern "$TEMP_FILE" "async function __replacePermanentMainContentFromSyncPayload\\(payloadInput, options = \\{\\}\\)" \
    "permanent JSON: pull can replace local canonical content"
  assert_pattern "$TEMP_FILE" "async function __writePermanentTreeSnapshotAfterChromeApply\\(localTreeInput, remoteTreeInput, options = \\{\\}\\)" \
    "permanent JSON: Chrome-assigned ids are written back into BCS"
  assert_pattern "$TEMP_FILE" "async function __syncPermanentMainTreeFromChromeBookmarks\\(options = \\{\\}\\)" \
    "permanent JSON: native Chrome changes sync back to BCS"
  assert_no_match "updates\\[BCS_PERM_MAIN_KEY\\] = __buildBcsGuardedPayload" \
    "permanent JSON: main content is not stored as guarded state payload"
  assert_no_match "(^|[^_[:alnum:]])readPermanentNodeSourceIDMap\\(" \
    "permanent sourceID: legacy map is not exposed as a runtime bridge"
  assert_no_match "__writePermanentNodeSourceIDMap" \
    "permanent sourceID: legacy map is not written in target mode"
  assert_no_match "__permanentNodeSourceIDByChromeId" \
    "permanent sourceID: no runtime Chrome-id identity index"
  assert_pattern "$TEMP_FILE" "allowGenerate: options && options\\.allowGenerateSourceID === true" \
    "permanent sourceID: snapshot generation is opt-in"
  assert_pattern "$TEMP_FILE" "if \\(sourceID\\) bookmarkNode\\[PERMANENT_NODE_SOURCE_ID_KEY\\] = sourceID;" \
    "permanent sourceID: bookmark export preserves embedded sourceID"
  assert_pattern "$TEMP_FILE" "if \\(sourceID\\) node\\[PERMANENT_NODE_SOURCE_ID_KEY\\] = sourceID;" \
    "permanent sourceID: folder export preserves embedded sourceID"
  assert_pattern "$TEMP_FILE" "throw new Error\\('Permanent payload is missing sourceID'\\);" \
    "permanent sourceID: permanent-to-temp fails closed when sourceID is missing"
  assert_pattern "$TEMP_FILE" "resolvePermanentNodeSourceID\\(nodeInput, options = \\{\\}\\)" \
    "permanent sourceID: bridge resolver exposed"
  assert_pattern "$TEMP_FILE" "recordPermanentNodeSourceIDMappingWithOptions\\(chromeId, sourceID, options = \\{\\}\\)" \
    "permanent sourceID: existing bridge entry records pending ids only"
  assert_pattern "$TEMP_FILE" "persistPermanentSourceIDMapFromTree\\(localTreeInput, remoteTreeInput\\)" \
    "permanent sourceID: existing bridge entry writes canonical BCS tree"
  assert_pattern "$TEMP_FILE" "const clonePermanentNodeForTempPayload = \\(node\\) => \\{" \
    "permanent sourceID: canvas permanent-to-temp payload resolver exists"
  assert_pattern "$TEMP_FILE" "const sourceID = __resolvePermanentNodeSourceID\\(node, \\{ allowGenerate: false \\}\\);" \
    "permanent sourceID: canvas permanent-to-temp payload inherits embedded IDs without generation"
  assert_pattern "$TEMP_FILE" "node\\.children\\.map\\(clonePermanentNodeForTempPayload\\)" \
    "permanent sourceID: canvas permanent-to-temp payload handles folder descendants"
  assert_pattern "$TEMP_FILE" "function clonePermanentBookmarkNodeForTempPayload\\(node\\)" \
    "permanent sourceID: single-node temp creation resolver exists"
  assert_pattern "$TEMP_FILE" "async function resolveBookmarkNode\\(data, options = \\{\\}\\)" \
    "permanent sourceID: single-node bookmark resolver accepts sourceID mode"
  assert_pattern "$TEMP_FILE" "resolveBookmarkNode\\(data, \\{ resolvePermanentSourceID \\}\\)" \
    "permanent sourceID: new temporary section uses permanent resolver"
  assert_pattern "$TEMP_FILE" "const CANVAS_PAYLOAD_SOURCE_KEY = '__canvasPayloadSource';" \
    "permanent sourceID: temp payload source marker exists"
  assert_pattern "$TEMP_FILE" "function __resolveSourceIDForTempPayload\\(payloadInput, options = \\{\\}\\)" \
    "permanent sourceID: temp insert sourceID resolver is centralized"
  assert_pattern "$TEMP_FILE" "const regenerateSourceID = !!\\(options && options\\.regenerateSourceID === true\\) && !resolvePermanentSourceID;" \
    "permanent sourceID: permanent payloads cannot be regenerated by generic temp insert"
  assert_pattern "$TEMP_FILE" "clone\\[CANVAS_PAYLOAD_SOURCE_KEY\\] = 'permanent';" \
    "permanent sourceID: permanent drag payloads carry source marker"
  assert_pattern "$CONTEXT_MENU_FILE" "__canvasPayloadSource: 'permanent'," \
    "permanent sourceID: context-menu permanent payloads carry source marker"
  assert_pattern "$DRAG_DROP_FILE" "__canvasPayloadSource: 'permanent'," \
    "permanent sourceID: tree drag permanent payloads carry source marker"
  assert_pattern "$CONTEXT_MENU_FILE" "async function readPermanentNodeFromBcs\\(nodeId\\)" \
    "permanent sourceID: context-menu payloads can read embedded BCS sourceID"
  assert_pattern "$DRAG_DROP_FILE" "async function readPermanentNodeFromBcs\\(nodeId\\)" \
    "permanent sourceID: tree drag payloads can read embedded BCS sourceID"
  assert_pattern "$CONTEXT_MENU_FILE" "function markClipboardPayloadSource\\(itemsInput, sourceKind\\)" \
    "permanent sourceID: mixed clipboard payload tracks source kind"
  assert_pattern "$CONTEXT_MENU_FILE" "const permanentPayload = payload\\.filter\\(item => String\\(item && item\\.__canvasPayloadSource \\|\\| ''\\) === 'permanent'\\);" \
    "permanent sourceID: mixed paste separates permanent payload"
  assert_pattern "$CONTEXT_MENU_FILE" "manager\\.insertFromPayload\\(target\\.sectionId, target\\.parentId, permanentPayload, insertIndex, \\{" \
    "permanent sourceID: mixed permanent paste has independent insert options"
  assert_pattern "$CONTEXT_MENU_FILE" "const preserveSourceID = bookmarkClipboard\\.source === 'temporary' && bookmarkClipboard\\.action === 'cut';" \
    "permanent sourceID: temp cut-to-permanent preserves sourceID"
  assert_pattern "$SEARCH_FILE" "function buildSearchBookmarkPayload\\(item, isZh\\)" \
    "permanent sourceID: search temp payload builder is centralized"
  assert_pattern "$SEARCH_FILE" "const needsPermanentLookup = items\\.some\\(item => item && item\\.source === 'permanent'\\);" \
    "permanent sourceID: search temp creation looks up all permanent results"
  assert_pattern "$SEARCH_FILE" "payload\\.__canvasPayloadSource = 'permanent';" \
    "permanent sourceID: search permanent payloads carry source marker"
  assert_pattern "$SEARCH_FILE" "payloadItems\\.push\\(buildSearchBookmarkPayload\\(item, isZh\\)\\);" \
    "permanent sourceID: search bookmark fallback preserves permanent source"
  assert_pattern "$SYNC_FILE" "function attachPermanentSourceIDsForComparison\\(treeInput, options = \\{\\}\\)" \
    "permanent sourceID: local compare tree receives sourceID"
  assert_pattern "$SYNC_FILE" "async function readPermanentSourceIDMapFromBcsForComparison\\(\\)" \
    "permanent sourceID: local compare maps BCS embedded sourceIDs by Chrome id"
  assert_pattern "$SYNC_FILE" "sourceIDMap: localSourceIDMap" \
    "permanent sourceID: compare receives BCS sourceID map"
  assert_pattern "$SYNC_FILE" "allowGenerate: false" \
    "permanent sourceID: compare does not generate IDs"
  assert_pattern "$SYNC_FILE" "throw error;" \
    "permanent JSON: BCS replace failure aborts pull apply"
  assert_pattern "$SYNC_FILE" "bridge\\.rememberPendingPermanentNodeSourceID\\(chromeId, sourceID\\);" \
    "permanent sourceID: remote apply records pending ids without legacy map"
  assert_pattern "$SYNC_FILE" "bridge\\.writePermanentTreeSnapshotAfterChromeApply\\(localTree, remoteTree, \\{" \
    "permanent JSON: remote apply writes Chrome ids back into BCS tree"
  assert_pattern "$SYNC_FILE" "bookmarkComparable\\.sourceID = sourceID;" \
    "permanent sourceID: bookmark comparable includes sourceID"
  assert_pattern "$SYNC_FILE" "folderComparable\\.sourceID = sourceID;" \
    "permanent sourceID: folder comparable includes sourceID"
  assert_pattern "$SYNC_FILE" "await persistPermanentSourceIDMapAfterApply\\(localTree, remoteTree\\);" \
    "permanent JSON: same/no-change pull still cleans Chrome id writeback"
  assert_no_match "recordCreatedPermanentPayloadSourceID" \
    "permanent sourceID: temp/permanent copy-create does not inherit payload IDs"
  assert_pattern "$SYNC_FILE" "await recordCreatedPermanentNodeSourceID\\(created, node\\);" \
    "permanent sourceID: remote permanent apply records remote permanent IDs"

  section "Step6/Step7 closure hit-check"
  assert_pattern "$SYNC_FILE" "const OBSIDIAN_EXPORT_FORMAT_ORDER = \\['visual', 'visual-no-icon', 'json'\\];" \
    "sync export format: three-mode order wired (visual/visual-no-icon/json)"
  assert_pattern "$SYNC_FILE" "const OBSIDIAN_EXPORT_FORMATS = new Set\\(OBSIDIAN_EXPORT_FORMAT_ORDER\\);" \
    "sync export format: three-mode set wired (derived from order)"
  assert_no_match "if \\(format === 'visual' \\|\\| format === 'visual-no-icon'\\) return 'json';" \
    "sync export format: no forced downgrade from visual modes to json"
  assert_no_match "if \\(fallbackFormat === 'visual' \\|\\| fallbackFormat === 'visual-no-icon'\\) return 'json';" \
    "sync export format: fallback keeps three-mode semantics"
  assert_pattern "$SYNC_FILE" "visual-no-icon" \
    "sync export format: visual-no-icon branch exists"

  assert_pattern "$TEMP_FILE" "function __normalizeCanvasPluginMarkdownNodeFields\\(node, options = \\{\\}\\) \\{" \
    "blank markdownSource: plugin markdown normalizer exists"
  assert_pattern "$TEMP_FILE" "node\\.markdownSource = markdownSource;" \
    "blank markdownSource: normalizer writes markdownSource"
  assert_pattern "$TEMP_FILE" "node\\.markdownSource = nextNodeText;" \
    "blank markdownSource: editor sync writes markdownSource"
  assert_pattern "$TEMP_FILE" "cloned\\.markdownSource = __normalizeCanvasMarkdownSource\\(__deriveMdNodeMarkdownSource\\(cloned\\)\\);" \
    "blank markdownSource: persisted state keeps markdownSource"

  assert_pattern "$TEMP_FILE" "if \\(__isCanvasNativeTextNode\\(node\\)\\) \\{" \
    "native/plugin blank split: native-text branch exists"
  assert_pattern "$TEMP_FILE" "type: 'blank-native-text'," \
    "native/plugin blank split: native branch payload tag exists"
  assert_pattern "$TEMP_FILE" "type: 'blank'," \
    "native/plugin blank split: plugin blank payload tag exists"
  assert_pattern "$TEMP_FILE" "markdown: __buildMdNodeMarkdown\\(node\\)" \
    "native/plugin blank split: plugin blank uses markdown payload"

  printf '\n== Summary ==\n'
  printf 'PASS: %s\n' "$PASS_COUNT"
  printf 'FAIL: %s\n' "$FAIL_COUNT"

  if (( FAIL_COUNT > 0 )); then
    exit 1
  fi
}

main "$@"
