#!/usr/bin/env bash
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SYNC_FILE="history_html/sync/obsidian-git-sync.js"
TEMP_FILE="history_html/bookmark_canvas_module.js"
SEARCH_FILE="history_html/search/search.js"
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

assert_original_id_only_reserved() {
  local output
  local count
  output="$(rg -n --no-heading --pcre2 '\boriginalId\b' -g '!docs/**' -g "!${SELF_PATH}" . || true)"

  if [[ -z "$output" ]]; then
    fail "originalId back-check (expected one reserved-key hit, found none)"
    return
  fi

  count="$(printf '%s\n' "$output" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"
  if [[ "$count" != "1" ]]; then
    fail "originalId back-check (expected 1 hit, got ${count})"
    printf '%s\n' "$output"
    return
  fi

  if [[ "$output" =~ ^(\./)?history_html/bookmark_canvas_module\.js:[0-9]+: ]]; then
    pass "originalId back-check (only reserved key remains)"
  else
    fail "originalId back-check (unexpected location)"
    printf '%s\n' "$output"
  fi
}

assert_source_id_single_field_back_check() {
  local source_id_hits
  local source_id_leak_hits
  source_id_hits="$(rg -n --no-heading --pcre2 '\bsourceID\b' -g '!docs/**' -g "!${SELF_PATH}" . || true)"
  if [[ -z "$source_id_hits" ]]; then
    fail "sourceID single-field back-check (expected sourceID usage, found none)"
    return
  fi

  source_id_leak_hits="$(rg -n --no-heading --pcre2 "\\.sourceId\\b|sourceId\\s*:|'sourceId'" -g '!docs/**' -g "!${SELF_PATH}" . || true)"
  if [[ -n "$source_id_leak_hits" ]]; then
    source_id_leak_hits="$(printf '%s\n' "$source_id_leak_hits" | rg -v --no-heading --pcre2 "^(\\./)?history_html/bookmark_canvas_module\\.js:[0-9]+:.*(\\|\\|\\s*[A-Za-z0-9_]+\\.sourceId|hasOwnProperty\\.call\\(item, 'sourceId'\\)|delete item\\.sourceId;|item\\.sourceId = undefined;|sourceId:\\s*'bookmark-canvas-export')" || true)"
  fi

  if [[ -z "$source_id_leak_hits" ]]; then
    pass "sourceID single-field back-check (sourceID allowed; sourceId runtime leak blocked except compat read)"
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
  run_node_check "$SEARCH_FILE"
  run_node_check "$SYNC_FILE"

  section "originalId/sourceID back-check"
  assert_original_id_only_reserved
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
  assert_pattern "$TEMP_FILE" 'function __stripLegacyOriginalIdFromTempSection\(' \
    "legacy cleanup: originalId strip helper exists"
  assert_pattern "$TEMP_FILE" '__stripLegacyOriginalIdFromTempSection\(cloned\);' \
    "legacy cleanup: persisted sections strip originalId"
  assert_pattern "$SYNC_FILE" "const allowSnapshotHint = !!\\(options && options.allowSnapshotHint === true\\);" \
    "consistency precheck: realtime api-tree default enforced"
  assert_pattern "$SYNC_FILE" "if \\(text\\.includes\\('push'\\) \\|\\| text\\.includes\\('full'\\) \\|\\| text\\.includes\\('sync'\\)\\) return true;" \
    "push recovery lock: stage trigger coverage widened"

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
