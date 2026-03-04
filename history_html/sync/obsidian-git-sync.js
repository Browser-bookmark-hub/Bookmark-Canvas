(function (global) {
    const SETTINGS_KEY = 'canvas-obsidian-git-sync-settings-v1';
    const RUNTIME_KEY = 'canvas-obsidian-git-sync-runtime-v1';
    const CONFLICT_LOG_KEY = 'canvas-obsidian-git-sync-conflicts-v1';
    const PENDING_CONFLICT_KEY = 'canvas-obsidian-git-sync-pending-conflict-v1';
    const RECOVERY_KEY = 'canvas-obsidian-git-sync-recovery-v1';
    const CLIENT_ID_KEY = 'canvas-obsidian-git-sync-client-id-v1';
    const TAB_ACTIVE_KEY = 'canvas-obsidian-git-sync-active-tab-v1';
    const OBSIDIAN_FILE_HASHES_KEY = 'canvas-obsidian-git-sync-obsidian-file-hashes-v1';
    const LAST_UPLOADED_TEMP_STATE_KEY = 'canvas-obsidian-git-sync-last-uploaded-temp-state-v1';
    const DIRTY_STATE_KEY = 'canvas-obsidian-git-sync-dirty-v1';
    const PATH_MAP_KEY = 'canvas-obsidian-git-sync-path-map-v1';
    const PREV_SYNC_INDEX_KEY = 'canvas-obsidian-git-sync-prev-index-v1';
    const SYNC_META_KEYS = [
        SETTINGS_KEY,
        RUNTIME_KEY,
        CONFLICT_LOG_KEY,
        PENDING_CONFLICT_KEY,
        RECOVERY_KEY,
        CLIENT_ID_KEY,
        TAB_ACTIVE_KEY,
        OBSIDIAN_FILE_HASHES_KEY,
        LAST_UPLOADED_TEMP_STATE_KEY,
        DIRTY_STATE_KEY,
        PATH_MAP_KEY,
        PREV_SYNC_INDEX_KEY
    ];

    const REPO_CONFIG_KEYS = [
        'githubRepoToken',
        'githubRepoOwner',
        'githubRepoName',
        'githubRepoBranch',
        'githubRepoBasePath'
    ];

    const SYNC_TAB_KEYS = ['repo', 'behavior', 'status'];
    const DEFAULT_ACTIVE_TAB = 'repo';
    const BEHAVIOR_SUBNAV_CONFIG = [
        { buttonId: 'canvasSyncBehaviorSubGeneralBtn', targetId: 'canvasSyncSectionGeneralTitle' },
        { buttonId: 'canvasSyncBehaviorSubPluginBtn', targetId: 'canvasSyncPluginSectionTitle' },
        { buttonId: 'canvasSyncBehaviorSubCompatBtn', targetId: 'canvasSyncSectionCompatTitle' }
    ];
    const BEHAVIOR_SUBNAV_COMPAT_CONFIG = [
        { buttonId: 'canvasSyncBehaviorSubCompatDetail1Btn', targetId: 'canvasSyncSectionCompatDetectTitle' },
        { buttonId: 'canvasSyncBehaviorSubCompatDetail2Btn', targetId: 'canvasSyncSectionCompatBgDetectTitle' },
        { buttonId: 'canvasSyncBehaviorSubCompatDetail3Btn', targetId: 'canvasSyncSectionCompatMismatchTitle' },
        { buttonId: 'canvasSyncBehaviorSubCompatDetail4Btn', targetId: 'canvasSyncSectionCompatMergeTitle' }
    ];

    const TEMP_SECTION_STORAGE_KEY = 'bookmark-canvas-temp-sections';

    const SYNC_KEYS = [
        TEMP_SECTION_STORAGE_KEY,
        'canvas-appearance-settings-v1',
        'canvas-other-settings-v1',
        'permanent-section-position',
        'permanent-section-copies',
        'canvas-permanent-tip-text'
    ];

    const CONFLICT_POLICIES = new Set(['none', 'ours', 'theirs']);
    const MISMATCH_POLICIES = new Set(['auto_pull', 'auto_push', 'prompt']);
    const SYNC_METHODS = new Set(['merge', 'rebase', 'reset']);
    const FIRST_SYNC_MODES = new Set(['auto', 'cloud', 'local']);
    const PERMANENT_PULL_MODES = new Set(['auto', 'overwrite', 'incremental']);
    const MAX_RECOVERY_RECORDS = 5;
    const DEFAULT_PERMANENT_INCREMENTAL_MAX_LOGICAL_CHANGES_ABS = 200;
    const PERMANENT_TREE_UPLOAD_INTERVALS = new Set([0, 5, 15, 30, 60]);
    const OBSIDIAN_EXPORT_FORMATS = new Set(['visual-no-icon', 'visual', 'editable']);
    const CUSTOM_UPLOAD_INTERVAL_SECONDS_RANGE = { min: 0, max: 24 * 60 * 60 };
    const SYNC_FILE_TOO_LARGE_ERROR_CODE = 'SYNC_FILE_TOO_LARGE';
    const OVERSIZE_SYNC_DIALOG_COOLDOWN_MS = 30 * 1000;

    const DEFAULT_SETTINGS = {
        enabled: false,
        autoSync: true,
        syncAfterEditStop: true,
        intervalSeconds: 120,
        debounceMs: 800,
        batchDebounceMs: 5000,
        splitIntervalCommitAndSync: false,
        autoPushIntervalMinutes: 2,
        autoPullIntervalMinutes: 5,
        mismatchPolicy: 'prompt',
        foregroundCheckEnabled: true,
        foregroundCheckIntervalSeconds: 30,
        backgroundCheckEnabled: true,
        backgroundCheckIntervalMinutes: 1,
        backgroundCooldownMinutes: 5,
        pullOnStartup: false,
        pushOnSync: true,
        pullOnSync: true,
        hideNoChangeNotice: true,
        firstSyncMode: 'auto',
        permanentPullMode: 'auto',
        permanentIncrementalMaxChanges: DEFAULT_PERMANENT_INCREMENTAL_MAX_LOGICAL_CHANGES_ABS,
        permanentTreeUploadIntervalSeconds: 15,
        tempSectionUploadIntervalSeconds: 5,
        blankSectionUploadIntervalSeconds: 5,
        obsidianFilePushEnabled: true,
        obsidianExportFormat: 'visual-no-icon',
        obsidianExportRoot: '书签画布',
        firstSyncPathVerifiedRoot: '',
        firstSyncPathVerifiedAt: 0,
        syncMethod: 'merge',
        conflictPolicy: 'none',
        deleteThresholdPercent: 20
    };

    const DEFAULT_RUNTIME = {
        isRunning: false,
        queueLength: 0,
        lastSuccessAt: 0,
        lastError: '',
        lastTrigger: '',
        lastRemoteSha: '',
        lastLocalHash: '',
        lastLocalFilesSha: '',
        lastCheckRemoteSha: '',
        lastAppliedDirection: '',
        lastSyncMode: '',
        lastLocalMutationAt: 0,
        lastPermanentTreeSnapshotAt: 0,
        lastTempSectionSnapshotAt: 0,
        lastObsidianPushAt: 0,
        lastObsidianPushChanged: 0,
        lastObsidianPushTotal: 0,
        hasPendingConflict: false,
        pendingMismatch: false,
        pendingMismatchAt: 0,
        pendingMismatchRemoteSha: ''
    };

    let settings = null;
    let runtime = null;
    let pendingConflict = null;
    let syncTimer = null;
    let retryTimer = null;
    let fallbackTimer = null;
    let autoPushTimer = null;
    let autoPullTimer = null;
    let startupPullTimer = null;
    let foregroundMismatchTimer = null;
    let panelBound = false;
    let repoConfig = null;
    let activeTabKey = DEFAULT_ACTIVE_TAB;
    let mismatchPromptShownOnInit = false;
    let conflictPromptShownOnInit = false;
    let previewPanelMode = '';
    let previewConflict = null;
    let behaviorSubNavScrollRaf = null;
    let oversizeSyncDialogLastAt = 0;
    let oversizeSyncDialogLastKey = '';
    let lastRecoverySnapshotWarningAt = 0;
    let syncMetaStorageHydrated = false;
    let syncMetaStorageCache = Object.create(null);
    let syncMetaPendingSet = Object.create(null);
    let syncMetaPendingRemove = new Set();
    let syncMetaWriteTimer = null;
    const pendingReasons = new Set();
    let floatingProgressEl = null;
    let floatingProgressLabelEl = null;
    let floatingProgressPercentEl = null;
    let floatingProgressActive = false;
    let floatingProgressMessage = '';
    let floatingProgressPercent = null;
    let syncUiProgressEnabled = false;
    let syncUiProgressButtonEl = null;

    function getRuntimeApi() {
        return global.chrome || global.browser || null;
    }

    function safeParse(raw, fallback) {
        if (!raw) return fallback;
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function queueSyncMetaPersist(key, rawValue, remove = false) {
        if (!key) return;
        if (remove) {
            delete syncMetaPendingSet[key];
            syncMetaPendingRemove.add(key);
        } else {
            syncMetaPendingRemove.delete(key);
            syncMetaPendingSet[key] = String(rawValue == null ? '' : rawValue);
        }

        if (syncMetaWriteTimer) return;
        syncMetaWriteTimer = setTimeout(() => {
            syncMetaWriteTimer = null;
            flushSyncMetaPersist();
        }, 180);
    }

    function flushSyncMetaPersist() {
        const api = getRuntimeApi();
        const keysToRemove = Array.from(syncMetaPendingRemove);
        const payload = Object.assign({}, syncMetaPendingSet);

        syncMetaPendingRemove = new Set();
        syncMetaPendingSet = Object.create(null);

        const hasRemove = keysToRemove.length > 0;
        const hasSet = Object.keys(payload).length > 0;
        if (!hasRemove && !hasSet) return;

        if (!api || !api.storage || !api.storage.local) return;

        const storage = api.storage.local;
        if (hasSet) {
            try {
                const maybePromise = storage.set(payload, () => { });
                if (maybePromise && typeof maybePromise.catch === 'function') {
                    maybePromise.catch(() => { });
                }
            } catch (_) { }
        }
        if (hasRemove) {
            try {
                const maybePromise = storage.remove(keysToRemove, () => { });
                if (maybePromise && typeof maybePromise.catch === 'function') {
                    maybePromise.catch(() => { });
                }
            } catch (_) { }
        }
    }

    function getSyncMetaRaw(key) {
        if (!key) return null;
        if (!syncMetaStorageHydrated) return null;
        if (Object.prototype.hasOwnProperty.call(syncMetaStorageCache, key)) {
            return syncMetaStorageCache[key];
        }
        return null;
    }

    function setSyncMetaRaw(key, rawValue) {
        if (!key) return;
        if (rawValue === null || typeof rawValue === 'undefined') {
            delete syncMetaStorageCache[key];
            queueSyncMetaPersist(key, '', true);
            return;
        }
        const normalized = String(rawValue);
        syncMetaStorageCache[key] = normalized;
        queueSyncMetaPersist(key, normalized, false);
    }

    async function hydrateSyncMetaStorage() {
        if (syncMetaStorageHydrated) return;
        syncMetaStorageHydrated = true;

        const keys = SYNC_META_KEYS.slice();
        let storageLocalState = {};
        try {
            storageLocalState = await storageLocalGet(keys);
        } catch (_) {
            storageLocalState = {};
        }

        const nextCache = Object.create(null);
        keys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(storageLocalState, key) && storageLocalState[key] != null) {
                nextCache[key] = String(storageLocalState[key]);
            }
        });

        syncMetaStorageCache = nextCache;
    }

    function normalizeSyncPath(path) {
        return String(path || '')
            .trim()
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .replace(/\/+$/, '')
            .replace(/\/+/g, '/');
    }

    function ensureConflictPolicy(policy) {
        const value = String(policy || '').trim().toLowerCase();
        if (value === 'manual_panel' || value === 'keep_newer' || value === 'keep_larger' || value === 'keep_both') {
            return 'none';
        }
        return CONFLICT_POLICIES.has(value) ? value : DEFAULT_SETTINGS.conflictPolicy;
    }

    function ensureSyncMethod(method) {
        const value = String(method || '').trim().toLowerCase();
        if (value === 'other_sync_service') {
            return 'reset';
        }
        return SYNC_METHODS.has(value) ? value : DEFAULT_SETTINGS.syncMethod;
    }

    function ensureFirstSyncMode(mode) {
        const value = String(mode || '').trim().toLowerCase();
        return FIRST_SYNC_MODES.has(value) ? value : DEFAULT_SETTINGS.firstSyncMode;
    }

    function ensurePermanentPullMode(mode) {
        const value = String(mode || '').trim().toLowerCase();
        return PERMANENT_PULL_MODES.has(value) ? value : DEFAULT_SETTINGS.permanentPullMode;
    }

    function normalizePermanentIncrementalMaxChanges(value, fallback = DEFAULT_SETTINGS.permanentIncrementalMaxChanges) {
        const parsed = toSafeInt(value, fallback);
        return Math.max(1, Math.min(20000, parsed));
    }

    function ensureMismatchPolicy(policy) {
        const value = String(policy || '').trim().toLowerCase();
        return MISMATCH_POLICIES.has(value) ? value : DEFAULT_SETTINGS.mismatchPolicy;
    }

    function toSafeInt(value, fallback) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return fallback;
        return parsed;
    }

    function normalizeIntervalMinutes(value, fallback = 0) {
        const minutes = toSafeInt(value, fallback);
        return Math.max(0, Math.min(24 * 60, minutes));
    }

    function normalizeSplitIntervalMinutes(value, fallback) {
        const safeFallback = normalizeIntervalMinutes(fallback, 0);
        const minutes = toSafeInt(value, safeFallback);
        return Math.max(0, Math.min(24 * 60, minutes));
    }

    function normalizeBackgroundMinutes(value, fallback, min = 1) {
        const safeMin = Math.max(1, toSafeInt(min, 1));
        const safeFallback = Math.max(safeMin, Math.min(24 * 60, toSafeInt(fallback, safeMin)));
        const minutes = toSafeInt(value, safeFallback);
        return Math.max(safeMin, Math.min(24 * 60, minutes));
    }

    function normalizeForegroundCheckSeconds(value, fallback = 30) {
        const safeFallback = Math.max(5, Math.min(3600, toSafeInt(fallback, 30)));
        const seconds = toSafeInt(value, safeFallback);
        return Math.max(5, Math.min(3600, seconds));
    }

    function normalizePermanentTreeUploadIntervalSeconds(value, fallback = DEFAULT_SETTINGS.permanentTreeUploadIntervalSeconds) {
        const seconds = toSafeInt(value, fallback);
        if (PERMANENT_TREE_UPLOAD_INTERVALS.has(seconds)) {
            return seconds;
        }
        return fallback;
    }

    function normalizeCustomUploadIntervalSeconds(value, fallback = 5) {
        const safeFallback = Math.max(
            CUSTOM_UPLOAD_INTERVAL_SECONDS_RANGE.min,
            Math.min(CUSTOM_UPLOAD_INTERVAL_SECONDS_RANGE.max, toSafeInt(fallback, 5))
        );
        const seconds = toSafeInt(value, safeFallback);
        return Math.max(
            CUSTOM_UPLOAD_INTERVAL_SECONDS_RANGE.min,
            Math.min(CUSTOM_UPLOAD_INTERVAL_SECONDS_RANGE.max, seconds)
        );
    }

    function normalizeObsidianExportFormat(value, fallback = DEFAULT_SETTINGS.obsidianExportFormat) {
        const format = String(value || '').trim().toLowerCase();
        return OBSIDIAN_EXPORT_FORMATS.has(format) ? format : fallback;
    }

    function normalizeObsidianExportRoot(path, fallback = DEFAULT_SETTINGS.obsidianExportRoot, options = {}) {
        const allowEmpty = !!(options && options.allowEmpty);
        const normalizeLegacyRoot = (value) => {
            const normalized = normalizeSyncPath(value);
            if (normalized === 'bookmark-canvas-sync') return '书签画布';
            if (normalized === 'bookmark-canvas') return '书签画布';
            if (normalized === '书签画布同步') return '书签画布';
            return normalized;
        };
        if (typeof path === 'string') {
            const normalizedInput = normalizeLegacyRoot(path);
            if (allowEmpty && !normalizedInput) return '';
            if (normalizedInput) return normalizedInput;
        }
        if (allowEmpty && typeof path === 'string') return '';
        return normalizeLegacyRoot(fallback)
            || normalizeLegacyRoot(DEFAULT_SETTINGS.obsidianExportRoot)
            || '书签画布';
    }

    function loadSettings() {
        const parsed = safeParse(getSyncMetaRaw(SETTINGS_KEY), null);
        const merged = Object.assign({}, DEFAULT_SETTINGS, parsed || {});

        merged.conflictPolicy = ensureConflictPolicy(merged.conflictPolicy);
        merged.syncMethod = ensureSyncMethod(merged.syncMethod);
        merged.syncAfterEditStop = merged.syncAfterEditStop !== false;
        merged.splitIntervalCommitAndSync = !!merged.splitIntervalCommitAndSync;
        merged.autoPushIntervalMinutes = normalizeSplitIntervalMinutes(merged.autoPushIntervalMinutes, DEFAULT_SETTINGS.autoPushIntervalMinutes);
        merged.autoPullIntervalMinutes = normalizeSplitIntervalMinutes(merged.autoPullIntervalMinutes, DEFAULT_SETTINGS.autoPullIntervalMinutes);
        merged.intervalSeconds = Math.max(60, toSafeInt(merged.intervalSeconds, DEFAULT_SETTINGS.intervalSeconds));
        if (merged.intervalSeconds === 180) {
            merged.intervalSeconds = 120;
        }
        merged.pullOnStartup = !!merged.pullOnStartup;
        merged.pushOnSync = merged.pushOnSync !== false;
        merged.pullOnSync = merged.pullOnSync !== false;
        merged.hideNoChangeNotice = !!merged.hideNoChangeNotice;

        merged.firstSyncMode = ensureFirstSyncMode(merged.firstSyncMode);
        merged.permanentPullMode = ensurePermanentPullMode(merged.permanentPullMode);
        merged.permanentIncrementalMaxChanges = normalizePermanentIncrementalMaxChanges(
            merged.permanentIncrementalMaxChanges,
            DEFAULT_SETTINGS.permanentIncrementalMaxChanges
        );
        merged.mismatchPolicy = ensureMismatchPolicy(merged.mismatchPolicy);
        merged.foregroundCheckEnabled = merged.foregroundCheckEnabled !== false;
        merged.foregroundCheckIntervalSeconds = normalizeForegroundCheckSeconds(
            merged.foregroundCheckIntervalSeconds,
            DEFAULT_SETTINGS.foregroundCheckIntervalSeconds
        );
        merged.backgroundCheckEnabled = merged.backgroundCheckEnabled !== false;
        merged.backgroundCheckIntervalMinutes = normalizeBackgroundMinutes(
            merged.backgroundCheckIntervalMinutes,
            DEFAULT_SETTINGS.backgroundCheckIntervalMinutes,
            1
        );
        merged.backgroundCooldownMinutes = normalizeBackgroundMinutes(
            merged.backgroundCooldownMinutes,
            DEFAULT_SETTINGS.backgroundCooldownMinutes,
            1
        );

        if (typeof merged.permanentTreeUploadIntervalSeconds === 'undefined') {
            if (typeof merged.syncPermanentTreeOnPush === 'boolean') {
                merged.permanentTreeUploadIntervalSeconds = merged.syncPermanentTreeOnPush ? 15 : 0;
            } else {
                merged.permanentTreeUploadIntervalSeconds = DEFAULT_SETTINGS.permanentTreeUploadIntervalSeconds;
            }
        }
        merged.permanentTreeUploadIntervalSeconds = normalizePermanentTreeUploadIntervalSeconds(
            merged.permanentTreeUploadIntervalSeconds,
            DEFAULT_SETTINGS.permanentTreeUploadIntervalSeconds
        );
        merged.tempSectionUploadIntervalSeconds = normalizeCustomUploadIntervalSeconds(
            merged.tempSectionUploadIntervalSeconds,
            DEFAULT_SETTINGS.tempSectionUploadIntervalSeconds
        );
        merged.blankSectionUploadIntervalSeconds = normalizeCustomUploadIntervalSeconds(
            merged.blankSectionUploadIntervalSeconds,
            DEFAULT_SETTINGS.blankSectionUploadIntervalSeconds
        );
        merged.obsidianFilePushEnabled = merged.obsidianFilePushEnabled !== false;
        merged.obsidianExportFormat = normalizeObsidianExportFormat(merged.obsidianExportFormat, DEFAULT_SETTINGS.obsidianExportFormat);
        merged.obsidianExportRoot = normalizeObsidianExportRoot(
            merged.obsidianExportRoot,
            DEFAULT_SETTINGS.obsidianExportRoot,
            { allowEmpty: true }
        );
        merged.firstSyncPathVerifiedRoot = normalizeSyncPath(merged.firstSyncPathVerifiedRoot);
        merged.firstSyncPathVerifiedAt = Math.max(0, toSafeInt(merged.firstSyncPathVerifiedAt, 0));

        return merged;
    }

    function saveSettings() {
        setSyncMetaRaw(SETTINGS_KEY, JSON.stringify(settings));
    }

    function loadRuntime() {
        const parsed = safeParse(getSyncMetaRaw(RUNTIME_KEY), null);
        return Object.assign({}, DEFAULT_RUNTIME, parsed || {});
    }

    function saveRuntime() {
        setSyncMetaRaw(RUNTIME_KEY, JSON.stringify(runtime));
    }

    function loadActiveTab() {
        const raw = String(getSyncMetaRaw(TAB_ACTIVE_KEY) || '').trim();
        return SYNC_TAB_KEYS.includes(raw) ? raw : DEFAULT_ACTIVE_TAB;
    }

    function saveActiveTab(tabKey) {
        const nextTab = SYNC_TAB_KEYS.includes(tabKey) ? tabKey : DEFAULT_ACTIVE_TAB;
        setSyncMetaRaw(TAB_ACTIVE_KEY, nextTab);
    }

    function loadObsidianFileHashes() {
        const parsed = safeParse(getSyncMetaRaw(OBSIDIAN_FILE_HASHES_KEY), {});
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        return parsed;
    }

    function saveObsidianFileHashes(map) {
        const safeMap = (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
        setSyncMetaRaw(OBSIDIAN_FILE_HASHES_KEY, JSON.stringify(safeMap));
    }

    function uniqueStringList(values, normalizer) {
        if (!Array.isArray(values)) return [];
        const normalize = typeof normalizer === 'function'
            ? normalizer
            : ((value) => String(value == null ? '' : value).trim());
        const output = [];
        const seen = new Set();
        values.forEach((value) => {
            const normalized = normalize(value);
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            output.push(normalized);
        });
        return output;
    }

    function createDefaultDirtyState() {
        return {
            canvas: {
                layoutDirty: false,
                fileRefDirty: false
            },
            permanent: {
                all: false,
                paths: []
            },
            temporary: {
                all: false,
                ids: []
            },
            blank: {
                all: false,
                ids: []
            },
            paths: [],
            updatedAt: 0
        };
    }

    function normalizeDirtyState(raw) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const canvasSource = (source.canvas && typeof source.canvas === 'object') ? source.canvas : {};
        const permanentSource = (source.permanent && typeof source.permanent === 'object') ? source.permanent : {};
        const temporarySource = (source.temporary && typeof source.temporary === 'object') ? source.temporary : {};
        const blankSource = (source.blank && typeof source.blank === 'object') ? source.blank : {};

        return {
            canvas: {
                layoutDirty: canvasSource.layoutDirty === true,
                fileRefDirty: canvasSource.fileRefDirty === true
            },
            permanent: {
                all: permanentSource.all === true,
                paths: uniqueStringList(permanentSource.paths, normalizeSyncPath)
            },
            temporary: {
                all: temporarySource.all === true,
                ids: uniqueStringList(temporarySource.ids)
            },
            blank: {
                all: blankSource.all === true,
                ids: uniqueStringList(blankSource.ids)
            },
            paths: uniqueStringList(source.paths, normalizeSyncPath),
            updatedAt: Number(source.updatedAt) || 0
        };
    }

    function loadDirtyState() {
        return normalizeDirtyState(safeParse(getSyncMetaRaw(DIRTY_STATE_KEY), createDefaultDirtyState()));
    }

    function saveDirtyState(state) {
        setSyncMetaRaw(DIRTY_STATE_KEY, JSON.stringify(normalizeDirtyState(state)));
    }

    function hasLocalDirtyWork(dirtyState = null) {
        const dirty = dirtyState ? normalizeDirtyState(dirtyState) : loadDirtyState();
        return dirty.canvas.layoutDirty
            || dirty.canvas.fileRefDirty
            || dirty.permanent.all
            || dirty.temporary.all
            || dirty.blank.all
            || dirty.permanent.paths.length > 0
            || dirty.temporary.ids.length > 0
            || dirty.blank.ids.length > 0
            || dirty.paths.length > 0;
    }

    function updateDirtyState(mutator) {
        const draft = loadDirtyState();
        if (typeof mutator === 'function') {
            mutator(draft);
        }
        draft.updatedAt = Date.now();
        const normalized = normalizeDirtyState(draft);
        saveDirtyState(normalized);
        return normalized;
    }

    function createDefaultPathMap() {
        return {
            canvasPath: '',
            permanentPaths: [],
            temporaryById: {},
            temporarySerialById: {},
            blankById: {},
            updatedAt: 0
        };
    }

    function normalizeStringMap(rawMap, valueNormalizer) {
        const source = (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) ? rawMap : {};
        const normalizeValue = typeof valueNormalizer === 'function'
            ? valueNormalizer
            : ((value) => String(value == null ? '' : value).trim());
        const output = {};
        Object.keys(source).forEach((key) => {
            const normalizedKey = String(key || '').trim();
            if (!normalizedKey) return;
            const normalizedValue = normalizeValue(source[key]);
            if (!normalizedValue) return;
            output[normalizedKey] = normalizedValue;
        });
        return output;
    }

    function normalizePathMap(raw) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        return {
            canvasPath: normalizeSyncPath(source.canvasPath),
            permanentPaths: uniqueStringList(source.permanentPaths, normalizeSyncPath),
            temporaryById: normalizeStringMap(source.temporaryById, normalizeSyncPath),
            temporarySerialById: normalizeStringMap(source.temporarySerialById, normalizeTemporarySerial),
            blankById: normalizeStringMap(source.blankById, normalizeSyncPath),
            updatedAt: Number(source.updatedAt) || 0
        };
    }

    function loadPathMap() {
        return normalizePathMap(safeParse(getSyncMetaRaw(PATH_MAP_KEY), createDefaultPathMap()));
    }

    function savePathMap(pathMap) {
        setSyncMetaRaw(PATH_MAP_KEY, JSON.stringify(normalizePathMap(pathMap)));
    }

    function createDefaultPrevSyncIndex() {
        return {
            files: {},
            updatedAt: 0
        };
    }

    function normalizePrevSyncIndex(raw) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const filesSource = (source.files && typeof source.files === 'object' && !Array.isArray(source.files))
            ? source.files
            : {};
        const files = {};

        Object.keys(filesSource).forEach((pathKey) => {
            const normalizedPath = normalizeSyncPath(pathKey);
            if (!normalizedPath) return;
            const entrySource = (filesSource[pathKey] && typeof filesSource[pathKey] === 'object') ? filesSource[pathKey] : {};
            files[normalizedPath] = {
                hash: String(entrySource.hash || ''),
                sha: String(entrySource.sha || ''),
                size: Math.max(0, Number(entrySource.size) || 0),
                mtime: Math.max(0, Number(entrySource.mtime) || 0),
                syncedAt: Math.max(0, Number(entrySource.syncedAt) || 0)
            };
        });

        return {
            files,
            updatedAt: Number(source.updatedAt) || 0
        };
    }

    function loadPrevSyncIndex() {
        return normalizePrevSyncIndex(safeParse(getSyncMetaRaw(PREV_SYNC_INDEX_KEY), createDefaultPrevSyncIndex()));
    }

    function savePrevSyncIndex(indexState) {
        setSyncMetaRaw(PREV_SYNC_INDEX_KEY, JSON.stringify(normalizePrevSyncIndex(indexState)));
    }

    function normalizeObsidianFileMeta(rawMeta) {
        if (!rawMeta || typeof rawMeta !== 'object') return null;

        const type = String(rawMeta.type || '').trim().toLowerCase();
        if (!type) return null;

        const meta = { type };
        if (type === 'temporary') {
            const sectionId = String(rawMeta.sectionId || '').trim();
            if (sectionId) meta.sectionId = sectionId;
            const sectionSerial = normalizeTemporarySerial(rawMeta.sectionSerial || rawMeta.sectionLabel);
            if (sectionSerial) meta.sectionSerial = sectionSerial;
        } else if (type === 'blank') {
            const nodeId = String(rawMeta.nodeId || '').trim();
            if (nodeId) meta.nodeId = nodeId;
        } else if (type === 'permanent') {
            const slot = Number.parseInt(rawMeta.slot, 10);
            if (Number.isFinite(slot) && slot > 0) meta.slot = slot;
            const copyId = String(rawMeta.copyId || '').trim();
            if (copyId) meta.copyId = copyId;
        }

        return meta;
    }

    function buildPathMapFromObsidianFiles(files) {
        const next = createDefaultPathMap();
        const source = Array.isArray(files) ? files : [];

        source.forEach((file) => {
            const path = normalizeSyncPath(file && file.path);
            if (!path) return;
            const meta = normalizeObsidianFileMeta(file && file.meta);
            if (!meta) {
                if (!next.canvasPath && /\.canvas$/i.test(path)) {
                    next.canvasPath = path;
                }
                return;
            }

            if (meta.type === 'canvas') {
                next.canvasPath = path;
                return;
            }
            if (meta.type === 'permanent') {
                next.permanentPaths.push(path);
                return;
            }
            if (meta.type === 'temporary' && meta.sectionId) {
                next.temporaryById[meta.sectionId] = path;
                const sectionSerial = meta.sectionSerial || normalizeTemporarySerial(extractFileBaseName(path));
                if (sectionSerial) {
                    next.temporarySerialById[meta.sectionId] = sectionSerial;
                }
                return;
            }
            if (meta.type === 'blank' && meta.nodeId) {
                next.blankById[meta.nodeId] = path;
            }
        });

        next.permanentPaths = uniqueStringList(next.permanentPaths, normalizeSyncPath);
        next.updatedAt = Date.now();
        return normalizePathMap(next);
    }

    function updateDirtyStateByReason(reason, options = {}) {
        const trigger = String(reason || '').toLowerCase();
        const dirtyPatch = options && options.dirty && typeof options.dirty === 'object' ? options.dirty : null;
        const dirtyPaths = uniqueStringList(options && options.dirtyPaths, normalizeSyncPath);

        return updateDirtyState((dirty) => {
            if (dirtyPaths.length) {
                dirty.paths = uniqueStringList([].concat(dirty.paths || [], dirtyPaths), normalizeSyncPath);
            }

            if (dirtyPatch) {
                const patchCanvas = dirtyPatch.canvas && typeof dirtyPatch.canvas === 'object' ? dirtyPatch.canvas : {};
                if (dirtyPatch.canvasLayout === true || patchCanvas.layoutDirty === true) {
                    dirty.canvas.layoutDirty = true;
                }
                if (dirtyPatch.canvasFileRef === true || patchCanvas.fileRefDirty === true) {
                    dirty.canvas.fileRefDirty = true;
                }

                if (dirtyPatch.permanentAll === true) {
                    dirty.permanent.all = true;
                }
                if (Array.isArray(dirtyPatch.permanentPaths)) {
                    dirty.permanent.paths = uniqueStringList([].concat(dirty.permanent.paths || [], dirtyPatch.permanentPaths), normalizeSyncPath);
                }

                if (dirtyPatch.temporaryAll === true) {
                    dirty.temporary.all = true;
                }
                if (Array.isArray(dirtyPatch.temporaryIds)) {
                    dirty.temporary.ids = uniqueStringList([].concat(dirty.temporary.ids || [], dirtyPatch.temporaryIds));
                }

                if (dirtyPatch.blankAll === true) {
                    dirty.blank.all = true;
                }
                if (Array.isArray(dirtyPatch.blankIds)) {
                    dirty.blank.ids = uniqueStringList([].concat(dirty.blank.ids || [], dirtyPatch.blankIds));
                }
                return;
            }

            if (trigger.includes('bookmark') || trigger.includes('permanent')) {
                dirty.permanent.all = true;
                return;
            }

            dirty.canvas.layoutDirty = true;
            dirty.temporary.all = true;
            dirty.blank.all = true;
        });
    }

    function shouldTrackAllFilesForPush(trigger) {
        const text = String(trigger || '').toLowerCase();
        if (!text) return false;
        if (text.startsWith('manual')) return true;
        if (text.includes('mismatch-panel-push')) return true;
        return text.includes('first-sync') || text.includes('bootstrap') || text.includes('startup');
    }

    function shouldForceWriteAllFilesForPush(trigger) {
        const text = String(trigger || '').toLowerCase();
        if (!text) return false;
        return text.includes('first-sync') || text.includes('bootstrap');
    }

    function collectCandidatePathsFromDirtyState(dirtyState, files, pathMap) {
        const dirty = normalizeDirtyState(dirtyState);
        const normalizedPathMap = normalizePathMap(pathMap);
        const sourceFiles = Array.isArray(files) ? files : [];
        const candidate = new Set();

        const canvasPaths = [];
        const permanentPaths = [];
        const temporaryById = Object.assign({}, normalizedPathMap.temporaryById);
        const blankById = Object.assign({}, normalizedPathMap.blankById);

        sourceFiles.forEach((file) => {
            const path = normalizeSyncPath(file && file.path);
            if (!path) return;
            const meta = normalizeObsidianFileMeta(file && file.meta);

            if (meta && meta.type === 'canvas') {
                canvasPaths.push(path);
                return;
            }
            if (meta && meta.type === 'permanent') {
                permanentPaths.push(path);
                return;
            }
            if (meta && meta.type === 'temporary') {
                if (meta.sectionId) temporaryById[meta.sectionId] = path;
                return;
            }
            if (meta && meta.type === 'blank') {
                if (meta.nodeId) blankById[meta.nodeId] = path;
                return;
            }
            if (/\.canvas$/i.test(path)) {
                canvasPaths.push(path);
            }
        });

        if (!canvasPaths.length && normalizedPathMap.canvasPath) {
            canvasPaths.push(normalizedPathMap.canvasPath);
        }

        if (!permanentPaths.length && normalizedPathMap.permanentPaths.length) {
            normalizedPathMap.permanentPaths.forEach((path) => permanentPaths.push(path));
        }

        if (dirty.canvas.layoutDirty || dirty.canvas.fileRefDirty) {
            canvasPaths.forEach((path) => candidate.add(path));
        }

        if (dirty.permanent.all) {
            permanentPaths.forEach((path) => candidate.add(path));
        }
        dirty.permanent.paths.forEach((path) => candidate.add(path));

        if (dirty.temporary.all) {
            Object.values(temporaryById).forEach((path) => candidate.add(path));
        }
        dirty.temporary.ids.forEach((id) => {
            const mapped = normalizeSyncPath(temporaryById[id]);
            if (mapped) candidate.add(mapped);
        });

        if (dirty.blank.all) {
            Object.values(blankById).forEach((path) => candidate.add(path));
        }
        dirty.blank.ids.forEach((id) => {
            const mapped = normalizeSyncPath(blankById[id]);
            if (mapped) candidate.add(mapped);
        });

        dirty.paths.forEach((path) => candidate.add(path));

        const hasStructuredDirty = !!(
            dirty.permanent.all
            || dirty.permanent.paths.length > 0
            || dirty.temporary.all
            || dirty.temporary.ids.length > 0
            || dirty.blank.all
            || dirty.blank.ids.length > 0
        );
        const hasNonCanvasCandidate = Array.from(candidate).some((path) => !/\.canvas$/i.test(path));
        if ((hasStructuredDirty || hasNonCanvasCandidate) && canvasPaths.length) {
            canvasPaths.forEach((path) => candidate.add(path));
        }

        return {
            candidatePaths: candidate,
            allTemporaryPaths: uniqueStringList(Object.values(temporaryById), normalizeSyncPath),
            allBlankPaths: uniqueStringList(Object.values(blankById), normalizeSyncPath),
            allPermanentPaths: uniqueStringList(permanentPaths, normalizeSyncPath),
            canvasPaths: uniqueStringList(canvasPaths, normalizeSyncPath),
            temporaryById,
            blankById
        };
    }

    function clearDirtyStateBySyncedPaths(dirtyState, syncedPaths, filesByPath, pathInfo) {
        const dirty = normalizeDirtyState(dirtyState);
        const syncedSet = new Set(uniqueStringList(syncedPaths, normalizeSyncPath));
        if (!syncedSet.size) {
            return dirty;
        }

        const pathLookup = (filesByPath && typeof filesByPath === 'object') ? filesByPath : {};
        const typedPaths = pathInfo && typeof pathInfo === 'object' ? pathInfo : {};
        const syncedTemporaryIds = new Set();
        const syncedBlankIds = new Set();
        let canvasSynced = false;

        syncedSet.forEach((path) => {
            const file = pathLookup[path];
            const meta = normalizeObsidianFileMeta(file && file.meta);
            if (meta && meta.type === 'canvas') {
                canvasSynced = true;
                return;
            }
            if (meta && meta.type === 'temporary' && meta.sectionId) {
                syncedTemporaryIds.add(meta.sectionId);
                return;
            }
            if (meta && meta.type === 'blank' && meta.nodeId) {
                syncedBlankIds.add(meta.nodeId);
                return;
            }
            if (/\.canvas$/i.test(path)) {
                canvasSynced = true;
            }
        });

        if (canvasSynced) {
            dirty.canvas.layoutDirty = false;
            dirty.canvas.fileRefDirty = false;
        }

        dirty.paths = dirty.paths.filter((path) => !syncedSet.has(path));
        dirty.permanent.paths = dirty.permanent.paths.filter((path) => !syncedSet.has(path));
        dirty.temporary.ids = dirty.temporary.ids.filter((id) => !syncedTemporaryIds.has(id));
        dirty.blank.ids = dirty.blank.ids.filter((id) => !syncedBlankIds.has(id));

        const temporaryById = (typedPaths.temporaryById && typeof typedPaths.temporaryById === 'object')
            ? typedPaths.temporaryById
            : {};
        const blankById = (typedPaths.blankById && typeof typedPaths.blankById === 'object')
            ? typedPaths.blankById
            : {};

        dirty.temporary.ids = dirty.temporary.ids.filter((id) => !!normalizeSyncPath(temporaryById[id]));
        dirty.blank.ids = dirty.blank.ids.filter((id) => !!normalizeSyncPath(blankById[id]));

        if (dirty.permanent.all) {
            const allPermanentPaths = uniqueStringList(typedPaths.allPermanentPaths, normalizeSyncPath);
            if (allPermanentPaths.length && allPermanentPaths.every((path) => syncedSet.has(path))) {
                dirty.permanent.all = false;
            }
        }

        if (dirty.temporary.all) {
            const allTemporaryPaths = uniqueStringList(typedPaths.allTemporaryPaths, normalizeSyncPath);
            if (allTemporaryPaths.length && allTemporaryPaths.every((path) => syncedSet.has(path))) {
                dirty.temporary.all = false;
            }
        }

        if (dirty.blank.all) {
            const allBlankPaths = uniqueStringList(typedPaths.allBlankPaths, normalizeSyncPath);
            if (allBlankPaths.length && allBlankPaths.every((path) => syncedSet.has(path))) {
                dirty.blank.all = false;
            }
        }

        dirty.updatedAt = Date.now();
        return normalizeDirtyState(dirty);
    }

    function getUtf8Size(value) {
        const text = String(value == null ? '' : value);
        return new TextEncoder().encode(text).length;
    }

    function storageLocalGet(keys) {
        const api = getRuntimeApi();
        if (!api || !api.storage || !api.storage.local) {
            return Promise.reject(new Error(textByLang('storage.local 不可用', 'storage.local is unavailable')));
        }

        const storage = api.storage.local;
        return new Promise((resolve, reject) => {
            try {
                const maybePromise = storage.get(keys, (result) => {
                    const runtimeErr = api.runtime && api.runtime.lastError;
                    if (runtimeErr && runtimeErr.message) {
                        reject(new Error(runtimeErr.message));
                        return;
                    }
                    resolve(result || {});
                });

                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.then((result) => resolve(result || {})).catch(reject);
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    function storageLocalSet(data) {
        const api = getRuntimeApi();
        if (!api || !api.storage || !api.storage.local) {
            return Promise.reject(new Error(textByLang('storage.local 不可用', 'storage.local is unavailable')));
        }

        const storage = api.storage.local;
        return new Promise((resolve, reject) => {
            try {
                const maybePromise = storage.set(data, () => {
                    const runtimeErr = api.runtime && api.runtime.lastError;
                    if (runtimeErr && runtimeErr.message) {
                        reject(new Error(runtimeErr.message));
                        return;
                    }
                    resolve();
                });

                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.then(() => resolve()).catch(reject);
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    function getBookmarksApi() {
        const api = getRuntimeApi();
        return api && api.bookmarks ? api.bookmarks : null;
    }

    function bookmarksGetTree() {
        const api = getRuntimeApi();
        const bookmarks = getBookmarksApi();
        if (!api || !bookmarks || typeof bookmarks.getTree !== 'function') {
            return Promise.reject(new Error(textByLang('bookmarks API 不可用', 'bookmarks API is unavailable')));
        }

        return new Promise((resolve, reject) => {
            try {
                const maybePromise = bookmarks.getTree((tree) => {
                    const runtimeErr = api.runtime && api.runtime.lastError;
                    if (runtimeErr && runtimeErr.message) {
                        reject(new Error(runtimeErr.message));
                        return;
                    }
                    resolve(Array.isArray(tree) ? tree : []);
                });

                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.then((tree) => resolve(Array.isArray(tree) ? tree : [])).catch(reject);
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    function bookmarksGetChildren(id) {
        const api = getRuntimeApi();
        const bookmarks = getBookmarksApi();
        if (!api || !bookmarks || typeof bookmarks.getChildren !== 'function') {
            return Promise.reject(new Error(textByLang('bookmarks API 不可用', 'bookmarks API is unavailable')));
        }

        return new Promise((resolve, reject) => {
            try {
                const maybePromise = bookmarks.getChildren(String(id || ''), (children) => {
                    const runtimeErr = api.runtime && api.runtime.lastError;
                    if (runtimeErr && runtimeErr.message) {
                        reject(new Error(runtimeErr.message));
                        return;
                    }
                    resolve(Array.isArray(children) ? children : []);
                });

                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.then((children) => resolve(Array.isArray(children) ? children : [])).catch(reject);
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    function bookmarksCreate(createInfo) {
        const api = getRuntimeApi();
        const bookmarks = getBookmarksApi();
        if (!api || !bookmarks || typeof bookmarks.create !== 'function') {
            return Promise.reject(new Error(textByLang('bookmarks API 不可用', 'bookmarks API is unavailable')));
        }

        return new Promise((resolve, reject) => {
            try {
                const maybePromise = bookmarks.create(createInfo, (node) => {
                    const runtimeErr = api.runtime && api.runtime.lastError;
                    if (runtimeErr && runtimeErr.message) {
                        reject(new Error(runtimeErr.message));
                        return;
                    }
                    resolve(node || null);
                });

                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.then((node) => resolve(node || null)).catch(reject);
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    function bookmarksRemove(id) {
        const api = getRuntimeApi();
        const bookmarks = getBookmarksApi();
        if (!api || !bookmarks || typeof bookmarks.remove !== 'function') {
            return Promise.reject(new Error(textByLang('bookmarks API 不可用', 'bookmarks API is unavailable')));
        }

        return new Promise((resolve, reject) => {
            try {
                const maybePromise = bookmarks.remove(String(id || ''), () => {
                    const runtimeErr = api.runtime && api.runtime.lastError;
                    if (runtimeErr && runtimeErr.message) {
                        reject(new Error(runtimeErr.message));
                        return;
                    }
                    resolve();
                });

                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.then(() => resolve()).catch(reject);
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    function bookmarksRemoveTree(id) {
        const api = getRuntimeApi();
        const bookmarks = getBookmarksApi();
        if (!api || !bookmarks || typeof bookmarks.removeTree !== 'function') {
            return Promise.reject(new Error(textByLang('bookmarks API 不可用', 'bookmarks API is unavailable')));
        }

        return new Promise((resolve, reject) => {
            try {
                const maybePromise = bookmarks.removeTree(String(id || ''), () => {
                    const runtimeErr = api.runtime && api.runtime.lastError;
                    if (runtimeErr && runtimeErr.message) {
                        reject(new Error(runtimeErr.message));
                        return;
                    }
                    resolve();
                });

                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.then(() => resolve()).catch(reject);
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    function deepCloneJson(value) {
        if (value === null || typeof value === 'undefined') return null;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return null;
        }
    }

    function normalizeBookmarkTreeSnapshot(raw) {
        if (!raw) return null;
        if (Array.isArray(raw)) return deepCloneJson(raw);
        if (raw && typeof raw === 'object' && Array.isArray(raw.children)) {
            return deepCloneJson([raw]);
        }
        return null;
    }

    function extractBookmarkRootFolders(tree) {
        const root = Array.isArray(tree) && tree.length ? tree[0] : null;
        const roots = root && Array.isArray(root.children) ? root.children : [];
        return roots.filter((item) => item && typeof item === 'object');
    }

    function normalizeBookmarkRootTitle(title) {
        return String(title || '').trim().toLowerCase();
    }

	    function getBookmarkTreeStats(treeSnapshot) {
	        const roots = extractBookmarkRootFolders(treeSnapshot);
	        let folderCount = 0;
	        let bookmarkCount = 0;

        const walk = (nodes) => {
            if (!Array.isArray(nodes)) return;
            nodes.forEach((node) => {
                if (!node || typeof node !== 'object') return;
                if (typeof node.url === 'string' && node.url.trim()) {
                    bookmarkCount += 1;
                    return;
                }
                folderCount += 1;
                walk(node.children);
            });
        };

        roots.forEach((rootNode) => {
            walk(rootNode.children);
        });

	        return {
	            roots: roots.length,
	            folders: folderCount,
	            bookmarks: bookmarkCount
	        };
	    }

	    function getBookmarkTreeHash(treeSnapshot) {
	        const normalized = normalizeBookmarkTreeSnapshot(treeSnapshot);
	        if (!normalized) return '';
	        try {
	            return hashString(JSON.stringify(normalized));
	        } catch (_) {
	            return '';
	        }
	    }

	    function shouldOverwriteLocalPermanentTreeFromRemote() {
	        // Reuse firstSyncMode as a "permanent section ownership" policy for ongoing sync.
	        // - cloud/auto: allow remote overwriting local permanent tree on pull
	        // - local: never overwrite local permanent tree from remote
	        const mode = ensureFirstSyncMode(settings && settings.firstSyncMode);
	        return mode === 'cloud' || mode === 'auto';
	    }

	    // Permanent-section remote -> local overwrite entry (shared by pull-related flows).
	    // Unified callers:
	    // - pull-only (manual-pull)
	    // - mismatch panel -> use remote
	    // - full sync when winner resolves to remote pull
	    // - conflict panel -> use remote (via force=true)
	    async function maybeOverwriteLocalPermanentTreeFromRemoteSnapshot(remoteTreeSnapshot, reason, options = {}) {
	        const forceOverwrite = !!(options && options.force === true);
	        if (!forceOverwrite && !shouldOverwriteLocalPermanentTreeFromRemote()) {
	            return { applied: false, skipped: 'policy-local' };
	        }

	        const remoteTree = normalizeBookmarkTreeSnapshot(remoteTreeSnapshot);
	        if (!remoteTree) {
	            return { applied: false, skipped: 'remote-missing' };
	        }

	        const remoteStats = getBookmarkTreeStats(remoteTree);
	        const remoteTotal = (remoteStats.folders || 0) + (remoteStats.bookmarks || 0);
	        if (!remoteStats.roots || remoteTotal <= 0) {
	            return { applied: false, skipped: 'remote-empty' };
	        }

	        const localTreeRaw = await bookmarksGetTree();
	        const localTree = normalizeBookmarkTreeSnapshot(localTreeRaw);
	        if (!localTree) {
	            throw new Error(textByLang('读取本地永久栏目失败：书签树为空', 'Failed to read local permanent section: bookmark tree is empty'));
	        }

	        const localStats = getBookmarkTreeStats(localTree);
	        const localHash = getBookmarkTreeHash(localTree);
	        const remoteHash = getBookmarkTreeHash(remoteTree);
	        if (localHash && remoteHash && localHash === remoteHash) {
	            return { applied: false, skipped: 'same' };
	        }

	        try {
	            const backup = normalizeSnapshot({
	                schemaVersion: 1,
	                format: 'bookmark-canvas-permanent-tree',
	                updatedAt: Date.now(),
	                generatedAt: Date.now(),
	                trigger: String(reason || 'pull'),
	                permanentTreeSnapshot: localTree,
	                data: {}
	            });
	            backupSnapshotForRecovery(backup, `before-permanent-overwrite:${String(reason || 'pull')}`);
	        } catch (_) { }

	        const permanentPullMode = ensurePermanentPullMode(settings && settings.permanentPullMode);
	        let applyMode = 'overwrite';
	        let fallbackReason = '';
	        let threshold = 0;
	        let logicalChangeCount = 0;
	
	        if (permanentPullMode === 'incremental' || permanentPullMode === 'auto') {
	            if (options && typeof options.onProgress === 'function') {
	                try { options.onProgress(textByLang('正在分析永久栏目差异...', 'Analyzing permanent section changes...')); } catch (_) { }
	            }
	            const incrementalResult = await applyIncrementalPermanentTreeFromSnapshot(remoteTree, localTree, {
	                reason: String(reason || 'pull'),
	                respectThreshold: permanentPullMode === 'auto'
	            });
	            if (incrementalResult && incrementalResult.applied) {
	                return {
	                    applied: true,
	                    counters: incrementalResult.counters,
	                    localStats,
	                    remoteStats,
	                    mode: 'incremental',
	                    threshold: incrementalResult.threshold,
	                    logicalChangeCount: incrementalResult.logicalChangeCount
	                };
	            }
	            fallbackReason = String(incrementalResult && (incrementalResult.fallback || incrementalResult.skipped) || 'fallback-overwrite');
	            threshold = Number(incrementalResult && incrementalResult.threshold) || 0;
	            logicalChangeCount = Number(incrementalResult && incrementalResult.logicalChangeCount) || 0;
	        }

	        if (options && typeof options.onProgress === 'function') {
	            try { options.onProgress(textByLang('正在覆盖本地书签树...', 'Overwriting local bookmark tree...')); } catch (_) { }
	        }

	        const counters = await overwriteLocalPermanentTreeFromSnapshot(remoteTree, localTree, {
	            reason: String(reason || 'pull')
	        });

	        return {
	            applied: true,
	            counters,
	            localStats,
	            remoteStats,
	            mode: applyMode,
	            fallbackReason,
	            threshold,
	            logicalChangeCount
	        };
	    }

	    async function getPermanentTreeSnapshotForSync() {
	        const tree = await bookmarksGetTree();
	        const normalized = normalizeBookmarkTreeSnapshot(tree);
	        if (!normalized) {
            throw new Error(textByLang('读取本地永久栏目失败：书签树为空', 'Failed to read local permanent section: bookmark tree is empty'));
        }
        return normalized;
    }

    async function clearBookmarkChildren(parentId) {
        const children = await bookmarksGetChildren(parentId);
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            if (!child || !child.id) continue;

            if (child.unmodifiable) {
                continue;
            }

            if (typeof child.url === 'string' && child.url.trim()) {
                await bookmarksRemove(child.id);
            } else {
                await bookmarksRemoveTree(child.id);
            }
        }
    }

    async function createBookmarkSubtree(parentId, node, index, counters) {
        if (!node || typeof node !== 'object') return;
        const title = String(node.title || '').trim();
        const url = String(node.url || '').trim();

        if (url) {
            await bookmarksCreate({
                parentId,
                index,
                title: title || url,
                url
            });
            if (counters) counters.bookmarks += 1;
            return;
        }

        const folder = await bookmarksCreate({
            parentId,
            index,
            title: title || 'Folder'
        });
        if (counters) counters.folders += 1;

        const children = Array.isArray(node.children) ? node.children : [];
        for (let i = 0; i < children.length; i++) {
            await createBookmarkSubtree(folder && folder.id ? folder.id : parentId, children[i], i, counters);
        }
    }

    async function withPermanentTreeBulkMode(reason, task) {
        const bulkMode = global.__canvasBookmarkBulkMode;
        const bulkModeAvailable = !!(bulkMode
            && typeof bulkMode.begin === 'function'
            && typeof bulkMode.end === 'function');
        const bulkReason = String(reason || 'sync-permanent-overwrite');
        let bulkModeBegun = false;
        let bulkSucceeded = false;

        try {
            if (bulkModeAvailable) {
                await bulkMode.begin(bulkReason);
                bulkModeBegun = true;
            }
            const result = await task();
            bulkSucceeded = true;
            return result;
        } finally {
            if (bulkModeBegun) {
                try {
                    if (bulkSucceeded && typeof bulkMode.noteMutation === 'function') {
                        bulkMode.noteMutation(bulkReason);
                    }
                    await bulkMode.end(bulkReason, {
                        resetBaseline: bulkSucceeded,
                        refreshTree: true
                    });
                } catch (error) {
                    console.warn('[Canvas Sync] bulk bookmark mode end failed:', error);
                }
            } else if (bulkSucceeded) {
                try {
                    if (typeof global.renderTreeView === 'function') {
                        await global.renderTreeView(true);
                    }
                } catch (_) { }
            }
        }
    }

    function isPermanentBookmarkNode(node) {
        return !!(node && typeof node.url === 'string' && node.url.trim());
    }

    function normalizePermanentNodeTitle(node, fallback = 'Folder') {
        return String(node && (node.title || node.name) || fallback).trim() || fallback;
    }

    function buildPermanentIncrementalNodeKey(node) {
        if (isPermanentBookmarkNode(node)) {
            return `bookmark:${normalizePermanentNodeTitle(node, String(node && node.url || ''))}\u0001${String(node && node.url || '').trim()}`;
        }
        return `folder:${normalizePermanentNodeTitle(node)}`;
    }

    function countPermanentSubtreeStats(node) {
        if (!node || typeof node !== 'object') {
            return { folders: 0, bookmarks: 0 };
        }
        if (isPermanentBookmarkNode(node)) {
            return { folders: 0, bookmarks: 1 };
        }
        let folders = 1;
        let bookmarks = 0;
        const children = Array.isArray(node.children) ? node.children : [];
        children.forEach((child) => {
            const childStats = countPermanentSubtreeStats(child);
            folders += childStats.folders;
            bookmarks += childStats.bookmarks;
        });
        return { folders, bookmarks };
    }

    function countPermanentSubtreeLogicalNodes(node) {
        const stats = countPermanentSubtreeStats(node);
        return (stats.folders || 0) + (stats.bookmarks || 0);
    }

    function buildPermanentComparableNodeSignature(node) {
        const buildComparable = (input) => {
            if (!input || typeof input !== 'object') return null;
            if (isPermanentBookmarkNode(input)) {
                return {
                    type: 'bookmark',
                    title: normalizePermanentNodeTitle(input, String(input.url || '')),
                    url: String(input.url || '').trim()
                };
            }
            return {
                type: 'folder',
                title: normalizePermanentNodeTitle(input),
                children: (Array.isArray(input.children) ? input.children : []).map(buildComparable).filter(Boolean)
            };
        };
        try {
            return hashString(JSON.stringify(buildComparable(node)));
        } catch (_) {
            return '';
        }
    }

    function isNonDecreasingNumberList(values) {
        let last = -Infinity;
        for (let i = 0; i < values.length; i++) {
            const next = Number(values[i]);
            if (!Number.isFinite(next)) continue;
            if (next < last) return false;
            last = next;
        }
        return true;
    }

    function buildPermanentIncrementalThreshold(localTreeSnapshot, remoteTreeSnapshot) {
        const localStats = getBookmarkTreeStats(localTreeSnapshot);
        const remoteStats = getBookmarkTreeStats(remoteTreeSnapshot);
        const total = Math.max(
            (localStats.folders || 0) + (localStats.bookmarks || 0),
            (remoteStats.folders || 0) + (remoteStats.bookmarks || 0),
            0
        );
        const absoluteThreshold = normalizePermanentIncrementalMaxChanges(
            settings && settings.permanentIncrementalMaxChanges,
            DEFAULT_SETTINGS.permanentIncrementalMaxChanges
        );
        return absoluteThreshold;
    }

    function buildPermanentIncrementalPlan(parentId, localChildrenInput, remoteChildrenInput, ancestry = []) {
        const localChildren = Array.isArray(localChildrenInput) ? localChildrenInput : [];
        const remoteChildren = Array.isArray(remoteChildrenInput) ? remoteChildrenInput : [];

        const localBuckets = new Map();
        localChildren.forEach((node, index) => {
            const key = buildPermanentIncrementalNodeKey(node);
            if (!localBuckets.has(key)) localBuckets.set(key, []);
            localBuckets.get(key).push({ node, index });
        });

        const remoteMatches = new Array(remoteChildren.length).fill(null);
        const matchedLocalIndexes = new Set();
        for (let remoteIndex = 0; remoteIndex < remoteChildren.length; remoteIndex++) {
            const remoteNode = remoteChildren[remoteIndex];
            const key = buildPermanentIncrementalNodeKey(remoteNode);
            const bucket = localBuckets.get(key);
            if (bucket && bucket.length) {
                const localEntry = bucket.shift();
                matchedLocalIndexes.add(localEntry.index);
                remoteMatches[remoteIndex] = {
                    remoteIndex,
                    remoteNode,
                    localIndex: localEntry.index,
                    localNode: localEntry.node
                };
            }
        }

        const matchedLocalOrder = remoteMatches.filter(Boolean).map((entry) => entry.localIndex);
        if (!isNonDecreasingNumberList(matchedLocalOrder)) {
            return {
                hasChanges: true,
                logicalChangeCount: Number.POSITIVE_INFINITY,
                complexReason: 'reorder-detected',
                path: ancestry.join(' / ')
            };
        }

        const deletes = localChildren
            .map((node, index) => ({ node, index }))
            .filter((entry) => !matchedLocalIndexes.has(entry.index))
            .sort((left, right) => right.index - left.index)
            .map((entry) => Object.assign({}, entry, {
                logicalCount: countPermanentSubtreeLogicalNodes(entry.node)
            }));

        let logicalChangeCount = deletes.reduce((sum, entry) => sum + (entry.logicalCount || 0), 0);
        const steps = [];

        for (let remoteIndex = 0; remoteIndex < remoteChildren.length; remoteIndex++) {
            const remoteNode = remoteChildren[remoteIndex];
            const match = remoteMatches[remoteIndex];
            if (!match) {
                const logicalCount = countPermanentSubtreeLogicalNodes(remoteNode);
                logicalChangeCount += logicalCount;
                steps.push({
                    kind: 'add',
                    index: remoteIndex,
                    node: remoteNode,
                    logicalCount
                });
                continue;
            }

            if (!isPermanentBookmarkNode(remoteNode)) {
                const localSignature = buildPermanentComparableNodeSignature(match.localNode);
                const remoteSignature = buildPermanentComparableNodeSignature(remoteNode);
                if (localSignature !== remoteSignature) {
                    const childPlan = buildPermanentIncrementalPlan(
                        String(match.localNode && match.localNode.id || ''),
                        match.localNode && Array.isArray(match.localNode.children) ? match.localNode.children : [],
                        Array.isArray(remoteNode.children) ? remoteNode.children : [],
                        ancestry.concat(normalizePermanentNodeTitle(remoteNode))
                    );
                    if (childPlan && childPlan.complexReason) {
                        return childPlan;
                    }
                    if (childPlan && childPlan.hasChanges) {
                        logicalChangeCount += childPlan.logicalChangeCount || 0;
                        steps.push({ kind: 'recurse', plan: childPlan });
                    }
                }
            }
        }

        return {
            parentId: String(parentId || ''),
            deletes,
            steps,
            logicalChangeCount,
            hasChanges: deletes.length > 0 || steps.length > 0
        };
    }

    function buildPermanentIncrementalSyncPlan(localTreeSnapshot, remoteTreeSnapshot) {
        const localRoots = extractBookmarkRootFolders(localTreeSnapshot);
        const remoteRoots = extractBookmarkRootFolders(remoteTreeSnapshot);
        const remoteByTitle = new Map();
        remoteRoots.forEach((node) => {
            const key = normalizeBookmarkRootTitle(node && node.title);
            if (!key || remoteByTitle.has(key)) return;
            remoteByTitle.set(key, node);
        });

        const plans = [];
        let logicalChangeCount = 0;
        for (let i = 0; i < localRoots.length; i++) {
            const localRoot = localRoots[i];
            if (!localRoot || !localRoot.id) continue;
            const key = normalizeBookmarkRootTitle(localRoot.title);
            const remoteRoot = (key && remoteByTitle.get(key)) || remoteRoots[i] || null;
            const remoteChildren = remoteRoot && Array.isArray(remoteRoot.children) ? remoteRoot.children : [];
            const rootPlan = buildPermanentIncrementalPlan(
                String(localRoot.id || ''),
                Array.isArray(localRoot.children) ? localRoot.children : [],
                remoteChildren,
                [normalizePermanentNodeTitle(remoteRoot || localRoot, textByLang('根目录', 'Root'))]
            );
            if (rootPlan && rootPlan.complexReason) {
                return rootPlan;
            }
            if (rootPlan && rootPlan.hasChanges) {
                plans.push(rootPlan);
                logicalChangeCount += rootPlan.logicalChangeCount || 0;
            }
        }

        return {
            plans,
            logicalChangeCount,
            hasChanges: plans.length > 0
        };
    }

    async function applyPermanentIncrementalPlan(plan, counters) {
        if (!plan || !plan.hasChanges) return;
        const deletes = Array.isArray(plan.deletes) ? plan.deletes : [];
        for (let i = 0; i < deletes.length; i++) {
            const entry = deletes[i];
            const node = entry && entry.node;
            if (!node || !node.id || node.unmodifiable) continue;
            if (isPermanentBookmarkNode(node)) {
                await bookmarksRemove(String(node.id));
                if (counters) counters.removedBookmarks += 1;
            } else {
                const subtreeStats = countPermanentSubtreeStats(node);
                await bookmarksRemoveTree(String(node.id));
                if (counters) {
                    counters.removedFolders += subtreeStats.folders || 0;
                    counters.removedBookmarks += subtreeStats.bookmarks || 0;
                }
            }
        }

        const steps = Array.isArray(plan.steps) ? plan.steps : [];
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            if (!step || typeof step !== 'object') continue;
            if (step.kind === 'add') {
                await createBookmarkSubtree(plan.parentId, step.node, step.index, counters);
                continue;
            }
            if (step.kind === 'recurse') {
                await applyPermanentIncrementalPlan(step.plan, counters);
            }
        }
    }

    async function applyIncrementalPermanentTreeFromSnapshot(treeSnapshot, localTreeSnapshot = null, options = {}) {
        const remoteTree = normalizeBookmarkTreeSnapshot(treeSnapshot);
        if (!remoteTree) {
            return { applied: false, fallback: 'remote-missing' };
        }

        const localTree = localTreeSnapshot ? normalizeBookmarkTreeSnapshot(localTreeSnapshot) : await bookmarksGetTree();
        const localRoots = extractBookmarkRootFolders(localTree);
        if (!localRoots.length) {
            throw new Error(textByLang('本地书签根目录不可用，无法增量同步', 'Local bookmark root is unavailable; cannot run incremental sync'));
        }

        const plan = buildPermanentIncrementalSyncPlan(localTree, remoteTree);
        const threshold = buildPermanentIncrementalThreshold(localTree, remoteTree);
        const logicalChangeCount = Number(plan && plan.logicalChangeCount) || 0;
        const respectThreshold = !(options && options.respectThreshold === false);

        if (plan && plan.complexReason) {
            return {
                applied: false,
                fallback: String(plan.complexReason || 'complex-change'),
                threshold,
                logicalChangeCount
            };
        }

        if (!plan || !plan.hasChanges) {
            return { applied: false, skipped: 'same', threshold, logicalChangeCount };
        }

        if (respectThreshold && logicalChangeCount > threshold) {
            return {
                applied: false,
                fallback: 'threshold-exceeded',
                threshold,
                logicalChangeCount
            };
        }

        const counters = { folders: 0, bookmarks: 0, removedFolders: 0, removedBookmarks: 0 };
        await withPermanentTreeBulkMode(options && options.reason || 'sync-permanent-incremental', async () => {
            const plans = Array.isArray(plan.plans) ? plan.plans : [];
            for (let i = 0; i < plans.length; i++) {
                await applyPermanentIncrementalPlan(plans[i], counters);
            }
        });

        return {
            applied: true,
            counters,
            threshold,
            logicalChangeCount
        };
    }

	    async function overwriteLocalPermanentTreeFromSnapshot(treeSnapshot, localTreeSnapshot = null, options = {}) {
	        const remoteTree = normalizeBookmarkTreeSnapshot(treeSnapshot);
	        if (!remoteTree) {
	            throw new Error(textByLang('云端未提供永久栏目快照，无法覆盖', 'Remote permanent section snapshot is missing; cannot overwrite'));
	        }

	        const localTree = localTreeSnapshot ? normalizeBookmarkTreeSnapshot(localTreeSnapshot) : await bookmarksGetTree();
	        const localRoots = extractBookmarkRootFolders(localTree);
	        if (!localRoots.length) {
	            throw new Error(textByLang('本地书签根目录不可用，无法覆盖', 'Local bookmark root is unavailable; cannot overwrite'));
	        }

        const remoteRoots = extractBookmarkRootFolders(remoteTree);
        const remoteByTitle = new Map();
        remoteRoots.forEach((node) => {
            const key = normalizeBookmarkRootTitle(node && node.title);
            if (!key || remoteByTitle.has(key)) return;
            remoteByTitle.set(key, node);
        });

        return await withPermanentTreeBulkMode(options && options.reason || 'sync-permanent-overwrite', async () => {
            const counters = { folders: 0, bookmarks: 0 };
            for (let i = 0; i < localRoots.length; i++) {
                const localRoot = localRoots[i];
                if (!localRoot || !localRoot.id) continue;

                const key = normalizeBookmarkRootTitle(localRoot.title);
                const remoteRoot = (key && remoteByTitle.get(key)) || remoteRoots[i] || null;
                const remoteChildren = remoteRoot && Array.isArray(remoteRoot.children) ? remoteRoot.children : [];

                await clearBookmarkChildren(localRoot.id);
                for (let j = 0; j < remoteChildren.length; j++) {
                    await createBookmarkSubtree(localRoot.id, remoteChildren[j], j, counters);
                }
            }
            return counters;
        });
    }

    function normalizeRepoBranch(branch) {
        const value = String(branch || '').trim();
        return value || 'main';
    }

    function normalizeRepoConfig(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            enabled: true,
            owner: String(source.owner || source.githubRepoOwner || '').trim(),
            repo: String(source.repo || source.githubRepoName || '').trim(),
            branch: normalizeRepoBranch(source.branch || source.githubRepoBranch),
            basePath: normalizeSyncPath(source.basePath || source.githubRepoBasePath || ''),
            token: String(source.token || source.githubRepoToken || '').trim()
        };
    }

    function mapRepoConfigToStorage(config) {
        return {
            githubRepoOwner: String(config.owner || '').trim(),
            githubRepoName: String(config.repo || '').trim(),
            githubRepoBranch: normalizeRepoBranch(config.branch),
            githubRepoBasePath: normalizeSyncPath(config.basePath || ''),
            githubRepoToken: String(config.token || '').trim()
        };
    }

    function setRepoStatus(message, level = 'neutral') {
        const statusEl = getElement('canvasSyncRepoStatus');
        if (!statusEl) return;
        statusEl.textContent = String(message || '');
        statusEl.dataset.status = String(level || 'neutral');
    }

    function applyRepoConfigToForm() {
        const owner = getElement('canvasSyncRepoOwnerInput');
        const repo = getElement('canvasSyncRepoNameInput');
        const branch = getElement('canvasSyncRepoBranchInput');
        const basePath = getElement('canvasSyncRepoBasePathInput');
        const token = getElement('canvasSyncRepoTokenInput');

        if (owner) owner.value = repoConfig ? repoConfig.owner : '';
        if (repo) repo.value = repoConfig ? repoConfig.repo : '';
        if (branch) branch.value = repoConfig ? normalizeRepoBranch(repoConfig.branch) : 'main';
        if (basePath) basePath.value = repoConfig ? repoConfig.basePath : '';
        if (token) token.value = repoConfig ? repoConfig.token : '';
    }

    function collectRepoConfigFromForm() {
        const owner = getElement('canvasSyncRepoOwnerInput');
        const repo = getElement('canvasSyncRepoNameInput');
        const branch = getElement('canvasSyncRepoBranchInput');
        const basePath = getElement('canvasSyncRepoBasePathInput');
        const token = getElement('canvasSyncRepoTokenInput');

        return {
            enabled: true,
            owner: String(owner ? owner.value : '').trim(),
            repo: String(repo ? repo.value : '').trim(),
            branch: normalizeRepoBranch(branch ? branch.value : ''),
            basePath: normalizeSyncPath(basePath ? basePath.value : ''),
            token: String(token ? token.value : '').trim()
        };
    }

    async function loadRepoConfigFromStorage() {
        try {
            const raw = await storageLocalGet(REPO_CONFIG_KEYS);
            repoConfig = normalizeRepoConfig(raw);
            applyRepoConfigToForm();
            const missingReason = getRepoConfigMissingReason(repoConfig);
            if (missingReason) {
                setRepoStatus('', 'neutral');
            } else {
                setRepoStatus(textByLang('已读取仓库配置，可先点“测试连接”', 'Repository config loaded, click "Test Connection" first'), 'neutral');
            }
            renderStatus();
        } catch (error) {
            setRepoStatus(textByLang(`读取仓库配置失败：${error && error.message ? error.message : String(error)}`, `Failed to load repository config: ${error && error.message ? error.message : String(error)}`), 'error');
        }
    }

    async function saveRepoConfigFromForm() {
        const nextConfig = collectRepoConfigFromForm();
        if (!nextConfig.owner || !nextConfig.repo) {
            throw new Error(textByLang('Owner 和 Repo 不能为空', 'Owner and Repo cannot be empty'));
        }
        if (!nextConfig.token) {
            throw new Error(textByLang('Token 不能为空', 'Token cannot be empty'));
        }

        await storageLocalSet(mapRepoConfigToStorage(nextConfig));
        repoConfig = nextConfig;
        setRepoStatus(textByLang('仓库配置已保存', 'Repository configuration saved'), 'ok');
    }

    async function testRepoConfig(config) {
        const payload = config && typeof config === 'object'
            ? Object.assign({}, config, { branch: normalizeRepoBranch(config.branch) })
            : collectRepoConfigFromForm();

        if (!payload.owner || !payload.repo || !payload.token) {
            throw new Error(textByLang('请先填写 Owner / Repo / Token', 'Please fill Owner / Repo / Token first'));
        }

        const response = await sendRuntimeMessage({
            action: 'canvasGitTestConfig',
            config: payload
        });

        if (!response || response.success !== true) {
            throw new Error((response && response.error) || textByLang('连接测试失败', 'Connection test failed'));
        }

        const repoName = response.repo && response.repo.fullName ? response.repo.fullName : `${payload.owner}/${payload.repo}`;
        const branch = response.resolvedBranch || payload.branch || 'default';
        const extras = [];
        if (response.basePathExists === false) {
            extras.push(textByLang('Base Path 不存在，将在首次写入时创建', 'Base Path does not exist; it will be created on first write'));
        }
        if (response.branchWillBeCreated) {
            extras.push(textByLang('分支不存在，将在首次同步写入时自动创建', 'Branch does not exist; it will be created automatically on first sync write'));
        }
        const extraText = extras.length ? `（${extras.join('；')}）` : '';
        setRepoStatus(textByLang(`连接成功：${repoName} @ ${branch} ${extraText}`, `Connected: ${repoName} @ ${branch} ${extraText}`).trim(), 'ok');
        return response;
    }

    function confirmMissingBranchAutoCreate(response, config) {
        if (!response || response.branchWillBeCreated !== true) return true;
        const normalizedConfig = config && typeof config === 'object' ? config : collectRepoConfigFromForm();
        const repoName = response.repo && response.repo.fullName
            ? response.repo.fullName
            : `${normalizedConfig.owner || ''}/${normalizedConfig.repo || ''}`.replace(/^\/+/, '');
        const branch = response.resolvedBranch || normalizeRepoBranch(normalizedConfig.branch);
        const message = textByLang(
            `检测到分支「${branch}」当前不存在。

确定：继续保存配置；首次同步写入时自动创建该分支。
取消：先返回修改分支名。`,
            `The branch "${branch}" does not exist yet.

OK: keep saving this config and create the branch automatically on the first sync write.
Cancel: go back and change the branch name first.`
        );
        try {
            return global.confirm(message);
        } catch (_) {
            return true;
        }
    }

    async function persistVerifiedRepoConfigAndEnableSync(config) {
        const normalizedConfig = normalizeRepoConfig(config && typeof config === 'object' ? config : collectRepoConfigFromForm());
        await storageLocalSet(mapRepoConfigToStorage(normalizedConfig));
        repoConfig = normalizedConfig;
        applyRepoConfigToForm();

        const wasEnabled = !!settings.enabled;
        if (!wasEnabled) {
            settings.enabled = true;
            saveSettings();
            applySettingsToForm();
            restartAutomationTimers();
            scheduleStartupPull();
        }
        renderStatus();
        return wasEnabled;
    }

    function setFirstSyncFoldOpen(open) {
        const isOpen = !!open;
        const firstSyncFold = getElement('canvasSyncFirstSyncFold');
        const firstSyncFoldSummary = getElement('canvasSyncFirstSyncFoldSummary');
        const firstSyncPanel = getElement('canvasSyncFirstSyncPanel');

        if (firstSyncFold) firstSyncFold.classList.toggle('is-open', isOpen);
        if (firstSyncFoldSummary) firstSyncFoldSummary.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (firstSyncPanel) firstSyncPanel.hidden = !isOpen;
    }

    function focusFirstSyncSetup() {
        setActiveTab('behavior');
        setFirstSyncFoldOpen(true);
        const firstSyncPanel = getElement('canvasSyncFirstSyncPanel');
        if (firstSyncPanel && typeof firstSyncPanel.scrollIntoView === 'function') {
            firstSyncPanel.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
    }

    function isFirstSyncPathValidated() {
        const currentRoot = normalizeSyncPath(settings && settings.obsidianExportRoot);
        const verifiedRoot = normalizeSyncPath(settings && settings.firstSyncPathVerifiedRoot);
        if (!currentRoot && !verifiedRoot) return true;
        return !!verifiedRoot && verifiedRoot === currentRoot;
    }

    function buildFirstSyncPathGuideHtml(currentRoot) {
        const rootValue = normalizeSyncPath(currentRoot);
        const demoRoot = rootValue || DEFAULT_SETTINGS.obsidianExportRoot;
        const ymd = (() => {
            const d = new Date();
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}${m}${day}`;
        })();
        const exampleFolderName = getSyncLang() === 'en'
            ? `${demoRoot || `bookmark-canvas-${ymd}`} (example)/`
            : `${demoRoot || `书签画布-${ymd}`}（示例）/`;
        const isDark = (() => {
            try { return (document.documentElement.getAttribute('data-theme') || '') === 'dark'; } catch (_) { return false; }
        })();
        const hl = (text) => {
            const style = isDark
                ? 'color:#fde68a;background:rgba(245,158,11,0.18);border:1px solid rgba(245,158,11,0.35);padding:0 4px;border-radius:6px;font-weight:700;'
                : 'color:#92400e;background:rgba(245,158,11,0.22);border:1px solid rgba(245,158,11,0.38);padding:0 4px;border-radius:6px;font-weight:700;';
            return `<span style="${style}">${text}</span>`;
        };
        const arrow = '<div style="margin:8px 0; line-height:1; display:flex; justify-content:center;"><i class="fas fa-arrow-down"></i></div>';
        const exampleShiftPx = 14;
        const stepBExample = getSyncLang() === 'en'
            ? `<div style="position:relative;text-align:center;">
  <span style="position:absolute;left:0;font-weight:600;">Put into:</span>
  <span style="display:inline-block; transform: translateX(${exampleShiftPx}px);"><code>Personal/Bookmarks/...</code></span>
</div>
<div style="transform: translateX(${exampleShiftPx}px);">${arrow}</div>
<div style="text-align:center;">Input: <code>Personal/Bookmarks/${demoRoot}</code></div>`
            : `<div style="position:relative;text-align:center;">
  <span style="position:absolute;left:0;font-weight:600;">放入：</span>
  <span style="display:inline-block; transform: translateX(${exampleShiftPx}px);"><code>个人/书签/...</code></span>
</div>
<div style="transform: translateX(${exampleShiftPx}px);">${arrow}</div>
<div style="text-align:center;">输入框填：<code>个人/书签/${demoRoot}</code> 即可</div>`;

        return getSyncLang() === 'en'
            ? `
                <div style="margin-bottom: 10px; line-height: 1.6;">
                    <div style="margin-bottom: 8px;">Please follow the steps below to ensure Obsidian can locate the exported .md files.</div>
                    <div style="margin: 6px 0 10px; font-weight: 600;">Where will you place <code>${exampleFolderName}</code> inside your Obsidian vault?</div>
                    <div style="border-top:1px solid #e5e7eb;width:60%;margin: 6px 0 10px;"></div>
                    <div style="margin: 6px 0;">If you put it under an existing vault's ${hl('root')}, keep the default value and ${hl('click Confirm')}.</div>
                    <div style="margin: 10px 0 6px;">If you put it under an existing vault's ${hl('subfolder')}, enter the ${hl('relative path')}.</div>
                    <div style="margin: 6px 0 10px; text-align: center;">
                        <div style="display: inline-block; padding: 4px 8px; border: 1px solid #e5e7eb; border-radius: 10px; background: rgba(255, 255, 255, 0.04); line-height: 1.5; box-sizing: border-box; text-align: center; max-width: 100%;">
                            <div style="font-weight: 600; margin: 0 0 1px; text-align: left;">Example:</div>
                            <div style="text-align: center;">${stepBExample}</div>
                        </div>
                    </div>
                    <div style="margin: 6px 0 0;">If this sync repository itself is your ${hl('standalone vault')}, ${hl('clear the input')} and click Confirm (files will be written to repo root).</div>
                </div>
            `
            : `
                <div style="margin-bottom: 10px; line-height: 1.6;">
                    <div style="margin-bottom: 8px;">请按以下流程选择位置，确保 Obsidian 能正确找到导出的 .md 文件。</div>
                    <div style="margin: 6px 0 10px; font-weight: 600;">把 <code>${exampleFolderName}</code> 放入 Obsidian vault（仓库）里的哪个位置。</div>
                    <div style="border-top:1px solid #e5e7eb;width:60%;margin: 6px 0 10px;"></div>
                    <div style="margin: 6px 0;">-若把它直接放在${hl('已有仓库的根目录')}下，请保持默认值，${hl('直接点击确认')}即可。</div>
                    <div style="margin: 10px 0 6px;">-若把它放在${hl('已有仓库的某个子文件夹')}下，请输入${hl('相对路径')}。</div>
                    <div style="margin: 6px 0 10px; text-align: center;">
                        <div style="display: inline-block; padding: 4px 8px; border: 1px solid #e5e7eb; border-radius: 10px; background: rgba(255, 255, 255, 0.04); line-height: 1.5; box-sizing: border-box; text-align: center; max-width: 100%;">
                            <div style="font-weight: 600; margin: 0 0 1px; text-align: left;">例如：</div>
                            <div style="text-align: center;">${stepBExample}</div>
                        </div>
                    </div>
                    <div style="margin: 6px 0 0;">-若这个同步仓库本身就是独立 vault，请${hl('清空输入框')}并点击确认（文件会直接写到仓库根目录，不创建“书签画布/”子目录）。</div>
                </div>
            `;
    }

    function formatSyncRootForDisplay(rootPath) {
        const normalized = normalizeSyncPath(rootPath);
        return normalized || textByLang('仓库根目录', 'repository root');
    }

    function buildRemotePathChangedNoticeHtml(candidates, currentRoot) {
        const list = Array.isArray(candidates) ? candidates : [];
        const currentLabel = formatSyncRootForDisplay(currentRoot);
        const candidateHtml = list.slice(0, 3).map((item) => {
            const root = normalizeSyncPath(item && item.root);
            const score = Number(item && item.score) || 0;
            return `<li><code>${escapeHtml(formatSyncRootForDisplay(root))}</code>${score > 0 ? ` <span style="opacity:.7;">(${score})</span>` : ''}</li>`;
        }).join('');
        return `
            <div style="margin:0 0 12px; padding:10px 12px; border:1px solid rgba(245,158,11,.35); border-radius:10px; background:rgba(245,158,11,.12);">
                <div style="font-weight:700; color:var(--warning-color, #f59e0b); margin-bottom:6px;">
                    ${textByLang('检测到云端路径可能已变化', 'Cloud path change detected')}
                </div>
                <div style="font-size:13px; line-height:1.6;">
                    ${textByLang(`当前设置：`, `Current setting:`)} <code>${escapeHtml(currentLabel)}</code>
                </div>
                <div style="font-size:13px; line-height:1.6; margin-top:4px;">
                    ${textByLang('云端候选路径：', 'Cloud candidates:')}
                    <ul style="margin:6px 0 0 18px; padding:0;">${candidateHtml || `<li>${escapeHtml(textByLang('未找到候选路径', 'No candidate found'))}</li>`}</ul>
                </div>
                <div style="font-size:12px; line-height:1.6; margin-top:6px; color:var(--text-secondary);">
                    ${textByLang('请重新校验路径；确认后，本次同步会继续使用新路径。', 'Please re-validate the path. After confirmation, this sync will continue with the new path.')}
                </div>
            </div>
        `;
    }

    function openFirstSyncPathValidationDialog(options = {}) {
        return new Promise((resolve) => {
            const existing = document.getElementById('canvasSyncPathValidationDialog');
            if (existing) {
                try { existing.remove(); } catch (_) { }
            }

            const rootInput = getElement('canvasSyncObsidianExportRootInput');
            const currentRoot = normalizeSyncPath(
                rootInput ? rootInput.value : (settings && settings.obsidianExportRoot)
            );
            const suggestedRoot = normalizeSyncPath(options && options.prefillRoot);
            const currentValue = (typeof options === 'object' && Object.prototype.hasOwnProperty.call(options, 'prefillRoot'))
                ? suggestedRoot
                : (typeof currentRoot === 'string' ? currentRoot : '');
            const continueAfterConfirm = !!(options && options.continueAfterConfirm);
            const noticeHtml = (options && typeof options.noticeHtml === 'string') ? options.noticeHtml : '';
            const title = textByLang('路径校验', 'Path Validation');
            const inputLabel = textByLang('请输入路径', 'Enter path');
            const confirmText = textByLang('确认', 'Confirm');
            const confirmLabel = textByLang('我已确认以上路径说明与输入路径一致', 'I confirm the path notes and input path are consistent');

            const dialog = document.createElement('div');
            dialog.className = 'import-dialog';
            dialog.id = 'canvasSyncPathValidationDialog';
            dialog.style.zIndex = '2147483647';
            dialog.innerHTML = `
                <div class="import-dialog-content" style="width:max-content;max-width:min(92vw, 620px);box-sizing:border-box;">
                    <div class="import-dialog-header">
                        <h3>${title}</h3>
                        <button class="import-dialog-close" id="closeCanvasSyncPathValidationDialog" type="button">&times;</button>
                    </div>
                    <div class="import-dialog-body" style="padding: 18px;">
                        ${noticeHtml}
                        ${buildFirstSyncPathGuideHtml(currentValue)}
                        <div style="margin: 0 0 6px; font-weight: 600;">${inputLabel}</div>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <input id="canvasSyncPathValidationInput" type="text" style="flex:1; padding: 9px 10px; border: 1px solid #d0d7de; border-radius: 8px;" />
                        </div>
                        ${continueAfterConfirm ? `<div style="margin-top:8px; font-size:12px; color:var(--text-secondary);">${textByLang('校验确认后，将继续执行首次同步。', 'After validation confirmation, first sync will continue.')}</div>` : ''}
                        <div style="margin-top:12px; display:flex; align-items:flex-end; justify-content:space-between; gap:12px;">
                            <div style="font-size:12px; line-height:1.5; color:var(--text-secondary); flex:1;">${confirmLabel}</div>
                            <button id="canvasSyncPathValidationConfirm" class="import-option-btn" style="width:auto; padding: 9px 14px; justify-content:center; align-self:flex-end;" type="button">
                                <i class="fas fa-check" aria-hidden="true"></i>
                                <span>${confirmText}</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;

            const cleanup = (result) => {
                try { dialog.remove(); } catch (_) { }
                resolve(result);
            };

            dialog.addEventListener('click', (event) => {
                if (event.target === dialog) cleanup(false);
            });

            document.body.appendChild(dialog);

            const closeBtn = document.getElementById('closeCanvasSyncPathValidationDialog');
            if (closeBtn) closeBtn.addEventListener('click', () => cleanup(false));

            const inputEl = document.getElementById('canvasSyncPathValidationInput');
            if (inputEl) {
                inputEl.value = currentValue;
                try { inputEl.focus(); inputEl.select(); } catch (_) { }
                inputEl.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        const nextRoot = normalizeObsidianExportRoot(inputEl.value, DEFAULT_SETTINGS.obsidianExportRoot, { allowEmpty: true });
                        if (rootInput) rootInput.value = nextRoot;
                        settings.obsidianExportRoot = nextRoot;
                        settings.firstSyncPathVerifiedRoot = normalizeSyncPath(nextRoot);
                        settings.firstSyncPathVerifiedAt = Date.now();
                        saveSettings();
                        cleanup(true);
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        cleanup(false);
                    }
                });
            }

            const confirmBtn = document.getElementById('canvasSyncPathValidationConfirm');
            if (confirmBtn) {
                confirmBtn.addEventListener('click', () => {
                    const nextRoot = normalizeObsidianExportRoot(
                        inputEl ? inputEl.value : currentValue,
                        DEFAULT_SETTINGS.obsidianExportRoot,
                        { allowEmpty: true }
                    );
                    if (rootInput) rootInput.value = nextRoot;
                    settings.obsidianExportRoot = nextRoot;
                    settings.firstSyncPathVerifiedRoot = normalizeSyncPath(nextRoot);
                    settings.firstSyncPathVerifiedAt = Date.now();
                    saveSettings();
                    cleanup(true);
                });
            }
        });
    }

    function getRepoConfigMissingReason(config) {
        const source = config && typeof config === 'object' ? config : {};
        if (!String(source.owner || '').trim() || !String(source.repo || '').trim()) {
            return textByLang('Owner / Repo 未配置', 'Owner / Repo not configured');
        }
        if (!String(source.token || '').trim()) {
            return textByLang('GitHub Token 未配置', 'GitHub token not configured');
        }
        return '';
    }

    function isManualSyncTrigger(_mode, trigger) {
        const triggerText = String(trigger || '').toLowerCase();
        if (!triggerText) return false;
        // Explicit user-initiated actions should show determinate progress on the button,
        // and should not be silently ignored.
        if (triggerText.startsWith('manual') || triggerText === 'user') return true;
        if (triggerText.startsWith('mismatch-panel-')) return true;
        return false;
    }

    function getSyncLang() {
        const normalizeLang = (raw) => {
            const value = String(raw || '').trim().toLowerCase();
            if (!value) return '';
            if (value === 'en' || value.startsWith('en')) return 'en';
            if (value === 'zh' || value === 'zh_cn' || value === 'zh-cn' || value.startsWith('zh')) return 'zh_CN';
            return '';
        };

        const langFromWindow = normalizeLang(global && global.currentLang);
        if (langFromWindow) return langFromWindow;

        try {
            const preferred = normalizeLang(localStorage.getItem('preferredLang'));
            if (preferred) return preferred;
        } catch (_) { }

        try {
            const docLang = normalizeLang(document && document.documentElement && document.documentElement.lang);
            if (docLang) return docLang;
        } catch (_) { }

        try {
            const navLang = normalizeLang((global && global.navigator && (global.navigator.language || (global.navigator.languages && global.navigator.languages[0]))) || '');
            if (navLang) return navLang;
        } catch (_) { }

        return 'zh_CN';
    }

    function textByLang(zh, en) {
        return getSyncLang() === 'en' ? en : zh;
    }

    function getGuideThemeParam() {
        const theme = String(document.documentElement.getAttribute('data-theme') || '').toLowerCase();
        if (theme === 'dark' || theme === 'light') {
            return theme;
        }
        return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function openTokenGuidePage() {
        const runtimeApi = getRuntimeApi();
        if (!runtimeApi || !runtimeApi.runtime || typeof runtimeApi.runtime.getURL !== 'function') {
            toast(textByLang('无法打开说明页：运行时不可用', 'Cannot open guide page: runtime is unavailable'));
            return;
        }

        const langParam = getSyncLang() === 'en' ? 'en' : 'zh';
        const themeParam = getGuideThemeParam();
        const guideUrl = `${runtimeApi.runtime.getURL('github-token-guide.html')}?lang=${encodeURIComponent(langParam)}&theme=${encodeURIComponent(themeParam)}`;

        if (runtimeApi.tabs && typeof runtimeApi.tabs.create === 'function') {
            runtimeApi.tabs.create({ url: guideUrl });
            return;
        }

        global.open(guideUrl, '_blank', 'noopener');
    }

    function openOfficialPluginPage() {
        const url = 'https://github.com/Vinzent03/obsidian-git';
        const runtimeApi = getRuntimeApi();
        if (runtimeApi && runtimeApi.tabs && typeof runtimeApi.tabs.create === 'function') {
            runtimeApi.tabs.create({ url });
            return;
        }
        global.open(url, '_blank', 'noopener');
    }

    function formatSyncMethodForDisplay(method) {
        const value = ensureSyncMethod(method);
        if (value === 'rebase') return textByLang('变基', 'Rebase');
        if (value === 'reset') return textByLang('仅记云端版本', 'Track remote revision only');
        return textByLang('合并', 'Merge');
    }

    function formatConflictPolicyForDisplay(policy) {
        const value = ensureConflictPolicy(policy);
        if (value === 'ours') return textByLang('本地优先', 'Our changes');
        if (value === 'theirs') return textByLang('云端优先', 'Their changes');
        return textByLang('手动处理冲突（Git 默认）', 'None (git default)');
    }

    function resolveFullSyncMode() {
        if (settings.pullOnSync && settings.pushOnSync) return 'full';
        if (settings.pullOnSync && !settings.pushOnSync) return 'pull';
        if (!settings.pullOnSync && settings.pushOnSync) return 'push';
        return 'noop';
    }

    // Triggers that should be treated as "user explicitly chose cloud -> local"
    // for permanent-section overwrite semantics.
    function isExplicitRemoteOverwriteTrigger(trigger) {
        const text = String(trigger || '').trim().toLowerCase();
        if (!text) return false;
        return text === 'manual-pull' || text === 'mismatch-panel-pull';
    }

    function shouldBypassPullPlanConflictCheck(trigger) {
        const text = String(trigger || '').trim().toLowerCase();
        if (!text) return false;
        return text === 'mismatch-panel-pull';
    }

    function isManualPushOnlyTrigger(trigger) {
        return String(trigger || '').trim().toLowerCase() === 'manual-push';
    }

    function getClientId() {
        let id = String(getSyncMetaRaw(CLIENT_ID_KEY) || '').trim();
        if (id) return id;
        id = `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        setSyncMetaRaw(CLIENT_ID_KEY, id);
        return id;
    }

    function toast(message) {
        if (typeof global.showToast === 'function') {
            try {
                global.showToast(message, { position: 'top-right' });
                return;
            } catch (_) { }
        }
        console.log('[Canvas Obsidian Git Sync]', message);
    }

    function getElement(id) {
        return document.getElementById(id);
    }

    function normalizeProgressPercent(value) {
        if (value == null) return null;
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        return Math.max(0, Math.min(100, n));
    }

    function ensureButtonProgressLabel(buttonEl) {
        if (!buttonEl) return null;
        const existing = buttonEl.querySelector('.canvas-sync-progress-label');
        if (existing) return existing;
        const label = document.createElement('span');
        label.className = 'canvas-sync-progress-label';
        label.textContent = '';
        buttonEl.appendChild(label);
        return label;
    }

    function setButtonProgress(buttonEl, message, percent) {
        if (!buttonEl) return;
        const label = ensureButtonProgressLabel(buttonEl);
        const normalized = normalizeProgressPercent(percent);
        if (normalized == null) {
            buttonEl.classList.remove('is-determinate');
            buttonEl.style.removeProperty('--canvas-sync-btn-progress');
            if (label) {
                label.textContent = String(message || textByLang('同步中...', 'Syncing...'));
            }
            return;
        }

        buttonEl.classList.add('is-determinate');
        buttonEl.style.setProperty('--canvas-sync-btn-progress', String(Math.max(0, Math.min(1, normalized / 100))));
        if (label) {
            label.textContent = `${Math.round(normalized)}%`;
        }
    }

    function setButtonBusy(buttonEl, busy) {
        if (!buttonEl) return;
        buttonEl.classList.toggle('is-busy', !!busy);
        if (busy) {
            buttonEl.setAttribute('aria-busy', 'true');
            setButtonProgress(buttonEl, textByLang('同步中...', 'Syncing...'), 0);
            return;
        }
        setButtonProgress(buttonEl, '', null);
        buttonEl.removeAttribute('aria-busy');
        try {
            const label = buttonEl.querySelector('.canvas-sync-progress-label');
            if (label) label.remove();
        } catch (_) { }
    }

    async function runWithButtonBusy(buttonEl, action) {
        if (!buttonEl || typeof action !== 'function') return null;
        const wasDisabled = !!buttonEl.disabled;
        syncUiProgressButtonEl = buttonEl;
        setButtonBusy(buttonEl, true);
        buttonEl.disabled = true;
        try {
            return await action();
        } finally {
            setButtonBusy(buttonEl, false);
            buttonEl.style.removeProperty('--canvas-sync-btn-progress');
            try { buttonEl.blur(); } catch (_) { }
            syncUiProgressButtonEl = null;
            if (!wasDisabled) buttonEl.disabled = false;
            updateSyncEnabledDependentFieldState();
        }
    }

    function isSyncPanelOpen() {
        const modal = getElement('canvasSyncModal');
        return !!(modal && modal.style.display === 'block');
    }

    function ensureFloatingProgressElements() {
        if (floatingProgressEl) return;
        if (!document.body) return;
        floatingProgressEl = document.createElement('div');
        floatingProgressEl.id = 'canvasSyncFloatingProgress';
        floatingProgressEl.className = 'canvas-sync-floating-progress';
        floatingProgressEl.hidden = true;

        const meta = document.createElement('div');
        meta.className = 'canvas-sync-floating-progress-meta';

        floatingProgressLabelEl = document.createElement('div');
        floatingProgressLabelEl.className = 'canvas-sync-floating-progress-label';
        floatingProgressLabelEl.textContent = textByLang('同步中...', 'Syncing...');

        floatingProgressPercentEl = document.createElement('div');
        floatingProgressPercentEl.className = 'canvas-sync-floating-progress-percent';
        floatingProgressPercentEl.textContent = '';

        meta.appendChild(floatingProgressLabelEl);
        meta.appendChild(floatingProgressPercentEl);

        const track = document.createElement('div');
        track.className = 'canvas-sync-floating-progress-track';

        const bar = document.createElement('div');
        bar.className = 'canvas-sync-floating-progress-bar';

        track.appendChild(bar);
        floatingProgressEl.appendChild(meta);
        floatingProgressEl.appendChild(track);
        document.body.appendChild(floatingProgressEl);
    }

    function updateFloatingProgressVisibility() {
        ensureFloatingProgressElements();
        if (!floatingProgressEl) return;

        const labelText = floatingProgressMessage || textByLang('同步中...', 'Syncing...');
        if (floatingProgressLabelEl) floatingProgressLabelEl.textContent = labelText;

        const normalized = normalizeProgressPercent(floatingProgressPercent);
        const determinate = normalized != null;
        floatingProgressEl.classList.toggle('is-determinate', determinate);
        if (determinate) {
            floatingProgressEl.style.setProperty('--canvas-sync-floating-progress', String(Math.max(0, Math.min(1, normalized / 100))));
        } else {
            floatingProgressEl.style.removeProperty('--canvas-sync-floating-progress');
        }
        if (floatingProgressPercentEl) {
            floatingProgressPercentEl.textContent = determinate ? `${Math.round(normalized)}%` : '';
        }

        const shouldShow = floatingProgressActive && determinate && !isSyncPanelOpen();
        floatingProgressEl.hidden = !shouldShow;
    }

    function setFloatingProgress(active, message = '', percent = null) {
        floatingProgressActive = !!active;
        floatingProgressMessage = String(message || '');
        floatingProgressPercent = percent == null ? null : Number(percent);
        updateFloatingProgressVisibility();
    }

    function updateSyncUiProgress(message, percent = null) {
        if (!syncUiProgressEnabled) return;
        const normalized = normalizeProgressPercent(percent);
        setFloatingProgress(true, message, normalized);
        setButtonProgress(syncUiProgressButtonEl, message, normalized);
    }

    function clearSyncUiProgress() {
        setFloatingProgress(false, '', null);
        setButtonProgress(syncUiProgressButtonEl, '', null);
    }

    function makeProgressRange(startPercent, endPercent) {
        const start = normalizeProgressPercent(startPercent) ?? 0;
        const end = normalizeProgressPercent(endPercent) ?? 100;
        const span = end - start;
        return (fraction, message) => {
            if (!syncUiProgressEnabled) return;
            const raw = Number(fraction);
            const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
            updateSyncUiProgress(message, start + (span * clamped));
        };
    }

    function formatTime(ts) {
        if (!ts || !Number.isFinite(ts)) return '-';
        const date = new Date(ts);
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString();
    }

    function formatBytes(bytes) {
        const n = Number(bytes) || 0;
        if (n < 1024) return `${n} B`;
        if (n < (1024 * 1024)) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    }

    function shortText(value, fallback = '-') {
        const raw = String(value || '').trim();
        if (!raw) return fallback;
        if (raw.length <= 12) return raw;
        return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDirtySerialToken(rawValue, fallbackIndex = 0) {
        const raw = String(rawValue == null ? '' : rawValue).trim();
        if (!raw) return `#${Math.max(1, Number(fallbackIndex) + 1)}`;

        if (/^[A-Za-z0-9_-]+$/.test(raw)) {
            return `#${raw}`;
        }

        const hashMatch = raw.match(/#([A-Za-z0-9_-]+)/);
        if (hashMatch) return `#${hashMatch[1]}`;

        const alnumMatch = raw.match(/([A-Za-z0-9_-]+)/);
        if (alnumMatch) return `#${alnumMatch[1]}`;

        return `#${Math.max(1, Number(fallbackIndex) + 1)}`;
    }

    function toAlphaLabelByNumber(value) {
        let number = Number.parseInt(value, 10);
        if (!Number.isFinite(number) || number <= 0) return '';
        let output = '';
        while (number > 0) {
            const remainder = (number - 1) % 26;
            output = String.fromCharCode(65 + remainder) + output;
            number = Math.floor((number - 1) / 26);
        }
        return output;
    }

    function normalizeTemporarySerial(rawValue) {
        const raw = String(rawValue == null ? '' : rawValue).trim();
        if (!raw) return '';

        const embeddedDash = raw.match(/([A-Za-z]+-\d+(?:-\d+)*)/);
        if (embeddedDash) return embeddedDash[1].toUpperCase();

        const oldScheme = raw.match(/^([A-Za-z]+)(\d+(?:-\d+)*)$/);
        if (oldScheme) {
            const alpha = oldScheme[1].toUpperCase();
            return `${alpha}-1-${oldScheme[2]}`;
        }

        return '';
    }

    function getTemporarySerialMapFromCanvasState() {
        const serialById = {};
        try {
            let sections = [];
            if (global.CanvasModule && global.CanvasModule.CanvasState && Array.isArray(global.CanvasModule.CanvasState.tempSections)) {
                sections = global.CanvasModule.CanvasState.tempSections;
            } else if (Array.isArray(global.CanvasState && global.CanvasState.tempSections)) {
                sections = global.CanvasState.tempSections;
            } else {
                const rawState = safeParse(localStorage.getItem(TEMP_SECTION_STORAGE_KEY), null);
                if (rawState && typeof rawState === 'object' && Array.isArray(rawState.sections)) {
                    sections = rawState.sections;
                }
            }
            sections.forEach((section) => {
                const sectionId = String(section && section.id || '').trim();
                if (!sectionId) return;

                let serial = '';
                if (typeof global.getTempSectionLabel === 'function') {
                    serial = normalizeTemporarySerial(global.getTempSectionLabel(section));
                }
                if (!serial) {
                    serial = normalizeTemporarySerial(section && section.label);
                }
                if (!serial) {
                    const sequence = Number.parseInt(section && section.sequenceNumber, 10);
                    if (Number.isFinite(sequence) && sequence > 0) {
                        const alpha = toAlphaLabelByNumber(sequence);
                        if (alpha) serial = `${alpha}-1`;
                    }
                }
                if (!serial) {
                    serial = normalizeTemporarySerial(section && section.title);
                }
                if (serial) serialById[sectionId] = serial;
            });
        } catch (_) { }
        return serialById;
    }

    function compareSerialToken(left, right) {
        return String(left || '').localeCompare(String(right || ''), undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    }

    function extractFileBaseName(path) {
        const normalizedPath = normalizeSyncPath(path);
        if (!normalizedPath) return '';
        const fileName = normalizedPath.split('/').filter(Boolean).pop() || normalizedPath;
        return fileName.replace(/\.[^.]+$/i, '').trim();
    }

    function formatPermanentSerialTokenFromPath(path, fallbackIndex = 0) {
        const baseName = extractFileBaseName(path);
        if (!baseName) return `#${Math.max(1, Number(fallbackIndex) + 1)}`;
        const markerMatch = baseName.match(/^([A-Za-z0-9_-]+)/);
        if (markerMatch) {
            return `#${markerMatch[1]}`;
        }
        return `#${Math.max(1, Number(fallbackIndex) + 1)}`;
    }

    function formatTemporarySerialToken(sectionId, sectionPath, explicitSerial = '', runtimeSerialById = null, fallbackIndex = 0) {
        const explicitMatch = normalizeTemporarySerial(explicitSerial);
        if (explicitMatch) return explicitMatch;

        const rawId = String(sectionId == null ? '' : sectionId).trim();
        if (runtimeSerialById && rawId && runtimeSerialById[rawId]) {
            return runtimeSerialById[rawId];
        }

        const directMatch = normalizeTemporarySerial(rawId);
        if (directMatch) return directMatch;

        const baseName = extractFileBaseName(sectionPath);
        const pathMatch = normalizeTemporarySerial(baseName);
        if (pathMatch) return pathMatch;

        return `T-${Math.max(1, Number(fallbackIndex) + 1)}`;
    }

    function isCanvasNativeTextNode(node) {
        if (!node || typeof node !== 'object') return false;
        const subtype = String(node.subtype || '').trim().toLowerCase();
        const source = String(node.source || '').trim().toLowerCase();
        return subtype === 'canvas-native-text' || source === 'obsidian-canvas-text';
    }

    function buildDirtySerialLines(dirtyStateRaw = null, pathMapRaw = null) {
        const dirty = dirtyStateRaw ? normalizeDirtyState(dirtyStateRaw) : loadDirtyState();
        const pathMap = pathMapRaw ? normalizePathMap(pathMapRaw) : loadPathMap();
        const runtimeTemporarySerialById = getTemporarySerialMapFromCanvasState();

        const permanentPathSet = new Set();
        if (dirty.permanent.all) {
            pathMap.permanentPaths.forEach((path) => permanentPathSet.add(path));
        }
        dirty.permanent.paths.forEach((path) => permanentPathSet.add(path));
        const permanentTokens = uniqueStringList(
            Array.from(permanentPathSet).map((path, index) => formatPermanentSerialTokenFromPath(path, index))
        ).sort((left, right) => compareSerialToken(String(left).replace(/^#/, ''), String(right).replace(/^#/, '')));

        const temporaryIdSet = new Set();
        if (dirty.temporary.all) {
            const runtimeIds = Object.keys(runtimeTemporarySerialById);
            if (runtimeIds.length) {
                runtimeIds.forEach((id) => temporaryIdSet.add(id));
            } else {
                Object.keys(pathMap.temporaryById || {}).forEach((id) => temporaryIdSet.add(id));
            }
        }
        dirty.temporary.ids.forEach((id) => temporaryIdSet.add(id));
        const temporaryTokens = uniqueStringList(
            Array.from(temporaryIdSet).map((id, index) => {
                const mappedPath = pathMap.temporaryById && pathMap.temporaryById[id];
                const mappedSerial = pathMap.temporarySerialById && pathMap.temporarySerialById[id];
                return formatTemporarySerialToken(id, mappedPath, mappedSerial, runtimeTemporarySerialById, index);
            })
        ).sort(compareSerialToken);

        const blankCount = (() => {
            if (dirty.blank.all) {
                const mappedCount = Object.keys(pathMap.blankById || {}).length;
                const localCount = Array.isArray(global.CanvasState && global.CanvasState.mdNodes)
                    ? global.CanvasState.mdNodes.filter((node) => node && node.subtype !== 'import-container' && !isCanvasNativeTextNode(node)).length
                    : 0;
                return Math.max(mappedCount, dirty.blank.ids.length, localCount);
            }
            return dirty.blank.ids.length;
        })();
        const nativeCardCount = (dirty.blank.all && Array.isArray(global.CanvasState && global.CanvasState.mdNodes))
            ? global.CanvasState.mdNodes.filter((node) => node && node.subtype !== 'import-container' && isCanvasNativeTextNode(node)).length
            : 0;

        const lines = [];
        if (permanentTokens.length) {
            lines.push(textByLang(`永久：${permanentTokens.join(' ')}`, `Permanent: ${permanentTokens.join(' ')}`));
        }
        if (temporaryTokens.length) {
            lines.push(textByLang(`临时：${temporaryTokens.join(' ')}`, `Temporary: ${temporaryTokens.join(' ')}`));
        }
        if (dirty.blank.all || blankCount > 0) {
            lines.push(textByLang(`空白：${blankCount}`, `Blank: ${blankCount}`));
        }
        if (nativeCardCount > 0) {
            lines.push(textByLang(`其他：原生卡片 ${nativeCardCount}`, `Other: native cards ${nativeCardCount}`));
        }
        if (dirty.canvas.layoutDirty || dirty.canvas.fileRefDirty) {
            lines.push(textByLang('画布：已变更', 'Canvas: changed'));
        }

        return lines;
    }

    function buildDirtySerialLinesHtml(dirtyStateRaw = null, pathMapRaw = null) {
        const lines = buildDirtySerialLines(dirtyStateRaw, pathMapRaw);
        if (!lines.length) {
            return `<span>${escapeHtml(textByLang('无', 'None'))}</span>`;
        }
        return lines.map((line) => `<span>${escapeHtml(line)}</span>`).join('');
    }

    function buildDirtySerialSummary(dirtyStateRaw = null) {
        const lines = buildDirtySerialLines(dirtyStateRaw);
        if (!lines.length) {
            return textByLang('无', 'None');
        }
        return lines.join(textByLang('；', '; '));
    }

    function getCurrentCloudHashForDisplay() {
        const pendingCloud = String(runtime && runtime.pendingMismatchRemoteSha || '').trim();
        if (pendingCloud) return pendingCloud;

        const checkedCloud = String(runtime && runtime.lastCheckRemoteSha || '').trim();
        if (checkedCloud) return checkedCloud;

        return String(runtime && runtime.lastRemoteSha || '').trim();
    }

    function getRecordedCloudHashForDisplay() {
        return String(runtime && runtime.lastRemoteSha || '').trim();
    }

    function buildLocalObsidianRevisionFromEntries(entries) {
        const source = Array.isArray(entries) ? entries : [];
        const canonical = source
            .map((entry) => ({
                path: normalizeSyncPath(entry && entry.path),
                hash: String((entry && entry.hash) || '')
            }))
            .filter((entry) => !!entry.path && !!entry.hash)
            .sort((a, b) => a.path.localeCompare(b.path))
            .map((entry) => `${entry.path}:${entry.hash}`)
            .join('\n');
        if (!canonical) return '';
        return `files:${hashString(canonical)}`;
    }

    function buildLocalObsidianRevisionFromHashMap(hashMap) {
        const source = (hashMap && typeof hashMap === 'object' && !Array.isArray(hashMap)) ? hashMap : {};
        return buildLocalObsidianRevisionFromEntries(
            Object.keys(source).map((path) => ({
                path,
                hash: source[path]
            }))
        );
    }

    function getCurrentLocalHashForDisplay() {
        const runtimeLocalFilesSha = String(runtime && runtime.lastLocalFilesSha || '').trim();
        if (runtimeLocalFilesSha) return runtimeLocalFilesSha;

        const indexedLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes());
        if (indexedLocalFilesSha) return indexedLocalFilesSha;

        const prevSyncIndex = loadPrevSyncIndex();
        const prevFiles = prevSyncIndex && prevSyncIndex.files && typeof prevSyncIndex.files === 'object'
            ? prevSyncIndex.files
            : {};
        const prevLocalFilesSha = buildLocalObsidianRevisionFromEntries(
            Object.keys(prevFiles).map((path) => ({
                path,
                hash: prevFiles[path] && prevFiles[path].hash
            }))
        );
        if (prevLocalFilesSha) return prevLocalFilesSha;
        return '';
    }

    function getDirectionText(direction) {
        const raw = String(direction || '').trim();
        if (!raw) return '-';
        if (raw === 'push') return textByLang('本地 → 云端', 'Local → Remote');
        if (raw === 'pull') return textByLang('云端 → 本地', 'Remote → Local');
        if (raw === 'noop') return textByLang('无变化', 'No Changes');
        if (raw === 'reset-head') return textByLang('仅记云端版本（仅更新 HEAD，不覆盖本地）', 'Track remote revision only (update HEAD only, keep local working tree)');
        if (raw === 'conflict-local') return textByLang('冲突已选：本地优先', 'Conflict Resolved: Local Preferred');
        if (raw === 'conflict-remote') return textByLang('冲突已选：云端优先', 'Conflict Resolved: Remote Preferred');
        if (raw === 'conflict') return textByLang('等待冲突处理', 'Waiting for Conflict Resolution');
        return raw;
    }


    function updateStatusPanelActionPlacement() {
        const statusTabPanel = getElement('canvasSyncTabStatusPanel');
        if (!statusTabPanel) return;

        const conflictPanel = getElement('canvasSyncConflictPanel');
        const mismatchPanel = getElement('canvasSyncMismatchPanel');

        const hasVisiblePanel = !!(
            (conflictPanel && !conflictPanel.hidden)
            || (mismatchPanel && !mismatchPanel.hidden)
        );

        statusTabPanel.classList.toggle('canvas-sync-tab-status--has-panel', hasVisiblePanel);
    }

    function renderStatus() {
        const runningEl = getElement('canvasSyncStatusRunning');
        const queueEl = getElement('canvasSyncStatusQueue');
        const lastEl = getElement('canvasSyncStatusLastSuccess');
        const directionEl = getElement('canvasSyncStatusLastDirection');
        const obsidianPushAtEl = getElement('canvasSyncStatusObsidianPushAt');
        const obsidianPushDeltaEl = getElement('canvasSyncStatusObsidianPushDelta');
        const remoteShaEl = getElement('canvasSyncStatusRemoteSha');
        const localHashEl = getElement('canvasSyncStatusLocalHash');
        const otherEl = getElement('canvasSyncStatusOther');
        const pendingMismatchEl = getElement('canvasSyncStatusPendingMismatch');
        const errorEl = getElement('canvasSyncStatusError');

        if (runningEl) {
            if (runtime.isRunning) {
                runningEl.textContent = textByLang('执行中', 'Running');
            } else if (runtime.hasPendingConflict) {
                runningEl.textContent = textByLang('等待冲突处理', 'Waiting for Conflict Resolution');
            } else {
                runningEl.textContent = textByLang('空闲', 'Idle');
            }
        }
        if (queueEl) queueEl.textContent = String(runtime.queueLength || 0);
        if (lastEl) lastEl.textContent = formatTime(runtime.lastSuccessAt);
        if (directionEl) directionEl.textContent = getDirectionText(runtime.lastAppliedDirection);
        if (obsidianPushAtEl) {
            obsidianPushAtEl.textContent = runtime.lastObsidianPushAt
                ? formatTime(runtime.lastObsidianPushAt)
                : '-';
        }
        if (obsidianPushDeltaEl) {
            const total = Number(runtime.lastObsidianPushTotal) || 0;
            const changed = Number(runtime.lastObsidianPushChanged) || 0;
            obsidianPushDeltaEl.textContent = total > 0 ? `${changed}/${total}` : '-';
        }
        if (remoteShaEl) {
            const cloudHash = String(getCurrentCloudHashForDisplay() || '').trim();
            remoteShaEl.textContent = cloudHash || '-';
        }
        if (localHashEl) {
            const localHash = String(getCurrentLocalHashForDisplay() || '').trim();
            localHashEl.textContent = localHash || '-';
        }
        if (otherEl) {
            otherEl.innerHTML = `<div class="canvas-sync-other-lines">${buildDirtySerialLinesHtml()}</div>`;
        }
        if (pendingMismatchEl) {
            pendingMismatchEl.textContent = runtime.pendingMismatch
                ? textByLang('有（待处理）', 'Yes (pending)')
                : textByLang('无', 'None');
        }
        if (errorEl) {
            const missingReason = getRepoConfigMissingReason(repoConfig);
            const repoNotReadyText = missingReason
                ? textByLang(`仓库未就绪：${missingReason}`, `Repository not ready: ${missingReason}`)
                : '';
            errorEl.textContent = runtime.lastError || repoNotReadyText || textByLang('无', 'None');
        }

        renderMismatchPanel();
        updateStatusPanelActionPlacement();
        updateSyncEnabledDependentFieldState();
    }

    function secondsToMinutes(seconds) {
        const value = Number(seconds);
        if (!Number.isFinite(value) || value <= 0) {
            return 3;
        }
        return Math.max(1, Math.round(value / 60));
    }

    function minutesToSeconds(minutes) {
        const value = Number(minutes);
        if (!Number.isFinite(value) || value <= 0) {
            return DEFAULT_SETTINGS.intervalSeconds;
        }
        return Math.max(60, Math.min(86400, Math.round(value * 60)));
    }

	    function setFirstSyncModeToForm(mode) {
	        const resolvedMode = ensureFirstSyncMode(mode);
	        const autoInput = getElement('canvasSyncFirstSyncModeAutoInput');
	        const cloudInput = getElement('canvasSyncFirstSyncModeCloudInput');
	        const localInput = getElement('canvasSyncFirstSyncModeLocalInput');
	        const autoInput2 = getElement('canvasSyncPermanentModeAutoInput');
	        const cloudInput2 = getElement('canvasSyncPermanentModeCloudInput');
	        const localInput2 = getElement('canvasSyncPermanentModeLocalInput');

	        if (autoInput) autoInput.checked = resolvedMode === 'auto';
	        if (cloudInput) cloudInput.checked = resolvedMode === 'cloud';
	        if (localInput) localInput.checked = resolvedMode === 'local';
	        if (autoInput2) autoInput2.checked = resolvedMode === 'auto';
	        if (cloudInput2) cloudInput2.checked = resolvedMode === 'cloud';
	        if (localInput2) localInput2.checked = resolvedMode === 'local';

	        const legacySelect = getElement('canvasSyncFirstSyncModeSelect');
	        if (legacySelect) legacySelect.value = resolvedMode;
	    }

	    function getFirstSyncModeFromForm(fallbackMode) {
	        const autoInput = getElement('canvasSyncFirstSyncModeAutoInput');
	        const cloudInput = getElement('canvasSyncFirstSyncModeCloudInput');
	        const localInput = getElement('canvasSyncFirstSyncModeLocalInput');
	        const autoInput2 = getElement('canvasSyncPermanentModeAutoInput');
	        const cloudInput2 = getElement('canvasSyncPermanentModeCloudInput');
	        const localInput2 = getElement('canvasSyncPermanentModeLocalInput');
	        const legacySelect = getElement('canvasSyncFirstSyncModeSelect');

	        // Prefer the radio that just changed (avoids two groups being temporarily out of sync).
	        try {
	            const active = global.document && global.document.activeElement ? global.document.activeElement : null;
	            const activeId = active && active.id ? String(active.id) : '';
	            if (active && typeof active.value === 'string') {
	                if (
	                    activeId === 'canvasSyncFirstSyncModeAutoInput'
	                    || activeId === 'canvasSyncFirstSyncModeCloudInput'
	                    || activeId === 'canvasSyncFirstSyncModeLocalInput'
	                    || activeId === 'canvasSyncPermanentModeAutoInput'
	                    || activeId === 'canvasSyncPermanentModeCloudInput'
	                    || activeId === 'canvasSyncPermanentModeLocalInput'
	                ) {
	                    return ensureFirstSyncMode(active.value);
	                }
	            }
	        } catch (_) { }

	        if (autoInput && autoInput.checked) return 'auto';
	        if (cloudInput && cloudInput.checked) return 'cloud';
	        if (localInput && localInput.checked) return 'local';
	        if (autoInput2 && autoInput2.checked) return 'auto';
	        if (cloudInput2 && cloudInput2.checked) return 'cloud';
	        if (localInput2 && localInput2.checked) return 'local';
	        if (legacySelect) return ensureFirstSyncMode(legacySelect.value);

	        return ensureFirstSyncMode(fallbackMode);
	    }

    function isSyncEnabledToggleChecked() {
        const enabledToggle = getElement('canvasSyncEnabledToggle');
        return !!(enabledToggle && enabledToggle.checked);
    }

    function setControlDisabledState(controlEl, disabled, hint) {
        if (!controlEl) return;

        const disabledFlag = !!disabled;
        controlEl.disabled = disabledFlag;
        controlEl.title = disabledFlag ? (hint || '') : '';

        const rowEl = typeof controlEl.closest === 'function'
            ? controlEl.closest('.canvas-sync-row')
            : null;
        if (!rowEl) return;

        rowEl.classList.toggle('canvas-sync-row--disabled', disabledFlag);
        rowEl.setAttribute('aria-disabled', disabledFlag ? 'true' : 'false');
        rowEl.title = disabledFlag ? (hint || '') : '';
    }

    function setActionDisabledState(buttonEl, disabled, hint) {
        if (!buttonEl) return;
        const disabledFlag = !!disabled;
        buttonEl.disabled = disabledFlag;
        buttonEl.title = disabledFlag ? (hint || '') : '';
    }

    function isMismatchPreviewActive() {
        return previewPanelMode === 'mismatch' && !pendingConflict && !(runtime && runtime.pendingMismatch);
    }

    function isConflictPreviewActive() {
        return previewPanelMode === 'conflict' && !pendingConflict;
    }

    function buildPreviewConflictPayload() {
        const now = Date.now();
        const localSnapshot = normalizeSnapshot({
            updatedAt: now - 90 * 1000,
            data: {
                [TEMP_SECTION_STORAGE_KEY]: JSON.stringify({ cards: [{ id: 'preview-local-card', title: 'local card' }] }),
                'canvas-permanent-tip-text': 'preview-local'
            }
        });
        const remoteSnapshot = normalizeSnapshot({
            updatedAt: now - 50 * 1000,
            data: {
                [TEMP_SECTION_STORAGE_KEY]: JSON.stringify({ cards: [{ id: 'preview-remote-card', title: 'remote card' }] }),
                'canvas-permanent-tip-text': 'preview-remote'
            }
        });

        return {
            id: `preview-conflict-${now}`,
            createdAt: now,
            reason: 'preview',
            remoteSha: 'preview-remote-sha',
            remotePath: settings && settings.obsidianExportRoot ? String(settings.obsidianExportRoot) : '',
            localSnapshot,
            remoteSnapshot,
            localMeta: buildSnapshotMeta(localSnapshot),
            remoteMeta: buildSnapshotMeta(remoteSnapshot)
        };
    }

    function updatePreviewActionButtonState() {
        const enabledOn = isSyncEnabledToggleChecked();
        const disabledByMaster = !enabledOn;
        const disabledByRunning = !!(runtime && runtime.isRunning);
        const disabledHint = textByLang(
            '启用同步已关闭：此项不可用',
            'Sync is disabled: this button is unavailable'
        );
        const previewHint = textByLang(
            '预览模式：此按钮仅用于查看样式，不执行同步操作',
            'Preview mode: this button is display-only and will not run sync actions'
        );
        const runningHint = textByLang(
            '正在同步：请等待当前同步完成',
            'Sync is running: please wait for completion'
        );

        const mismatchPreview = isMismatchPreviewActive();
        const conflictPreview = isConflictPreviewActive();

        const mismatchRemoteBtn = getElement('canvasSyncMismatchUseRemoteBtn');
        setActionDisabledState(
            mismatchRemoteBtn,
            disabledByMaster || mismatchPreview || disabledByRunning,
            disabledByMaster ? disabledHint : (mismatchPreview ? previewHint : (disabledByRunning ? runningHint : ''))
        );

        const mismatchLocalBtn = getElement('canvasSyncMismatchUseLocalBtn');
        setActionDisabledState(
            mismatchLocalBtn,
            disabledByMaster || mismatchPreview || disabledByRunning,
            disabledByMaster ? disabledHint : (mismatchPreview ? previewHint : (disabledByRunning ? runningHint : ''))
        );

        const conflictLocalBtn = getElement('canvasSyncConflictUseLocalBtn');
        setActionDisabledState(
            conflictLocalBtn,
            disabledByMaster || conflictPreview || disabledByRunning,
            disabledByMaster ? disabledHint : (conflictPreview ? previewHint : (disabledByRunning ? runningHint : ''))
        );

        const conflictRemoteBtn = getElement('canvasSyncConflictUseRemoteBtn');
        setActionDisabledState(
            conflictRemoteBtn,
            disabledByMaster || conflictPreview || disabledByRunning,
            disabledByMaster ? disabledHint : (conflictPreview ? previewHint : (disabledByRunning ? runningHint : ''))
        );
    }

    function setPreviewPanelMode(mode) {
        const targetMode = mode === 'mismatch' || mode === 'conflict' ? mode : '';
        previewPanelMode = targetMode;

        if (targetMode === 'conflict' && !pendingConflict) {
            previewConflict = buildPreviewConflictPayload();
        } else if (targetMode !== 'conflict') {
            previewConflict = null;
        }

        renderStatus();
        renderConflictPanel();
        updatePreviewActionButtonState();
    }

    function scrollStatusPanelToPreview(mode) {
        const statusPanel = getElement('canvasSyncTabStatusPanel');
        if (!statusPanel) return;

        const targetId = mode === 'conflict' ? 'canvasSyncConflictPanel' : 'canvasSyncMismatchPanel';
        const targetPanel = getElement(targetId);
        if (!targetPanel) return;

        const doScroll = () => {
            const top = Math.max(0, (targetPanel.offsetTop || 0) - 8);
            if (typeof statusPanel.scrollTo === 'function') {
                try {
                    statusPanel.scrollTo({ top, behavior: 'smooth' });
                    return;
                } catch (_) { }
            }
            statusPanel.scrollTop = top;
        };

        global.requestAnimationFrame(() => {
            global.requestAnimationFrame(doScroll);
        });
    }

    function ensureStatusPanelVisible(mode, noticeText = '') {
        const modal = getElement('canvasSyncModal');
        if (!modal) return;

        const isOpen = modal.style.display === 'block';
        if (isOpen) {
            setActiveTab('status');
            renderStatus();
            renderConflictPanel();
        } else {
            openPanel({ activeTab: 'status' });
        }

        const statusPanel = getElement('canvasSyncTabStatusPanel');
        if (statusPanel) {
            const goTop = () => {
                if (typeof statusPanel.scrollTo === 'function') {
                    try {
                        statusPanel.scrollTo({ top: 0, behavior: 'auto' });
                        return;
                    } catch (_) { }
                }
                statusPanel.scrollTop = 0;
            };

            global.requestAnimationFrame(() => {
                global.requestAnimationFrame(goTop);
            });
        }

        if (noticeText) {
            toast(noticeText);
        }
    }

    function updateSyncEnabledDependentFieldState() {
        const enabledOn = isSyncEnabledToggleChecked();
        const disabledHint = textByLang(
            '启用同步已关闭：此项不可用',
            'Sync is disabled: this field is unavailable'
        );
        const shouldDisable = !enabledOn;

	        [
	            'canvasSyncAutoToggle',
	            'canvasSyncAutoAfterEditStopToggle',
	            'canvasSyncFirstSyncModeAutoInput',
	            'canvasSyncFirstSyncModeCloudInput',
	            'canvasSyncFirstSyncModeLocalInput',
	            'canvasSyncPermanentModeAutoInput',
	            'canvasSyncPermanentModeCloudInput',
	            'canvasSyncPermanentModeLocalInput',
	            'canvasSyncPermanentTreeIntervalSelect',
	            'canvasSyncTempSectionIntervalInput',
	            'canvasSyncMdNodeIntervalInput',
	            'canvasSyncSplitIntervalsToggle',
            'canvasSyncMismatchPolicySelect',
            'canvasSyncPullOnStartupToggle',
            'canvasSyncPushOnSyncToggle',
            'canvasSyncPullOnSyncToggle',
            'canvasSyncHideNoChangeNoticeToggle',
            'canvasSyncMethodSelect',
            'canvasSyncConflictSelect',
            'canvasSyncDeleteThresholdInput',
            'canvasSyncPermanentPullModeSelect',
            'canvasSyncPermanentIncrementalThresholdInput',
            'canvasSyncObsidianFilePushToggle',
            'canvasSyncObsidianExportFormatSelect',
            'canvasSyncObsidianExportRootInput'
        ].forEach((id) => {
            setControlDisabledState(getElement(id), shouldDisable, disabledHint);
        });

        const disabledByRunning = !!(runtime && runtime.isRunning);
        const runningHint = textByLang(
            '正在同步：请等待当前同步完成',
            'Sync is running: please wait for completion'
        );

        [
            'canvasSyncNowBtn',
            'canvasSyncPushOnlyBtn',
            'canvasSyncPullOnlyBtn',
            'canvasSyncRebuildBtn',
            'canvasSyncFirstSyncPathCheckBtn',
            'canvasSyncFirstSyncOverwriteBtn',
            'canvasSyncRunBgCheckBtn',
            'canvasSyncPreviewMismatchBtn',
            'canvasSyncPreviewConflictBtn',
            'canvasSyncMismatchUseRemoteBtn',
            'canvasSyncMismatchUseLocalBtn',
            'canvasSyncMismatchDismissBtn',
            'canvasSyncConflictUseLocalBtn',
            'canvasSyncConflictUseRemoteBtn',
            'canvasSyncConflictDismissBtn'
        ].forEach((id) => {
            setActionDisabledState(
                getElement(id),
                shouldDisable || disabledByRunning,
                shouldDisable ? disabledHint : (disabledByRunning ? runningHint : '')
            );
        });

        updateBackgroundCheckFieldState();
        updatePermanentPullModeFieldState();
        updatePreviewActionButtonState();
    }


    function updatePermanentPullModeFieldState() {
        const enabledOn = isSyncEnabledToggleChecked();
        const permanentPullMode = getElement('canvasSyncPermanentPullModeSelect');
        const thresholdInput = getElement('canvasSyncPermanentIncrementalThresholdInput');

        const disabledByMasterHint = textByLang(
            '启用同步已关闭：此项不可用',
            'Sync is disabled: this field is unavailable'
        );
        const disabledByModeHint = textByLang(
            '当前非“自动”：此项仅在“自动”下可用',
            'Current mode is not auto: this field is available only in auto mode'
        );

        const autoMode = !!(enabledOn && permanentPullMode && ensurePermanentPullMode(permanentPullMode.value) === 'auto');
        const fieldHint = !enabledOn ? disabledByMasterHint : disabledByModeHint;

        setControlDisabledState(
            thresholdInput,
            !autoMode,
            fieldHint
        );
    }

    function updateBackgroundCheckFieldState() {
        const enabledOn = isSyncEnabledToggleChecked();
        const foregroundCheckToggle = getElement('canvasSyncForegroundCheckToggle');
        const foregroundCheckIntervalInput = getElement('canvasSyncForegroundCheckIntervalInput');
        const backgroundCheckToggle = getElement('canvasSyncBackgroundCheckToggle');
        const backgroundCheckIntervalInput = getElement('canvasSyncBackgroundCheckIntervalInput');
        const backgroundCooldownInput = getElement('canvasSyncBackgroundCooldownInput');
        const mismatchPolicySelect = getElement('canvasSyncMismatchPolicySelect');

        const disabledByMasterHint = textByLang(
            '启用同步已关闭：此项不可用',
            'Sync is disabled: this field is unavailable'
        );
        const disabledByForegroundCheckHint = textByLang(
            '前台检测已关闭：此项不生效',
            'Foreground check disabled: this field is inactive'
        );
        const disabledByBackgroundCheckHint = textByLang(
            '后台检测已关闭：此项不生效',
            'Background check disabled: this field is inactive'
        );

        const foregroundCheckOn = !!(enabledOn && foregroundCheckToggle && foregroundCheckToggle.checked);
        const backgroundCheckOn = !!(enabledOn && backgroundCheckToggle && backgroundCheckToggle.checked);
        const mismatchFieldHint = !enabledOn ? disabledByMasterHint : textByLang(
            '前台和后台检测都已关闭：此项不生效',
            'Both foreground and background checks are disabled: this field is inactive'
        );

        setControlDisabledState(
            foregroundCheckToggle,
            !enabledOn,
            disabledByMasterHint
        );
        setControlDisabledState(
            foregroundCheckIntervalInput,
            !foregroundCheckOn,
            !enabledOn ? disabledByMasterHint : disabledByForegroundCheckHint
        );
        setControlDisabledState(
            backgroundCheckToggle,
            !enabledOn,
            disabledByMasterHint
        );
        setControlDisabledState(
            backgroundCheckIntervalInput,
            !backgroundCheckOn,
            !enabledOn ? disabledByMasterHint : disabledByBackgroundCheckHint
        );
        setControlDisabledState(
            backgroundCooldownInput,
            !backgroundCheckOn,
            !enabledOn ? disabledByMasterHint : disabledByBackgroundCheckHint
        );
        setControlDisabledState(
            mismatchPolicySelect,
            !(foregroundCheckOn || backgroundCheckOn),
            mismatchFieldHint
        );
    }

    function updateTimerModeFieldState() {
        const splitInterval = getElement('canvasSyncSplitIntervalsToggle');
        const intervalInput = getElement('canvasSyncIntervalInput');
        const pushIntervalInput = getElement('canvasSyncAutoPushIntervalInput');
        const pullIntervalInput = getElement('canvasSyncAutoPullIntervalInput');

        const enabledOn = isSyncEnabledToggleChecked();
        const splitOn = !!(enabledOn && splitInterval && splitInterval.checked);
        const disabledByMasterHint = textByLang(
            '启用同步已关闭：此项不可用',
            'Sync is disabled: this field is unavailable'
        );
        const intervalDisabledHint = textByLang(
            '分离定时器已开启：此项不生效',
            'Split timers enabled: this field is inactive'
        );
        const pushPullDisabledHint = textByLang(
            '分离定时器未开启：此项不生效',
            'Split timers disabled: this field is inactive'
        );

        const intervalDisabled = !enabledOn || splitOn;
        const pushPullDisabled = !enabledOn || !splitOn;

        setControlDisabledState(
            intervalInput,
            intervalDisabled,
            !enabledOn ? disabledByMasterHint : intervalDisabledHint
        );
        setControlDisabledState(
            pushIntervalInput,
            pushPullDisabled,
            !enabledOn ? disabledByMasterHint : pushPullDisabledHint
        );
        setControlDisabledState(
            pullIntervalInput,
            pushPullDisabled,
            !enabledOn ? disabledByMasterHint : pushPullDisabledHint
        );

        updateBackgroundCheckFieldState();
        updatePermanentPullModeFieldState();
    }

    function applySettingsToForm() {
        const enabled = getElement('canvasSyncEnabledToggle');
        const auto = getElement('canvasSyncAutoToggle');
        const syncAfterEditStop = getElement('canvasSyncAutoAfterEditStopToggle');
        const splitInterval = getElement('canvasSyncSplitIntervalsToggle');
        const permanentTreeUploadInterval = getElement('canvasSyncPermanentTreeIntervalSelect');
        const tempSectionUploadInterval = getElement('canvasSyncTempSectionIntervalInput');
        const blankSectionUploadInterval = getElement('canvasSyncMdNodeIntervalInput');
        const interval = getElement('canvasSyncIntervalInput');
        const pushInterval = getElement('canvasSyncAutoPushIntervalInput');
        const pullInterval = getElement('canvasSyncAutoPullIntervalInput');
        const foregroundCheckEnabled = getElement('canvasSyncForegroundCheckToggle');
        const foregroundCheckInterval = getElement('canvasSyncForegroundCheckIntervalInput');
        const backgroundCheckEnabled = getElement('canvasSyncBackgroundCheckToggle');
        const backgroundCheckInterval = getElement('canvasSyncBackgroundCheckIntervalInput');
        const backgroundCooldown = getElement('canvasSyncBackgroundCooldownInput');
        const mismatchPolicy = getElement('canvasSyncMismatchPolicySelect');
        const pullOnStartup = getElement('canvasSyncPullOnStartupToggle');
        const pushOnSync = getElement('canvasSyncPushOnSyncToggle');
        const pullOnSync = getElement('canvasSyncPullOnSyncToggle');
        const hideNoChangeNotice = getElement('canvasSyncHideNoChangeNoticeToggle');
        const syncMethod = getElement('canvasSyncMethodSelect');
        const conflict = getElement('canvasSyncConflictSelect');
        const threshold = getElement('canvasSyncDeleteThresholdInput');
        const permanentPullMode = getElement('canvasSyncPermanentPullModeSelect');
        const permanentIncrementalThreshold = getElement('canvasSyncPermanentIncrementalThresholdInput');
        const obsidianFilePushEnabled = getElement('canvasSyncObsidianFilePushToggle');
        const obsidianExportFormat = getElement('canvasSyncObsidianExportFormatSelect');
        const obsidianExportRoot = getElement('canvasSyncObsidianExportRootInput');

        if (enabled) enabled.checked = !!settings.enabled;
        if (auto) auto.checked = !!settings.autoSync;
        if (syncAfterEditStop) syncAfterEditStop.checked = settings.syncAfterEditStop !== false;
        if (splitInterval) splitInterval.checked = !!settings.splitIntervalCommitAndSync;
        setFirstSyncModeToForm(settings.firstSyncMode);
        if (permanentTreeUploadInterval) {
            permanentTreeUploadInterval.value = String(
                normalizePermanentTreeUploadIntervalSeconds(
                    settings.permanentTreeUploadIntervalSeconds,
                    DEFAULT_SETTINGS.permanentTreeUploadIntervalSeconds
                )
            );
        }
        if (tempSectionUploadInterval) {
            tempSectionUploadInterval.value = String(
                normalizeCustomUploadIntervalSeconds(
                    settings.tempSectionUploadIntervalSeconds,
                    DEFAULT_SETTINGS.tempSectionUploadIntervalSeconds
                )
            );
        }
        if (blankSectionUploadInterval) {
            blankSectionUploadInterval.value = String(
                normalizeCustomUploadIntervalSeconds(
                    settings.blankSectionUploadIntervalSeconds,
                    DEFAULT_SETTINGS.blankSectionUploadIntervalSeconds
                )
            );
        }
        if (interval) interval.value = String(secondsToMinutes(settings.intervalSeconds || DEFAULT_SETTINGS.intervalSeconds));
        if (pushInterval) {
            pushInterval.value = String(
                normalizeSplitIntervalMinutes(
                    settings.autoPushIntervalMinutes,
                    DEFAULT_SETTINGS.autoPushIntervalMinutes
                )
            );
        }
        if (pullInterval) {
            pullInterval.value = String(
                normalizeSplitIntervalMinutes(
                    settings.autoPullIntervalMinutes,
                    DEFAULT_SETTINGS.autoPullIntervalMinutes
                )
            );
        }
        if (foregroundCheckEnabled) foregroundCheckEnabled.checked = settings.foregroundCheckEnabled !== false;
        if (foregroundCheckInterval) foregroundCheckInterval.value = String(normalizeForegroundCheckSeconds(settings.foregroundCheckIntervalSeconds, DEFAULT_SETTINGS.foregroundCheckIntervalSeconds));
        if (backgroundCheckEnabled) backgroundCheckEnabled.checked = settings.backgroundCheckEnabled !== false;
        if (backgroundCheckInterval) {
            backgroundCheckInterval.value = String(
                normalizeBackgroundMinutes(
                    settings.backgroundCheckIntervalMinutes,
                    DEFAULT_SETTINGS.backgroundCheckIntervalMinutes,
                    1
                )
            );
        }
        if (backgroundCooldown) {
            backgroundCooldown.value = String(
                normalizeBackgroundMinutes(
                    settings.backgroundCooldownMinutes,
                    DEFAULT_SETTINGS.backgroundCooldownMinutes,
                    1
                )
            );
        }
        if (mismatchPolicy) mismatchPolicy.value = ensureMismatchPolicy(settings.mismatchPolicy);
        if (pullOnStartup) pullOnStartup.checked = !!settings.pullOnStartup;
        if (pushOnSync) pushOnSync.checked = settings.pushOnSync !== false;
        if (pullOnSync) pullOnSync.checked = settings.pullOnSync !== false;
        if (hideNoChangeNotice) hideNoChangeNotice.checked = !!settings.hideNoChangeNotice;
        if (syncMethod) syncMethod.value = ensureSyncMethod(settings.syncMethod);
        if (conflict) conflict.value = settings.conflictPolicy || DEFAULT_SETTINGS.conflictPolicy;
        if (threshold) threshold.value = String(settings.deleteThresholdPercent || DEFAULT_SETTINGS.deleteThresholdPercent);
        if (permanentPullMode) permanentPullMode.value = ensurePermanentPullMode(settings.permanentPullMode);
        if (permanentIncrementalThreshold) permanentIncrementalThreshold.value = String(normalizePermanentIncrementalMaxChanges(settings.permanentIncrementalMaxChanges, DEFAULT_SETTINGS.permanentIncrementalMaxChanges));
        if (obsidianFilePushEnabled) obsidianFilePushEnabled.checked = settings.obsidianFilePushEnabled !== false;
        if (obsidianExportFormat) obsidianExportFormat.value = normalizeObsidianExportFormat(settings.obsidianExportFormat, DEFAULT_SETTINGS.obsidianExportFormat);
        if (obsidianExportRoot) {
            obsidianExportRoot.value = (typeof settings.obsidianExportRoot === 'string')
                ? settings.obsidianExportRoot
                : DEFAULT_SETTINGS.obsidianExportRoot;
        }
        updateSyncEnabledDependentFieldState();
        updateTimerModeFieldState();
    }

    function pullSettingsFromForm() {
        const enabled = getElement('canvasSyncEnabledToggle');
        const auto = getElement('canvasSyncAutoToggle');
        const syncAfterEditStop = getElement('canvasSyncAutoAfterEditStopToggle');
        const splitInterval = getElement('canvasSyncSplitIntervalsToggle');
        const permanentTreeUploadInterval = getElement('canvasSyncPermanentTreeIntervalSelect');
        const tempSectionUploadInterval = getElement('canvasSyncTempSectionIntervalInput');
        const blankSectionUploadInterval = getElement('canvasSyncMdNodeIntervalInput');
        const interval = getElement('canvasSyncIntervalInput');
        const pushInterval = getElement('canvasSyncAutoPushIntervalInput');
        const pullInterval = getElement('canvasSyncAutoPullIntervalInput');
        const foregroundCheckEnabled = getElement('canvasSyncForegroundCheckToggle');
        const foregroundCheckInterval = getElement('canvasSyncForegroundCheckIntervalInput');
        const backgroundCheckEnabled = getElement('canvasSyncBackgroundCheckToggle');
        const backgroundCheckInterval = getElement('canvasSyncBackgroundCheckIntervalInput');
        const backgroundCooldown = getElement('canvasSyncBackgroundCooldownInput');
        const mismatchPolicy = getElement('canvasSyncMismatchPolicySelect');
        const pullOnStartup = getElement('canvasSyncPullOnStartupToggle');
        const pushOnSync = getElement('canvasSyncPushOnSyncToggle');
        const pullOnSync = getElement('canvasSyncPullOnSyncToggle');
        const hideNoChangeNotice = getElement('canvasSyncHideNoChangeNoticeToggle');
        const syncMethod = getElement('canvasSyncMethodSelect');
        const conflict = getElement('canvasSyncConflictSelect');
        const threshold = getElement('canvasSyncDeleteThresholdInput');
        const permanentPullMode = getElement('canvasSyncPermanentPullModeSelect');
        const permanentIncrementalThreshold = getElement('canvasSyncPermanentIncrementalThresholdInput');
        const obsidianFilePushEnabled = getElement('canvasSyncObsidianFilePushToggle');
        const obsidianExportFormat = getElement('canvasSyncObsidianExportFormatSelect');
        const obsidianExportRoot = getElement('canvasSyncObsidianExportRootInput');

	        settings.enabled = enabled ? !!enabled.checked : settings.enabled;
	        settings.autoSync = auto ? !!auto.checked : settings.autoSync;
	        settings.syncAfterEditStop = syncAfterEditStop ? !!syncAfterEditStop.checked : settings.syncAfterEditStop;
	        settings.splitIntervalCommitAndSync = splitInterval ? !!splitInterval.checked : settings.splitIntervalCommitAndSync;
	        settings.firstSyncMode = getFirstSyncModeFromForm(settings.firstSyncMode);
	        setFirstSyncModeToForm(settings.firstSyncMode);
	        settings.permanentTreeUploadIntervalSeconds = normalizePermanentTreeUploadIntervalSeconds(
	            permanentTreeUploadInterval ? permanentTreeUploadInterval.value : settings.permanentTreeUploadIntervalSeconds,
	            DEFAULT_SETTINGS.permanentTreeUploadIntervalSeconds
	        );
        settings.tempSectionUploadIntervalSeconds = normalizeCustomUploadIntervalSeconds(
            tempSectionUploadInterval ? tempSectionUploadInterval.value : settings.tempSectionUploadIntervalSeconds,
            DEFAULT_SETTINGS.tempSectionUploadIntervalSeconds
        );
        settings.blankSectionUploadIntervalSeconds = normalizeCustomUploadIntervalSeconds(
            blankSectionUploadInterval ? blankSectionUploadInterval.value : settings.blankSectionUploadIntervalSeconds,
            DEFAULT_SETTINGS.blankSectionUploadIntervalSeconds
        );

        const intervalMinutes = Math.max(1, Number.parseInt(interval ? interval.value : `${secondsToMinutes(settings.intervalSeconds)}`, 10) || secondsToMinutes(DEFAULT_SETTINGS.intervalSeconds));
        settings.intervalSeconds = minutesToSeconds(intervalMinutes);

        settings.autoPushIntervalMinutes = normalizeSplitIntervalMinutes(
            pushInterval ? pushInterval.value : settings.autoPushIntervalMinutes,
            DEFAULT_SETTINGS.autoPushIntervalMinutes
        );
        settings.autoPullIntervalMinutes = normalizeSplitIntervalMinutes(
            pullInterval ? pullInterval.value : settings.autoPullIntervalMinutes,
            DEFAULT_SETTINGS.autoPullIntervalMinutes
        );
        if (pushInterval) pushInterval.value = String(settings.autoPushIntervalMinutes);
        if (pullInterval) pullInterval.value = String(settings.autoPullIntervalMinutes);
        settings.foregroundCheckEnabled = foregroundCheckEnabled ? !!foregroundCheckEnabled.checked : settings.foregroundCheckEnabled;
        settings.foregroundCheckIntervalSeconds = normalizeForegroundCheckSeconds(
            foregroundCheckInterval ? foregroundCheckInterval.value : settings.foregroundCheckIntervalSeconds,
            DEFAULT_SETTINGS.foregroundCheckIntervalSeconds
        );
        if (foregroundCheckInterval) foregroundCheckInterval.value = String(settings.foregroundCheckIntervalSeconds);
        settings.backgroundCheckEnabled = backgroundCheckEnabled ? !!backgroundCheckEnabled.checked : settings.backgroundCheckEnabled;
        settings.backgroundCheckIntervalMinutes = normalizeBackgroundMinutes(
            backgroundCheckInterval ? backgroundCheckInterval.value : settings.backgroundCheckIntervalMinutes,
            DEFAULT_SETTINGS.backgroundCheckIntervalMinutes,
            1
        );
        settings.backgroundCooldownMinutes = normalizeBackgroundMinutes(
            backgroundCooldown ? backgroundCooldown.value : settings.backgroundCooldownMinutes,
            DEFAULT_SETTINGS.backgroundCooldownMinutes,
            1
        );
        if (backgroundCheckInterval) backgroundCheckInterval.value = String(settings.backgroundCheckIntervalMinutes);
        if (backgroundCooldown) backgroundCooldown.value = String(settings.backgroundCooldownMinutes);
        settings.mismatchPolicy = ensureMismatchPolicy(mismatchPolicy ? mismatchPolicy.value : settings.mismatchPolicy);
        settings.pullOnStartup = pullOnStartup ? !!pullOnStartup.checked : settings.pullOnStartup;
        settings.pushOnSync = pushOnSync ? !!pushOnSync.checked : settings.pushOnSync;
        settings.pullOnSync = pullOnSync ? !!pullOnSync.checked : settings.pullOnSync;
        settings.hideNoChangeNotice = hideNoChangeNotice ? !!hideNoChangeNotice.checked : settings.hideNoChangeNotice;

        settings.syncMethod = ensureSyncMethod(syncMethod ? syncMethod.value : settings.syncMethod);
        settings.conflictPolicy = ensureConflictPolicy(conflict ? conflict.value : settings.conflictPolicy);
        settings.deleteThresholdPercent = Math.max(1, Math.min(100, Number.parseInt(threshold ? threshold.value : `${settings.deleteThresholdPercent}`, 10) || DEFAULT_SETTINGS.deleteThresholdPercent));
        settings.permanentPullMode = ensurePermanentPullMode(permanentPullMode ? permanentPullMode.value : settings.permanentPullMode);
        settings.permanentIncrementalMaxChanges = normalizePermanentIncrementalMaxChanges(
            permanentIncrementalThreshold ? permanentIncrementalThreshold.value : settings.permanentIncrementalMaxChanges,
            DEFAULT_SETTINGS.permanentIncrementalMaxChanges
        );
        settings.obsidianFilePushEnabled = obsidianFilePushEnabled ? !!obsidianFilePushEnabled.checked : settings.obsidianFilePushEnabled;
        settings.obsidianExportFormat = normalizeObsidianExportFormat(
            obsidianExportFormat ? obsidianExportFormat.value : settings.obsidianExportFormat,
            DEFAULT_SETTINGS.obsidianExportFormat
        );
        settings.obsidianExportRoot = normalizeObsidianExportRoot(
            obsidianExportRoot ? obsidianExportRoot.value : DEFAULT_SETTINGS.obsidianExportRoot,
            DEFAULT_SETTINGS.obsidianExportRoot,
            { allowEmpty: true }
        );

        updateSyncEnabledDependentFieldState();
        updateTimerModeFieldState();
        saveSettings();
        restartAutomationTimers();
        void updateBackgroundSyncContext('settings-change');
        if (runtime && runtime.pendingMismatch && ensureMismatchPolicy(settings.mismatchPolicy) === 'auto_pull') {
            void maybeHandlePendingMismatchAutoPull();
        }
    }

    function setActiveTab(tabKey, options = {}) {
        const nextTab = SYNC_TAB_KEYS.includes(tabKey) ? tabKey : DEFAULT_ACTIVE_TAB;
        const persist = options.persist !== false;

        SYNC_TAB_KEYS.forEach((key) => {
            const capKey = key.charAt(0).toUpperCase() + key.slice(1);
            const buttonEl = getElement(`canvasSyncTab${capKey}Btn`);
            const panelEl = getElement(`canvasSyncTab${capKey}Panel`);
            const isActive = key === nextTab;

            if (buttonEl) {
                buttonEl.classList.toggle('is-active', isActive);
                buttonEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
            }
            if (panelEl) {
                panelEl.hidden = !isActive;
            }
        });

        setBehaviorSubNavVisible(nextTab === 'behavior');
        if (nextTab === 'behavior') {
            const currentActiveSubButton = getCurrentActiveBehaviorSubButtonId();
            if (currentActiveSubButton) {
                setBehaviorSubNavActive(currentActiveSubButton);
            } else if (BEHAVIOR_SUBNAV_CONFIG.length > 0) {
                setBehaviorSubNavActive(BEHAVIOR_SUBNAV_CONFIG[0].buttonId);
            }
            scheduleBehaviorSubNavSyncFromScroll();
        }

        activeTabKey = nextTab;
        if (persist) {
            saveActiveTab(nextTab);
        }
    }

    function bindTabButton(buttonId, tabKey) {
        const buttonEl = getElement(buttonId);
        if (!buttonEl) return;
        if (buttonEl.dataset.bound === 'true') return;

        buttonEl.dataset.bound = 'true';
        buttonEl.addEventListener('click', () => {
            setActiveTab(tabKey);
        });
    }

    function setBehaviorSubNavVisible(visible) {
        const subNavEl = getElement('canvasSyncBehaviorSubNav');
        if (!subNavEl) return;
        subNavEl.hidden = !visible;
        if (!visible) {
            setBehaviorCompatSubNavVisible(false);
        }
    }

    function setBehaviorCompatSubNavVisible(visible) {
        const subNavEl = getElement('canvasSyncBehaviorSubCompatNav');
        if (!subNavEl) return;
        subNavEl.hidden = !visible;
    }

    function getCurrentActiveBehaviorSubButtonId() {
        const subNavEl = getElement('canvasSyncBehaviorSubNav');
        if (!subNavEl) return '';
        const activeButton = subNavEl.querySelector('.canvas-sync-tab-subnav-btn.is-active, .canvas-sync-tab-subnav-btn[aria-current="true"]');
        if (!activeButton || !activeButton.id) return '';
        return activeButton.id;
    }

    function setBehaviorSubNavActive(buttonId) {
        BEHAVIOR_SUBNAV_CONFIG.forEach((item) => {
            const buttonEl = getElement(item.buttonId);
            if (!buttonEl) return;
            const isActive = item.buttonId === buttonId;
            buttonEl.classList.toggle('is-active', isActive);
            buttonEl.setAttribute('aria-current', isActive ? 'true' : 'false');
        });
        const compatActive = buttonId === 'canvasSyncBehaviorSubCompatBtn';
        setBehaviorCompatSubNavVisible(compatActive);
        if (!compatActive) {
            setBehaviorCompatSubNavActive('');
        } else {
            const currentNested = getCurrentActiveBehaviorCompatSubButtonId();
            if (currentNested) {
                setBehaviorCompatSubNavActive(currentNested);
            } else if (BEHAVIOR_SUBNAV_COMPAT_CONFIG.length > 0) {
                setBehaviorCompatSubNavActive(BEHAVIOR_SUBNAV_COMPAT_CONFIG[0].buttonId);
            }
        }
    }


    function getCurrentActiveBehaviorCompatSubButtonId() {
        const subNavEl = getElement('canvasSyncBehaviorSubCompatNav');
        if (!subNavEl) return '';
        const activeButton = subNavEl.querySelector('.canvas-sync-tab-subnav-btn.is-active, .canvas-sync-tab-subnav-btn[aria-current="true"]');
        if (!activeButton || !activeButton.id) return '';
        return activeButton.id;
    }

    function setBehaviorCompatSubNavActive(buttonId) {
        BEHAVIOR_SUBNAV_COMPAT_CONFIG.forEach((item) => {
            const buttonEl = getElement(item.buttonId);
            if (!buttonEl) return;
            const isActive = !!buttonId && item.buttonId === buttonId;
            buttonEl.classList.toggle('is-active', isActive);
            buttonEl.setAttribute('aria-current', isActive ? 'true' : 'false');
        });
    }

    function scrollBehaviorSectionIntoView(targetId) {
        const panelEl = getElement('canvasSyncTabBehaviorPanel');
        const targetEl = getElement(targetId);
        if (!panelEl || !targetEl) return;

        const panelRect = panelEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const currentTop = Number(panelEl.scrollTop) || 0;
        const nextTop = Math.max(0, currentTop + (targetRect.top - panelRect.top) - 6);

        if (typeof panelEl.scrollTo === 'function') {
            try {
                panelEl.scrollTo({ top: nextTop, behavior: 'auto' });
                scheduleBehaviorSubNavSyncFromScroll();
                return;
            } catch (_) { }
        }

        panelEl.scrollTop = nextTop;
        scheduleBehaviorSubNavSyncFromScroll();
    }

    function bindBehaviorSubNavButtons() {
        BEHAVIOR_SUBNAV_CONFIG.forEach((item, index) => {
            const buttonEl = getElement(item.buttonId);
            if (!buttonEl) return;
            if (buttonEl.dataset.bound === 'true') return;

            buttonEl.dataset.bound = 'true';
            buttonEl.addEventListener('click', () => {
                setActiveTab('behavior');
                setBehaviorSubNavActive(item.buttonId);
                if (item.buttonId === 'canvasSyncBehaviorSubCompatBtn' && BEHAVIOR_SUBNAV_COMPAT_CONFIG.length > 0) {
                    setBehaviorCompatSubNavVisible(true);
                    setBehaviorCompatSubNavActive(BEHAVIOR_SUBNAV_COMPAT_CONFIG[0].buttonId);
                }
                scrollBehaviorSectionIntoView(item.targetId);
            });

            if (index === 0) {
                buttonEl.classList.add('is-active');
                buttonEl.setAttribute('aria-current', 'true');
            } else {
                buttonEl.setAttribute('aria-current', 'false');
            }
        });

        BEHAVIOR_SUBNAV_COMPAT_CONFIG.forEach((item, index) => {
            const buttonEl = getElement(item.buttonId);
            if (!buttonEl) return;
            if (buttonEl.dataset.bound === 'true') return;

            buttonEl.dataset.bound = 'true';
            buttonEl.addEventListener('click', () => {
                setActiveTab('behavior');
                setBehaviorSubNavActive('canvasSyncBehaviorSubCompatBtn');
                setBehaviorCompatSubNavActive(item.buttonId);
                scrollBehaviorSectionIntoView(item.targetId);
            });

            if (index === 0) {
                buttonEl.setAttribute('aria-current', 'false');
            } else {
                buttonEl.setAttribute('aria-current', 'false');
            }
        });

        const panelEl = getElement('canvasSyncTabBehaviorPanel');
        if (panelEl && panelEl.dataset.subnavScrollBound !== 'true') {
            panelEl.dataset.subnavScrollBound = 'true';
            panelEl.addEventListener('scroll', () => {
                scheduleBehaviorSubNavSyncFromScroll();
            }, { passive: true });
        }
    }

    function findBehaviorSubNavButtonIdByScroll() {
        const panelEl = getElement('canvasSyncTabBehaviorPanel');
        if (!panelEl) return '';

        const panelRect = panelEl.getBoundingClientRect();
        const anchorTop = panelRect.top + 44;

        let fallbackButtonId = '';
        let matchedButtonId = '';

        for (let i = 0; i < BEHAVIOR_SUBNAV_CONFIG.length; i++) {
            const item = BEHAVIOR_SUBNAV_CONFIG[i];
            const targetEl = getElement(item.targetId);
            if (!targetEl) continue;

            if (!fallbackButtonId) fallbackButtonId = item.buttonId;

            const targetRect = targetEl.getBoundingClientRect();
            if (targetRect.top <= anchorTop) {
                matchedButtonId = item.buttonId;
            }
        }

        return matchedButtonId || fallbackButtonId || '';
    }

    function syncBehaviorSubNavActiveByScrollPosition() {
        if (activeTabKey !== 'behavior') return;
        const nextButtonId = findBehaviorSubNavButtonIdByScroll();
        if (!nextButtonId) return;

        const currentButtonId = getCurrentActiveBehaviorSubButtonId();
        if (currentButtonId !== nextButtonId) {
            setBehaviorSubNavActive(nextButtonId);
        }

        if (nextButtonId === 'canvasSyncBehaviorSubCompatBtn') {
            const panelEl = getElement('canvasSyncTabBehaviorPanel');
            const anchorTop = panelEl ? panelEl.getBoundingClientRect().top + 44 : 0;
            let matchedNested = '';
            for (let i = 0; i < BEHAVIOR_SUBNAV_COMPAT_CONFIG.length; i++) {
                const item = BEHAVIOR_SUBNAV_COMPAT_CONFIG[i];
                const targetEl = getElement(item.targetId);
                if (!targetEl) continue;
                const rect = targetEl.getBoundingClientRect();
                if (rect.top <= anchorTop) {
                    matchedNested = item.buttonId;
                }
            }
            if (!matchedNested && BEHAVIOR_SUBNAV_COMPAT_CONFIG.length > 0) {
                matchedNested = BEHAVIOR_SUBNAV_COMPAT_CONFIG[0].buttonId;
            }
            setBehaviorCompatSubNavActive(matchedNested);
        }
    }

    function scheduleBehaviorSubNavSyncFromScroll() {
        if (behaviorSubNavScrollRaf != null) return;
        behaviorSubNavScrollRaf = global.requestAnimationFrame(() => {
            behaviorSubNavScrollRaf = null;
            syncBehaviorSubNavActiveByScrollPosition();
        });
    }

    function readTempStateTimestampFromRaw(raw) {
        if (!raw) return 0;
        try {
            const parsed = JSON.parse(raw);
            const ts = Number(parsed && parsed.timestamp);
            return Number.isFinite(ts) && ts > 0 ? ts : 0;
        } catch (_) {
            return 0;
        }
    }

    function snapshotDataStableString(data) {
        const keys = Object.keys(data || {}).sort();
        const normalized = {};
        keys.forEach((key) => {
            normalized[key] = String(data[key]);
        });
        return JSON.stringify(normalized);
    }

    function hashString(raw) {
        let hash = 2166136261;
        for (let i = 0; i < raw.length; i++) {
            hash ^= raw.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function toSnapshotDataString(value) {
        if (typeof value === 'string') return value;
        if (value === null || typeof value === 'undefined') return '';
        try {
            return JSON.stringify(value);
        } catch (_) {
            return String(value);
        }
    }

    function normalizeSnapshot(rawSnapshot) {
        const snapshot = rawSnapshot && typeof rawSnapshot === 'object' ? rawSnapshot : null;
        if (!snapshot) throw new Error(textByLang('同步文件格式无效', 'Invalid sync file format'));

        const isBackupPayload = snapshot.exporter === 'bookmark-backup-canvas'
            && snapshot.storage
            && typeof snapshot.storage === 'object';

        const rawData = isBackupPayload
            ? snapshot.storage
            : (snapshot.data && typeof snapshot.data === 'object' ? snapshot.data : {});

        const data = {};
        Object.keys(rawData || {}).forEach((key) => {
            data[key] = toSnapshotDataString(rawData[key]);
        });

        if (isBackupPayload && (!data[TEMP_SECTION_STORAGE_KEY] || !String(data[TEMP_SECTION_STORAGE_KEY]).trim())) {
            const canvasState = snapshot.canvasState && typeof snapshot.canvasState === 'object' ? snapshot.canvasState : null;
            if (canvasState) {
                data[TEMP_SECTION_STORAGE_KEY] = JSON.stringify({
                    sections: Array.isArray(canvasState.tempSections) ? canvasState.tempSections : [],
                    mdNodes: Array.isArray(canvasState.mdNodes) ? canvasState.mdNodes : [],
                    edges: Array.isArray(canvasState.edges) ? canvasState.edges : [],
                    tempSectionCounter: Number(canvasState.tempSectionCounter) || 0,
                    mdNodeCounter: Number(canvasState.mdNodeCounter) || 0,
                    edgeCounter: Number(canvasState.edgeCounter) || 0,
                    timestamp: Date.now()
                });
            }
        }

        return {
            schemaVersion: Number(snapshot.schemaVersion) || 1,
            format: snapshot.format || 'bookmark-canvas-state',
            clientId: String(snapshot.clientId || ''),
            updatedAt: Number(snapshot.updatedAt) || Number(snapshot.generatedAt) || Number(snapshot.exportedAt ? Date.parse(snapshot.exportedAt) : 0) || 0,
            generatedAt: Number(snapshot.generatedAt) || Number(snapshot.exportedAt ? Date.parse(snapshot.exportedAt) : 0) || 0,
            trigger: String(snapshot.trigger || ''),
            permanentTreeSnapshot: normalizeBookmarkTreeSnapshot(snapshot.permanentTreeSnapshot || snapshot.permanentTree || snapshot.permanentTreeData),
            data
        };
    }

    function snapshotComparableString(snapshot) {
        const dataPart = snapshotDataStableString(snapshot && snapshot.data ? snapshot.data : {});
        const permanentTreePart = (() => {
            const tree = snapshot && snapshot.permanentTreeSnapshot ? snapshot.permanentTreeSnapshot : null;
            if (!tree) return '';
            try {
                return JSON.stringify(tree);
            } catch (_) {
                return '';
            }
        })();

        return `${dataPart}::${permanentTreePart}`;
    }

    function getSnapshotHash(snapshot) {
        return hashString(snapshotComparableString(snapshot));
    }

    function getSnapshotBytes(snapshot) {
        return snapshotComparableString(snapshot).length;
    }

    function buildSnapshotMeta(snapshot) {
        return {
            updatedAt: Number(snapshot && snapshot.updatedAt) || 0,
            hash: getSnapshotHash(snapshot),
            bytes: getSnapshotBytes(snapshot)
        };
    }

    function shouldIncludePermanentTreeSnapshot(trigger, options = {}) {
        if (options.includePermanentTree === true) return true;
        if (options.includePermanentTree === false) return false;

        const intervalSeconds = normalizePermanentTreeUploadIntervalSeconds(
            settings && settings.permanentTreeUploadIntervalSeconds,
            DEFAULT_SETTINGS.permanentTreeUploadIntervalSeconds
        );
        if (intervalSeconds <= 0) return false;

        const lastTs = Number(runtime && runtime.lastPermanentTreeSnapshotAt) || 0;
        if (lastTs <= 0) return true;

        const triggerText = String(trigger || '').toLowerCase();
        const isStrictManual = triggerText.startsWith('manual');
        if (isStrictManual) return true;

        return (Date.now() - lastTs) >= (intervalSeconds * 1000);
    }

    function shouldIncludeTempSectionSnapshot(trigger, options = {}) {
        if (options.includeTempSection === true) return true;
        if (options.includeTempSection === false) return false;

        const intervalSeconds = normalizeCustomUploadIntervalSeconds(
            settings && settings.tempSectionUploadIntervalSeconds,
            DEFAULT_SETTINGS.tempSectionUploadIntervalSeconds
        );
        if (intervalSeconds <= 0) return false;

        const lastTs = Number(runtime && runtime.lastTempSectionSnapshotAt) || 0;
        if (lastTs <= 0) return true;

        const triggerText = String(trigger || '').toLowerCase();
        const isStrictManual = triggerText.startsWith('manual');
        if (isStrictManual) return true;

        return (Date.now() - lastTs) >= (intervalSeconds * 1000);
    }

    function shouldPushBlankSectionFiles(trigger, options = {}) {
        if (options.includeBlankSectionFiles === true) return true;
        if (options.includeBlankSectionFiles === false) return false;

        const intervalSeconds = normalizeCustomUploadIntervalSeconds(
            settings && settings.blankSectionUploadIntervalSeconds,
            DEFAULT_SETTINGS.blankSectionUploadIntervalSeconds
        );
        if (intervalSeconds <= 0) return false;

        const lastTs = Number(runtime && runtime.lastObsidianPushAt) || 0;
        if (lastTs <= 0) return true;

        const triggerText = String(trigger || '').toLowerCase();
        const isStrictManual = triggerText.startsWith('manual');
        if (isStrictManual) return true;

        return (Date.now() - lastTs) >= (intervalSeconds * 1000);
    }

    function applyTempSectionSnapshotThrottle(data, trigger, options = {}) {
        if (!data || typeof data !== 'object') {
            return { includeTempSection: false };
        }

        const currentRaw = typeof data[TEMP_SECTION_STORAGE_KEY] === 'string'
            ? data[TEMP_SECTION_STORAGE_KEY]
            : '';

        const includeTempSection = shouldIncludeTempSectionSnapshot(trigger, options);
        if (includeTempSection) {
            return { includeTempSection: true };
        }

        const cachedRaw = String(getSyncMetaRaw(LAST_UPLOADED_TEMP_STATE_KEY) || '');
        if (cachedRaw) {
            data[TEMP_SECTION_STORAGE_KEY] = cachedRaw;
            return { includeTempSection: false, usedCachedTempSection: true };
        }

        if (currentRaw) {
            return { includeTempSection: true, forcedIncludeWithoutCache: true };
        }

        return { includeTempSection: false };
    }

    function hydratePermanentTreeFromRemote(localSnapshot, remoteSnapshot) {
        if (!localSnapshot || localSnapshot.permanentTreeSnapshot) {
            return false;
        }

        const remoteTree = normalizeBookmarkTreeSnapshot(
            remoteSnapshot && remoteSnapshot.permanentTreeSnapshot
        );
        if (!remoteTree) {
            return false;
        }

        localSnapshot.permanentTreeSnapshot = remoteTree;
        return true;
    }

    async function buildLocalSnapshot(trigger, options = {}) {
        const data = {};
        SYNC_KEYS.forEach((key) => {
            const raw = localStorage.getItem(key);
            if (raw !== null && raw !== undefined) {
                data[key] = raw;
            }
        });

        const tempSectionMeta = applyTempSectionSnapshotThrottle(data, trigger, options);

        const tempTs = readTempStateTimestampFromRaw(data[TEMP_SECTION_STORAGE_KEY]);
        const now = Date.now();
        const updatedAt = Math.max(now, Number(runtime.lastLocalMutationAt) || 0, tempTs);

        const includePermanentTree = shouldIncludePermanentTreeSnapshot(trigger, options);

        let permanentTreeSnapshot = null;
        if (includePermanentTree) {
            permanentTreeSnapshot = await getPermanentTreeSnapshotForSync();
        }

        const snapshot = {
            schemaVersion: 1,
            format: 'bookmark-canvas-state',
            clientId: getClientId(),
            updatedAt,
            generatedAt: now,
            trigger: trigger || 'manual',
            permanentTreeSnapshot,
            data
        };

        Object.defineProperty(snapshot, '_syncMeta', {
            value: Object.assign({}, tempSectionMeta),
            enumerable: false,
            configurable: true,
            writable: true
        });

        return snapshot;
    }

    function decodeBase64ToText(base64) {
        const normalized = String(base64 || '').replace(/\s+/g, '');
        if (!normalized) return '';
        const binary = atob(normalized);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder().decode(bytes);
    }

    function decodeBase64ToBytes(base64) {
        const normalized = String(base64 || '').replace(/\s+/g, '');
        if (!normalized) return new Uint8Array(0);
        const binary = atob(normalized);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    function sendRuntimeMessage(payload, timeoutMs = 20000) {
        return new Promise((resolve, reject) => {
            const runtimeApi = getRuntimeApi();
            if (!runtimeApi || !runtimeApi.runtime || typeof runtimeApi.runtime.sendMessage !== 'function') {
                reject(new Error(textByLang('扩展运行时不可用', 'Extension runtime is unavailable')));
                return;
            }

            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error(textByLang('同步请求超时', 'Sync request timeout')));
            }, timeoutMs);

            try {
                runtimeApi.runtime.sendMessage(payload, (response) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);

                    const lastError = runtimeApi.runtime.lastError;
                    if (lastError && lastError.message) {
                        reject(new Error(lastError.message));
                        return;
                    }
                    resolve(response || {});
                });
            } catch (error) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    function buildBackgroundSyncSettingsPayload() {
        const current = settings || DEFAULT_SETTINGS;
        return {
            enabled: current.enabled === true,
            autoSync: current.autoSync !== false,
            splitIntervalCommitAndSync: current.splitIntervalCommitAndSync === true,
            intervalSeconds: Math.max(60, Number(current.intervalSeconds) || DEFAULT_SETTINGS.intervalSeconds),
            autoPushIntervalMinutes: normalizeSplitIntervalMinutes(current.autoPushIntervalMinutes, DEFAULT_SETTINGS.autoPushIntervalMinutes),
            autoPullIntervalMinutes: normalizeSplitIntervalMinutes(current.autoPullIntervalMinutes, DEFAULT_SETTINGS.autoPullIntervalMinutes),
            backgroundCheckIntervalMinutes: normalizeBackgroundMinutes(current.backgroundCheckIntervalMinutes, DEFAULT_SETTINGS.backgroundCheckIntervalMinutes, 1),
            backgroundCooldownMinutes: normalizeBackgroundMinutes(current.backgroundCooldownMinutes, DEFAULT_SETTINGS.backgroundCooldownMinutes, 1),
            obsidianExportRoot: normalizeObsidianExportRoot(
                current.obsidianExportRoot,
                DEFAULT_SETTINGS.obsidianExportRoot,
                { allowEmpty: true }
            ),
            mismatchPolicy: ensureMismatchPolicy(current.mismatchPolicy),
            foregroundCheckEnabled: current.foregroundCheckEnabled !== false,
            foregroundCheckIntervalSeconds: normalizeForegroundCheckSeconds(current.foregroundCheckIntervalSeconds, DEFAULT_SETTINGS.foregroundCheckIntervalSeconds),
            backgroundCheckEnabled: current.backgroundCheckEnabled !== false
        };
    }

    function buildBackgroundSyncRuntimePayload(runtimePatch) {
        const mergedRuntime = Object.assign({}, runtime || DEFAULT_RUNTIME, runtimePatch || {});
        let localDirty = false;
        try {
            localDirty = hasLocalDirtyWork();
        } catch (_) {
            localDirty = false;
        }

        const queueLength = Number(mergedRuntime.queueLength) || 0;
        const isRunning = mergedRuntime.isRunning === true;
        const pendingMismatch = mergedRuntime.pendingMismatch === true;

        return {
            lastRemoteSha: String(mergedRuntime.lastRemoteSha || ''),
            lastLocalHash: String(mergedRuntime.lastLocalHash || ''),
            lastCheckRemoteSha: String(mergedRuntime.lastCheckRemoteSha || ''),
            lastSuccessAt: Number(mergedRuntime.lastSuccessAt) || 0,
            lastLocalMutationAt: Number(mergedRuntime.lastLocalMutationAt) || 0,
            pendingMismatch,
            pendingMismatchAt: Number(mergedRuntime.pendingMismatchAt) || 0,
            pendingMismatchRemoteSha: String(mergedRuntime.pendingMismatchRemoteSha || ''),
            queueLength,
            isRunning,
            hasPendingWork: isRunning || queueLength > 0 || pendingMismatch || localDirty,
            localDirty: localDirty || queueLength > 0 || isRunning
        };
    }

    async function updateBackgroundSyncContext(eventName, runtimePatch = null) {
        try {
            const response = await sendRuntimeMessage({
                action: 'canvasGitSyncUpdateContext',
                event: String(eventName || '').trim() || 'sync-context-update',
                settings: buildBackgroundSyncSettingsPayload(),
                runtime: buildBackgroundSyncRuntimePayload(runtimePatch)
            }, 10000);
            return response || null;
        } catch (_) {
            return null;
        }
    }

    async function getBackgroundSyncState() {
        try {
            const response = await sendRuntimeMessage({
                action: 'canvasGitSyncGetBackgroundState'
            }, 10000);
            if (!response || response.success !== true) return null;
            return response;
        } catch (_) {
            return null;
        }
    }

    async function clearPendingMismatchInBackground() {
        try {
            await sendRuntimeMessage({
                action: 'canvasGitSyncClearPendingMismatch'
            }, 10000);
        } catch (_) { }
    }

    function applyBackgroundRuntimeState(backgroundRuntime, options = {}) {
        if (!backgroundRuntime || typeof backgroundRuntime !== 'object') return false;

        const nextPendingMismatch = backgroundRuntime.pendingMismatch === true;
        const nextMismatchAt = Number(backgroundRuntime.pendingMismatchUpdatedAt)
            || Number(backgroundRuntime.pendingMismatchAt)
            || 0;
        const nextMismatchRemoteSha = String(backgroundRuntime.pendingMismatchRemoteSha || '');
        const nextLastCheckRemoteSha = String(backgroundRuntime.lastCheckRemoteSha || '');
        const nextIsRunning = backgroundRuntime.isRunning === true;
        const nextQueueLength = Math.max(0, Number(backgroundRuntime.queueLength) || 0);
        const nextHasPendingWork = backgroundRuntime.hasPendingWork === true;

        let changed = false;
        if (!!runtime.pendingMismatch !== nextPendingMismatch) {
            runtime.pendingMismatch = nextPendingMismatch;
            if (!nextPendingMismatch) {
                mismatchPromptShownOnInit = false;
            } else {
                mismatchPromptShownOnInit = false;
            }
            changed = true;
        }

        if (runtime.pendingMismatchAt !== nextMismatchAt) {
            runtime.pendingMismatchAt = nextMismatchAt;
            changed = true;
        }

        if (runtime.pendingMismatchRemoteSha !== nextMismatchRemoteSha) {
            runtime.pendingMismatchRemoteSha = nextMismatchRemoteSha;
            changed = true;
        }

        if (runtime.lastCheckRemoteSha !== nextLastCheckRemoteSha) {
            runtime.lastCheckRemoteSha = nextLastCheckRemoteSha;
            changed = true;
        }

        if (!!runtime.isRunning !== nextIsRunning) {
            runtime.isRunning = nextIsRunning;
            changed = true;
        }

        if (runtime.queueLength !== nextQueueLength) {
            runtime.queueLength = nextQueueLength;
            changed = true;
        }

        if (!!runtime.hasPendingWork !== nextHasPendingWork) {
            runtime.hasPendingWork = nextHasPendingWork;
            changed = true;
        }

        if (options.updateRemoteSha && typeof backgroundRuntime.lastRemoteSha === 'string' && backgroundRuntime.lastRemoteSha) {
            if (runtime.lastRemoteSha !== backgroundRuntime.lastRemoteSha) {
                runtime.lastRemoteSha = backgroundRuntime.lastRemoteSha;
                changed = true;
            }
        }

        if (changed) {
            saveRuntime();
            renderStatus();
            if (nextPendingMismatch
                && settings
                && ensureMismatchPolicy(settings.mismatchPolicy) === 'prompt'
                && !hasPendingConflict()
                && !runtime.isRunning) {
                ensureStatusPanelVisible('mismatch', textByLang(
                    '检测到云端不一致，请在“状态”面板选择处理方式',
                    'Remote mismatch detected. Choose an action in the Status panel.'
                ));
            }
        }

        return changed;
    }

    async function refreshPendingMismatchFromBackground() {
        const response = await getBackgroundSyncState();
        if (!response || !response.runtime) return;
        applyBackgroundRuntimeState(response.runtime, { updateRemoteSha: true });
    }

    async function resolvePendingMismatchBySync(mode, trigger) {
        const beforeSuccessAt = Number(runtime.lastSuccessAt) || 0;

        await runSync(mode, trigger);

        const successAdvanced = (Number(runtime.lastSuccessAt) || 0) > beforeSuccessAt;
        const hasError = !!String(runtime.lastError || '').trim();
        const isSuccessful = successAdvanced && !hasError;

        if (isSuccessful) {
            runtime.pendingMismatch = false;
            runtime.pendingMismatchAt = 0;
            runtime.pendingMismatchRemoteSha = '';
            mismatchPromptShownOnInit = false;
            saveRuntime();
            renderStatus();
            await clearPendingMismatchInBackground();
            await updateBackgroundSyncContext('mismatch-cleared', {
                pendingMismatch: false,
                pendingMismatchAt: 0,
                hasPendingWork: false,
                localDirty: false
            });
        }

        return isSuccessful;
    }

    async function maybeHandlePendingMismatchOnPanelOpen() {
        if (!settings || ensureMismatchPolicy(settings.mismatchPolicy) !== 'prompt') return;
        if (!runtime || !runtime.pendingMismatch) return;
        if (runtime.isRunning) return;
        if (hasPendingConflict()) return;

        setActiveTab('status');
        renderMismatchPanel();
    }

    function maybePromptPendingConflictOnInit() {
        if (conflictPromptShownOnInit) return;
        if (!pendingConflict) return;
        if (runtime && runtime.isRunning) return;

        conflictPromptShownOnInit = true;
        ensureStatusPanelVisible('conflict', textByLang(
            '检测到并发冲突，请在“状态”面板选择处理方式',
            'Concurrent changes detected. Choose an action in the Status panel.'
        ));
    }

    function maybePromptPendingMismatchOnInit() {
        if (mismatchPromptShownOnInit) return;
        if (!settings || ensureMismatchPolicy(settings.mismatchPolicy) !== 'prompt') return;
        if (!runtime || !runtime.pendingMismatch) return;
        if (runtime.isRunning) return;
        if (hasPendingConflict()) return;

        mismatchPromptShownOnInit = true;
        ensureStatusPanelVisible('mismatch', textByLang(
            '前台关闭期间检测到云端更新，请在“状态”面板选择处理方式',
            'Remote updates were detected while foreground was closed. Please choose an action in Status panel.'
        ));
    }

    async function maybeHandlePendingMismatchAutoPull() {
        if (!settings) return;
        const mismatchPolicy = ensureMismatchPolicy(settings.mismatchPolicy);
        if (mismatchPolicy !== 'auto_pull' && mismatchPolicy !== 'auto_push') return;
        if (!runtime || !runtime.pendingMismatch) return;
        if (runtime.isRunning) return;
        if (hasPendingConflict()) return;

        const mode = mismatchPolicy === 'auto_push' ? 'push' : 'pull';
        const trigger = mismatchPolicy === 'auto_push'
            ? 'mismatch-policy-auto-push'
            : 'mismatch-policy-auto-pull';

        const ok = await resolvePendingMismatchBySync(mode, trigger);
        if (!ok) {
            toast(mismatchPolicy === 'auto_push'
                ? textByLang('后台检测到不一致，自动按本地覆盖云端失败，请稍后重试', 'Background mismatch detected; auto local-overwrite-cloud failed, please retry later')
                : textByLang('后台检测到不一致，自动使用云端覆盖本地失败，请稍后重试', 'Background mismatch detected; auto cloud-overwrite-local failed, please retry later'));
        }
    }

    function buildSnapshotFromRemoteFolderParsed(parsedPayload, remoteRevision = '') {
        const parsed = parsedPayload && typeof parsedPayload === 'object' ? parsedPayload : {};
        const storage = parsed.storage && typeof parsed.storage === 'object' ? parsed.storage : {};
        const tempState = parsed.tempState && typeof parsed.tempState === 'object' ? parsed.tempState : null;
        const primaryState = parsed.primaryState && typeof parsed.primaryState === 'object' ? parsed.primaryState : {};

        const data = {};
        Object.keys(storage).forEach((key) => {
            data[key] = toSnapshotDataString(storage[key]);
        });

        if (tempState && !data[TEMP_SECTION_STORAGE_KEY]) {
            data[TEMP_SECTION_STORAGE_KEY] = JSON.stringify(tempState);
        }

        const normalized = normalizeSnapshot({
            schemaVersion: 1,
            format: 'bookmark-canvas-files',
            trigger: 'remote-files',
            updatedAt: Date.now(),
            generatedAt: Date.now(),
            permanentTreeSnapshot: normalizeBookmarkTreeSnapshot(primaryState.permanentTreeSnapshot),
            data
        });

        if (!normalized.trigger && remoteRevision) {
            normalized.trigger = String(remoteRevision);
        }
        return normalized;
    }

    function isMissingCanvasOrBackupInRemoteParseError(error) {
        const message = String(error && error.message ? error.message : error || '');
        if (!message) return false;
        return /缺少\s*backup\.json\s*或\s*\.canvas\s*文件|missing\s*backup\.json\s*or\s*\.canvas\s*files/i.test(message);
    }

    async function readRemoteSnapshot() {
        const rootPath = normalizeObsidianExportRoot(
            settings && settings.obsidianExportRoot,
            DEFAULT_SETTINGS.obsidianExportRoot,
            { allowEmpty: true }
        );
        const remoteListRaw = await listRemoteObsidianFilesByPath(rootPath);
        const remoteList = filterRemoteListForManagedSyncFiles(remoteListRaw, rootPath);
        const remoteRevision = buildRemoteObsidianRevisionFromList(remoteList);

        if (!remoteList || !Array.isArray(remoteList.files) || remoteList.files.length === 0) {
            return {
                notFound: true,
                path: rootPath,
                sha: remoteRevision || '',
                snapshot: normalizeSnapshot({ data: {} }),
                remoteList
            };
        }

        const bridge = global.CanvasObsidianExportBridge;
        const parseSyncFolderFiles = bridge && typeof bridge.parseSyncFolderFilesForSync === 'function'
            ? bridge.parseSyncFolderFilesForSync.bind(bridge)
            : (bridge && typeof bridge.parseSyncFolderFiles === 'function'
                ? bridge.parseSyncFolderFiles.bind(bridge)
                : null);
        if (!bridge || typeof parseSyncFolderFiles !== 'function') {
            throw new Error(textByLang('云端同步解析器不可用', 'Cloud sync parser is unavailable'));
        }

        const fetched = await fetchRemoteObsidianFolderFiles(remoteList);
        if (!fetched.folderFiles || fetched.folderFiles.size === 0) {
            return {
                notFound: true,
                path: rootPath,
                sha: remoteRevision || '',
                snapshot: normalizeSnapshot({ data: {} }),
                remoteList
            };
        }

        const folderName = (rootPath ? rootPath.split('/').filter(Boolean).slice(-1)[0] : '') || DEFAULT_SETTINGS.obsidianExportRoot;
        let parsed = null;
        try {
            parsed = await parseSyncFolderFiles(fetched.folderFiles, folderName);
        } catch (error) {
            if (isMissingCanvasOrBackupInRemoteParseError(error)) {
                return {
                    notFound: true,
                    path: rootPath,
                    sha: remoteRevision || '',
                    snapshot: normalizeSnapshot({ data: {} }),
                    remoteList
                };
            }
            throw error;
        }
        const snapshot = buildSnapshotFromRemoteFolderParsed(parsed, remoteRevision);

        if (!normalizeBookmarkTreeSnapshot(snapshot.permanentTreeSnapshot)
            && typeof bridge.rebuildPermanentTreeSnapshotFromSyncFolderFiles === 'function') {
            try {
                const rebuiltPermanentTree = bridge.rebuildPermanentTreeSnapshotFromSyncFolderFiles(fetched.folderFiles, folderName);
                const normalizedPermanentTree = normalizeBookmarkTreeSnapshot(rebuiltPermanentTree);
                if (normalizedPermanentTree) {
                    snapshot.permanentTreeSnapshot = normalizedPermanentTree;
                }
            } catch (error) {
                console.warn('[Canvas Sync] rebuild remote permanent tree snapshot failed:', error);
            }
        }

        return {
            notFound: false,
            path: rootPath,
            sha: remoteRevision || '',
            snapshot,
            remoteList
        };
    }

    async function writeRemoteFile(path, content, commitMessage) {
        const payload = {
            action: 'canvasGitWriteFile',
            path: normalizeSyncPath(path),
            commitMessage,
            content: String(content == null ? '' : content)
        };

        if (!payload.path) {
            throw new Error(textByLang('缺少文件路径', 'Missing file path'));
        }

        const response = await sendRuntimeMessage(payload, 30000);
        if (!response || response.success !== true) {
            const message = (response && response.error) || textByLang(`写入文件失败：${payload.path}`, `Failed to write file: ${payload.path}`);
            const error = new Error(message);
            if (response && response.errorCode) error.code = String(response.errorCode);
            if (response && Number.isFinite(Number(response.sizeBytes))) error.sizeBytes = Number(response.sizeBytes);
            if (response && Number.isFinite(Number(response.limitBytes))) error.limitBytes = Number(response.limitBytes);
            if (response && response.path) error.path = String(response.path);
            throw error;
        }

        return response;
    }

    async function deleteRemoteFile(path, commitMessage) {
        const payload = {
            action: 'canvasGitDeleteFile',
            path: normalizeSyncPath(path),
            commitMessage
        };

        if (!payload.path) {
            throw new Error(textByLang('缺少文件路径', 'Missing file path'));
        }

        const response = await sendRuntimeMessage(payload, 30000);
        if (!response || response.success !== true) {
            const message = (response && response.error) || textByLang(`删除文件失败：${payload.path}`, `Failed to delete file: ${payload.path}`);
            throw new Error(message);
        }

        return response;
    }

    async function applyRemoteFilesBatch(changes, commitMessage) {
        const payload = {
            action: 'canvasGitApplyFilesBatch',
            changes: Array.isArray(changes) ? changes : [],
            commitMessage
        };

        if (!payload.changes.length) {
            throw new Error(textByLang('缺少变更列表', 'Missing change list'));
        }

        const response = await sendRuntimeMessage(payload, 120000);
        if (!response || response.success !== true) {
            const message = (response && response.error) || textByLang('批量写入失败', 'Batch write failed');
            const error = new Error(message);
            if (response && response.errorCode) error.code = String(response.errorCode);
            if (response && Number.isFinite(Number(response.sizeBytes))) error.sizeBytes = Number(response.sizeBytes);
            if (response && Number.isFinite(Number(response.limitBytes))) error.limitBytes = Number(response.limitBytes);
            if (response && response.path) error.path = String(response.path);
            throw error;
        }

        return response;
    }

    async function pushObsidianFilesIncremental(trigger, onProgress = null) {
        const reportProgress = (fraction, message) => {
            if (typeof onProgress !== 'function') return;
            try { onProgress(fraction, message); } catch (_) { }
        };

        if (!settings || settings.obsidianFilePushEnabled === false) {
            reportProgress(1, textByLang('已跳过文件推送', 'File push skipped'));
            return {
                enabled: false,
                changedCount: 0,
                totalCount: 0,
                paths: [],
                guidePaths: []
            };
        }

        const bridge = global.CanvasObsidianExportBridge;
        if (!bridge || typeof bridge.buildSyncFiles !== 'function') {
            reportProgress(1, textByLang('导出桥不可用', 'Export bridge unavailable'));
            return {
                enabled: false,
                changedCount: 0,
                totalCount: 0,
                reason: 'bridge-unavailable',
                paths: [],
                guidePaths: []
            };
        }

        reportProgress(0.05, textByLang('正在导出文件...', 'Exporting files...'));
        const bundle = await bridge.buildSyncFiles({
            exportFormat: settings.obsidianExportFormat,
            exportRoot: settings.obsidianExportRoot
        });
        const sourceFiles = Array.isArray(bundle && bundle.files) ? bundle.files : [];
        reportProgress(0.25, textByLang(`导出完成：${sourceFiles.length} 个文件`, `Exported: ${sourceFiles.length} files`));

        const normalizedFiles = [];
        const filesByPath = {};
        const guidePaths = [];
        sourceFiles.forEach((file) => {
            const path = normalizeSyncPath(file && file.path);
            if (!path) return;
            const content = String(file && file.content != null ? file.content : '');
            const meta = normalizeObsidianFileMeta(file && file.meta);
            const normalizedFile = {
                path,
                content,
                hash: hashString(content),
                meta
            };
            normalizedFiles.push(normalizedFile);
            filesByPath[path] = normalizedFile;
            if (/\/说明导入规则\.md$/i.test(path) || /^说明导入规则\.md$/i.test(path)) {
                guidePaths.push(path);
            }
        });

        reportProgress(0.32, textByLang('计算差异...', 'Calculating diff...'));
        const dirtyState = loadDirtyState();
        const previousPathMap = loadPathMap();
        const nextPathMap = buildPathMapFromObsidianFiles(normalizedFiles);
        savePathMap(nextPathMap);

        const forceTrackAll = shouldTrackAllFilesForPush(trigger);
        const forceWriteAll = shouldForceWriteAllFilesForPush(trigger);
        if (!forceTrackAll && !hasLocalDirtyWork(dirtyState)) {
            reportProgress(1, textByLang('无变更，跳过推送', 'No changes, skipped push'));
            return {
                enabled: true,
                changedCount: 0,
                totalCount: normalizedFiles.length,
                candidateCount: 0,
                skippedNoDirty: true,
                exportRoot: bundle && bundle.exportRoot ? String(bundle.exportRoot) : settings.obsidianExportRoot,
                paths: normalizedFiles.map((file) => file.path),
                guidePaths
            };
        }

        const pathInfo = collectCandidatePathsFromDirtyState(
            dirtyState,
            normalizedFiles,
            Object.assign({}, previousPathMap, nextPathMap)
        );

        const previousHashes = loadObsidianFileHashes();
        const nextHashes = {};
        const changedFiles = [];
        normalizedFiles.forEach((file) => {
            nextHashes[file.path] = file.hash;
        });

        const removedPaths = Object.keys(previousHashes || {}).map((path) => normalizeSyncPath(path)).filter((path) => {
            if (!path) return false;
            return !Object.prototype.hasOwnProperty.call(nextHashes, path);
        });

        const prevSyncIndex = loadPrevSyncIndex();
        const prevSyncFilesIndex = (prevSyncIndex && prevSyncIndex.files && typeof prevSyncIndex.files === 'object')
            ? prevSyncIndex.files
            : {};

        const candidateSet = forceTrackAll
            ? new Set(normalizedFiles.map((file) => file.path))
            : pathInfo.candidatePaths;

        if (!candidateSet.size && normalizedFiles.length) {
            normalizedFiles.forEach((file) => candidateSet.add(file.path));
        }

        // If a file was never pushed (no previous sha recorded), we must include it in the next push,
        // otherwise `.canvas` may reference missing markdown files.
        if (!forceTrackAll && normalizedFiles.length) {
            normalizedFiles.forEach((file) => {
                const path = file && file.path ? String(file.path) : '';
                if (!path) return;
                const prevEntry = prevSyncFilesIndex[path];
                const prevSha = prevEntry ? String(prevEntry.sha || '') : '';
                if (!prevEntry || !prevSha) {
                    candidateSet.add(path);
                }
            });
        }

        // When tracking all files (usually manual triggers), preflight remote listing once:
        // if a file is missing remotely, we must upload it even if local hash matches previous baseline.
        let remoteFilesByPathForMissingCheck = null;
        if (forceTrackAll && !forceWriteAll) {
            try {
                reportProgress(0.45, textByLang('检查云端缺失文件...', 'Checking remote missing files...'));
                const remoteListRaw = await listRemoteObsidianFilesByPath(settings.obsidianExportRoot);
                remoteFilesByPathForMissingCheck = remoteListRaw && remoteListRaw.filesByPath ? remoteListRaw.filesByPath : null;
            } catch (_) {
                remoteFilesByPathForMissingCheck = null;
            }
        }

        const processedPaths = [];
        candidateSet.forEach((path) => {
            const normalizedPath = normalizeSyncPath(path);
            if (!normalizedPath) return;
            const file = filesByPath[normalizedPath];
            if (!file) return;
            processedPaths.push(normalizedPath);
            const remoteMissing = !!(remoteFilesByPathForMissingCheck && !remoteFilesByPathForMissingCheck[normalizedPath]);
            const prevEntry = prevSyncFilesIndex[normalizedPath];
            const prevSha = prevEntry ? String(prevEntry.sha || '') : '';
            const localUnsynced = !prevEntry || !prevSha;
            if (forceWriteAll || remoteMissing || localUnsynced || previousHashes[normalizedPath] !== file.hash) {
                changedFiles.push({ path: normalizedPath, content: file.content });
            }
        });

        const writeResultsByPath = {};

        // Prefer one single Git commit per push (Git Data API), instead of one commit per file (Contents API).
        // This aligns better with Obsidian Git semantics: commit -> pull -> push.
        const batchCommitMessage = `Bookmark Canvas Sync: ${trigger || 'sync'} batch update(${changedFiles.length}) delete(${removedPaths.length})`;

        let batchDeletePaths = removedPaths.slice();
        let fallbackDeletes = [];

        // Git Trees API errors if we try to delete a path that does not exist, so we pre-filter deletes when possible.
        if (batchDeletePaths.length) {
            const applyRemoteDeleteFilter = (remoteFilesByPath) => {
                const remote = (remoteFilesByPath && typeof remoteFilesByPath === 'object') ? remoteFilesByPath : {};
                batchDeletePaths = batchDeletePaths.filter((path) => !!remote[path]);
                const batchDeleteSet = new Set(batchDeletePaths);
                fallbackDeletes = removedPaths.filter((path) => !batchDeleteSet.has(path));
            };

            if (remoteFilesByPathForMissingCheck) {
                applyRemoteDeleteFilter(remoteFilesByPathForMissingCheck);
            } else {
                try {
                    const remoteListRaw = await listRemoteObsidianFilesByPath(settings.obsidianExportRoot);
                    applyRemoteDeleteFilter(remoteListRaw && remoteListRaw.filesByPath ? remoteListRaw.filesByPath : {});
                } catch (_) {
                    // If we cannot list remote, avoid batch deletes (updates still batched); fall back to Contents API deletes.
                    fallbackDeletes = batchDeletePaths.slice();
                    batchDeletePaths = [];
                }
            }
        }

        const batchChanges = [];
        changedFiles.forEach((file) => {
            batchChanges.push({ path: file.path, content: file.content });
        });
        batchDeletePaths.forEach((path) => {
            batchChanges.push({ path, delete: true });
        });

        if (batchChanges.length) {
            reportProgress(0.65, textByLang('提交到云端...', 'Committing to cloud...'));
            const batchResult = await applyRemoteFilesBatch(batchChanges, batchCommitMessage);
            const fileShas = batchResult && typeof batchResult.fileShas === 'object' ? batchResult.fileShas : {};
            Object.keys(fileShas || {}).forEach((path) => {
                const sha = String(fileShas[path] || '');
                if (!sha) return;
                writeResultsByPath[path] = { fileSha: sha, commitSha: batchResult.commitSha || null };
            });
            reportProgress(0.9, textByLang('云端提交完成', 'Cloud commit completed'));
        }

        // Fallback deletions (rare): keep behavior compatible (and not block the whole batch commit).
        for (let i = 0; i < fallbackDeletes.length; i++) {
            const removedPath = fallbackDeletes[i];
            const commitMessage = `Bookmark Canvas Sync: ${trigger || 'sync'} delete ${removedPath}`;
            await deleteRemoteFile(removedPath, commitMessage);
            reportProgress(
                0.9 + (0.1 * ((i + 1) / Math.max(1, fallbackDeletes.length))),
                textByLang(`清理远端文件 ${i + 1}/${fallbackDeletes.length}`, `Cleaning remote files ${i + 1}/${fallbackDeletes.length}`)
            );
        }

        // Only advance the local hash baseline for paths we actually considered in this push.
        // Otherwise, a missing/buggy dirty mark could make the baseline "ahead" of the remote,
        // and the file would never be pushed (hash would look unchanged locally).
        const mergedHashes = Object.assign({}, previousHashes || {});
        processedPaths.forEach((path) => {
            const normalizedPath = normalizeSyncPath(path);
            if (!normalizedPath) return;
            const hash = String(nextHashes[normalizedPath] || '');
            if (!hash) return;
            mergedHashes[normalizedPath] = hash;
        });
        removedPaths.forEach((path) => {
            const normalizedPath = normalizeSyncPath(path);
            if (!normalizedPath) return;
            delete mergedHashes[normalizedPath];
        });
        saveObsidianFileHashes(mergedHashes);

        const syncedPaths = processedPaths.concat(removedPaths);
        if (syncedPaths.length) {
            const nextDirty = clearDirtyStateBySyncedPaths(dirtyState, syncedPaths, filesByPath, pathInfo);
            saveDirtyState(nextDirty);
        }

        const nextPrevSyncIndex = normalizePrevSyncIndex(prevSyncIndex);
        const nowTs = Date.now();
        const visiblePaths = new Set(normalizedFiles.map((file) => file.path));

        Object.keys(nextPrevSyncIndex.files).forEach((path) => {
            if (!visiblePaths.has(path)) {
                delete nextPrevSyncIndex.files[path];
            }
        });

        syncedPaths.forEach((path) => {
            const file = filesByPath[path];
            if (!file) {
                if (nextPrevSyncIndex.files[path]) {
                    delete nextPrevSyncIndex.files[path];
                }
                return;
            }

            const writeResult = writeResultsByPath[path];
            const previousEntry = nextPrevSyncIndex.files[path] || {};
            const nextSha = writeResult
                ? String(writeResult.fileSha || writeResult.commitSha || previousEntry.sha || '')
                : String(previousEntry.sha || '');

            nextPrevSyncIndex.files[path] = {
                hash: file.hash,
                sha: nextSha,
                size: getUtf8Size(file.content),
                mtime: nowTs,
                syncedAt: nowTs
            };
        });

        nextPrevSyncIndex.updatedAt = nowTs;
        savePrevSyncIndex(nextPrevSyncIndex);

        reportProgress(1, textByLang('上传完成', 'Upload completed'));
        return {
            enabled: true,
            changedCount: changedFiles.length,
            deletedCount: removedPaths.length,
            totalCount: normalizedFiles.length,
            candidateCount: processedPaths.length,
            skippedNoDirty: false,
            localRevision: buildLocalObsidianRevisionFromHashMap(nextHashes),
            exportRoot: bundle && bundle.exportRoot ? String(bundle.exportRoot) : settings.obsidianExportRoot,
            paths: normalizedFiles.map((file) => file.path),
            guidePaths
        };
    }

    async function rebuildObsidianIndexesFromLocalSnapshot(trigger, options = {}) {
        if (!settings || settings.obsidianFilePushEnabled === false) {
            if (options && options.clearDirty !== false) {
                saveDirtyState(createDefaultDirtyState());
            }
            return {
                enabled: false,
                reason: 'obsidian-file-push-disabled',
                totalCount: 0
            };
        }

        const bridge = global.CanvasObsidianExportBridge;
        if (!bridge || typeof bridge.buildSyncFiles !== 'function') {
            return {
                enabled: false,
                reason: 'bridge-unavailable',
                totalCount: 0
            };
        }

        const bundle = await bridge.buildSyncFiles({
            exportFormat: settings.obsidianExportFormat,
            exportRoot: settings.obsidianExportRoot
        });
        const sourceFiles = Array.isArray(bundle && bundle.files) ? bundle.files : [];

        const normalizedFiles = [];
        sourceFiles.forEach((file) => {
            const path = normalizeSyncPath(file && file.path);
            if (!path) return;
            const content = String(file && file.content != null ? file.content : '');
            const meta = normalizeObsidianFileMeta(file && file.meta);
            normalizedFiles.push({
                path,
                content,
                hash: hashString(content),
                meta
            });
        });

        const nextHashes = {};
        normalizedFiles.forEach((file) => {
            nextHashes[file.path] = file.hash;
        });
        saveObsidianFileHashes(nextHashes);

        const nextPathMap = buildPathMapFromObsidianFiles(normalizedFiles);
        savePathMap(nextPathMap);

        const prevSyncIndex = loadPrevSyncIndex();
        const nextPrevSyncIndex = normalizePrevSyncIndex(prevSyncIndex);
        const remoteFilesByPath = (options && options.remoteFilesByPath && typeof options.remoteFilesByPath === 'object')
            ? options.remoteFilesByPath
            : null;
        const nowTs = Number(options && options.syncedAt) || Date.now();
        const visiblePaths = new Set(normalizedFiles.map((file) => file.path));

        Object.keys(nextPrevSyncIndex.files).forEach((path) => {
            if (!visiblePaths.has(path)) {
                delete nextPrevSyncIndex.files[path];
            }
        });

        normalizedFiles.forEach((file) => {
            const previousEntry = nextPrevSyncIndex.files[file.path] || {};
            const remoteEntry = remoteFilesByPath ? remoteFilesByPath[file.path] : null;
            nextPrevSyncIndex.files[file.path] = {
                hash: file.hash,
                sha: String((remoteEntry && remoteEntry.sha) || previousEntry.sha || ''),
                size: getUtf8Size(file.content),
                mtime: nowTs,
                syncedAt: nowTs
            };
        });
        nextPrevSyncIndex.updatedAt = nowTs;
        savePrevSyncIndex(nextPrevSyncIndex);

        if (options && options.clearDirty !== false) {
            saveDirtyState(createDefaultDirtyState());
        }

        return {
            enabled: true,
            totalCount: normalizedFiles.length,
            localRevision: buildLocalObsidianRevisionFromHashMap(nextHashes),
            exportRoot: bundle && bundle.exportRoot ? String(bundle.exportRoot) : settings.obsidianExportRoot,
            trigger: String(trigger || 'pull-index-rebuild')
        };
    }

    async function listRemoteObsidianFilesByPath(rootPath) {
        const hasExplicitRoot = typeof rootPath === 'string';
        const normalizedRootPath = normalizeSyncPath(hasExplicitRoot ? rootPath : (settings && settings.obsidianExportRoot));

        const response = await sendRuntimeMessage({
            action: 'canvasGitListFiles',
            rootPath: normalizedRootPath
        }, 30000);

        if (!response || response.success !== true) {
            throw new Error((response && response.error) || textByLang('读取云端文件清单失败', 'Failed to list cloud files'));
        }

        const files = [];
        const filesByPath = {};

        const sourceFiles = Array.isArray(response.files) ? response.files : [];
        sourceFiles.forEach((entry) => {
            const path = normalizeSyncPath(entry && entry.path);
            if (!path) return;
            if (normalizedRootPath && path !== normalizedRootPath && !path.startsWith(`${normalizedRootPath}/`)) return;

            const fileEntry = {
                path,
                repoPath: normalizeSyncPath(entry && entry.repoPath),
                sha: String((entry && entry.sha) || ''),
                size: Math.max(0, Number(entry && entry.size) || 0)
            };
            files.push(fileEntry);
            filesByPath[path] = fileEntry;
        });

        return {
            rootPath: normalizedRootPath,
            files,
            filesByPath,
            truncated: response.truncated === true
        };
    }

    function buildRemoteRootCandidatesFromFiles(sourceFiles, expectedRoot = '') {
        const files = Array.isArray(sourceFiles) ? sourceFiles : [];
        const candidateMap = new Map();
        const expected = normalizeSyncPath(expectedRoot);

        files.forEach((entry) => {
            const path = normalizeSyncPath(entry && entry.path);
            if (!path || !/\.canvas$/i.test(path)) return;
            const segments = path.split('/').filter(Boolean);
            const canvasName = segments.pop() || '';
            const root = segments.join('/');
            if (!candidateMap.has(root)) {
                candidateMap.set(root, {
                    root,
                    canvasNames: new Set(),
                    permanentCount: 0,
                    temporaryCount: 0,
                    blankCount: 0,
                    score: 0
                });
            }
            candidateMap.get(root).canvasNames.add(canvasName);
        });

        const statsList = Array.from(candidateMap.values());
        statsList.forEach((stats) => {
            const prefix = stats.root ? `${stats.root}/` : '';
            files.forEach((entry) => {
                const path = normalizeSyncPath(entry && entry.path);
                if (!path) return;
                if (prefix && !path.startsWith(prefix)) return;
                const relative = prefix ? path.slice(prefix.length) : path;
                if (!relative) return;
                if (/^(永久栏目|Permanent)(\/|$)/.test(relative)) stats.permanentCount += 1;
                if (/^(临时栏目|Temporary)(\/|$)/.test(relative)) stats.temporaryCount += 1;
                if (/^(空白栏目|Blank)(\/|$)/.test(relative)) stats.blankCount += 1;
            });

            const hasCanvas = stats.canvasNames.size > 0;
            const hasPermanent = stats.permanentCount > 0;
            const hasTemporary = stats.temporaryCount > 0;
            const hasBlank = stats.blankCount > 0;
            const hasCoreFolder = hasPermanent || hasTemporary || hasBlank;
            const hasDefaultCanvasName = stats.canvasNames.has('书签画布.canvas') || stats.canvasNames.has('bookmark-canvas.canvas');
            const expectedLeaf = expected ? expected.split('/').filter(Boolean).slice(-1)[0] : '';
            const candidateLeaf = stats.root ? stats.root.split('/').filter(Boolean).slice(-1)[0] : '';
            const leafMatch = !!(expectedLeaf && candidateLeaf && expectedLeaf === candidateLeaf);

            stats.score = 0;
            if (hasCanvas) stats.score += 5;
            if (hasPermanent) stats.score += 3;
            if (hasTemporary) stats.score += 2;
            if (hasBlank) stats.score += 2;
            if (hasDefaultCanvasName) stats.score += 2;
            if (leafMatch) stats.score += 1;
            stats.hasCoreFolder = hasCoreFolder;
        });

        return statsList
            .filter((item) => item.canvasNames.size > 0 && item.hasCoreFolder)
            .sort((left, right) => {
                if (right.score !== left.score) return right.score - left.score;
                const leftDepth = String(left.root || '').split('/').filter(Boolean).length;
                const rightDepth = String(right.root || '').split('/').filter(Boolean).length;
                if (rightDepth !== leftDepth) return rightDepth - leftDepth;
                return String(left.root || '').localeCompare(String(right.root || ''));
            })
            .map((item) => ({
                root: item.root,
                score: item.score,
                canvasNames: Array.from(item.canvasNames.values())
            }));
    }

    async function maybeHandleRemotePathChanged(options = {}) {
        const currentRoot = normalizeSyncPath(settings && settings.obsidianExportRoot);
        const interactive = options && options.interactive === true;
        const continueAfterConfirm = options && options.continueAfterConfirm === true;

        let allRemoteList = null;
        try {
            allRemoteList = await listRemoteObsidianFilesByPath('');
        } catch (_) {
            return { detected: false, updated: false, canceled: false, candidates: [] };
        }

        const candidates = buildRemoteRootCandidatesFromFiles(allRemoteList && allRemoteList.files, currentRoot);
        const filtered = candidates.filter((item) => normalizeSyncPath(item && item.root) !== currentRoot);
        if (!filtered.length) {
            return { detected: false, updated: false, canceled: false, candidates: [] };
        }

        const suggested = normalizeSyncPath(filtered[0] && filtered[0].root);
        if (!interactive) {
            return {
                detected: true,
                updated: false,
                canceled: false,
                suggestedRoot: suggested,
                candidates: filtered
            };
        }

        const noticeHtml = buildRemotePathChangedNoticeHtml(filtered, currentRoot);
        const confirmed = await openFirstSyncPathValidationDialog({
            continueAfterConfirm,
            prefillRoot: suggested,
            noticeHtml
        });

        return {
            detected: true,
            updated: !!confirmed,
            canceled: !confirmed,
            suggestedRoot: suggested,
            candidates: filtered
        };
    }

    function createPathValidationRequiredError(pathRecovery, options = {}) {
        const interactive = options && options.interactive === true;
        const recovery = pathRecovery && typeof pathRecovery === 'object' ? pathRecovery : null;
        const suggestedRootLabel = recovery && Object.prototype.hasOwnProperty.call(recovery, 'suggestedRoot')
            ? formatSyncRootForDisplay(recovery.suggestedRoot)
            : '';
        const canceled = !!(recovery && recovery.canceled);

        const message = canceled
            ? textByLang('已取消路径校验，本次同步未执行', 'Path validation cancelled, sync not executed')
            : (interactive
                ? textByLang(
                    `检测到云端路径可能已变化，请先完成路径校验后再同步${suggestedRootLabel ? `（建议：${suggestedRootLabel}）` : ''}`,
                    `Cloud path may have changed. Complete path validation before sync${suggestedRootLabel ? ` (suggested: ${suggestedRootLabel})` : ''}`
                )
                : textByLang(
                    `后台检测到云端路径可能已变化，请前往同步设置重新校验路径${suggestedRootLabel ? `（建议：${suggestedRootLabel}）` : ''}`,
                    `Background check detected cloud path change. Open sync settings and re-validate the path${suggestedRootLabel ? ` (suggested: ${suggestedRootLabel})` : ''}`
                ));

        const error = new Error(message);
        error.code = 'path-validation-required';
        error.canceled = canceled;
        error.pathRecovery = recovery;
        return error;
    }

    async function readRemoteSnapshotWithPathRecovery(options = {}) {
        const interactive = options && options.interactive === true;
        const continueAfterConfirm = options && options.continueAfterConfirm === true;
        const throwWhenDetected = !(options && options.throwWhenDetected === false);

        let remoteState = await readRemoteSnapshot();
        if (!remoteState.notFound) {
            return remoteState;
        }

        const recovery = await maybeHandleRemotePathChanged({
            interactive,
            continueAfterConfirm
        });

        if (recovery && recovery.detected && recovery.updated) {
            remoteState = await readRemoteSnapshot();
            return remoteState;
        }

        if (recovery && recovery.detected && throwWhenDetected) {
            throw createPathValidationRequiredError(recovery, { interactive });
        }

        return remoteState;
    }

    function buildRemoteObsidianRevisionFromList(remoteList) {
        const files = remoteList && Array.isArray(remoteList.files) ? remoteList.files : [];
        if (!files.length) return '';
        const canonical = files
            .map((entry) => ({
                path: normalizeSyncPath(entry && entry.path),
                sha: String((entry && entry.sha) || '')
            }))
            .filter((entry) => !!entry.path)
            .sort((a, b) => a.path.localeCompare(b.path))
            .map((entry) => `${entry.path}:${entry.sha}`)
            .join('\n');
        if (!canonical) return '';
        return `files:${hashString(canonical)}`;
    }

    function buildManagedCanvasFileNameCandidates(rootPath) {
        const normalizedRoot = normalizeSyncPath(rootPath);
        const rootLeaf = normalizedRoot
            ? normalizedRoot.split('/').filter(Boolean).slice(-1)[0]
            : '';
        const candidates = new Set([
            '书签画布.canvas',
            'bookmark-canvas.canvas'
        ]);
        if (rootLeaf) {
            candidates.add(`${rootLeaf}.canvas`);
        }
        return candidates;
    }

    function isManagedSyncRelativePath(relativePath, canvasFileNames) {
        const relative = normalizeSyncPath(relativePath);
        if (!relative) return false;

        if (/^(永久栏目|Permanent|临时栏目|Temporary|空白栏目|Blank)\/.+\.md$/i.test(relative)) {
            return true;
        }
        if (/^(说明导入规则\.md|README_Import_Rules\.md|说明_导入规则\.md)$/i.test(relative)) {
            return true;
        }
        if (/^bookmark-canvas\.backup\.json$/i.test(relative)) {
            return true;
        }
        if (/^[^/]+\.canvas$/i.test(relative)) {
            const fileName = relative.split('/').pop() || '';
            return !!(canvasFileNames && canvasFileNames.has(fileName));
        }
        return false;
    }

    function filterRemoteListForManagedSyncFiles(remoteList, rootPath = '') {
        const source = remoteList && typeof remoteList === 'object' ? remoteList : {};
        const sourceFiles = Array.isArray(source.files) ? source.files : [];
        const normalizedRoot = normalizeSyncPath(
            typeof rootPath === 'string'
                ? rootPath
                : (source.rootPath || '')
        );
        const canvasFileNames = buildManagedCanvasFileNameCandidates(normalizedRoot);
        const files = [];
        const filesByPath = {};

        sourceFiles.forEach((entry) => {
            const path = normalizeSyncPath(entry && entry.path);
            if (!path) return;

            let relativePath = path;
            if (normalizedRoot) {
                const prefix = `${normalizedRoot}/`;
                if (!path.startsWith(prefix)) return;
                relativePath = path.slice(prefix.length);
            }

            if (!isManagedSyncRelativePath(relativePath, canvasFileNames)) return;
            files.push(entry);
            filesByPath[path] = entry;
        });

        return {
            rootPath: normalizedRoot,
            files,
            filesByPath,
            truncated: source.truncated === true
        };
    }

    async function readRemoteFileAtPath(path) {
        const normalizedPath = normalizeSyncPath(path);
        if (!normalizedPath) {
            throw new Error(textByLang('缺少文件路径', 'Missing file path'));
        }

        const response = await sendRuntimeMessage({
            action: 'canvasGitReadFile',
            path: normalizedPath
        }, 30000);

        if (!response || response.success !== true) {
            throw new Error((response && response.error) || textByLang(`读取云端文件失败：${normalizedPath}`, `Failed to read cloud file: ${normalizedPath}`));
        }

        if (response.notFound === true) {
            return {
                notFound: true,
                path: normalizedPath,
                sha: '',
                bytes: new Uint8Array(0)
            };
        }

        return {
            notFound: false,
            path: normalizeSyncPath(response.path) || normalizedPath,
            sha: String(response.sha || ''),
            bytes: decodeBase64ToBytes(response.contentBase64 || '')
        };
    }

    async function fetchRemoteObsidianFolderFiles(remoteList, onProgress = null) {
        const files = remoteList && Array.isArray(remoteList.files) ? remoteList.files : [];
        const reportProgress = (fraction, message) => {
            if (typeof onProgress !== 'function') return;
            try { onProgress(fraction, message); } catch (_) { }
        };
        const targets = files
            .map((entry) => normalizeSyncPath(entry && entry.path))
            .filter((path) => !!path && (/\.md$/i.test(path) || /\.canvas$/i.test(path) || /bookmark-canvas\.backup\.json$/i.test(path)));

        reportProgress(0, textByLang(`拉取文件 0/${targets.length}`, `Downloading files 0/${targets.length}`));
        const folderFiles = new Map();
        let downloaded = 0;

        for (let i = 0; i < targets.length; i++) {
            const path = targets[i];
            const fileState = await readRemoteFileAtPath(path);
            if (fileState.notFound) continue;
            folderFiles.set(path, fileState.bytes);
            downloaded += 1;
            reportProgress(
                (i + 1) / Math.max(1, targets.length),
                textByLang(`拉取文件 ${i + 1}/${targets.length}`, `Downloading files ${i + 1}/${targets.length}`)
            );
        }

        return {
            folderFiles,
            downloaded
        };
    }

    async function applyRemoteObsidianFilesReplace(remoteList, trigger, onProgress = null) {
        const bridge = global.CanvasObsidianExportBridge;
        if (!bridge || typeof bridge.applySyncFilesReplace !== 'function') {
            return {
                applied: false,
                reason: 'apply-bridge-unavailable'
            };
        }

        const fetched = await fetchRemoteObsidianFolderFiles(remoteList, onProgress);
        if (!fetched.folderFiles.size) {
            return {
                applied: false,
                reason: 'empty-remote-files'
            };
        }

        const rootPath = normalizeSyncPath(settings && settings.obsidianExportRoot);
        const folderName = (rootPath ? rootPath.split('/').filter(Boolean).slice(-1)[0] : '') || DEFAULT_SETTINGS.obsidianExportRoot;
        const applyResult = await bridge.applySyncFilesReplace(fetched.folderFiles, folderName, {
            trigger: String(trigger || 'pull')
        });

	        return {
	            applied: !!(applyResult && applyResult.success),
	            downloaded: fetched.downloaded,
	            tempCount: Number(applyResult && applyResult.tempCount) || 0,
	            mdCount: Number(applyResult && applyResult.mdCount) || 0,
	            edgeCount: Number(applyResult && applyResult.edgeCount) || 0,
	            permanentTreeSnapshot: applyResult && applyResult.permanentTreeSnapshot ? applyResult.permanentTreeSnapshot : null
	        };
	    }

    function buildObsidianFileSyncPlan(localFiles, remoteFilesByPath, prevSyncIndex) {
        const localByPath = {};
        const localList = Array.isArray(localFiles) ? localFiles : [];
        localList.forEach((file) => {
            const path = normalizeSyncPath(file && file.path);
            if (!path) return;
            localByPath[path] = file;
        });

        const remoteByPath = (remoteFilesByPath && typeof remoteFilesByPath === 'object') ? remoteFilesByPath : {};
        const prevIndex = (prevSyncIndex && typeof prevSyncIndex === 'object') ? prevSyncIndex : createDefaultPrevSyncIndex();
        const prevFiles = (prevIndex.files && typeof prevIndex.files === 'object') ? prevIndex.files : {};

        const allPaths = new Set();
        Object.keys(localByPath).forEach((path) => allPaths.add(path));
        Object.keys(remoteByPath).forEach((path) => allPaths.add(normalizeSyncPath(path)));
        Object.keys(prevFiles).forEach((path) => allPaths.add(normalizeSyncPath(path)));

        const plan = {
            upload: [],
            download: [],
            deleteRemote: [],
            deleteLocal: [],
            conflict: [],
            skip: []
        };

        allPaths.forEach((rawPath) => {
            const path = normalizeSyncPath(rawPath);
            if (!path) return;

            const localEntry = localByPath[path] || null;
            const remoteEntry = remoteByPath[path] || null;
            const prevEntry = prevFiles[path] || null;
            const hasPrevBaseline = !!(prevEntry && (prevEntry.hash || prevEntry.sha));

            if (!hasPrevBaseline) {
                if (localEntry && !remoteEntry) {
                    plan.upload.push({ path, reason: 'new-local-no-baseline' });
                } else if (!localEntry && remoteEntry) {
                    plan.download.push({ path, reason: 'new-remote-no-baseline' });
                } else {
                    plan.skip.push({ path, reason: 'no-baseline-both-exist-or-empty' });
                }
                return;
            }

            const prevHash = String(prevEntry.hash || '');
            const prevSha = String(prevEntry.sha || '');
            const localChanged = prevHash
                ? ((!localEntry) || String(localEntry.hash || '') !== prevHash)
                : !!localEntry;
            const remoteChanged = prevSha
                ? ((!remoteEntry) || String(remoteEntry.sha || '') !== prevSha)
                : !!remoteEntry;

            if (!localChanged && !remoteChanged) {
                plan.skip.push({ path, reason: 'no-change' });
                return;
            }

            if (localChanged && !remoteChanged) {
                if (localEntry) {
                    plan.upload.push({ path, reason: 'local-changed-only' });
                } else {
                    plan.deleteRemote.push({ path, reason: 'local-deleted-only' });
                }
                return;
            }

            if (!localChanged && remoteChanged) {
                if (remoteEntry) {
                    plan.download.push({ path, reason: 'remote-changed-only' });
                } else {
                    plan.deleteLocal.push({ path, reason: 'remote-deleted-only' });
                }
                return;
            }

            plan.conflict.push({ path, reason: 'local-and-remote-changed' });
        });

        return plan;
    }

    async function buildObsidianPullPlan(trigger) {
        if (!settings || settings.obsidianFilePushEnabled === false) {
            return {
                enabled: false,
                reason: 'obsidian-file-push-disabled',
                trigger: String(trigger || 'pull-plan')
            };
        }

        const bridge = global.CanvasObsidianExportBridge;
        if (!bridge || typeof bridge.buildSyncFiles !== 'function') {
            return {
                enabled: false,
                reason: 'bridge-unavailable',
                trigger: String(trigger || 'pull-plan')
            };
        }

        const bundle = await bridge.buildSyncFiles({
            exportFormat: settings.obsidianExportFormat,
            exportRoot: settings.obsidianExportRoot
        });
        const sourceFiles = Array.isArray(bundle && bundle.files) ? bundle.files : [];

        const localFiles = [];
        sourceFiles.forEach((file) => {
            const path = normalizeSyncPath(file && file.path);
            if (!path) return;
            const content = String(file && file.content != null ? file.content : '');
            const meta = normalizeObsidianFileMeta(file && file.meta);
            localFiles.push({
                path,
                content,
                hash: hashString(content),
                meta
            });
        });

        const remoteListRaw = await listRemoteObsidianFilesByPath(settings.obsidianExportRoot);
        const remoteList = filterRemoteListForManagedSyncFiles(remoteListRaw, settings.obsidianExportRoot);
        const prevSyncIndex = loadPrevSyncIndex();
        const plan = buildObsidianFileSyncPlan(localFiles, remoteList.filesByPath, prevSyncIndex);

        return {
            enabled: true,
            trigger: String(trigger || 'pull-plan'),
            localFiles,
            remoteList,
            plan
        };
    }

    function storeConflictRecord(localSnapshot, remoteSnapshot, reason, extra = {}) {
        const list = safeParse(getSyncMetaRaw(CONFLICT_LOG_KEY), []);
        const arr = Array.isArray(list) ? list : [];
        arr.unshift({
            ts: Date.now(),
            reason,
            policy: settings.conflictPolicy,
            local: buildSnapshotMeta(localSnapshot),
            remote: buildSnapshotMeta(remoteSnapshot),
            extra
        });
        setSyncMetaRaw(CONFLICT_LOG_KEY, JSON.stringify(arr.slice(0, 20)));
    }

    function hasPendingConflict() {
        return !!pendingConflict;
    }

    function loadPendingConflict() {
        const parsed = safeParse(getSyncMetaRaw(PENDING_CONFLICT_KEY), null);
        if (!parsed) return null;
        try {
            const localSnapshot = normalizeSnapshot(parsed.localSnapshot || {});
            const remoteSnapshot = normalizeSnapshot(parsed.remoteSnapshot || {});
            const fileConflicts = uniqueStringList(parsed.fileConflicts, normalizeSyncPath);
            const filePlanSummaryRaw = (parsed.filePlanSummary && typeof parsed.filePlanSummary === 'object')
                ? parsed.filePlanSummary
                : {};
            const filePlanSummary = {
                conflict: Math.max(0, Number(filePlanSummaryRaw.conflict) || 0),
                download: Math.max(0, Number(filePlanSummaryRaw.download) || 0),
                deleteLocal: Math.max(0, Number(filePlanSummaryRaw.deleteLocal) || 0),
                upload: Math.max(0, Number(filePlanSummaryRaw.upload) || 0),
                deleteRemote: Math.max(0, Number(filePlanSummaryRaw.deleteRemote) || 0),
                skip: Math.max(0, Number(filePlanSummaryRaw.skip) || 0)
            };
            return {
                id: String(parsed.id || `conflict-${Date.now()}`),
                createdAt: Number(parsed.createdAt) || Date.now(),
                reason: String(parsed.reason || 'concurrent-change'),
                remoteSha: String(parsed.remoteSha || ''),
                remotePath: String(parsed.remotePath || ''),
                localSnapshot,
                remoteSnapshot,
                localMeta: parsed.localMeta || buildSnapshotMeta(localSnapshot),
                remoteMeta: parsed.remoteMeta || buildSnapshotMeta(remoteSnapshot),
                fileConflicts,
                filePlanSummary
            };
        } catch (_) {
            return null;
        }
    }

    function persistPendingConflict() {
        if (!pendingConflict) {
            setSyncMetaRaw(PENDING_CONFLICT_KEY, null);
            return;
        }
        setSyncMetaRaw(PENDING_CONFLICT_KEY, JSON.stringify(pendingConflict));
    }


    function evaluatePermanentPullDecision(localTreeSnapshot, remoteTreeSnapshot) {
        const mode = ensurePermanentPullMode(settings && settings.permanentPullMode);
        const localTree = normalizeBookmarkTreeSnapshot(localTreeSnapshot);
        const remoteTree = normalizeBookmarkTreeSnapshot(remoteTreeSnapshot);
        if (!localTree || !remoteTree) {
            return { policy: mode, result: 'overwrite', reason: 'tree-missing', threshold: 0, logicalChangeCount: 0 };
        }
        if (mode === 'overwrite') {
            return { policy: mode, result: 'overwrite', reason: 'fixed-overwrite', threshold: 0, logicalChangeCount: 0 };
        }
        if (mode === 'incremental') {
            return { policy: mode, result: 'incremental', reason: 'fixed-incremental', threshold: 0, logicalChangeCount: 0 };
        }
        const plan = buildPermanentIncrementalSyncPlan(localTree, remoteTree);
        const threshold = buildPermanentIncrementalThreshold(localTree, remoteTree);
        const logicalChangeCount = Number(plan && plan.logicalChangeCount) || 0;
        if (plan && plan.complexReason) {
            return { policy: mode, result: 'overwrite', reason: String(plan.complexReason), threshold, logicalChangeCount };
        }
        if (!plan || !plan.hasChanges) {
            return { policy: mode, result: 'incremental', reason: 'same', threshold, logicalChangeCount };
        }
        if (logicalChangeCount > threshold) {
            return { policy: mode, result: 'overwrite', reason: 'threshold-exceeded', threshold, logicalChangeCount };
        }
        return { policy: mode, result: 'incremental', reason: 'within-threshold', threshold, logicalChangeCount };
    }

    function formatPermanentPullDecisionText(decision) {
        const source = decision && typeof decision === 'object' ? decision : {};
        const policy = ensurePermanentPullMode(source.policy);
        const result = source.result === 'incremental' ? 'incremental' : 'overwrite';
        const threshold = Number(source.threshold) || 0;
        const logicalChangeCount = Number(source.logicalChangeCount) || 0;

        if (policy === 'overwrite') {
            return textByLang('永久栏目处理：覆盖恢复（固定）', 'Permanent section handling: overwrite restore (fixed)');
        }
        if (policy === 'incremental') {
            return textByLang('永久栏目处理：增量同步（固定）', 'Permanent section handling: incremental sync (fixed)');
        }
        return result === 'incremental'
            ? textByLang(`永久栏目处理：自动 → 本次使用增量同步（变更数 ${logicalChangeCount} / 阈值 ${threshold}）`, `Permanent section handling: auto → incremental sync this time (changes ${logicalChangeCount} / threshold ${threshold})`)
            : textByLang(`永久栏目处理：自动 → 本次使用覆盖恢复（变更数 ${logicalChangeCount} / 阈值 ${threshold}）`, `Permanent section handling: auto → overwrite restore this time (changes ${logicalChangeCount} / threshold ${threshold})`);
    }

    let mismatchPermanentHintToken = 0;
    async function refreshMismatchPermanentModeHint() {
        const panel = getElement('canvasSyncMismatchPanel');
        const hintEl = getElement('canvasSyncMismatchPermanentModeHint');
        if (!panel || !hintEl || panel.hidden || !runtime || !runtime.pendingMismatch) return;
        const token = ++mismatchPermanentHintToken;
        hintEl.hidden = false;
        hintEl.textContent = textByLang('永久栏目处理：正在计算...', 'Permanent section handling: calculating...');
        try {
            const localTree = await getPermanentTreeSnapshotForSync();
            const remoteState = await readRemoteSnapshotWithPathRecovery({ interactive: false, continueAfterConfirm: false, throwWhenDetected: false });
            const remoteTree = remoteState && !remoteState.notFound && remoteState.snapshot
                ? remoteState.snapshot.permanentTreeSnapshot
                : null;
            const decision = evaluatePermanentPullDecision(localTree, remoteTree);
            if (token !== mismatchPermanentHintToken) return;
            hintEl.textContent = formatPermanentPullDecisionText(decision);
        } catch (error) {
            if (token !== mismatchPermanentHintToken) return;
            hintEl.textContent = textByLang('永久栏目处理：无法计算，执行时将回退为覆盖恢复', 'Permanent section handling: unable to calculate, will fall back to overwrite restore');
        }
    }

    function renderConflictPanel() {
        const panel = getElement('canvasSyncConflictPanel');
        if (!panel) return;

        const conflictPreview = isConflictPreviewActive();
        if (conflictPreview && !previewConflict) {
            previewConflict = buildPreviewConflictPayload();
        }

        const conflictData = pendingConflict || (conflictPreview ? previewConflict : null);

        if (!conflictData) {
            panel.hidden = true;
            const summaryWhenHidden = getElement('canvasSyncConflictSummary');
            if (summaryWhenHidden) {
                delete summaryWhenHidden.dataset.dynamicSummary;
            }
            const dismissTextWhenHidden = getElement('canvasSyncConflictDismissText');
            if (dismissTextWhenHidden) {
                dismissTextWhenHidden.textContent = textByLang('稍后处理', 'Handle later');
            }
            updatePreviewActionButtonState();
            updateStatusPanelActionPlacement();
            return;
        }

        panel.hidden = false;

        const detectedAt = getElement('canvasSyncConflictDetectedAt');
        if (detectedAt) detectedAt.textContent = formatTime(conflictData.createdAt);

        const summary = getElement('canvasSyncConflictSummary');
        const permanentHint = getElement('canvasSyncConflictPermanentModeHint');
        if (summary) {
            if (conflictPreview) {
                summary.textContent = textByLang(
                    '这是“冲突面板”预览：用于展示两端都改时的对比信息与处理按钮。',
                    'This is a conflict panel preview showing the comparison info and action buttons when both sides changed.'
                );
            } else {
                const cloudHash = String(conflictData.remoteSha || getCurrentCloudHashForDisplay() || '').trim() || '-';
                const localHash = String(getCurrentLocalHashForDisplay() || '').trim() || '-';
                const dirtyLines = buildDirtySerialLines();
                const conflictFileCount = Array.isArray(conflictData.fileConflicts) ? conflictData.fileConflicts.length : 0;
                const cloudHashHtml = `<span class="canvas-sync-hash-value">${escapeHtml(cloudHash)}</span>`;
                const localHashHtml = `<span class="canvas-sync-hash-value">${escapeHtml(localHash)}</span>`;
                const conflictHintZh = conflictFileCount > 0 ? `文件级冲突 ${conflictFileCount} 个` : '无文件级冲突';
                const conflictHintEn = conflictFileCount > 0 ? `${conflictFileCount} file-level conflicts` : 'no file-level conflicts';
                const otherItemsZh = [
                    ...dirtyLines,
                    conflictHintZh
                ];
                const otherItemsEn = [
                    ...dirtyLines,
                    conflictHintEn
                ];
                const otherListHtmlZh = `<ul class="canvas-sync-other-list">${otherItemsZh.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
                const otherListHtmlEn = `<ul class="canvas-sync-other-list">${otherItemsEn.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;

                summary.innerHTML = textByLang(
                    `<ol class="canvas-sync-mismatch-list"><li>检测结果：本地与云端都发生变更，请选择处理方式。</li><li>云端哈希（Cloud Hash）：${cloudHashHtml}</li><li>本地哈希（Local Hash）：${localHashHtml}</li><li>具体变更：${otherListHtmlZh}</li></ol>`,
                    `<ol class="canvas-sync-mismatch-list"><li>Detection: both local and cloud changed. Choose how to resolve.</li><li>Cloud Hash: ${cloudHashHtml}</li><li>Local Hash: ${localHashHtml}</li><li>Detailed Changes: ${otherListHtmlEn}</li></ol>`
                );
            }
            summary.dataset.dynamicSummary = 'true';
        }

        const localUpdated = getElement('canvasSyncConflictLocalUpdated');
        const localSize = getElement('canvasSyncConflictLocalSize');
        const localHash = getElement('canvasSyncConflictLocalHash');
        if (localUpdated) localUpdated.textContent = formatTime(conflictData.localMeta.updatedAt);
        if (localSize) localSize.textContent = formatBytes(conflictData.localMeta.bytes);
        if (localHash) localHash.textContent = shortText(getCurrentLocalHashForDisplay(), '-');

        const remoteUpdated = getElement('canvasSyncConflictRemoteUpdated');
        const remoteSize = getElement('canvasSyncConflictRemoteSize');
        const remoteHash = getElement('canvasSyncConflictRemoteHash');
        if (remoteUpdated) remoteUpdated.textContent = formatTime(conflictData.remoteMeta.updatedAt);
        if (remoteSize) remoteSize.textContent = formatBytes(conflictData.remoteMeta.bytes);
        if (remoteHash) remoteHash.textContent = shortText(getCurrentCloudHashForDisplay() || conflictData.remoteSha || conflictData.remoteMeta.hash, '-');

        if (permanentHint) {
            const localTree = conflictData && conflictData.localSnapshot ? conflictData.localSnapshot.permanentTreeSnapshot : null;
            const remoteTree = conflictData && conflictData.remoteSnapshot ? conflictData.remoteSnapshot.permanentTreeSnapshot : null;
            permanentHint.hidden = false;
            permanentHint.textContent = formatPermanentPullDecisionText(evaluatePermanentPullDecision(localTree, remoteTree));
        }

        const dismissText = getElement('canvasSyncConflictDismissText');
        if (dismissText) {
            dismissText.textContent = conflictPreview
                ? textByLang('关闭预览', 'Close Preview')
                : textByLang('稍后处理', 'Handle later');
        }

        updatePreviewActionButtonState();
        updateStatusPanelActionPlacement();
    }

    function renderMismatchPanel() {
        const panel = getElement('canvasSyncMismatchPanel');
        if (!panel) return;

        const mismatchPreview = isMismatchPreviewActive();

        const shouldShow = !!(
            runtime
            && runtime.pendingMismatch
            && !pendingConflict
            && settings
            && ensureMismatchPolicy(settings.mismatchPolicy) === 'prompt'
        ) || mismatchPreview;

        if (!shouldShow) {
            panel.hidden = true;
            const permanentHintWhenHidden = getElement('canvasSyncMismatchPermanentModeHint');
            if (permanentHintWhenHidden) permanentHintWhenHidden.hidden = true;
            const summaryWhenHidden = getElement('canvasSyncMismatchSummary');
            if (summaryWhenHidden) {
                delete summaryWhenHidden.dataset.dynamicSummary;
            }
            const dismissTextWhenHidden = getElement('canvasSyncMismatchDismissText');
            if (dismissTextWhenHidden) {
                dismissTextWhenHidden.textContent = textByLang('稍后处理', 'Handle later');
            }
            updatePreviewActionButtonState();
            updateStatusPanelActionPlacement();
            return;
        }

        panel.hidden = false;

        const detectedAt = getElement('canvasSyncMismatchDetectedAt');
        if (detectedAt) {
            detectedAt.textContent = formatTime(mismatchPreview ? Date.now() : (runtime.pendingMismatchAt || Date.now()));
        }

        const summary = getElement('canvasSyncMismatchSummary');
        const permanentHint = getElement('canvasSyncMismatchPermanentModeHint');
        if (summary) {
            if (mismatchPreview) {
                summary.textContent = textByLang(
                    '这是“云端不一致面板”预览：用于展示后台检测到版本不一致时的处理按钮。',
                    'This is a remote mismatch panel preview showing actions when background detects a revision mismatch.'
                );
            } else {
                const cloudHash = String(getCurrentCloudHashForDisplay() || '').trim() || '-';
                const localHash = String(getCurrentLocalHashForDisplay() || '').trim() || '-';
                const dirtyLines = buildDirtySerialLines();
                const cloudHashHtml = `<span class="canvas-sync-hash-value">${escapeHtml(cloudHash)}</span>`;
                const localHashHtml = `<span class="canvas-sync-hash-value">${escapeHtml(localHash)}</span>`;
                const otherItemsZh = [
                    ...dirtyLines
                ];
                const otherItemsEn = [
                    ...dirtyLines
                ];
                const otherListHtmlZh = `<ul class="canvas-sync-other-list">${otherItemsZh.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
                const otherListHtmlEn = `<ul class="canvas-sync-other-list">${otherItemsEn.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;

                summary.innerHTML = textByLang(
                    `<ol class="canvas-sync-mismatch-list"><li>检测结果：前台关闭期间检测到云端不一致，当前已回到前台。</li><li>云端哈希（Cloud Hash）：${cloudHashHtml}</li><li>本地哈希（Local Hash）：${localHashHtml}</li><li>具体变更：${otherListHtmlZh}</li></ol>`,
                    `<ol class="canvas-sync-mismatch-list"><li>Detection: cloud mismatch was detected while foreground was closed, and you are now back in foreground.</li><li>Cloud Hash: ${cloudHashHtml}</li><li>Local Hash: ${localHashHtml}</li><li>Detailed Changes: ${otherListHtmlEn}</li></ol>`
                );
            }
            summary.dataset.dynamicSummary = 'true';
        }

        if (permanentHint) {
            permanentHint.hidden = false;
            void refreshMismatchPermanentModeHint();
        }

        const dismissText = getElement('canvasSyncMismatchDismissText');
        if (dismissText) {
            dismissText.textContent = mismatchPreview
                ? textByLang('关闭预览', 'Close Preview')
                : textByLang('稍后处理', 'Handle later');
        }

        updatePreviewActionButtonState();
        updateStatusPanelActionPlacement();
    }

    function setPendingConflict(conflict) {
        pendingConflict = conflict;
        runtime.hasPendingConflict = true;
        conflictPromptShownOnInit = false;
        persistPendingConflict();
        saveRuntime();
        renderStatus();
        renderConflictPanel();
        ensureStatusPanelVisible('conflict', textByLang(
            '检测到并发冲突，请在“状态”面板选择处理方式',
            'Concurrent changes detected. Choose an action in the Status panel.'
        ));
        void updateBackgroundSyncContext('sync-conflict-pending', {
            hasPendingWork: true,
            isRunning: runtime.isRunning,
            queueLength: runtime.queueLength,
            pendingMismatch: runtime.pendingMismatch
        });
    }

    function clearPendingConflict() {
        pendingConflict = null;
        runtime.hasPendingConflict = false;
        conflictPromptShownOnInit = false;
        persistPendingConflict();
        saveRuntime();
        renderStatus();
        renderConflictPanel();
        void updateBackgroundSyncContext('sync-conflict-cleared', {
            hasPendingWork: runtime.pendingMismatch,
            isRunning: runtime.isRunning,
            queueLength: runtime.queueLength,
            pendingMismatch: runtime.pendingMismatch
        });
    }

    async function setPendingMismatchState(remoteSha, message, options = {}) {
        runtime.pendingMismatch = true;
        runtime.pendingMismatchAt = Date.now();
        runtime.pendingMismatchRemoteSha = String(remoteSha || '');
        if (typeof message === 'string') {
            runtime.lastError = message;
        }

        mismatchPromptShownOnInit = false;
        saveRuntime();
        renderStatus();

        if (options && options.openPanel !== false && !hasPendingConflict()) {
            ensureStatusPanelVisible('mismatch', String(message || textByLang(
                '检测到云端不一致，请在“状态”面板选择处理方式',
                'Remote mismatch detected. Choose an action in the Status panel.'
            )));
        }

        await updateBackgroundSyncContext('pending-mismatch-foreground', {
            pendingMismatch: true,
            pendingMismatchAt: runtime.pendingMismatchAt,
            pendingMismatchRemoteSha: runtime.pendingMismatchRemoteSha,
            hasPendingWork: true,
            isRunning: runtime.isRunning,
            queueLength: runtime.queueLength,
            localDirty: hasLocalDirtyWork()
        });
    }

    function backupSnapshotForRecovery(snapshot, reason) {
        const record = {
            ts: Date.now(),
            reason: String(reason || 'manual'),
            snapshot
        };

        const warnQuota = (error) => {
            const now = Date.now();
            if (now - lastRecoverySnapshotWarningAt < 6000) return;
            lastRecoverySnapshotWarningAt = now;
            console.warn('[Canvas Sync] save recovery snapshot skipped (storage quota):', error);
            toast(textByLang(
                '本地存储空间不足：已跳过恢复快照备份，本次操作继续执行。',
                'Storage quota exceeded: recovery snapshot backup skipped, operation continues.'
            ));
        };

        try {
            const list = safeParse(getSyncMetaRaw(RECOVERY_KEY), []);
            const arr = Array.isArray(list) ? list : [];
            arr.unshift(record);

            for (let keep = Math.min(MAX_RECOVERY_RECORDS, arr.length); keep >= 1; keep--) {
                try {
                    setSyncMetaRaw(RECOVERY_KEY, JSON.stringify(arr.slice(0, keep)));
                    return true;
                } catch (error) {
                    if (keep === 1) throw error;
                }
            }
        } catch (error) {
            try {
                setSyncMetaRaw(RECOVERY_KEY, JSON.stringify([{
                    ts: record.ts,
                    reason: record.reason,
                    snapshotHash: getSnapshotHash(snapshot),
                    snapshotOmitted: true
                }]));
            } catch (_) { }
            warnQuota(error);
            return false;
        }

        return false;
    }

    function applySnapshotToLocal(snapshot, options = {}) {
        const nextData = snapshot && snapshot.data && typeof snapshot.data === 'object' ? snapshot.data : {};
        const bypassDeleteThreshold = !!(options && options.bypassDeleteThreshold);
        const bypassReason = String(options && options.bypassReason || '');

        const existingKeys = SYNC_KEYS.filter((key) => localStorage.getItem(key) !== null);
        const keysToDelete = existingKeys.filter((key) => !Object.prototype.hasOwnProperty.call(nextData, key));
        const deletePercent = existingKeys.length > 0
            ? (keysToDelete.length / existingKeys.length) * 100
            : 0;

        if (!bypassDeleteThreshold && deletePercent > settings.deleteThresholdPercent) {
            throw new Error(textByLang(`云端删除比例 ${deletePercent.toFixed(1)}% 超过阈值 ${settings.deleteThresholdPercent}%`, `Remote deletion ratio ${deletePercent.toFixed(1)}% exceeds threshold ${settings.deleteThresholdPercent}%`));
        }
        if (bypassDeleteThreshold && deletePercent > settings.deleteThresholdPercent) {
        }

        SYNC_KEYS.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(nextData, key)) {
                localStorage.setItem(key, String(nextData[key]));
            } else {
                localStorage.removeItem(key);
            }
        });

        runtime.lastLocalMutationAt = Number(snapshot.updatedAt) || Date.now();

        try {
            if (typeof global.loadTempNodes === 'function') {
                global.loadTempNodes();
            }
        } catch (_) { }

        try {
            global.dispatchEvent(new CustomEvent('canvas-obsidian-git-sync-applied', {
                detail: {
                    updatedAt: runtime.lastLocalMutationAt,
                    keys: SYNC_KEYS.slice()
                }
            }));
        } catch (_) { }
    }


    function buildSnapshotForRemoteLocalApply(snapshotInput) {
        const snapshot = normalizeSnapshot(snapshotInput || { data: {} });
        const nextData = Object.assign({}, snapshot.data || {});
        const tempRaw = typeof nextData[TEMP_SECTION_STORAGE_KEY] === 'string'
            ? nextData[TEMP_SECTION_STORAGE_KEY]
            : '';
        if (!tempRaw) return snapshot;

        let tempState = null;
        try {
            tempState = JSON.parse(tempRaw);
        } catch (_) {
            tempState = null;
        }
        if (!tempState || typeof tempState !== 'object') return snapshot;

        const sections = Array.isArray(tempState.sections) ? tempState.sections : [];
        const filteredSections = sections.filter((section) => {
            if (!section || typeof section !== 'object') return false;
            const id = String(section.id || '').trim();
            if (id === 'permanent-section' || id.startsWith('permanent-section-copy-')) return false;
            if (section.isSnapshot === true) {
                const title = String(section.title || '').trim();
                if (/^\[(快照|Snapshot)\]/i.test(title)) return false;
            }
            return true;
        });
        if (filteredSections.length === sections.length) return snapshot;

        const removedIds = new Set(sections
            .filter((section) => !filteredSections.includes(section))
            .map((section) => String(section && section.id || '').trim())
            .filter(Boolean));
        const edges = Array.isArray(tempState.edges) ? tempState.edges : [];
        const filteredEdges = edges
            .map((edge) => {
                const nextEdge = edge && typeof edge === 'object' ? Object.assign({}, edge) : edge;
                if (!nextEdge || typeof nextEdge !== 'object') return nextEdge;
                const fromNode = String(nextEdge.fromNode || '').trim();
                const toNode = String(nextEdge.toNode || '').trim();
                if (fromNode && removedIds.has(fromNode)) nextEdge.fromNode = 'permanent-section';
                if (toNode && removedIds.has(toNode)) nextEdge.toNode = 'permanent-section';
                return nextEdge;
            })
            .filter((edge) => {
                if (!edge || typeof edge !== 'object') return false;
                const fromNode = String(edge.fromNode || '').trim();
                const toNode = String(edge.toNode || '').trim();
                return !removedIds.has(fromNode) && !removedIds.has(toNode);
            });

        nextData[TEMP_SECTION_STORAGE_KEY] = JSON.stringify(Object.assign({}, tempState, {
            sections: filteredSections,
            edges: filteredEdges
        }));

        return Object.assign({}, snapshot, { data: nextData });
    }

    function decideWinner(localSnapshot, remoteSnapshot, concurrentChanged, localChanged = false, remoteChanged = false, syncMethod = settings.syncMethod) {
        if (concurrentChanged) {
            if (settings.conflictPolicy === 'ours') return 'local';
            if (settings.conflictPolicy === 'theirs') return 'remote';
            return '';
        }

        if (syncMethod === 'reset' && !localChanged && remoteChanged) return 'remote-reset';

        if (localChanged && !remoteChanged) return 'local';
        if (remoteChanged && !localChanged) return 'remote';

        const localTs = Number(localSnapshot.updatedAt) || 0;
        const remoteTs = Number(remoteSnapshot.updatedAt) || 0;
        const localBytes = getSnapshotBytes(localSnapshot);
        const remoteBytes = getSnapshotBytes(remoteSnapshot);

        if (localTs === remoteTs) {
            if (localBytes === remoteBytes) return 'local';
            return localBytes > remoteBytes ? 'local' : 'remote';
        }
        return localTs > remoteTs ? 'local' : 'remote';
    }

    function createPendingConflictPayload(localSnapshot, remoteSnapshot, remoteState, extra = {}) {
        const fileConflicts = uniqueStringList(extra && extra.fileConflicts, normalizeSyncPath);
        const summarySource = extra && extra.filePlanSummary && typeof extra.filePlanSummary === 'object'
            ? extra.filePlanSummary
            : {};
        return {
            id: `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(),
            reason: 'concurrent-change',
            remoteSha: String(remoteState && remoteState.sha || ''),
            remotePath: String(remoteState && remoteState.path || ''),
            localSnapshot,
            remoteSnapshot,
            localMeta: buildSnapshotMeta(localSnapshot),
            remoteMeta: buildSnapshotMeta(remoteSnapshot),
            fileConflicts,
            filePlanSummary: {
                conflict: Math.max(0, Number(summarySource.conflict) || fileConflicts.length),
                download: Math.max(0, Number(summarySource.download) || 0),
                deleteLocal: Math.max(0, Number(summarySource.deleteLocal) || 0),
                upload: Math.max(0, Number(summarySource.upload) || 0),
                deleteRemote: Math.max(0, Number(summarySource.deleteRemote) || 0),
                skip: Math.max(0, Number(summarySource.skip) || 0)
            }
        };
    }

    function buildOneWaySyncPreflightState(localSnapshot, localHash, remoteState, syncMethod = settings.syncMethod) {
        const remoteExists = !!(remoteState && !remoteState.notFound);
        const remoteSnapshot = remoteExists
            ? normalizeSnapshot(remoteState.snapshot || {})
            : normalizeSnapshot({ data: {} });

        let nextLocalHash = localHash;
        if (remoteExists && hydratePermanentTreeFromRemote(localSnapshot, remoteSnapshot)) {
            nextLocalHash = getSnapshotHash(localSnapshot);
        }

        const remoteSha = String(remoteState && remoteState.sha || '');
        const hasLocalBase = !!runtime.lastLocalHash;
        const hasRemoteBase = !!runtime.lastRemoteSha;
        const localDirty = hasLocalDirtyWork();
        const localChanged = hasLocalBase && runtime.lastLocalHash !== nextLocalHash;
        const remoteChanged = hasRemoteBase && !!remoteSha && runtime.lastRemoteSha !== remoteSha;
        const concurrentChanged = localChanged && remoteChanged;
        const localUntracked = !hasLocalBase && localDirty;
        const remoteUntracked = !hasRemoteBase && !!remoteSha;
        const winner = remoteExists
            ? decideWinner(localSnapshot, remoteSnapshot, concurrentChanged, localChanged, remoteChanged, syncMethod)
            : 'local';

        return {
            remoteSnapshot,
            localHash: nextLocalHash,
            remoteSha,
            hasLocalBase,
            hasRemoteBase,
            localDirty,
            localChanged,
            remoteChanged,
            concurrentChanged,
            localUntracked,
            remoteUntracked,
            winner
        };
    }

    async function resolvePendingConflict(choice) {
        if (!pendingConflict) {
            toast(textByLang('没有待处理冲突', 'No pending conflicts'));
            return;
        }
        if (runtime.isRunning) {
            toast(textByLang('正在同步，请稍后', 'Sync is running, please wait'));
            return;
        }

        runtime.isRunning = true;
        saveRuntime();
        renderStatus();

        try {
            const localSnapshot = normalizeSnapshot(pendingConflict.localSnapshot);
            const remoteSnapshot = normalizeSnapshot(pendingConflict.remoteSnapshot);
            let recoverySnapshotSaved = true;

            if (choice === 'local') {
                if (settings.obsidianFilePushEnabled === false) {
                    throw new Error(textByLang('已关闭 Obsidian 文件推送，无法覆盖云端', 'Obsidian file push is disabled, cannot overwrite cloud'));
                }
                applySnapshotToLocal(localSnapshot);
                const pushResult = await pushObsidianFilesIncremental('manual-conflict-keep-local');
                let remoteRevision = '';
                try {
                    const remoteListRaw = await listRemoteObsidianFilesByPath(settings.obsidianExportRoot);
                    const remoteList = filterRemoteListForManagedSyncFiles(remoteListRaw, settings.obsidianExportRoot);
                    remoteRevision = buildRemoteObsidianRevisionFromList(remoteList);
                } catch (_) {
                    remoteRevision = '';
                }
                runtime.lastLocalHash = getSnapshotHash(localSnapshot);
                runtime.lastLocalFilesSha = String(pushResult && pushResult.localRevision || buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha || '');
                runtime.lastRemoteSha = remoteRevision || runtime.lastRemoteSha;
                runtime.lastAppliedDirection = 'conflict-local';
                storeConflictRecord(localSnapshot, remoteSnapshot, 'resolved-local', {
                    conflictId: pendingConflict.id,
                    remoteSha: remoteRevision || pendingConflict.remoteSha,
                    changedCount: Number(pushResult && pushResult.changedCount) || 0
                });
            } else if (choice === 'remote') {
                // Conflict panel -> use remote:
                // after applying snapshot data, permanent section must also go through
                // the same overwrite helper used by other remote -> local flows.
                const currentLocal = await buildLocalSnapshot('conflict-local-backup', { includePermanentTree: true });
                recoverySnapshotSaved = backupSnapshotForRecovery(currentLocal, 'before-apply-remote-conflict');
                applySnapshotToLocal(buildSnapshotForRemoteLocalApply(remoteSnapshot), {
                    bypassDeleteThreshold: true,
                    bypassReason: 'manual-conflict-use-remote'
                });
                try {
                    let remotePermanentTreeSnapshot = remoteSnapshot && remoteSnapshot.permanentTreeSnapshot;
                    if (!normalizeBookmarkTreeSnapshot(remotePermanentTreeSnapshot)) {
                        try {
                            const latestRemoteState = await readRemoteSnapshotWithPathRecovery({
                                interactive: false,
                                continueAfterConfirm: false,
                                throwWhenDetected: false
                            });
                            if (latestRemoteState && !latestRemoteState.notFound && latestRemoteState.snapshot) {
                                remotePermanentTreeSnapshot = latestRemoteState.snapshot.permanentTreeSnapshot;
                            }
                        } catch (_) { }
                    }
                    const overwriteResult = await maybeOverwriteLocalPermanentTreeFromRemoteSnapshot(
                        remotePermanentTreeSnapshot,
                        'manual-conflict-use-remote',
                        { force: true }
                    );
                    if (overwriteResult && overwriteResult.applied) {
                        runtime.lastPermanentTreeSnapshotAt = Date.now();
                    }
                } catch (error) {
                    console.warn('[Canvas Sync] overwrite local permanent tree from conflict(remote) failed:', error);
                    throw error;
                }
                if (settings.obsidianFilePushEnabled !== false) {
                    try {
                        let remoteFilesByPath = null;
                        let rebuiltResult = null;
                        try {
                            const remoteListRaw = await listRemoteObsidianFilesByPath(settings.obsidianExportRoot);
                            const remoteList = filterRemoteListForManagedSyncFiles(remoteListRaw, settings.obsidianExportRoot);
                            remoteFilesByPath = remoteList && remoteList.filesByPath ? remoteList.filesByPath : null;
                        } catch (_) {
                            remoteFilesByPath = null;
                        }
                        rebuiltResult = await rebuildObsidianIndexesFromLocalSnapshot('conflict-remote-apply', {
                            clearDirty: true,
                            syncedAt: Date.now(),
                            remoteFilesByPath
                        });
                        if (rebuiltResult && rebuiltResult.enabled) {
                            runtime.lastLocalFilesSha = String(rebuiltResult.localRevision || runtime.lastLocalFilesSha || '');
                        }
                    } catch (error) {
                        console.warn('[Canvas Sync] rebuild local obsidian index after conflict(remote) failed:', error);
                    }
                } else {
                    saveDirtyState(createDefaultDirtyState());
                }
                runtime.lastLocalHash = getSnapshotHash(remoteSnapshot);
                runtime.lastRemoteSha = pendingConflict.remoteSha || runtime.lastRemoteSha;
                runtime.lastAppliedDirection = 'conflict-remote';
                storeConflictRecord(localSnapshot, remoteSnapshot, 'resolved-remote', {
                    conflictId: pendingConflict.id,
                    remoteSha: pendingConflict.remoteSha
                });
            } else {
                throw new Error(textByLang('不支持的冲突选择', 'Unsupported conflict choice'));
            }

            clearPendingConflict();
            pendingReasons.clear();
            runtime.queueLength = 0;
            runtime.lastError = '';
            runtime.lastSuccessAt = Date.now();
            saveRuntime();
            renderStatus();

            toast(choice === 'local'
                ? textByLang('冲突已处理：已保留本地并覆盖云端', 'Conflict resolved: kept local and overwrote remote')
                : (recoverySnapshotSaved
                    ? textByLang('冲突已处理：已使用云端覆盖本地（已生成本地恢复快照）', 'Conflict resolved: used remote to overwrite local (local recovery snapshot created)')
                    : textByLang('冲突已处理：已使用云端覆盖本地（未保存恢复快照）', 'Conflict resolved: used remote to overwrite local (recovery snapshot not saved)')));
        } catch (error) {
            runtime.lastError = error && error.message ? error.message : String(error);
            saveRuntime();
            renderStatus();
            scheduleRetry();
            toast(textByLang(`冲突处理失败：${runtime.lastError}`, `Conflict resolution failed: ${runtime.lastError}`));
        } finally {
            runtime.isRunning = false;
            saveRuntime();
            renderStatus();
            renderConflictPanel();
        }
    }

    function isLikelyOfflineError(message) {
        const text = String(message || '').toLowerCase();
        return text.includes('failed to fetch')
            || text.includes('network')
            || text.includes('timeout')
            || text.includes('timed out')
            || text.includes('离线');
    }

    function isSyncFileTooLargeError(error) {
        if (!error) return false;
        if (String(error.code || '') === SYNC_FILE_TOO_LARGE_ERROR_CODE) return true;
        const message = String(error && error.message ? error.message : error || '').toLowerCase();
        return (message.includes('100mb') || message.includes('100 mib'))
            && (message.includes('拆分') || message.includes('split') || message.includes('无法写入') || message.includes('cannot write'));
    }

    function showSyncFileTooLargeDialog(error) {
        const now = Date.now();
        const sizeBytes = Number(error && error.sizeBytes);
        const limitBytes = Number(error && error.limitBytes);
        const pathText = error && error.path ? String(error.path) : '';
        const key = `${pathText}|${Number.isFinite(sizeBytes) ? sizeBytes : 0}|${Number.isFinite(limitBytes) ? limitBytes : 0}`;

        if ((now - oversizeSyncDialogLastAt) < OVERSIZE_SYNC_DIALOG_COOLDOWN_MS && key === oversizeSyncDialogLastKey) {
            return;
        }
        oversizeSyncDialogLastAt = now;
        oversizeSyncDialogLastKey = key;

        const sizeHint = Number.isFinite(sizeBytes) && sizeBytes > 0
            ? textByLang(`当前文件约 ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`, `Current file is about ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`)
            : textByLang('当前文件已超过 GitHub 单文件限制', 'Current file exceeds GitHub single-file limit');

        const message = textByLang(
            [
                '检测到同步文件超过 100MB，本次推送/自动同步已停止。',
                sizeHint,
                '',
                '建议：',
                '1. 将内容拆分成不同的栏目',
                '2. 删除永久栏目中的一些内容',
                '3. 将临时栏目中的内容分出去一点',
                '',
                '处理后请再次执行同步。'
            ].join('\n'),
            [
                'Sync file exceeded 100MB; this push/auto sync has been stopped.',
                sizeHint,
                '',
                'Suggestions:',
                '1. Split content into different sections',
                '2. Remove part of permanent section content',
                '3. Move part of temporary section content out',
                '',
                'Please sync again after cleanup.'
            ].join('\n')
        );

        if (typeof global.alert === 'function') {
            global.alert(message);
            return;
        }
        toast(message);
    }

    async function runSync(mode, trigger) {
        if (!settings.enabled) {
            toast(textByLang('同步已关闭', 'Sync is disabled'));
            return;
        }

        const isManualTrigger = isManualSyncTrigger(mode, trigger);
        const effectiveMode = mode === 'full' ? resolveFullSyncMode() : mode;
        const syncMethod = ensureSyncMethod(settings.syncMethod);

        try {
            const rawRepoConfig = await storageLocalGet(REPO_CONFIG_KEYS);
            repoConfig = normalizeRepoConfig(rawRepoConfig);
        } catch (_) {
            if (!repoConfig) {
                repoConfig = normalizeRepoConfig({});
            }
        }

        const missingReason = getRepoConfigMissingReason(repoConfig);
        if (missingReason) {
            runtime.lastError = missingReason;
            pendingReasons.clear();
            runtime.queueLength = 0;
            saveRuntime();
            renderStatus();
            if (isManualTrigger) {
                toast(textByLang(`同步未执行：${missingReason}`, `Sync skipped: ${missingReason}`));
            }
            return;
        }

        if (hasPendingConflict()) {
            runtime.lastError = textByLang('存在待处理冲突，请先在冲突面板选择', 'A pending conflict exists. Resolve it in the conflict panel first');
            saveRuntime();
            renderStatus();
            renderConflictPanel();
            ensureStatusPanelVisible('conflict', textByLang('请先处理同步冲突', 'Please resolve sync conflicts first'));
            return;
        }

        const shouldRequireLocalDirty = !isManualTrigger
            && (effectiveMode === 'push' || effectiveMode === 'full')
            && !(runtime && runtime.pendingMismatch);
        if (shouldRequireLocalDirty && !hasLocalDirtyWork()) {
            pendingReasons.clear();
            runtime.queueLength = 0;
            runtime.lastError = '';
            saveRuntime();
            renderStatus();
            void updateBackgroundSyncContext('sync-skip-clean', {
                queueLength: 0,
                hasPendingWork: runtime.pendingMismatch === true,
                localDirty: false
            });
            return;
        }

        if (runtime.isRunning) {
            if (isManualTrigger) {
                toast(textByLang('正在同步，请等待当前同步完成', 'Sync is running. Please wait for completion.'));
                renderStatus();
                return;
            }
            pendingReasons.add(`queued:${trigger || 'unknown'}`);
            runtime.queueLength = pendingReasons.size;
            saveRuntime();
            renderStatus();
            return;
        }

        runtime.isRunning = true;
        runtime.lastTrigger = trigger || 'manual';
        runtime.lastSyncMode = `${effectiveMode}:${syncMethod}`;
        saveRuntime();
        renderStatus();
        syncUiProgressEnabled = isManualTrigger;
        if (syncUiProgressEnabled) {
            updateSyncUiProgress(textByLang('准备同步...', 'Preparing sync...'), 0);
        }
        void updateBackgroundSyncContext('sync-running', {
            isRunning: true,
            queueLength: runtime.queueLength,
            pendingMismatch: runtime.pendingMismatch
        });

        try {
            const localSnapshot = await buildLocalSnapshot(trigger);
            let localHash = getSnapshotHash(localSnapshot);
            let abortedByPendingConflict = false;
            updateSyncUiProgress(textByLang('已读取本地状态', 'Loaded local state'), 10);

            const doPush = async (reason) => {
                let obsidianPushResult = null;
                const canPushBlankSectionFiles = shouldPushBlankSectionFiles(trigger || reason || 'sync');
                if (settings.obsidianFilePushEnabled !== false && canPushBlankSectionFiles) {
                    const pushProgress = makeProgressRange(15, 85);
                    obsidianPushResult = await pushObsidianFilesIncremental(trigger || reason || 'sync', pushProgress);
                    if (obsidianPushResult && obsidianPushResult.enabled) {
                        runtime.lastObsidianPushAt = Date.now();
                        runtime.lastObsidianPushChanged = Number(obsidianPushResult.changedCount) || 0;
                        runtime.lastObsidianPushTotal = Number(obsidianPushResult.totalCount) || 0;
                        runtime.lastLocalFilesSha = String(obsidianPushResult.localRevision || runtime.lastLocalFilesSha || '');
                    }
                } else if (settings.obsidianFilePushEnabled !== false && !canPushBlankSectionFiles) {
                    obsidianPushResult = { enabled: false, skippedByThrottle: true };
                } else if (settings.obsidianFilePushEnabled === false) {
                    throw new Error(textByLang('已关闭 Obsidian 文件推送，无法执行上传同步', 'Obsidian file push is disabled, cannot perform upload sync'));
                }

                let remoteRevision = '';
                if (settings.obsidianFilePushEnabled !== false) {
                    try {
                        updateSyncUiProgress(textByLang('校验云端状态...', 'Validating cloud state...'), 90);
                        const remoteListAfterPushRaw = await listRemoteObsidianFilesByPath(settings.obsidianExportRoot);
                        const remoteListAfterPush = filterRemoteListForManagedSyncFiles(remoteListAfterPushRaw, settings.obsidianExportRoot);
                        remoteRevision = buildRemoteObsidianRevisionFromList(remoteListAfterPush);
                        updateSyncUiProgress(textByLang('云端状态已更新', 'Cloud state updated'), 95);
                    } catch (_) {
                        remoteRevision = '';
                    }
                }

                runtime.lastLocalHash = localHash;
                runtime.lastLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha;
                runtime.lastRemoteSha = remoteRevision || runtime.lastRemoteSha;
                const nowTs = Date.now();
                if (localSnapshot && localSnapshot.permanentTreeSnapshot) {
                    runtime.lastPermanentTreeSnapshotAt = nowTs;
                }

                const includeTempSection = !!(localSnapshot && localSnapshot._syncMeta && localSnapshot._syncMeta.includeTempSection);
                if (includeTempSection) {
                    runtime.lastTempSectionSnapshotAt = nowTs;
                    const pushedTempStateRaw = localSnapshot
                        && localSnapshot.data
                        && typeof localSnapshot.data[TEMP_SECTION_STORAGE_KEY] === 'string'
                        ? localSnapshot.data[TEMP_SECTION_STORAGE_KEY]
                        : '';
                    if (pushedTempStateRaw) {
                        setSyncMetaRaw(LAST_UPLOADED_TEMP_STATE_KEY, pushedTempStateRaw);
                    }
                }
                runtime.lastAppliedDirection = 'push';

                if (obsidianPushResult && obsidianPushResult.enabled) {
                    return `push + files(${runtime.lastObsidianPushChanged}/${runtime.lastObsidianPushTotal})`;
                }
                if (obsidianPushResult && obsidianPushResult.skippedByThrottle) {
                    return textByLang('push + 空白栏目文件节流中', 'push + blank-section files throttled');
                }
                return 'push';
            };

            // Shared remote -> local apply path for sync-related pull actions.
            // Temp / blank sections are applied from sync files or snapshot data,
            // while permanent section is overwritten via maybeOverwriteLocalPermanentTreeFromRemoteSnapshot().
            const doPull = async (remoteState, reason, preparedPullPlan = null) => {
                const explicitRemoteOverride = isExplicitRemoteOverwriteTrigger(trigger);
                const bypassPullPlanConflictCheck = shouldBypassPullPlanConflictCheck(trigger);
                updateSyncUiProgress(textByLang('计算拉取计划...', 'Building pull plan...'), 20);
                let pullPlanResult = preparedPullPlan;
                if (!pullPlanResult && settings.obsidianFilePushEnabled !== false) {
                    try {
                        pullPlanResult = await buildObsidianPullPlan(trigger || reason || 'pull');
                    } catch (error) {
                        console.warn('[Canvas Sync] build pull plan failed:', error);
                    }
                }

                if (
                    pullPlanResult
                    && pullPlanResult.enabled
                    && !bypassPullPlanConflictCheck
                    && settings.conflictPolicy === 'none'
                    && pullPlanResult.plan
                    && Array.isArray(pullPlanResult.plan.conflict)
                    && pullPlanResult.plan.conflict.length > 0
                ) {
                    const conflictPaths = pullPlanResult.plan.conflict
                        .map((item) => normalizeSyncPath(item && item.path))
                        .filter(Boolean);
                    const filePlanSummary = {
                        conflict: conflictPaths.length,
                        download: Array.isArray(pullPlanResult.plan.download) ? pullPlanResult.plan.download.length : 0,
                        deleteLocal: Array.isArray(pullPlanResult.plan.deleteLocal) ? pullPlanResult.plan.deleteLocal.length : 0,
                        upload: Array.isArray(pullPlanResult.plan.upload) ? pullPlanResult.plan.upload.length : 0,
                        deleteRemote: Array.isArray(pullPlanResult.plan.deleteRemote) ? pullPlanResult.plan.deleteRemote.length : 0,
                        skip: Array.isArray(pullPlanResult.plan.skip) ? pullPlanResult.plan.skip.length : 0
                    };

                    setPendingConflict(createPendingConflictPayload(localSnapshot, remoteState.snapshot, remoteState, {
                        fileConflicts: conflictPaths,
                        filePlanSummary
                    }));
                    storeConflictRecord(localSnapshot, remoteState.snapshot, 'pending-file-conflict', {
                        remoteSha: remoteState.sha || '',
                        strategy: settings.conflictPolicy,
                        syncMethod,
                        filePlanSummary
                    });

                    runtime.lastAppliedDirection = 'conflict';
                    runtime.lastError = textByLang(
                        `检测到文件级并发修改（${conflictPaths.length} 个），请在冲突面板处理`,
                        `File-level concurrent changes detected (${conflictPaths.length}). Resolve them in the conflict panel.`
                    );
                    pendingReasons.clear();
                    runtime.queueLength = 0;
                    saveRuntime();
                    renderStatus();
                    renderConflictPanel();
                    openPanel({ activeTab: 'status' });
                    toast(textByLang(
                        `检测到文件级冲突：${conflictPaths.length} 个，请先选择本地或云端`,
                        `File-level conflicts detected: ${conflictPaths.length}. Please choose local or cloud first.`
                    ));
                    abortedByPendingConflict = true;
                    return textByLang('冲突待处理', 'Conflict pending');
                }

                if (explicitRemoteOverride) {
                    backupSnapshotForRecovery(localSnapshot, `before-${String(trigger || reason || 'pull')}-remote-overwrite`);
                }

                const remoteFilesByPath = pullPlanResult && pullPlanResult.remoteList
                    ? pullPlanResult.remoteList.filesByPath
                    : null;
                const hasRemoteFiles = !!(
                    pullPlanResult
                    && pullPlanResult.enabled
                    && pullPlanResult.remoteList
                    && Array.isArray(pullPlanResult.remoteList.files)
                    && pullPlanResult.remoteList.files.length > 0
                );

                let appliedByFiles = false;
                let applyResult = null;
                if (settings.obsidianFilePushEnabled !== false && hasRemoteFiles) {
                    try {
                        const pullFilesProgress = makeProgressRange(25, 75);
                        applyResult = await applyRemoteObsidianFilesReplace(
                            pullPlanResult.remoteList,
                            trigger || reason || 'pull',
                            pullFilesProgress
                        );
                        appliedByFiles = !!(applyResult && applyResult.applied);
                    } catch (error) {
                        console.warn('[Canvas Sync] apply remote files replace failed:', error);
                    }
                }

                if (!appliedByFiles) {
                    updateSyncUiProgress(textByLang('正在应用云端快照...', 'Applying remote snapshot...'), 75);
                    if (remoteState && !remoteState.notFound && remoteState.snapshot) {
                        applySnapshotToLocal(buildSnapshotForRemoteLocalApply(remoteState.snapshot), {
                            bypassDeleteThreshold: explicitRemoteOverride,
                            bypassReason: explicitRemoteOverride ? 'mismatch-panel-use-remote' : ''
                        });
                    } else if (settings.obsidianFilePushEnabled !== false && hasRemoteFiles) {
                        throw new Error(textByLang('云端文件存在，但应用失败且无可用文件解析结果', 'Cloud files exist but apply failed and no usable parsed payload'));
                    } else {
                        throw new Error(textByLang('云端同步目录为空，无法仅拉取', 'Cloud sync folder is empty; pull-only cannot continue'));
                    }
                }

                // Permanent section ownership: if remote provides a permanent tree snapshot (from Obsidian files or
                // from the remote JSON snapshot), overwrite the local Chrome bookmarks tree.
                try {
                    // Unified permanent-section overwrite path for pull-related flows.
                    const remotePermanentTreeSnapshot = (applyResult && applyResult.permanentTreeSnapshot)
                        || (remoteState && !remoteState.notFound && remoteState.snapshot
                            ? remoteState.snapshot.permanentTreeSnapshot
                            : null);
                    const overwriteResult = await maybeOverwriteLocalPermanentTreeFromRemoteSnapshot(
                        remotePermanentTreeSnapshot,
                        trigger || reason || 'pull',
                        {
                            force: explicitRemoteOverride,
                            onProgress: (message) => updateSyncUiProgress(message, 82)
                        }
                    );
                    if (overwriteResult && overwriteResult.applied) {
                        runtime.lastPermanentTreeSnapshotAt = Date.now();
                    }
                } catch (error) {
                    console.warn('[Canvas Sync] overwrite local permanent tree from remote failed:', error);
                    throw error;
                }

                if (settings.obsidianFilePushEnabled !== false) {
                    try {
                        updateSyncUiProgress(textByLang('重建本地索引...', 'Rebuilding local index...'), 85);
                        const rebuiltIndex = await rebuildObsidianIndexesFromLocalSnapshot(`pull:${trigger || 'sync'}`, {
                            clearDirty: true,
                            syncedAt: Date.now(),
                            remoteFilesByPath
                        });
                        if (rebuiltIndex && rebuiltIndex.enabled) {
                            runtime.lastObsidianPushTotal = Number(rebuiltIndex.totalCount) || runtime.lastObsidianPushTotal;
                            runtime.lastObsidianPushChanged = 0;
                            runtime.lastLocalFilesSha = String(rebuiltIndex.localRevision || runtime.lastLocalFilesSha || '');
                        }
                    } catch (error) {
                        console.warn('[Canvas Sync] rebuild local obsidian index after pull failed:', error);
                    }
                } else {
                    saveDirtyState(createDefaultDirtyState());
                }

                try {
                    updateSyncUiProgress(textByLang('同步本地校验...', 'Verifying local state...'), 92);
                    const postPullSnapshot = await buildLocalSnapshot('post-pull-hash', {
                        includePermanentTree: false,
                        includeTempSection: true,
                        includeBlankSectionFiles: true
                    });
                    runtime.lastLocalHash = getSnapshotHash(postPullSnapshot);
                } catch (_) {
                    if (remoteState && !remoteState.notFound && remoteState.snapshot) {
                        runtime.lastLocalHash = getSnapshotHash(remoteState.snapshot);
                    }
                }

                const remoteRevisionFromFiles = buildRemoteObsidianRevisionFromList(
                    pullPlanResult && pullPlanResult.remoteList
                        ? pullPlanResult.remoteList
                        : null
                );
                runtime.lastRemoteSha = remoteState.sha || remoteRevisionFromFiles || runtime.lastRemoteSha;
                runtime.lastAppliedDirection = 'pull';
                return reason || (appliedByFiles
                    ? textByLang('pull（文件集）', 'pull (files)')
                    : 'pull');
            };

            const doResetHead = async (remoteState, reason) => {
                runtime.lastLocalHash = localHash;
                runtime.lastLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha;
                runtime.lastRemoteSha = remoteState.sha || runtime.lastRemoteSha;
                runtime.lastAppliedDirection = 'reset-head';
                return reason || textByLang('仅记云端版本（仅更新 HEAD）', 'Track remote revision only (update HEAD)');
            };

            let actionText = 'noop';

            if (effectiveMode === 'noop') {
                runtime.lastAppliedDirection = 'noop';
                runtime.lastLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha;
                actionText = 'noop';
            } else if (effectiveMode === 'push') {
                const pushTriggerText = String(trigger || '').trim().toLowerCase();
                const skipPushPreflight = pushTriggerText === 'mismatch-panel-push'
                    || pushTriggerText === 'mismatch-policy-auto-push';
                let allowPushOnly = true;

                if (!skipPushPreflight) {
                    updateSyncUiProgress(textByLang('校验云端基线...', 'Checking cloud baseline...'), 15);
                    const remoteState = await readRemoteSnapshotWithPathRecovery({
                        interactive: isManualTrigger,
                        continueAfterConfirm: true
                    });
                    const pushPreflight = buildOneWaySyncPreflightState(localSnapshot, localHash, remoteState, syncMethod);
                    localHash = pushPreflight.localHash;

                    if (!pushPreflight.winner) {
                        setPendingConflict(createPendingConflictPayload(localSnapshot, pushPreflight.remoteSnapshot, remoteState));
                        storeConflictRecord(localSnapshot, pushPreflight.remoteSnapshot, 'pending-manual', {
                            remoteSha: pushPreflight.remoteSha || remoteState.sha || '',
                            strategy: settings.conflictPolicy,
                            syncMethod
                        });
                        runtime.lastAppliedDirection = 'conflict';
                        runtime.lastError = textByLang(
                            '检测到并发修改，已暂停当前上传路径，请先在冲突面板选择处理方式',
                            'Concurrent changes detected. The current upload path has been paused; resolve it in the conflict panel first.'
                        );
                        pendingReasons.clear();
                        runtime.queueLength = 0;
                        saveRuntime();
                        renderStatus();
                        toast(textByLang('检测到冲突：请先在面板中选择保留本地或使用云端', 'Conflict detected: choose keep local or use cloud in the panel first'));
                        allowPushOnly = false;
                    } else {
                        const riskyRemoteOverwrite = pushPreflight.remoteChanged
                            || pushPreflight.concurrentChanged
                            || pushPreflight.remoteUntracked;

                        if (isManualTrigger && riskyRemoteOverwrite && (pushPreflight.winner !== 'local' || pushPreflight.remoteUntracked)) {
                            if (!requestOneWayOverwriteConfirmation('push', pushPreflight)) {
                                runtime.lastError = '';
                                saveRuntime();
                                renderStatus();
                                toast(textByLang('已取消当前上传操作', 'Current upload action cancelled'));
                                allowPushOnly = false;
                            }
                        } else if (!isManualTrigger && riskyRemoteOverwrite && (pushPreflight.winner !== 'local' || pushPreflight.remoteUntracked)) {
                            await setPendingMismatchState(
                                pushPreflight.remoteSha || remoteState.sha || '',
                                textByLang(
                                    '检测到云端已有更新，已暂停当前自动上传路径，请在“状态”面板选择处理方式',
                                    'Cloud updates were detected. The current automatic upload path has been paused; choose an action in Status.'
                                ),
                                { openPanel: document.visibilityState === 'visible' }
                            );
                            allowPushOnly = false;
                        }
                    }
                }

                if (!allowPushOnly) {
                    return;
                }

                actionText = await doPush(isManualPushOnlyTrigger(trigger) ? 'manual push' : 'push');
            } else {
                updateSyncUiProgress(textByLang('读取云端状态...', 'Reading cloud state...'), 15);
                const remoteState = await readRemoteSnapshotWithPathRecovery({
                    interactive: isManualTrigger,
                    continueAfterConfirm: true
                });
                updateSyncUiProgress(textByLang('云端状态已读取', 'Cloud state loaded'), 18);
                if (effectiveMode === 'pull') {
                    if (remoteState.notFound) {
                        let pullPlanWhenNoState = null;
                        if (settings.obsidianFilePushEnabled !== false) {
                            try {
                                pullPlanWhenNoState = await buildObsidianPullPlan(`${trigger || 'pull'}:no-state`);
                            } catch (_) {
                                pullPlanWhenNoState = null;
                            }
                        }

                        const hasRemoteFilesWhenNoState = !!(
                            pullPlanWhenNoState
                            && pullPlanWhenNoState.enabled
                            && pullPlanWhenNoState.remoteList
                            && Array.isArray(pullPlanWhenNoState.remoteList.files)
                            && pullPlanWhenNoState.remoteList.files.length > 0
                        );

                        if (!hasRemoteFilesWhenNoState) {
                            throw new Error(textByLang('云端同步目录为空，无法仅拉取', 'Cloud sync folder is empty; pull-only cannot continue'));
                        }

                        if (syncMethod === 'reset') {
                            runtime.lastLocalHash = localHash;
                            runtime.lastLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha;
                            runtime.lastRemoteSha = buildRemoteObsidianRevisionFromList(pullPlanWhenNoState.remoteList) || runtime.lastRemoteSha;
                            runtime.lastAppliedDirection = 'reset-head';
                            actionText = textByLang('仅记云端文件版本（仅更新版本指针）', 'Track cloud file revision only (update revision pointer only)');
                        } else {
                            let allowPullOnly = true;
                            const pullPreflight = buildOneWaySyncPreflightState(localSnapshot, localHash, remoteState, syncMethod);
                            localHash = pullPreflight.localHash;

                            const riskyLocalOverwrite = pullPreflight.localChanged
                                || pullPreflight.concurrentChanged
                                || pullPreflight.localUntracked;

                            if (!pullPreflight.winner) {
                                setPendingConflict(createPendingConflictPayload(localSnapshot, pullPreflight.remoteSnapshot, remoteState));
                                storeConflictRecord(localSnapshot, pullPreflight.remoteSnapshot, 'pending-manual', {
                                    remoteSha: pullPreflight.remoteSha || remoteState.sha || '',
                                    strategy: settings.conflictPolicy,
                                    syncMethod
                                });
                                runtime.lastAppliedDirection = 'conflict';
                                runtime.lastError = textByLang(
                                    '检测到并发修改，已暂停当前拉取路径，请先在冲突面板选择处理方式',
                                    'Concurrent changes detected. The current pull path has been paused; resolve it in the conflict panel first.'
                                );
                                pendingReasons.clear();
                                runtime.queueLength = 0;
                                saveRuntime();
                                renderStatus();
                                toast(textByLang('检测到冲突：请先在面板中选择保留本地或使用云端', 'Conflict detected: choose keep local or use cloud in the panel first'));
                                allowPullOnly = false;
                            } else if (riskyLocalOverwrite && pullPreflight.winner !== 'remote' && pullPreflight.winner !== 'remote-reset') {
                                if (isManualTrigger) {
                                    if (!requestOneWayOverwriteConfirmation('pull', pullPreflight)) {
                                        runtime.lastError = '';
                                        saveRuntime();
                                        renderStatus();
                                        toast(textByLang('已取消当前拉取操作', 'Current pull action cancelled'));
                                        allowPullOnly = false;
                                    }
                                } else {
                                    if (pullPreflight.remoteChanged || pullPreflight.concurrentChanged || pullPreflight.remoteUntracked) {
                                        await setPendingMismatchState(
                                            pullPreflight.remoteSha || remoteState.sha || '',
                                            textByLang(
                                                '检测到本地与云端都有更新，已暂停当前自动拉取路径，请在“状态”面板选择处理方式',
                                                'Both local and cloud changed. The current automatic pull path has been paused; choose an action in Status.'
                                            ),
                                            { openPanel: document.visibilityState === 'visible' }
                                        );
                                    } else {
                                        runtime.lastError = textByLang(
                                            '检测到本地未同步修改，已跳过当前自动拉取路径',
                                            'Local unsynced changes detected; the current automatic pull path was skipped.'
                                        );
                                        saveRuntime();
                                        renderStatus();
                                    }
                                    allowPullOnly = false;
                                }
                            }

                            if (!allowPullOnly) {
                                return;
                            }

                            if (!isExplicitRemoteOverwriteTrigger(trigger)
                                && isManualTrigger
                                && riskyLocalOverwrite
                                && pullPreflight.winner !== 'remote'
                                && pullPreflight.winner !== 'remote-reset') {
                                backupSnapshotForRecovery(localSnapshot, `before-${String(trigger || 'pull')}-remote-overwrite`);
                            }

                            actionText = await doPull(
                                remoteState,
                                syncMethod === 'rebase' ? 'pull (rebase mode, files)' : 'pull (files)',
                                pullPlanWhenNoState
                            );
                        }
                    } else if (syncMethod === 'reset') {
                        actionText = await doResetHead(remoteState);
                    }
                    else {
                        let allowPullOnly = true;
                        const pullPreflight = buildOneWaySyncPreflightState(localSnapshot, localHash, remoteState, syncMethod);
                        localHash = pullPreflight.localHash;

                        const riskyLocalOverwrite = pullPreflight.localChanged
                            || pullPreflight.concurrentChanged
                            || pullPreflight.localUntracked;

                        if (!pullPreflight.winner) {
                            setPendingConflict(createPendingConflictPayload(localSnapshot, pullPreflight.remoteSnapshot, remoteState));
                            storeConflictRecord(localSnapshot, pullPreflight.remoteSnapshot, 'pending-manual', {
                                remoteSha: pullPreflight.remoteSha || remoteState.sha || '',
                                strategy: settings.conflictPolicy,
                                syncMethod
                            });
                            runtime.lastAppliedDirection = 'conflict';
                            runtime.lastError = textByLang(
                                '检测到并发修改，已暂停当前拉取路径，请先在冲突面板选择处理方式',
                                'Concurrent changes detected. The current pull path has been paused; resolve it in the conflict panel first.'
                            );
                            pendingReasons.clear();
                            runtime.queueLength = 0;
                            saveRuntime();
                            renderStatus();
                            toast(textByLang('检测到冲突：请先在面板中选择保留本地或使用云端', 'Conflict detected: choose keep local or use cloud in the panel first'));
                            allowPullOnly = false;
                        } else if (riskyLocalOverwrite && pullPreflight.winner !== 'remote' && pullPreflight.winner !== 'remote-reset') {
                            if (isManualTrigger) {
                                if (!requestOneWayOverwriteConfirmation('pull', pullPreflight)) {
                                    runtime.lastError = '';
                                    saveRuntime();
                                    renderStatus();
                                    toast(textByLang('已取消当前拉取操作', 'Current pull action cancelled'));
                                    allowPullOnly = false;
                                }
                            } else {
                                if (pullPreflight.remoteChanged || pullPreflight.concurrentChanged || pullPreflight.remoteUntracked) {
                                    await setPendingMismatchState(
                                        pullPreflight.remoteSha || remoteState.sha || '',
                                        textByLang(
                                            '检测到本地与云端都有更新，已暂停当前自动拉取路径，请在“状态”面板选择处理方式',
                                            'Both local and cloud changed. The current automatic pull path has been paused; choose an action in Status.'
                                        ),
                                        { openPanel: document.visibilityState === 'visible' }
                                    );
                                } else {
                                    runtime.lastError = textByLang(
                                        '检测到本地未同步修改，已跳过当前自动拉取路径',
                                        'Local unsynced changes detected; the current automatic pull path was skipped.'
                                    );
                                    saveRuntime();
                                    renderStatus();
                                }
                                allowPullOnly = false;
                            }
                        }

                        if (!allowPullOnly) {
                            return;
                        }

                        if (!isExplicitRemoteOverwriteTrigger(trigger)
                            && isManualTrigger
                            && riskyLocalOverwrite
                            && pullPreflight.winner !== 'remote'
                            && pullPreflight.winner !== 'remote-reset') {
                            backupSnapshotForRecovery(localSnapshot, `before-${String(trigger || 'pull')}-remote-overwrite`);
                        }

                        actionText = await doPull(remoteState, syncMethod === 'rebase' ? 'pull (rebase mode)' : 'pull');
                    }
                } else {
                    if (remoteState.notFound) {
                        let pullPlanWhenNoState = null;
                        if (settings.obsidianFilePushEnabled !== false) {
                            try {
                                pullPlanWhenNoState = await buildObsidianPullPlan(`${trigger || 'sync'}:remote-state-missing`);
                            } catch (_) {
                                pullPlanWhenNoState = null;
                            }
                        }

                        const hasRemoteFilesWhenNoState = !!(
                            pullPlanWhenNoState
                            && pullPlanWhenNoState.enabled
                            && pullPlanWhenNoState.remoteList
                            && Array.isArray(pullPlanWhenNoState.remoteList.files)
                            && pullPlanWhenNoState.remoteList.files.length > 0
                        );

                        if (hasRemoteFilesWhenNoState) {
                            actionText = await doPull(remoteState, 'pull (files-only remote)', pullPlanWhenNoState);
                        } else {
                            actionText = await doPush('bootstrap push');
                        }
                    } else {
                        const remoteSnapshot = remoteState.snapshot;
                        if (hydratePermanentTreeFromRemote(localSnapshot, remoteSnapshot)) {
                            localHash = getSnapshotHash(localSnapshot);
                        }
                        const remoteHash = getSnapshotHash(remoteSnapshot);

                        if (remoteHash === localHash) {
                            runtime.lastLocalHash = localHash;
                            runtime.lastLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha;
                            runtime.lastRemoteSha = remoteState.sha || runtime.lastRemoteSha;
                            runtime.lastAppliedDirection = 'noop';
                            actionText = 'noop';
                        } else {
                            const hasLocalBase = !!runtime.lastLocalHash;
                            const hasRemoteBase = !!runtime.lastRemoteSha;
                            const localChanged = hasLocalBase && runtime.lastLocalHash !== localHash;
                            const remoteChanged = hasRemoteBase && remoteState.sha && runtime.lastRemoteSha !== remoteState.sha;
                            const concurrentChanged = localChanged && remoteChanged;

                            if (concurrentChanged && settings.conflictPolicy === 'none') {
                                setPendingConflict(createPendingConflictPayload(localSnapshot, remoteSnapshot, remoteState));
                                storeConflictRecord(localSnapshot, remoteSnapshot, 'pending-manual', {
                                    remoteSha: remoteState.sha || '',
                                    strategy: settings.conflictPolicy,
                                    syncMethod
                                });
                                runtime.lastAppliedDirection = 'conflict';
                                runtime.lastError = textByLang(
                                    `检测到并发修改（合并策略=${formatSyncMethodForDisplay(syncMethod)}，冲突策略=${formatConflictPolicyForDisplay(settings.conflictPolicy)}），请在冲突面板中选择`,
                                    `Concurrent changes detected (merge strategy=${formatSyncMethodForDisplay(syncMethod)}, conflict strategy=${formatConflictPolicyForDisplay(settings.conflictPolicy)}). Resolve it in the conflict panel.`
                                );
                                pendingReasons.clear();
                                runtime.queueLength = 0;
                                saveRuntime();
                                renderStatus();
                                renderConflictPanel();
                                openPanel({ activeTab: 'status' });
                                toast(textByLang(
                                    `检测到冲突：当前冲突策略=手动处理冲突（Git 默认），当前合并策略=${formatSyncMethodForDisplay(syncMethod)}，请手动选择本地或云端`,
                                    `Conflict detected: conflict strategy is None (git default), merge strategy is ${formatSyncMethodForDisplay(syncMethod)}. Please choose local or remote manually.`
                                ));
                                return;
                            }

                            if (!concurrentChanged && syncMethod === 'reset' && remoteChanged && !localChanged) {
                                actionText = await doResetHead(remoteState);
                            } else {
                                const winner = decideWinner(localSnapshot, remoteSnapshot, concurrentChanged, localChanged, remoteChanged, syncMethod);
                                if (!winner) {
                                    setPendingConflict(createPendingConflictPayload(localSnapshot, remoteSnapshot, remoteState));
                                    runtime.lastAppliedDirection = 'conflict';
                                    runtime.lastError = textByLang('检测到并发修改，请在冲突面板中处理', 'Concurrent changes detected. Resolve them in the conflict panel');
                                    pendingReasons.clear();
                                    runtime.queueLength = 0;
                                    saveRuntime();
                                    renderStatus();
                                    renderConflictPanel();
                                    openPanel({ activeTab: 'status' });
                                    toast(textByLang('检测到冲突：请在面板中选择本地或云端', 'Conflict detected: please choose local or remote in the panel'));
                                    return;
                                }
                                if (winner === 'local') {
                                    actionText = await doPush(
                                        concurrentChanged
                                            ? `conflict resolved (local, ${settings.conflictPolicy}, ${syncMethod})`
                                            : syncMethod === 'rebase'
                                                ? 'local newer push (rebase mode)'
                                                : 'local newer push'
                                    );
                                } else if (winner === 'remote-reset') {
                                    actionText = await doResetHead(remoteState);
                                } else {
                                    actionText = await doPull(remoteState,
                                        concurrentChanged
                                            ? `conflict resolved (remote, ${settings.conflictPolicy}, ${syncMethod})`
                                            : 'remote newer pull'
                                    );
                                }
                            }
                        }
                    }
                }
            }

            if (abortedByPendingConflict) {
                return;
            }

            pendingReasons.clear();
            runtime.queueLength = 0;
            runtime.lastError = '';
            runtime.lastSuccessAt = Date.now();
            runtime.pendingMismatch = false;
            runtime.pendingMismatchAt = 0;
            runtime.pendingMismatchRemoteSha = '';
            saveRuntime();
            renderStatus();
            void updateBackgroundSyncContext('sync-success', {
                isRunning: false,
                queueLength: 0,
                pendingMismatch: false,
                pendingMismatchAt: 0,
                pendingMismatchRemoteSha: '',
                hasPendingWork: false,
                localDirty: false,
                lastRemoteSha: runtime.lastRemoteSha,
                lastLocalHash: runtime.lastLocalHash,
                lastSuccessAt: runtime.lastSuccessAt
            });

            const triggerText = trigger ? `（${trigger}）` : '';
            if (actionText === 'noop') {
                if (isManualTrigger || !settings.hideNoChangeNotice) {
                    toast(textByLang(`Obsidian Git 同步完成${triggerText}：无变更`, `Obsidian Git sync completed${triggerText}: no changes`));
                }
            } else {
                toast(textByLang(
                    `Obsidian Git 同步完成${triggerText}：${actionText}（${formatSyncMethodForDisplay(syncMethod)}）`,
                    `Obsidian Git sync completed${triggerText}: ${actionText} (${formatSyncMethodForDisplay(syncMethod)})`
                ));
            }
        } catch (error) {
            runtime.lastError = error && error.message ? error.message : String(error);
            saveRuntime();
            renderStatus();
            void updateBackgroundSyncContext('sync-error', {
                isRunning: false,
                queueLength: runtime.queueLength,
                pendingMismatch: runtime.pendingMismatch,
                lastRemoteSha: runtime.lastRemoteSha,
                lastLocalHash: runtime.lastLocalHash,
                lastSuccessAt: runtime.lastSuccessAt
            });

            const isRepoConfigError = /token 未配置|仓库未配置|仓库已禁用|owner\s*\/\s*repo 未配置|token not configured|repository not ready|repository disabled|owner\s*\/\s*repo not configured/i.test(runtime.lastError);
            const isPathValidationError = !!(error && error.code === 'path-validation-required');
            const isTooLargeError = isSyncFileTooLargeError(error);

            if (isTooLargeError) {
                showSyncFileTooLargeDialog(error);
            }

            if (!hasPendingConflict() && !isRepoConfigError && !isTooLargeError && !isPathValidationError) {
                scheduleRetry();
            }

            const offlineHint = isLikelyOfflineError(runtime.lastError)
                ? textByLang('（检测到网络异常，将自动重试）', ' (Network issue detected; will retry automatically)')
                : '';
            if (isManualTrigger || !isRepoConfigError) {
                toast(textByLang(`同步失败：${runtime.lastError}${offlineHint}`, `Sync failed: ${runtime.lastError}${offlineHint}`));
            }

            if (isPathValidationError) {
                focusFirstSyncSetup();
            } else {
                const panelMode = hasPendingConflict()
                    ? 'conflict'
                    : ((runtime && runtime.pendingMismatch) ? 'mismatch' : '');
                ensureStatusPanelVisible(panelMode);
            }
        } finally {
            clearSyncUiProgress();
            syncUiProgressEnabled = false;
            runtime.isRunning = false;
            saveRuntime();
            renderStatus();
            void updateBackgroundSyncContext('sync-idle', {
                isRunning: false,
                queueLength: runtime.queueLength,
                pendingMismatch: runtime.pendingMismatch,
                lastRemoteSha: runtime.lastRemoteSha,
                lastLocalHash: runtime.lastLocalHash,
                lastSuccessAt: runtime.lastSuccessAt
            });
        }
    }

    async function refreshRepoConfigFromStorage() {

        try {
            const rawRepoConfig = await storageLocalGet(REPO_CONFIG_KEYS);
            repoConfig = normalizeRepoConfig(rawRepoConfig);
        } catch (_) {
            if (!repoConfig) {
                repoConfig = normalizeRepoConfig({});
            }
        }
        return repoConfig;
    }

    async function readRemoteSnapshotForImport() {
        await refreshRepoConfigFromStorage();
        const missingReason = getRepoConfigMissingReason(repoConfig);
        if (missingReason) {
            throw new Error(textByLang(`仓库未就绪：${missingReason}`, `Repository not ready: ${missingReason}`));
        }

        const remoteState = await readRemoteSnapshotWithPathRecovery({
            interactive: true,
            continueAfterConfirm: true
        });
        if (remoteState.notFound) {
            throw new Error(textByLang('云端同步目录为空，请先在另一端执行一次同步', 'Cloud sync folder is empty. Run one sync on the other side first.'));
        }

        return {
            path: remoteState.path || '',
            sha: remoteState.sha || '',
            snapshot: remoteState.snapshot
        };
    }

    async function initializeRemoteSnapshotFromLocal(reason = 'bootstrap-init') {
        const localSnapshot = await buildLocalSnapshot(reason, { includePermanentTree: true });
        if (settings.obsidianFilePushEnabled === false) {
            throw new Error(textByLang('已关闭 Obsidian 文件推送，无法初始化云端', 'Obsidian file push is disabled, cannot initialize cloud'));
        }
        const bootstrapProgress = makeProgressRange(20, 85);
        const pushResult = await pushObsidianFilesIncremental(`manual-${reason || 'bootstrap-init'}`, bootstrapProgress);
        const guidePaths = Array.isArray(pushResult && pushResult.guidePaths)
            ? pushResult.guidePaths.filter((path) => !!normalizeSyncPath(path))
            : [];
        if (!guidePaths.length) {
            throw new Error(textByLang(
                '首次同步失败：首包未包含“说明导入规则.md”',
                'First sync failed: initial package does not include "说明导入规则.md"'
            ));
        }

        let remoteRevision = '';
        try {
            updateSyncUiProgress(textByLang('校验云端文件...', 'Validating cloud files...'), 90);
            const root = settings.obsidianExportRoot;
            let remoteListRaw = await listRemoteObsidianFilesByPath(root);
            let remoteList = filterRemoteListForManagedSyncFiles(remoteListRaw, root);
            let remoteFilesByPath = remoteList && remoteList.filesByPath && typeof remoteList.filesByPath === 'object'
                ? remoteList.filesByPath
                : {};
            let hasGuideInRemote = guidePaths.some((path) => Object.prototype.hasOwnProperty.call(remoteFilesByPath, path));

            if (!hasGuideInRemote) {
                // GitHub list endpoint could be eventually consistent right after a write.
                // Retry once quietly to avoid noisy warnings.
                await new Promise((resolve) => setTimeout(resolve, 800));
                remoteListRaw = await listRemoteObsidianFilesByPath(root);
                remoteList = filterRemoteListForManagedSyncFiles(remoteListRaw, root);
                remoteFilesByPath = remoteList && remoteList.filesByPath && typeof remoteList.filesByPath === 'object'
                    ? remoteList.filesByPath
                    : {};
                hasGuideInRemote = guidePaths.some((path) => Object.prototype.hasOwnProperty.call(remoteFilesByPath, path));
            }

            remoteRevision = buildRemoteObsidianRevisionFromList(remoteList);
            updateSyncUiProgress(textByLang('云端文件校验完成', 'Cloud files validated'), 95);
        } catch (_) {
            remoteRevision = '';
        }

        runtime.lastLocalHash = getSnapshotHash(localSnapshot);
        runtime.lastLocalFilesSha = String(pushResult && pushResult.localRevision || buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha || '');
        runtime.lastRemoteSha = remoteRevision || runtime.lastRemoteSha;
        runtime.lastPermanentTreeSnapshotAt = Date.now();
        runtime.lastTempSectionSnapshotAt = Date.now();
        const pushedTempStateRaw = localSnapshot
            && localSnapshot.data
            && typeof localSnapshot.data[TEMP_SECTION_STORAGE_KEY] === 'string'
            ? localSnapshot.data[TEMP_SECTION_STORAGE_KEY]
            : '';
        if (pushedTempStateRaw) {
            setSyncMetaRaw(LAST_UPLOADED_TEMP_STATE_KEY, pushedTempStateRaw);
        }
        runtime.lastAppliedDirection = 'push-bootstrap';
        runtime.lastError = '';
        runtime.lastSuccessAt = Date.now();
        pendingReasons.clear();
        runtime.queueLength = 0;
        saveRuntime();
        renderStatus();
    }

    function setFirstSyncStatus(message, level = 'neutral', markDynamic = true) {
        const statusEl = getElement('canvasSyncFirstSyncStatus');
        if (!statusEl) return;
        statusEl.textContent = String(message || textByLang('等待执行首次同步', 'Waiting to run first sync'));
        statusEl.dataset.status = String(level || 'neutral');
        if (markDynamic) {
            statusEl.dataset.dynamicStatus = 'true';
        } else {
            delete statusEl.dataset.dynamicStatus;
        }
    }

    function requestFirstSyncOverwriteConfirmation(treeStats) {
        const stats = treeStats && typeof treeStats === 'object' ? treeStats : { roots: 0, folders: 0, bookmarks: 0 };
        const firstConfirmText = (getSyncLang() === 'en'
            ? [
                'First sync will use cloud as source of truth:',
                '1) Cloud permanent section will overwrite local browser bookmark tree',
                '2) Existing local permanent section will be replaced',
                `Cloud stats: roots ${stats.roots}, folders ${stats.folders}, bookmarks ${stats.bookmarks}`,
                '',
                'Do you want to continue?'
            ]
            : [
                '首次同步将以云端为准：',
                '1) 使用云端永久栏目覆盖本地浏览器书签树',
                '2) 本地现有永久栏目会被替换',
                `云端统计：根目录 ${stats.roots}，文件夹 ${stats.folders}，书签 ${stats.bookmarks}`,
                '',
                '确定继续吗？'
            ]).join('\n');

        if (!global.confirm(firstConfirmText)) {
            return false;
        }

        const keyword = global.prompt(textByLang('为防误操作，请输入 OVERWRITE 以继续：', 'Type OVERWRITE to continue:'), '');
        return String(keyword || '').trim().toUpperCase() === 'OVERWRITE';
    }

    function requestFirstSyncLocalOverwriteConfirmation(localStats, remoteStats) {
        const local = localStats && typeof localStats === 'object' ? localStats : { roots: 0, folders: 0, bookmarks: 0 };
        const remote = remoteStats && typeof remoteStats === 'object' ? remoteStats : { roots: 0, folders: 0, bookmarks: 0 };

        const confirmText = (getSyncLang() === 'en'
            ? [
                'First sync will use local as source of truth:',
                '1) Local permanent section snapshot will overwrite cloud',
                '2) Existing cloud permanent section will be replaced',
                `Local stats: roots ${local.roots}, folders ${local.folders}, bookmarks ${local.bookmarks}`,
                `Cloud stats: roots ${remote.roots}, folders ${remote.folders}, bookmarks ${remote.bookmarks}`,
                '',
                'Do you want to continue?'
            ]
            : [
                '首次同步将以本地为准：',
                '1) 本地永久栏目快照会覆盖云端',
                '2) 云端现有永久栏目会被替换',
                `本地统计：根目录 ${local.roots}，文件夹 ${local.folders}，书签 ${local.bookmarks}`,
                `云端统计：根目录 ${remote.roots}，文件夹 ${remote.folders}，书签 ${remote.bookmarks}`,
                '',
                '确定继续吗？'
            ]).join('\n');

        if (!global.confirm(confirmText)) {
            return false;
        }

        const keyword = global.prompt(textByLang('为防误操作，请输入 OVERWRITE 以继续：', 'Type OVERWRITE to continue:'), '');
        return String(keyword || '').trim().toUpperCase() === 'OVERWRITE';
    }

    function requestOneWayOverwriteConfirmation(mode, summary = {}) {
        const direction = mode === 'pull' ? 'pull' : 'push';
        const concurrentChanged = summary && summary.concurrentChanged === true;
        const localChanged = summary && summary.localChanged === true;
        const remoteChanged = summary && summary.remoteChanged === true;
        const localUntracked = summary && summary.localUntracked === true;
        const remoteUntracked = summary && summary.remoteUntracked === true;

        const detailLinesZh = [];
        const detailLinesEn = [];

        if (concurrentChanged) {
            detailLinesZh.push('当前判断：本地和云端都已发生变化。');
            detailLinesEn.push('Current assessment: both local and cloud changed.');
        } else {
            if (localChanged) {
                detailLinesZh.push('当前判断：本地存在未同步的新变化。');
                detailLinesEn.push('Current assessment: local has unsynced new changes.');
            } else if (localUntracked) {
                detailLinesZh.push('当前判断：本地已有变更，但当前缺少可靠共同基线。');
                detailLinesEn.push('Current assessment: local already changed, but there is no reliable common baseline yet.');
            }

            if (remoteChanged) {
                detailLinesZh.push('当前判断：云端存在较新的内容。');
                detailLinesEn.push('Current assessment: cloud has newer content.');
            } else if (remoteUntracked) {
                detailLinesZh.push('当前判断：云端已有内容，但当前缺少可靠共同基线。');
                detailLinesEn.push('Current assessment: cloud already has content, but there is no reliable common baseline yet.');
            }
        }

        const confirmText = (direction === 'pull'
            ? (getSyncLang() === 'en'
                ? [
                    'Pull-only is about to use cloud content to overwrite local data.',
                    'A local recovery snapshot will be saved before overwrite.',
                    ''
                ].concat(detailLinesEn, [
                    '',
                    'Do you want to continue?'
                ])
                : [
                    '“仅拉取”即将使用云端内容覆盖本地数据。',
                    '执行前会自动保存一份本地恢复快照。',
                    ''
                ].concat(detailLinesZh, [
                    '',
                    '确定继续吗？'
                ]))
            : (getSyncLang() === 'en'
                ? [
                    'Push-only is about to use local content to overwrite cloud data.',
                    'This operation does not pull cloud content first.',
                    ''
                ].concat(detailLinesEn, [
                    '',
                    'Do you want to continue?'
                ])
                : [
                    '“仅上传”即将使用本地内容覆盖云端数据。',
                    '该操作不会先拉取云端内容。',
                    ''
                ].concat(detailLinesZh, [
                    '',
                    '确定继续吗？'
                ]))).join('\n');

        if (!global.confirm(confirmText)) {
            return false;
        }

        const keyword = global.prompt(textByLang('为防误操作，请输入 OVERWRITE 以继续：', 'Type OVERWRITE to continue:'), '');
        return String(keyword || '').trim().toUpperCase() === 'OVERWRITE';
    }

    async function requestFirstSyncPathValidation(options = {}) {
        setFirstSyncFoldOpen(true);
        const confirmed = await openFirstSyncPathValidationDialog(options);
        return !!confirmed;
    }

    function resolveFirstSyncMode(preferredMode, hasRemotePermanentSnapshot, hasRemoteManagedFiles = false) {
        const mode = ensureFirstSyncMode(preferredMode);
        if (mode === 'auto') {
            if (!hasRemoteManagedFiles) {
                return 'local';
            }
            if (!hasRemotePermanentSnapshot) {
                return 'remote-data-without-permanent';
            }
            const chooseCloud = global.confirm(textByLang(
                '检测到云端已有永久栏目数据。\n\n确定 = 以云端为准（覆盖本地）\n取消 = 以本地为准（覆盖云端）',
                'Cloud permanent snapshot detected.\n\nOK = Use cloud (overwrite local)\nCancel = Use local (overwrite cloud)'
            ));
            return chooseCloud ? 'cloud' : 'local';
        }
        return mode;
    }

    async function runFirstSyncCloudOverwrite(trigger = 'manual-first-sync-overwrite') {
        if (!settings.enabled) {
            toast(textByLang('同步已关闭', 'Sync is disabled'));
            return false;
        }

        if (runtime.isRunning) {
            toast(textByLang('正在同步，请稍后再试', 'Sync is running, please try again later'));
            return false;
        }

        await refreshRepoConfigFromStorage();
        const missingReason = getRepoConfigMissingReason(repoConfig);
        if (missingReason) {
            runtime.lastError = missingReason;
            saveRuntime();
            renderStatus();
            setFirstSyncStatus(textByLang(`首次同步未执行：${missingReason}`, `First sync skipped: ${missingReason}`), 'error');
            toast(textByLang(`首次同步未执行：${missingReason}`, `First sync skipped: ${missingReason}`));
            return false;
        }

        runtime.isRunning = true;
        runtime.lastTrigger = trigger;
        runtime.lastSyncMode = 'first-sync';
        saveRuntime();
        renderStatus();
        setFirstSyncStatus(textByLang('首次同步进行中...', 'First sync is running...'), 'neutral');
        syncUiProgressEnabled = isManualSyncTrigger(null, trigger);
        updateSyncUiProgress(textByLang('首次同步中...', 'Running first sync...'), 0);

        try {
            const preferredMode = ensureFirstSyncMode(settings.firstSyncMode);
            updateSyncUiProgress(textByLang('读取云端状态...', 'Reading cloud state...'), 10);
            const remoteState = await readRemoteSnapshotWithPathRecovery({
                interactive: true,
                continueAfterConfirm: true
            });
            updateSyncUiProgress(textByLang('云端状态已读取', 'Cloud state loaded'), 18);
            const remoteSnapshot = remoteState.notFound ? null : normalizeSnapshot(remoteState.snapshot || {});
            const remotePermanentTree = remoteSnapshot ? normalizeBookmarkTreeSnapshot(remoteSnapshot.permanentTreeSnapshot) : null;
            const hasRemotePermanentSnapshot = !!remotePermanentTree;
            const remoteManagedFiles = remoteState && remoteState.remoteList && Array.isArray(remoteState.remoteList.files)
                ? remoteState.remoteList.files
                : [];
            const hasRemoteManagedFiles = remoteManagedFiles.length > 0;

            const effectiveMode = resolveFirstSyncMode(preferredMode, hasRemotePermanentSnapshot, hasRemoteManagedFiles);

            if (effectiveMode === 'remote-data-without-permanent') {
                throw new Error(textByLang(
                    '检测到云端已有同步文件，但未恢复出可用于首次同步的永久栏目快照。为避免误判为“云端为空”并覆盖云端，请先检查云端路径/文件，或明确切换到“以本地为准”。',
                    'Cloud sync files were detected, but no permanent snapshot could be restored for first sync. To avoid treating the cloud as empty and overwriting it, verify the remote path/files first or explicitly switch to "Use local".'
                ));
            }

            if (effectiveMode === 'local') {
                if (hasRemotePermanentSnapshot) {
                    const localSnapshotForConfirm = await buildLocalSnapshot('first-sync-local-confirm', { includePermanentTree: true });
                    const localTree = normalizeBookmarkTreeSnapshot(localSnapshotForConfirm.permanentTreeSnapshot);
                    const localStats = getBookmarkTreeStats(localTree);
                    const remoteStats = getBookmarkTreeStats(remotePermanentTree);
                    if (!requestFirstSyncLocalOverwriteConfirmation(localStats, remoteStats)) {
                        throw new Error(textByLang('已取消首次覆盖操作', 'First overwrite cancelled'));
                    }
                }

                updateSyncUiProgress(textByLang('正在以本地初始化云端...', 'Initializing cloud from local...'), 20);
                await initializeRemoteSnapshotFromLocal(hasRemotePermanentSnapshot ? 'first-sync-local-overwrite-cloud' : 'first-sync-local-bootstrap-cloud');
                updateSyncUiProgress(textByLang('云端初始化完成', 'Cloud initialized'), 95);

                runtime.lastSyncMode = 'first-sync-local';
                runtime.lastError = '';
                runtime.lastSuccessAt = Date.now();
                saveRuntime();
                renderStatus();

                setFirstSyncStatus(
                    hasRemotePermanentSnapshot
                        ? textByLang('首次同步完成：已按本地覆盖云端永久栏目', 'First sync completed: local permanent section overwrote cloud')
                        : (hasRemoteManagedFiles
                            ? textByLang('首次同步完成：云端已有同步文件但缺少永久栏目快照，已按本地重建云端', 'First sync completed: cloud had sync files but no permanent snapshot; rebuilt from local')
                            : textByLang('首次同步完成：检测到云端为空，已按本地初始化云端', 'First sync completed: cloud was empty, initialized from local')),
                    'ok'
                );
                toast(textByLang(
                    hasRemotePermanentSnapshot
                        ? '首次同步完成：已按本地覆盖云端永久栏目'
                        : (hasRemoteManagedFiles
                            ? '首次同步完成：云端已有同步文件但缺少永久栏目快照，已按本地重建'
                            : '首次同步完成：云端为空，已按本地初始化'),
                    hasRemotePermanentSnapshot
                        ? 'First sync completed: local overwrote cloud permanent section'
                        : (hasRemoteManagedFiles
                            ? 'First sync completed: cloud had sync files but no permanent snapshot; rebuilt from local'
                            : 'First sync completed: cloud empty, initialized from local')
                ));
                setFirstSyncFoldOpen(false);
                return true;
            }

            if (!hasRemotePermanentSnapshot) {
                throw new Error(textByLang(
                    hasRemoteManagedFiles
                        ? '云端已有同步文件，但没有可用永久栏目快照，无法以云端为准。请先检查云端导出内容/同步路径，或改用“以本地为准”。'
                        : '云端没有可用永久栏目快照，无法以云端为准。请改用“自动”或“以本地为准”。',
                    hasRemoteManagedFiles
                        ? 'Cloud has sync files but no usable permanent snapshot, so it cannot be used as the source of truth. Check the remote export/path first, or switch to "Use local".'
                        : 'Cloud has no permanent snapshot, cannot use cloud as source. Switch to "Auto" or "Use local".'
                ));
            }

            const stats = getBookmarkTreeStats(remotePermanentTree);
            if (!requestFirstSyncOverwriteConfirmation(stats)) {
                throw new Error(textByLang('已取消首次覆盖操作', 'First overwrite cancelled'));
            }

            updateSyncUiProgress(textByLang('备份本地数据...', 'Backing up local data...'), 25);
            const localBackupSnapshot = await buildLocalSnapshot('before-first-sync-overwrite', {
                includePermanentTree: true
            });
            backupSnapshotForRecovery(localBackupSnapshot, 'before-first-sync-cloud-overwrite');

            updateSyncUiProgress(textByLang('正在覆盖本地...', 'Overwriting local...'), 45);
            // First sync (cloud as source): this is the baseline implementation for
            // permanent-section overwrite into the real browser bookmark tree.
            await overwriteLocalPermanentTreeFromSnapshot(remotePermanentTree);

            let firstSyncAppliedByFiles = false;
            if (settings.obsidianFilePushEnabled !== false && remoteState && remoteState.remoteList && Array.isArray(remoteState.remoteList.files) && remoteState.remoteList.files.length > 0) {
                try {
                    const fileApplyResult = await applyRemoteObsidianFilesReplace(
                        remoteState.remoteList,
                        'first-sync-cloud-overwrite'
                    );
                    firstSyncAppliedByFiles = !!(fileApplyResult && fileApplyResult.applied);
                } catch (error) {
                    console.warn('[Canvas Sync] apply remote files replace in first-sync cloud overwrite failed:', error);
                }
            }

            if (!firstSyncAppliedByFiles) {
                applySnapshotToLocal(buildSnapshotForRemoteLocalApply(remoteSnapshot), {
                    bypassDeleteThreshold: true,
                    bypassReason: 'first-sync-cloud-overwrite'
                });
            }
            if (settings.obsidianFilePushEnabled !== false) {
                try {
                    updateSyncUiProgress(textByLang('重建本地索引...', 'Rebuilding local index...'), 75);
                    let remoteFilesByPath = null;
                    let rebuiltResult = null;
                    try {
                        const remoteListRaw = await listRemoteObsidianFilesByPath(settings.obsidianExportRoot);
                        const remoteList = filterRemoteListForManagedSyncFiles(remoteListRaw, settings.obsidianExportRoot);
                        remoteFilesByPath = remoteList && remoteList.filesByPath ? remoteList.filesByPath : null;
                    } catch (_) {
                        remoteFilesByPath = null;
                    }
                    rebuiltResult = await rebuildObsidianIndexesFromLocalSnapshot('first-sync-cloud-overwrite', {
                        clearDirty: true,
                        syncedAt: Date.now(),
                        remoteFilesByPath
                    });
                    if (rebuiltResult && rebuiltResult.enabled) {
                        runtime.lastLocalFilesSha = String(rebuiltResult.localRevision || runtime.lastLocalFilesSha || '');
                    }
                    updateSyncUiProgress(textByLang('本地索引已更新', 'Local index updated'), 90);
                } catch (error) {
                    console.warn('[Canvas Sync] rebuild local obsidian index after first-sync cloud overwrite failed:', error);
                }
            } else {
                saveDirtyState(createDefaultDirtyState());
            }

            runtime.lastLocalHash = getSnapshotHash(remoteSnapshot);
            runtime.lastLocalFilesSha = runtime.lastLocalFilesSha || buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes());
            runtime.lastRemoteSha = remoteState.sha || runtime.lastRemoteSha;
            runtime.lastAppliedDirection = 'first-sync-overwrite';
            runtime.lastSyncMode = 'first-sync-cloud';
            runtime.lastError = '';
            runtime.lastSuccessAt = Date.now();
            pendingReasons.clear();
            runtime.queueLength = 0;
            saveRuntime();
            renderStatus();

            setFirstSyncStatus(
                textByLang(`首次同步完成：已按云端覆盖本地（书签 ${stats.bookmarks}，文件夹 ${stats.folders}）`, `First sync completed: cloud overwrote local (bookmarks ${stats.bookmarks}, folders ${stats.folders})`),
                'ok'
            );
            toast(textByLang(`首次同步完成：已按云端覆盖本地（书签 ${stats.bookmarks}，文件夹 ${stats.folders}）`, `First sync completed: cloud overwrote local (bookmarks ${stats.bookmarks}, folders ${stats.folders})`));
            setFirstSyncFoldOpen(false);
            updateSyncUiProgress(textByLang('首次同步完成', 'First sync completed'), 100);
            return true;
        } catch (error) {
            runtime.lastError = error && error.message ? error.message : String(error);
            const isCanceled = /已取消首次覆盖操作|first overwrite cancelled/i.test(runtime.lastError)
                || !!(error && error.code === 'path-validation-required' && error.canceled);
            if (isCanceled) {
                runtime.lastError = '';
                setFirstSyncStatus(textByLang('首次同步已取消', 'First sync cancelled'), 'neutral');
            } else {
                setFirstSyncStatus(textByLang(`首次同步失败：${runtime.lastError}`, `First sync failed: ${runtime.lastError}`), 'error');
            }
            saveRuntime();
            renderStatus();
            if (!isCanceled && isSyncFileTooLargeError(error)) {
                showSyncFileTooLargeDialog(error);
            }
            if (!isCanceled) {
                toast(textByLang(`首次同步失败：${runtime.lastError}`, `First sync failed: ${runtime.lastError}`));
            }
            return false;
        } finally {
            clearSyncUiProgress();
            syncUiProgressEnabled = false;
            runtime.isRunning = false;
            saveRuntime();
            renderStatus();
        }
    }

    function scheduleRetry() {

        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
        if (hasPendingConflict()) return;

        const delayMs = navigator.onLine === false ? 5000 : 2000;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            const hasDirty = hasLocalDirtyWork();
            const hasMismatch = !!(runtime && runtime.pendingMismatch);
            if (settings.enabled && settings.autoSync && !hasPendingConflict() && !shouldPauseAutoSyncForPendingMismatch() && (hasDirty || hasMismatch)) {
                runSync('full', 'retry');
            }
        }, delayMs);
    }

    function shouldPauseAutoSyncForPendingMismatch() {
        if (!runtime || !runtime.pendingMismatch) return false;
        if (!settings) return false;
        return ensureMismatchPolicy(settings.mismatchPolicy) === 'prompt';
    }

    function scheduleSync(reason, options = {}) {
        if (!settings.enabled || !settings.autoSync) return;
        if (hasPendingConflict()) return;
        if (shouldPauseAutoSyncForPendingMismatch()) return;
        if (getRepoConfigMissingReason(repoConfig || {})) return;

        const shouldCheckDirty = options && options.skipDirtyCheck === true ? false : true;
        if (shouldCheckDirty && !hasLocalDirtyWork()) {
            pendingReasons.clear();
            runtime.queueLength = 0;
            saveRuntime();
            renderStatus();
            void updateBackgroundSyncContext('local-clean', {
                queueLength: 0,
                isRunning: runtime.isRunning,
                pendingMismatch: runtime.pendingMismatch,
                hasPendingWork: runtime.pendingMismatch === true,
                localDirty: false
            });
            return;
        }

        runtime.lastLocalMutationAt = Date.now();

        pendingReasons.add(reason || 'unknown');
        runtime.queueLength = pendingReasons.size;
        saveRuntime();
        renderStatus();
        void updateBackgroundSyncContext('local-dirty', {
            queueLength: runtime.queueLength,
            isRunning: runtime.isRunning,
            pendingMismatch: runtime.pendingMismatch
        });

        const wait = options.immediate
            ? 0
            : (options.bulk ? settings.batchDebounceMs : settings.debounceMs);

        if (syncTimer) {
            clearTimeout(syncTimer);
            syncTimer = null;
        }
        syncTimer = setTimeout(() => {
            syncTimer = null;
            runSync('full', reason || 'auto');
        }, Math.max(0, wait));
    }

    function restartFallbackTimer() {
        if (fallbackTimer) {
            clearInterval(fallbackTimer);
            fallbackTimer = null;
        }
        if (!settings.enabled || !settings.autoSync) return;
        if (settings.splitIntervalCommitAndSync) return;
        if (!Number.isFinite(settings.intervalSeconds) || settings.intervalSeconds <= 0) return;
        fallbackTimer = setInterval(() => {
            if (hasPendingConflict()) return;
            if (shouldPauseAutoSyncForPendingMismatch()) return;
            if (!hasLocalDirtyWork()) return;
            scheduleSync('fallback', { immediate: true });
        }, settings.intervalSeconds * 1000);
    }

    function restartPushPullTimers() {
        if (autoPushTimer) {
            clearInterval(autoPushTimer);
            autoPushTimer = null;
        }
        if (autoPullTimer) {
            clearInterval(autoPullTimer);
            autoPullTimer = null;
        }

        if (!settings.enabled || !settings.autoSync) return;
        if (!settings.splitIntervalCommitAndSync) return;

        if (settings.autoPushIntervalMinutes > 0) {
            autoPushTimer = setInterval(() => {
                if (hasPendingConflict()) return;
                if (shouldPauseAutoSyncForPendingMismatch()) return;
                if (!hasLocalDirtyWork()) return;
                runSync('push', 'auto-push-interval');
            }, settings.autoPushIntervalMinutes * 60 * 1000);
        }

        if (settings.autoPullIntervalMinutes > 0) {
            autoPullTimer = setInterval(() => {
                if (hasPendingConflict()) return;
                if (shouldPauseAutoSyncForPendingMismatch()) return;
                runSync('pull', 'auto-pull-interval');
            }, settings.autoPullIntervalMinutes * 60 * 1000);
        }
    }

    function restartAutomationTimers() {
        restartFallbackTimer();
        restartPushPullTimers();
        restartForegroundMismatchTimer();
    }

    function restartForegroundMismatchTimer() {
        if (foregroundMismatchTimer) {
            clearInterval(foregroundMismatchTimer);
            foregroundMismatchTimer = null;
        }
        if (!settings || !settings.enabled) return;
        if (settings.foregroundCheckEnabled === false) return;

        const intervalMs = normalizeForegroundCheckSeconds(settings.foregroundCheckIntervalSeconds, DEFAULT_SETTINGS.foregroundCheckIntervalSeconds) * 1000;
        foregroundMismatchTimer = setInterval(async () => {
            try {
                if (document.visibilityState !== 'visible') return;
                if (runtime && runtime.isRunning) return;
                if (hasPendingConflict()) return;
                await sendRuntimeMessage({ action: 'canvasGitSyncRunBackgroundCheckNow' }, 12000);
                await refreshPendingMismatchFromBackground();
            } catch (_) { }
        }, intervalMs);
    }

    function scheduleStartupPull() {
        if (startupPullTimer) {
            clearTimeout(startupPullTimer);
            startupPullTimer = null;
        }
        if (!settings.enabled || !settings.autoSync) return;
        if (shouldPauseAutoSyncForPendingMismatch()) return;
        if (!settings.pullOnStartup) return;

        startupPullTimer = setTimeout(() => {
            startupPullTimer = null;
            runSync('pull', 'startup-auto-pull');
        }, 1200);
    }

    function positionPanel() {
        const modal = getElement('canvasSyncModal');
        if (!modal || modal.style.display !== 'block') return;

        modal.style.position = 'fixed';
        modal.style.left = '50%';
        modal.style.top = '50%';
        modal.style.transform = 'translate(-50%, -50%)';
    }

    function openPanel(options = {}) {
        const modal = getElement('canvasSyncModal');
        if (!modal) return;
        applySettingsToForm();
        renderStatus();
        renderConflictPanel();

        refreshPendingMismatchFromBackground()
            .then(() => maybeHandlePendingMismatchOnPanelOpen())
            .catch(() => { });

        const targetTab = options && options.activeTab ? options.activeTab : activeTabKey;
        setActiveTab(targetTab, { persist: false });
        setFirstSyncFoldOpen(false);
        modal.style.display = 'block';
        updateFloatingProgressVisibility();

        global.requestAnimationFrame(() => {
            positionPanel();
            scheduleBehaviorSubNavSyncFromScroll();
        });

        loadRepoConfigFromStorage().catch((error) => {
            setRepoStatus(textByLang(`读取仓库配置失败：${error && error.message ? error.message : String(error)}`, `Failed to read repository configuration: ${error && error.message ? error.message : String(error)}`), 'error');
        });
    }

    function closePanel() {
        const modal = getElement('canvasSyncModal');
        if (!modal) return;
        if (previewPanelMode) {
            previewPanelMode = '';
            previewConflict = null;
            renderStatus();
            renderConflictPanel();
        }
        modal.style.display = 'none';
        updateFloatingProgressVisibility();
    }

    function bindPanelEvents() {
        if (panelBound) return;
        const modal = getElement('canvasSyncModal');
        if (!modal) return;

        panelBound = true;

        const closeBtn = getElement('canvasSyncModalClose');
        if (closeBtn) closeBtn.addEventListener('click', closePanel);

        const tokenGuideBtn = getElement('canvasSyncTokenGuideBtn');
        if (tokenGuideBtn) tokenGuideBtn.addEventListener('click', openTokenGuidePage);

        const officialPluginBtn = getElement('canvasSyncOfficialPluginBtn');
        if (officialPluginBtn) officialPluginBtn.addEventListener('click', openOfficialPluginPage);

        const firstSyncFoldSummary = getElement('canvasSyncFirstSyncFoldSummary');
        if (firstSyncFoldSummary) {
            firstSyncFoldSummary.addEventListener('click', () => {
                const firstSyncPanel = getElement('canvasSyncFirstSyncPanel');
                const isOpen = !!(firstSyncPanel && !firstSyncPanel.hidden);
                setFirstSyncFoldOpen(!isOpen);
            });
        }

        bindTabButton('canvasSyncTabRepoBtn', 'repo');
        bindTabButton('canvasSyncTabBehaviorBtn', 'behavior');
        bindTabButton('canvasSyncTabStatusBtn', 'status');
        bindBehaviorSubNavButtons();
        setActiveTab(activeTabKey, { persist: false });

        const repoSaveBtn = getElement('canvasSyncRepoSaveBtn');
        if (repoSaveBtn) {
            repoSaveBtn.addEventListener('click', async () => {
                const testBtnEl = getElement('canvasSyncRepoTestBtn');
                try {
                    repoSaveBtn.disabled = true;
                    if (testBtnEl) testBtnEl.disabled = true;

                    setRepoStatus(textByLang('正在保存仓库配置...', 'Saving repository configuration...'), 'neutral');
                    await saveRepoConfigFromForm();

                    setRepoStatus(textByLang('配置已保存，正在自动测试连接...', 'Configuration saved, testing connection automatically...'), 'neutral');
                    const config = collectRepoConfigFromForm();
                    const testResult = await testRepoConfig(config);
                    if (!confirmMissingBranchAutoCreate(testResult, config)) {
                        setRepoStatus(textByLang('已取消保存：请先修改分支名或保持当前配置', 'Save cancelled: update the branch name first or keep the current config'), 'neutral');
                        return;
                    }
                    const wasEnabled = await persistVerifiedRepoConfigAndEnableSync(config);

                    focusFirstSyncSetup();
                    toast(textByLang(
                        testResult && testResult.branchWillBeCreated
                            ? '保存并测试成功：首次同步时将自动创建该分支，并已跳转到首次同步策略'
                            : (wasEnabled
                                ? '保存并测试成功，已跳转到首次同步策略'
                                : '保存并测试成功，已启用同步并跳转到首次同步策略'),
                        testResult && testResult.branchWillBeCreated
                            ? 'Saved and tested successfully: the branch will be created automatically on first sync, and the first-sync setup is now focused'
                            : (wasEnabled
                                ? 'Saved and tested successfully, redirected to first sync strategy'
                                : 'Saved and tested successfully, sync enabled and redirected to first sync strategy')
                    ));
                } catch (error) {
                    const text = error && error.message ? error.message : String(error);
                    setRepoStatus(textByLang(`保存或检测失败：${text}`, `Save or test failed: ${text}`), 'error');
                    toast(textByLang(`保存或检测失败：${text}`, `Save or test failed: ${text}`));
                } finally {
                    repoSaveBtn.disabled = false;
                    if (testBtnEl) testBtnEl.disabled = false;
                }
            });
        }

        const repoTestBtn = getElement('canvasSyncRepoTestBtn');
        if (repoTestBtn) {
            repoTestBtn.addEventListener('click', async () => {
                try {
                    repoTestBtn.disabled = true;
                    setRepoStatus(textByLang('正在测试连接，请稍候...', 'Testing connection, please wait...'), 'neutral');
                    const config = collectRepoConfigFromForm();
                    const testResult = await testRepoConfig(config);
                    if (!confirmMissingBranchAutoCreate(testResult, config)) {
                        setRepoStatus(textByLang('已取消保存：请先修改分支名后再测试', 'Save cancelled: update the branch name first, then test again'), 'neutral');
                        return;
                    }
                    const wasEnabled = await persistVerifiedRepoConfigAndEnableSync(config);

                    toast(textByLang(
                        testResult && testResult.branchWillBeCreated
                            ? '仓库连接测试成功：首次同步时将自动创建该分支'
                            : (wasEnabled
                                ? '仓库连接测试成功'
                                : '仓库连接测试成功，已自动启用同步'),
                        testResult && testResult.branchWillBeCreated
                            ? 'Repository connection test succeeded: the branch will be created automatically on first sync'
                            : (wasEnabled
                                ? 'Repository connection test succeeded'
                                : 'Repository connection test succeeded, sync has been enabled automatically')
                    ));
                } catch (error) {
                    const text = error && error.message ? error.message : String(error);
                    setRepoStatus(textByLang(`连接失败：${text}`, `Connection failed: ${text}`), 'error');
                    toast(textByLang(`仓库连接测试失败：${text}`, `Repository connection test failed: ${text}`));
                } finally {
                    repoTestBtn.disabled = false;
                }
            });
        }

	        [
	            'canvasSyncEnabledToggle',
	            'canvasSyncAutoToggle',
	            'canvasSyncAutoAfterEditStopToggle',
	            'canvasSyncIntervalInput',
	            'canvasSyncSplitIntervalsToggle',
	            'canvasSyncFirstSyncModeAutoInput',
	            'canvasSyncFirstSyncModeCloudInput',
	            'canvasSyncFirstSyncModeLocalInput',
	            'canvasSyncPermanentModeAutoInput',
	            'canvasSyncPermanentModeCloudInput',
	            'canvasSyncPermanentModeLocalInput',
	            'canvasSyncPermanentTreeIntervalSelect',
	            'canvasSyncTempSectionIntervalInput',
	            'canvasSyncMdNodeIntervalInput',
	            'canvasSyncAutoPushIntervalInput',
            'canvasSyncAutoPullIntervalInput',
            'canvasSyncForegroundCheckToggle',
            'canvasSyncForegroundCheckIntervalInput',
            'canvasSyncBackgroundCheckToggle',
            'canvasSyncBackgroundCheckIntervalInput',
            'canvasSyncBackgroundCooldownInput',
            'canvasSyncMismatchPolicySelect',
            'canvasSyncPullOnStartupToggle',
            'canvasSyncPushOnSyncToggle',
            'canvasSyncPullOnSyncToggle',
            'canvasSyncHideNoChangeNoticeToggle',
            'canvasSyncMethodSelect',
            'canvasSyncConflictSelect',
            'canvasSyncDeleteThresholdInput',
            'canvasSyncPermanentPullModeSelect',
            'canvasSyncPermanentIncrementalThresholdInput',
            'canvasSyncObsidianFilePushToggle',
            'canvasSyncObsidianExportFormatSelect',
            'canvasSyncObsidianExportRootInput'
        ].forEach((id) => {
            const el = getElement(id);
            if (!el) return;
            el.addEventListener('change', () => {
                pullSettingsFromForm();
                toast(textByLang('同步设置已保存', 'Sync settings saved'));
            });
        });

        const syncNowBtn = getElement('canvasSyncNowBtn');
        if (syncNowBtn) {
            syncNowBtn.addEventListener('click', () => {
                void runWithButtonBusy(syncNowBtn, () => runSync('full', 'manual'));
            });
        }

        const pushOnlyBtn = getElement('canvasSyncPushOnlyBtn');
        if (pushOnlyBtn) {
            pushOnlyBtn.addEventListener('click', () => {
                void runWithButtonBusy(pushOnlyBtn, () => runSync('push', 'manual-push'));
            });
        }

        const pullOnlyBtn = getElement('canvasSyncPullOnlyBtn');
        if (pullOnlyBtn) {
            pullOnlyBtn.addEventListener('click', () => {
                void runWithButtonBusy(pullOnlyBtn, () => runSync('pull', 'manual-pull'));
            });
        }

        const rebuildBtn = getElement('canvasSyncRebuildBtn');
        if (rebuildBtn) {
            rebuildBtn.addEventListener('click', () => {
                void runWithButtonBusy(rebuildBtn, async () => {
                    runtime = Object.assign({}, DEFAULT_RUNTIME);
                    clearPendingConflict();
                    setSyncMetaRaw(OBSIDIAN_FILE_HASHES_KEY, null);
                    saveRuntime();
                    renderStatus();
                    renderConflictPanel();
                    toast(textByLang('同步状态已刷新', 'Sync state refreshed'));
                });
            });
        }

        const runBgCheckBtn = getElement('canvasSyncRunBgCheckBtn');
        if (runBgCheckBtn) {
            runBgCheckBtn.addEventListener('click', async () => {
                try {
                    runBgCheckBtn.disabled = true;
                    await sendRuntimeMessage({ action: 'canvasGitSyncRunBackgroundCheckNow' }, 12000);
                    await refreshPendingMismatchFromBackground();
                    renderStatus();
                    renderConflictPanel();
                    if (runtime.pendingMismatch) {
                        setActiveTab('status');
                        await maybeHandlePendingMismatchOnPanelOpen();
                        toast(textByLang('后台检查完成：检测到云端不一致', 'Background check completed: remote mismatch detected'));
                    } else {
                        toast(textByLang('后台检查完成：当前未检测到不一致', 'Background check completed: no mismatch detected'));
                    }
                } catch (error) {
                    toast(textByLang(
                        `后台检查失败：${error && error.message ? error.message : String(error)}`,
                        `Background check failed: ${error && error.message ? error.message : String(error)}`
                    ));
                } finally {
                    runBgCheckBtn.disabled = false;
                }
            });
        }

        const previewMismatchBtn = getElement('canvasSyncPreviewMismatchBtn');
        if (previewMismatchBtn) {
            previewMismatchBtn.addEventListener('click', () => {
                setPreviewPanelMode('mismatch');
                setActiveTab('status');
                scrollStatusPanelToPreview('mismatch');
                toast(textByLang('已打开“云端不一致面板”预览', 'Remote mismatch panel preview opened'));
            });
        }

        const previewConflictBtn = getElement('canvasSyncPreviewConflictBtn');
        if (previewConflictBtn) {
            previewConflictBtn.addEventListener('click', () => {
                setPreviewPanelMode('conflict');
                setActiveTab('status');
                scrollStatusPanelToPreview('conflict');
                toast(textByLang('已打开“冲突面板”预览', 'Conflict panel preview opened'));
            });
        }

        const firstSyncOverwriteBtn = getElement('canvasSyncFirstSyncOverwriteBtn');
        const firstSyncPathCheckBtn = getElement('canvasSyncFirstSyncPathCheckBtn');
        if (firstSyncPathCheckBtn) {
            firstSyncPathCheckBtn.addEventListener('click', async () => {
                pullSettingsFromForm();
                const confirmed = await requestFirstSyncPathValidation({ continueAfterConfirm: false });
                if (!confirmed) return;
                toast(textByLang(
                    `路径校验完成：${settings.obsidianExportRoot || '仓库根目录'}`,
                    `Path check completed: ${settings.obsidianExportRoot || 'repository root'}`
                ));
            });
        }

        if (firstSyncOverwriteBtn) {
            firstSyncOverwriteBtn.addEventListener('click', () => {
                void (async () => {
                    pullSettingsFromForm();
                    if (!isFirstSyncPathValidated()) {
                        const pathConfirmed = await requestFirstSyncPathValidation({ continueAfterConfirm: true });
                        if (!pathConfirmed) {
                            toast(textByLang('请先完成路径校验后再执行首次同步', 'Please complete path validation before running first sync'));
                            return;
                        }
                    }
                    await runWithButtonBusy(firstSyncOverwriteBtn, () => runFirstSyncCloudOverwrite());
                })();
            });
        }

        const conflictUseLocalBtn = getElement('canvasSyncConflictUseLocalBtn');
        if (conflictUseLocalBtn) {
            conflictUseLocalBtn.addEventListener('click', () => {
                resolvePendingConflict('local');
            });
        }

        const conflictUseRemoteBtn = getElement('canvasSyncConflictUseRemoteBtn');
        if (conflictUseRemoteBtn) {
            conflictUseRemoteBtn.addEventListener('click', () => {
                resolvePendingConflict('remote');
            });
        }

        const conflictDismissBtn = getElement('canvasSyncConflictDismissBtn');
        if (conflictDismissBtn) {
            conflictDismissBtn.addEventListener('click', () => {
                if (isConflictPreviewActive()) {
                    setPreviewPanelMode('');
                    toast(textByLang('已关闭“冲突面板”预览', 'Conflict panel preview closed'));
                    return;
                }
                toast(textByLang('冲突已保留，自动同步暂停，待你手动选择后恢复', 'Conflict kept. Auto sync is paused until you resolve it manually'));
                closePanel();
            });
        }

        const mismatchUseRemoteBtn = getElement('canvasSyncMismatchUseRemoteBtn');
        if (mismatchUseRemoteBtn) {
            mismatchUseRemoteBtn.addEventListener('click', () => {
                if (runtime.isRunning) {
                    toast(textByLang('正在同步，请稍后', 'Sync is running, please wait'));
                    return;
                }
                void runWithButtonBusy(mismatchUseRemoteBtn, async () => {
                    if (runtime.isRunning) {
                        toast(textByLang('正在同步，请稍后', 'Sync is running, please wait'));
                        renderMismatchPanel();
                        return false;
                    }
                    const ok = await resolvePendingMismatchBySync('pull', 'mismatch-panel-pull');
                    if (!ok) {
                        toast(textByLang('与云端对齐失败，请检查错误后重试', 'Failed to align with cloud; check errors and retry'));
                    }
                    renderMismatchPanel();
                    return ok;
                });
            });
        }

        const mismatchUseLocalBtn = getElement('canvasSyncMismatchUseLocalBtn');
        if (mismatchUseLocalBtn) {
            mismatchUseLocalBtn.addEventListener('click', () => {
                if (runtime.isRunning) {
                    toast(textByLang('正在同步，请稍后', 'Sync is running, please wait'));
                    return;
                }
                void runWithButtonBusy(mismatchUseLocalBtn, async () => {
                    if (runtime.isRunning) {
                        toast(textByLang('正在同步，请稍后', 'Sync is running, please wait'));
                        renderMismatchPanel();
                        return false;
                    }
                    const ok = await resolvePendingMismatchBySync('push', 'mismatch-panel-push');
                    if (!ok) {
                        toast(textByLang('本地覆盖云端失败，请检查错误后重试', 'Failed to overwrite cloud with local; check errors and retry'));
                    }
                    renderMismatchPanel();
                    return ok;
                });
            });
        }

        const mismatchDismissBtn = getElement('canvasSyncMismatchDismissBtn');
        if (mismatchDismissBtn) {
            mismatchDismissBtn.addEventListener('click', () => {
                if (isMismatchPreviewActive()) {
                    setPreviewPanelMode('');
                    toast(textByLang('已关闭“云端不一致面板”预览', 'Remote mismatch panel preview closed'));
                    return;
                }
                toast(textByLang('已保留“云端不一致待处理”状态', 'Pending remote mismatch is kept'));
                closePanel();
            });
        }

        modal.addEventListener('click', (event) => {
            if (event.target === modal) closePanel();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            const currentModal = getElement('canvasSyncModal');
            if (currentModal && currentModal.style.display === 'block') {
                closePanel();
            }
        });

        global.addEventListener('resize', () => {
            const currentModal = getElement('canvasSyncModal');
            if (!currentModal || currentModal.style.display !== 'block') return;
            global.requestAnimationFrame(() => {
                positionPanel();
                scheduleBehaviorSubNavSyncFromScroll();
            });
        });

        global.addEventListener('online', () => {
            if (!settings.enabled || !settings.autoSync || hasPendingConflict()) return;
            scheduleSync('online', { immediate: true });
        });

        global.addEventListener('offline', () => {
            runtime.lastError = textByLang('当前离线，已暂停云端同步，恢复网络后自动重试', 'Offline now. Remote sync paused and will retry when network is back');
            saveRuntime();
            renderStatus();
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            restartForegroundMismatchTimer();
            void refreshPendingMismatchFromBackground()
                .then(() => maybePromptPendingMismatchOnInit())
                .catch(() => { });
        });
    }

    async function init() {
        try {
            await hydrateSyncMetaStorage();
        } catch (_) { }

        settings = loadSettings();
        runtime = loadRuntime();
        // Foreground sync cannot survive a page reload; stale persisted running state would
        // disable all action buttons and suppress mismatch prompts incorrectly.
        runtime.isRunning = false;
        runtime.pendingMismatch = runtime.pendingMismatch === true;
        runtime.pendingMismatchAt = Number(runtime.pendingMismatchAt) || 0;
        runtime.pendingMismatchRemoteSha = String(runtime.pendingMismatchRemoteSha || '');
        runtime.lastLocalFilesSha = String(runtime.lastLocalFilesSha || '');
        if (!runtime.lastLocalFilesSha) {
            const prevSyncIndex = loadPrevSyncIndex();
            const prevFiles = prevSyncIndex && prevSyncIndex.files && typeof prevSyncIndex.files === 'object'
                ? prevSyncIndex.files
                : {};
            runtime.lastLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes())
                || buildLocalObsidianRevisionFromEntries(Object.keys(prevFiles).map((path) => ({
                    path,
                    hash: prevFiles[path] && prevFiles[path].hash
                })))
                || '';
        }
        runtime.lastCheckRemoteSha = String(runtime.lastCheckRemoteSha || '');
        runtime.queueLength = hasLocalDirtyWork() ? Math.max(1, Number(runtime.queueLength) || 0) : 0;
        activeTabKey = loadActiveTab();
        repoConfig = normalizeRepoConfig({});
        pendingConflict = loadPendingConflict();
        runtime.hasPendingConflict = !!pendingConflict;

        bindPanelEvents();
        applySettingsToForm();
        applyRepoConfigToForm();
        loadRepoConfigFromStorage().catch(() => { });
        renderConflictPanel();
        renderStatus();
        restartAutomationTimers();
        scheduleStartupPull();

        refreshPendingMismatchFromBackground()
            .then(() => maybeHandlePendingMismatchAutoPull())
            .then(() => maybePromptPendingConflictOnInit())
            .then(() => maybePromptPendingMismatchOnInit())
            .catch(() => { });

        void updateBackgroundSyncContext('init', {
            isRunning: runtime.isRunning,
            queueLength: runtime.queueLength,
            pendingMismatch: runtime.pendingMismatch,
            pendingMismatchAt: runtime.pendingMismatchAt,
            pendingMismatchRemoteSha: runtime.pendingMismatchRemoteSha,
            lastRemoteSha: runtime.lastRemoteSha,
            lastCheckRemoteSha: runtime.lastCheckRemoteSha,
            lastLocalHash: runtime.lastLocalHash,
            lastSuccessAt: runtime.lastSuccessAt
        });
    }

    const syncApi = {
        openPanel,
        closePanel,
        requestSyncNow: (trigger) => runSync('full', trigger || 'manual'),
        runFirstSyncCloudOverwrite,
        readRemoteSnapshotForImport,
        markDirty: (reason, options) => {
            updateDirtyStateByReason(reason, options || {});
            const effectiveSettings = settings || loadSettings();
            if (!effectiveSettings || effectiveSettings.syncAfterEditStop === false) {
                return;
            }
            scheduleSync(reason || 'save', options || {});
        },
        getSettings: () => Object.assign({}, settings || loadSettings()),
        updateSettings: (patch) => {
            settings = Object.assign({}, settings || loadSettings(), patch || {});
            settings.conflictPolicy = ensureConflictPolicy(settings.conflictPolicy);
            settings.syncMethod = ensureSyncMethod(settings.syncMethod);
            settings.syncAfterEditStop = settings.syncAfterEditStop !== false;
            settings.splitIntervalCommitAndSync = !!settings.splitIntervalCommitAndSync;
            settings.autoPushIntervalMinutes = normalizeSplitIntervalMinutes(settings.autoPushIntervalMinutes, DEFAULT_SETTINGS.autoPushIntervalMinutes);
            settings.autoPullIntervalMinutes = normalizeSplitIntervalMinutes(settings.autoPullIntervalMinutes, DEFAULT_SETTINGS.autoPullIntervalMinutes);
            settings.mismatchPolicy = ensureMismatchPolicy(settings.mismatchPolicy);
            settings.foregroundCheckEnabled = settings.foregroundCheckEnabled !== false;
            settings.foregroundCheckIntervalSeconds = normalizeForegroundCheckSeconds(
                settings.foregroundCheckIntervalSeconds,
                DEFAULT_SETTINGS.foregroundCheckIntervalSeconds
            );
            settings.backgroundCheckEnabled = settings.backgroundCheckEnabled !== false;
            settings.backgroundCheckIntervalMinutes = normalizeBackgroundMinutes(
                settings.backgroundCheckIntervalMinutes,
                DEFAULT_SETTINGS.backgroundCheckIntervalMinutes,
                1
            );
            settings.backgroundCooldownMinutes = normalizeBackgroundMinutes(
                settings.backgroundCooldownMinutes,
                DEFAULT_SETTINGS.backgroundCooldownMinutes,
                1
            );
            settings.pullOnStartup = !!settings.pullOnStartup;
            settings.pushOnSync = settings.pushOnSync !== false;
            settings.pullOnSync = settings.pullOnSync !== false;
            settings.hideNoChangeNotice = !!settings.hideNoChangeNotice;
            settings.firstSyncMode = ensureFirstSyncMode(settings.firstSyncMode);
            settings.permanentPullMode = ensurePermanentPullMode(settings.permanentPullMode);
            settings.permanentIncrementalMaxChanges = normalizePermanentIncrementalMaxChanges(
                settings.permanentIncrementalMaxChanges,
                DEFAULT_SETTINGS.permanentIncrementalMaxChanges
            );
            settings.permanentTreeUploadIntervalSeconds = normalizePermanentTreeUploadIntervalSeconds(
                settings.permanentTreeUploadIntervalSeconds,
                DEFAULT_SETTINGS.permanentTreeUploadIntervalSeconds
            );
            settings.tempSectionUploadIntervalSeconds = normalizeCustomUploadIntervalSeconds(
                settings.tempSectionUploadIntervalSeconds,
                DEFAULT_SETTINGS.tempSectionUploadIntervalSeconds
            );
            settings.blankSectionUploadIntervalSeconds = normalizeCustomUploadIntervalSeconds(
                settings.blankSectionUploadIntervalSeconds,
                DEFAULT_SETTINGS.blankSectionUploadIntervalSeconds
            );
            settings.obsidianFilePushEnabled = settings.obsidianFilePushEnabled !== false;
            settings.obsidianExportFormat = normalizeObsidianExportFormat(
                settings.obsidianExportFormat,
                DEFAULT_SETTINGS.obsidianExportFormat
            );
            settings.obsidianExportRoot = normalizeObsidianExportRoot(
                settings.obsidianExportRoot,
                DEFAULT_SETTINGS.obsidianExportRoot,
                { allowEmpty: true }
            );
            saveSettings();
            applySettingsToForm();
            restartAutomationTimers();
            scheduleStartupPull();
            renderStatus();
            void updateBackgroundSyncContext('settings-update', {
                isRunning: runtime && runtime.isRunning,
                queueLength: runtime && runtime.queueLength,
                pendingMismatch: runtime && runtime.pendingMismatch,
                pendingMismatchAt: runtime && runtime.pendingMismatchAt,
                lastRemoteSha: runtime && runtime.lastRemoteSha,
                lastLocalHash: runtime && runtime.lastLocalHash,
                lastSuccessAt: runtime && runtime.lastSuccessAt
            });
        }
,
        refreshI18n: () => {
            renderStatus();
            renderConflictPanel();
            updateStatusPanelActionPlacement();
        }
    };

    global.CanvasObsidianGitSync = syncApi;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            void init();
        });
    } else {
        void init();
    }
})(window);
