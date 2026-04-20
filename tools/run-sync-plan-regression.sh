#!/usr/bin/env bash
set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SYNC_FILE="history_html/sync/obsidian-git-sync.js"
TEMP_FILE="history_html/bookmark_canvas_module.js"
GUARD_SCRIPT="tools/run-sync-guard-acceptance.sh"

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

assert_order() {
  local file="$1"
  local first_pattern="$2"
  local second_pattern="$3"
  local label="$4"
  local first_line
  local second_line

  first_line="$(rg -n --no-heading --pcre2 "$first_pattern" "$file" | head -n 1 | cut -d: -f1)"
  second_line="$(rg -n --no-heading --pcre2 "$second_pattern" "$file" | head -n 1 | cut -d: -f1)"

  if [[ -z "$first_line" || -z "$second_line" ]]; then
    fail "$label"
    printf '  line lookup failed: first=%s second=%s\n' "${first_line:-N/A}" "${second_line:-N/A}"
    return
  fi

  if (( first_line < second_line )); then
    pass "$label"
  else
    fail "$label"
    printf '  order mismatch: first=%s second=%s\n' "$first_line" "$second_line"
  fi
}

run_guard_script() {
  local out_file
  out_file="$(mktemp -t sync-guard-regression.XXXXXX.log)"
  if bash "$GUARD_SCRIPT" >"$out_file" 2>&1; then
    pass "guard acceptance script passes"
  else
    fail "guard acceptance script passes"
    tail -n 80 "$out_file"
  fi
  rm -f "$out_file"
}

main() {
  cd "$REPO_ROOT" || exit 1

  section "Prerequisites"
  require_cmd "bash"
  require_cmd "node"
  require_cmd "rg"

  section "Syntax check"
  run_node_check "$TEMP_FILE"
  run_node_check "$SYNC_FILE"

  section "Baseline guard"
  run_guard_script

  section "Flow order regression"
  assert_order "$SYNC_FILE" \
    "await applySnapshotToLocal\\(buildSnapshotForRemoteLocalApply\\(remoteSnapshot\\)\\);" \
    "const overwriteResult = await maybeOverwriteLocalPermanentTreeFromRemoteSnapshot\\(" \
    "conflict-remote: protocol apply runs before permanent overwrite"
  assert_order "$SYNC_FILE" \
    "const rawApplyResult = await bridge.applySyncFilesReplace\\(" \
    "await maybeOverwriteLocalPermanentTreeFromRemoteSnapshot\\(remotePermanentTreeSnapshot, trigger" \
    "pull-main: file replace runs before permanent overwrite"
  assert_order "$SYNC_FILE" \
    "await applySnapshotToLocal\\(buildSnapshotForRemoteLocalApply\\(stagedSnapshot\\)\\);" \
    "await maybeOverwriteLocalPermanentTreeFromRemoteSnapshot\\(remotePermanentTreeSnapshot, trigger" \
    "pull-main fallback: snapshot apply runs before permanent overwrite"

  section "SourceID hooks"
  assert_pattern "$SYNC_FILE" \
    "async function ensureTempSourceIDIntegrityAfterRemoteApply\\(trigger = 'remote-apply'\\)" \
    "sourceID integrity helper exists"
  assert_pattern "$SYNC_FILE" \
    "await ensureTempSourceIDIntegrityAfterRemoteApply\\(trigger\\);" \
    "sourceID integrity check runs in pull-main apply path"
  assert_pattern "$SYNC_FILE" \
    "await ensureTempSourceIDIntegrityAfterRemoteApply\\('manual-conflict-use-remote'\\);" \
    "sourceID integrity check runs in conflict-remote path"
  assert_pattern "$TEMP_FILE" \
    "window\\.CanvasObsidianExportBridge\\.validateTempSourceIDIntegrity = function \\(options = \\{\\}\\)" \
    "sourceID validation bridge is exposed"

  section "Canonical contract mapper"
  assert_pattern "$TEMP_FILE" \
    "function __buildCanonicalSyncContract\\(input = \\{\\}, options = \\{\\}\\)" \
    "canonical contract builder exists"
  assert_pattern "$TEMP_FILE" \
    "function __buildCanonicalSyncContractFromCloudSnapshot\\(snapshot\\)" \
    "cloud -> canonical mapper exists"
  assert_pattern "$TEMP_FILE" \
    "function __buildCanonicalSyncContractFromBackupPayload\\(primaryStateInput, storageInput = null\\)" \
    "backup -> canonical mapper exists"
  assert_pattern "$TEMP_FILE" \
    "function __buildImportPayloadFromCanonicalSyncContract\\(contractInput, options = \\{\\}\\)" \
    "canonical -> import payload mapper exists"
  assert_pattern "$TEMP_FILE" \
    "const canonical = __buildCanonicalSyncContractFromBackupPayload\\(primaryState, storage\\);" \
    "manual JSON import path goes through canonical mapper"
  assert_pattern "$TEMP_FILE" \
    "const canonical = __buildCanonicalSyncContractFromCloudSnapshot\\(snapshot\\);" \
    "cloud snapshot import path goes through canonical mapper"

  printf '\n== Summary ==\n'
  printf 'PASS: %s\n' "$PASS_COUNT"
  printf 'FAIL: %s\n' "$FAIL_COUNT"

  if (( FAIL_COUNT > 0 )); then
    exit 1
  fi
}

main "$@"
