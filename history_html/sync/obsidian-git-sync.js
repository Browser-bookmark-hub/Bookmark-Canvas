(function (global) {
    const SETTINGS_KEY = 'canvas-obsidian-git-sync-settings-v1';
    const RUNTIME_KEY = 'canvas-obsidian-git-sync-runtime-v1';
    const CONFLICT_LOG_KEY = 'canvas-obsidian-git-sync-conflicts-v1';
    const PENDING_CONFLICT_KEY = 'canvas-obsidian-git-sync-pending-conflict-v1';
    const RECOVERY_KEY = 'canvas-obsidian-git-sync-recovery-v1';
    const ACTIVE_RUN_RECOVERY_KEY = 'canvas-obsidian-git-sync-active-run-v1';
    const RECOVERY_LOCK_KEY = 'canvas-obsidian-git-sync-recovery-lock-v1';
    const CLIENT_ID_KEY = 'canvas-obsidian-git-sync-client-id-v1';
    const TAB_ACTIVE_KEY = 'canvas-obsidian-git-sync-active-tab-v1';
    const OBSIDIAN_FILE_HASHES_KEY = 'canvas-obsidian-git-sync-obsidian-file-hashes-v1';
    const LAST_UPLOADED_TEMP_STATE_KEY = 'canvas-obsidian-git-sync-last-uploaded-temp-state-v1';
    const LAST_SYNC_EXPORT_FORMAT_KEY = 'canvas-obsidian-git-sync-last-export-format-v1';
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
        LAST_SYNC_EXPORT_FORMAT_KEY,
        DIRTY_STATE_KEY,
        PATH_MAP_KEY,
        PREV_SYNC_INDEX_KEY,
        ACTIVE_RUN_RECOVERY_KEY,
        RECOVERY_LOCK_KEY
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
        { buttonId: 'canvasSyncBehaviorSubPluginBtn', targetId: 'canvasSyncPluginSectionTitle' }
    ];
    const BEHAVIOR_SUBNAV_COMPAT_CONFIG = [];
    const STATUS_SUBNAV_CONFIG = [
        { buttonId: 'canvasSyncStatusSubActionsBtn', targetId: 'canvasSyncStatusActionsSectionTitle' },
        { buttonId: 'canvasSyncStatusSubConfigBtn', targetId: 'canvasSyncStatusConfigSectionTitle' },
        { buttonId: 'canvasSyncStatusSubRuntimeBtn', targetId: 'canvasSyncStatusRuntimeSectionTitle' }
    ];

    const TEMP_SECTION_STORAGE_KEY = 'bcs:temp-state-snapshot';
    const BCS_META_KEY = 'bcs:meta';
    const BCS_CANVAS_KEY = 'bcs:canvas';
    const BCS_SECTION_PREFIX = 'bcs:section:';
    const BCS_MD_PREFIX = 'bcs:md:';
    const BCS_PERM_MAIN_KEY = 'bcs:perm:main';
    const BCS_PERM_COPY_PREFIX = 'bcs:perm:copy-';

    const SYNC_KEYS = [
        TEMP_SECTION_STORAGE_KEY,
        'canvas-appearance-settings-v1',
        'canvas-other-settings-v1'
    ];

    const CONFLICT_POLICIES = new Set(['none', 'ours', 'theirs', 'newer']);
    const SYNC_METHODS = new Set(['merge', 'rebase', 'reset']);
    const FIRST_SYNC_MODES = new Set(['auto', 'cloud', 'local']);
    const PERMANENT_PULL_MODES = new Set(['auto', 'overwrite', 'incremental']);
    const RECOVERY_SNAPSHOT_KEEP_LATEST = 1;
    const DEFAULT_PERMANENT_INCREMENTAL_MAX_LOGICAL_CHANGES_ABS = 200;
    const PERMANENT_TREE_UPLOAD_INTERVALS = new Set([0, 5, 15, 30, 60]);
    const OBSIDIAN_EXPORT_FORMATS = new Set(['visual', 'visual-no-icon', 'json']);
    const RECOVERY_SNAPSHOT_IDLE_REASON = 'idle-periodic-backup';
    const RECOVERY_SNAPSHOT_MANUAL_REASON = 'manual-backup';
    const CUSTOM_UPLOAD_INTERVAL_SECONDS_RANGE = { min: 0, max: 24 * 60 * 60 };
    const SYNC_FILE_TOO_LARGE_ERROR_CODE = 'SYNC_FILE_TOO_LARGE';
    const OVERSIZE_SYNC_DIALOG_COOLDOWN_MS = 30 * 1000;
    const ACTIVE_RUN_RECOVERY_AUTO_RESUME_DELAY_MS = 1200;
    const ACTIVE_RUN_RECOVERY_MAX_RESUME_COUNT = 3;
    const ACTIVE_RUN_RECOVERY_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
    const RECOVERY_BUNDLE_DB_NAME = 'canvas-obsidian-git-sync-recovery-db-v1';
    const RECOVERY_BUNDLE_STORE_NAME = 'recovery-bundles';
    const RECOVERY_BUNDLE_ACTIVE_KEY = 'active';
    const RECOVERY_LOCK_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
    const USER_INTERACTION_IDLE_GRACE_MS = 1200;
    const FOREGROUND_ACTIVITY_THROTTLE_MS = 80;
    const TEMP_STATE_CACHE_MAX_ENTRIES = 12;

    const DEFAULT_SETTINGS = {
        enabled: false,
        toastEnabled: true,
        firstSyncMode: 'auto',
        permanentPullMode: 'auto',
        permanentIncrementalMaxChanges: DEFAULT_PERMANENT_INCREMENTAL_MAX_LOGICAL_CHANGES_ABS,
        permanentTreeUploadIntervalSeconds: 15,
        tempSectionUploadIntervalSeconds: 3,
        blankSectionUploadIntervalSeconds: 3,
        obsidianFilePushEnabled: true,
        obsidianExportFormat: 'json',
        obsidianExportRoot: '书签画布',
        firstSyncPathVerifiedRoot: '',
        firstSyncPathVerifiedAt: 0,
        syncMethod: 'merge',
        conflictPolicy: 'none'
    };

    const DEFAULT_RUNTIME = {
        isRunning: false,
        queueLength: 0,
        lastSuccessAt: 0,
        lastError: '',
        lastTrigger: '',
        lastRemoteSha: '',
        lastLocalHash: '',
        lastPermanentSectionHash: '',
        lastOtherSyncDataHash: '',
        lastLocalFilesSha: '',
        lastCheckRemoteSha: '',
        lastAppliedDirection: '',
        lastSyncMode: '',
        lastLocalMutationAt: 0,
        lastRemoteCommittedAt: 0,
        lastRemoteSignalSha: '',
        lastPermanentTreeSnapshotAt: 0,
        lastTempSectionSnapshotAt: 0,
        lastObsidianPushAt: 0,
        lastBlankSectionFilePushAt: 0,
        lastObsidianPushChanged: 0,
        lastObsidianPushTotal: 0,
        hasPendingConflict: false
    };

    let settings = null;
    let runtime = null;
    let pendingConflict = null;
    let conflictFineModeEnabled = false;
    let conflictFineChoiceByPath = {};
    let panelBound = false;
    let repoConfig = null;
    let activeTabKey = DEFAULT_ACTIVE_TAB;
    let conflictPromptShownOnInit = false;
    let previewPanelMode = '';
    let previewConflict = null;
    let behaviorSubNavScrollRaf = null;
    let statusSubNavScrollRaf = null;
    let oversizeSyncDialogLastAt = 0;
    let oversizeSyncDialogLastKey = '';
    let lastRecoverySnapshotWarningAt = 0;
    let syncMetaStorageHydrated = false;
    let syncMetaStorageChangeBound = false;
    let syncMetaStorageCache = Object.create(null);
    let syncMetaPendingSet = Object.create(null);
    let syncMetaPendingRemove = new Set();
    let syncMetaWriteTimer = null;
    const pendingReasons = new Set();
    let floatingProgressEl = null;
    let floatingProgressLabelEl = null;
    let floatingProgressPercentEl = null;
    let floatingProgressHintEl = null;
    let floatingProgressActive = false;
    let floatingProgressMessage = '';
    let floatingProgressPercent = null;
    let floatingProgressDisplayReady = false;
    let floatingProgressDelayTimer = null;
    let syncUiProgressEnabled = false;
    let syncUiProgressButtonEl = null;
    let lastUserDirtyAt = 0;
    let remoteCommittedAtRefreshPromise = null;
    let latestConflictComparisonSummary = null;
    let syncActionStaleCheckTimer = null;
    let syncActionStaleCheckScheduled = false;
    let activeRunRecoveryResumeTimer = null;
    let recoveryLockState = null;
    let recoveryLockResumeInFlight = false;
    let syncActionDialogCleanup = null;
    let lastForegroundUserInteractionAt = 0;
    const tempStateNormalizedRawCache = new Map();
    const tempStateComparableCache = new Map();

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

    function normalizeActiveRunRecoveryMode(value) {
        const mode = String(value || '').trim().toLowerCase();
        if (mode === 'full' || mode === 'push' || mode === 'pull' || mode === 'first-sync-cloud') {
            return mode;
        }
        return '';
    }

    function normalizeActiveRunRecoveryRecord(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            version: 1,
            status: source.status === 'interrupted' ? 'interrupted' : (source.status === 'running' ? 'running' : ''),
            mode: normalizeActiveRunRecoveryMode(source.mode),
            trigger: String(source.trigger || '').trim(),
            manual: source.manual === true,
            startedAt: Math.max(0, Number(source.startedAt) || 0),
            updatedAt: Math.max(0, Number(source.updatedAt) || 0),
            interruptedAt: Math.max(0, Number(source.interruptedAt) || 0),
            interruptionReason: String(source.interruptionReason || '').trim(),
            resumeCount: Math.max(0, Number(source.resumeCount) || 0),
            lastKnownQueueLength: Math.max(0, Number(source.lastKnownQueueLength) || 0),
            lastKnownDirtySummary: String(source.lastKnownDirtySummary || '').trim()
        };
    }

    function readRawActiveRunRecoveryStorage() {
        try {
            const localRaw = String(localStorage.getItem(ACTIVE_RUN_RECOVERY_KEY) || '').trim();
            if (localRaw) return localRaw;
        } catch (_) { }
        return String(getSyncMetaRaw(ACTIVE_RUN_RECOVERY_KEY) || '').trim();
    }

    function loadActiveRunRecoveryRecord() {
        const raw = readRawActiveRunRecoveryStorage();
        if (!raw) return null;
        const parsed = safeParse(raw, null);
        const normalized = normalizeActiveRunRecoveryRecord(parsed);
        if (!normalized.status || !normalized.mode) return null;
        return normalized;
    }

    function clearActiveRunRecoveryRecord() {
        try {
            localStorage.removeItem(ACTIVE_RUN_RECOVERY_KEY);
        } catch (_) { }
        setSyncMetaRaw(ACTIVE_RUN_RECOVERY_KEY, null);
    }

    function persistActiveRunRecoveryRecord(record) {
        const normalized = normalizeActiveRunRecoveryRecord(record);
        if (!normalized.status || !normalized.mode) {
            clearActiveRunRecoveryRecord();
            return null;
        }

        const raw = JSON.stringify(normalized);
        try {
            localStorage.setItem(ACTIVE_RUN_RECOVERY_KEY, raw);
        } catch (_) { }
        setSyncMetaRaw(ACTIVE_RUN_RECOVERY_KEY, raw);
        return normalized;
    }

    function clearActiveRunRecoveryResumeTimer() {
        if (activeRunRecoveryResumeTimer) {
            clearTimeout(activeRunRecoveryResumeTimer);
            activeRunRecoveryResumeTimer = null;
        }
    }

    function beginActiveRunRecovery(mode, trigger, options = {}) {
        clearActiveRunRecoveryResumeTimer();
        const normalizedMode = normalizeActiveRunRecoveryMode(mode);
        if (!normalizedMode) return null;

        const previous = loadActiveRunRecoveryRecord();
        const resumeCount = previous && previous.mode === normalizedMode
            ? Math.max(0, Number(previous.resumeCount) || 0) + 1
            : 0;

        return persistActiveRunRecoveryRecord({
            status: 'running',
            mode: normalizedMode,
            trigger: String(trigger || '').trim(),
            manual: options.manual === true,
            startedAt: Date.now(),
            updatedAt: Date.now(),
            interruptedAt: 0,
            interruptionReason: '',
            resumeCount,
            lastKnownQueueLength: Math.max(0, Number(runtime && runtime.queueLength) || 0),
            lastKnownDirtySummary: buildDirtySerialSummary()
        });
    }

    function markActiveRunRecoveryInterrupted(reason = 'pagehide') {
        const current = loadActiveRunRecoveryRecord();
        if (!current || current.status !== 'running') return null;
        const now = Date.now();

        return persistActiveRunRecoveryRecord(Object.assign({}, current, {
            status: 'interrupted',
            updatedAt: now,
            interruptedAt: now,
            interruptionReason: String(reason || 'pagehide').trim() || 'pagehide',
            lastKnownQueueLength: Math.max(0, Number(runtime && runtime.queueLength) || 0),
            lastKnownDirtySummary: buildDirtySerialSummary()
        }));
    }

    function hasPendingActiveRunRecovery(record = null) {
        const current = record ? normalizeActiveRunRecoveryRecord(record) : loadActiveRunRecoveryRecord();
        return !!(current && current.status && current.mode);
    }

    function getActiveRunRecoveryAgeMs(record = null) {
        const current = record ? normalizeActiveRunRecoveryRecord(record) : loadActiveRunRecoveryRecord();
        if (!current) return Number.POSITIVE_INFINITY;
        const baseTs = current.interruptedAt || current.updatedAt || current.startedAt || 0;
        if (!baseTs) return Number.POSITIVE_INFINITY;
        return Math.max(0, Date.now() - baseTs);
    }

    function shouldAutoResumeActiveRunRecovery(record = null) {
        const current = record ? normalizeActiveRunRecoveryRecord(record) : loadActiveRunRecoveryRecord();
        if (!hasPendingActiveRunRecovery(current)) return false;
        // Active-run recovery only records that a foreground sync was interrupted.
        // It does NOT hold a frozen bundle / target package, so auto-rerunning from
        // the current page state can generate a different upload set after reload.
        // Crash recovery must prefer the recovery-lock path only.
        return false;
    }

    function formatActiveRunRecoveryMode(mode) {
        const normalized = normalizeActiveRunRecoveryMode(mode);
        if (normalized === 'push') return textByLang('仅上传', 'Push Only');
        if (normalized === 'pull') return textByLang('仅拉取', 'Pull Only');
        if (normalized === 'first-sync-cloud') return textByLang('首次同步', 'First Sync');
        return textByLang('同步', 'Sync');
    }

    function buildActiveRunRecoveryNotice(record, willAutoResume = false) {
        const current = normalizeActiveRunRecoveryRecord(record);
        const modeText = formatActiveRunRecoveryMode(current.mode);
        const baseZh = `检测到上次${modeText}在页面关闭或浏览器异常后中断`;
        const baseEn = `Detected the previous ${modeText} was interrupted after the page closed or the browser crashed`;
        if (willAutoResume) {
            return textByLang(
                `${baseZh}，已在当前页面恢复；关闭页面不会转到后台继续，请保持当前页面开启直到完成。`,
                `${baseEn}. It has been restored on this page; closing the page will not continue it in the background, so keep this page open until it finishes.`
            );
        }
        return textByLang(
            `${baseZh}。当前不会自动重跑；若看到“继续上次同步/上传/拉取”面板，请按该面板继续。若没有恢复面板，说明中断发生在恢复缓存建立前，请手动重新发起本轮操作。`,
            `${baseEn}. It will not auto-rerun. If a “continue previous sync/upload/pull” panel appears, resume from there. If no recovery panel appears, the interruption happened before a recovery bundle was staged, so restart the action manually.`
        );
    }

    function buildActiveRunRecoveryTrigger(record) {
        const current = normalizeActiveRunRecoveryRecord(record);
        if (current.mode === 'first-sync-cloud') {
            return current.manual ? 'manual-first-sync-recovery' : 'auto-first-sync-recovery';
        }
        if (current.mode === 'push') {
            return current.manual ? 'manual-push-recovery' : 'auto-push-recovery';
        }
        if (current.mode === 'pull') {
            return current.manual ? 'manual-pull-recovery' : 'auto-pull-recovery';
        }
        return current.manual ? 'manual-sync-recovery' : 'auto-sync-recovery';
    }

    function scheduleActiveRunRecoveryResume(reason = 'init') {
        const current = loadActiveRunRecoveryRecord();
        if (!shouldAutoResumeActiveRunRecovery(current)) {
            clearActiveRunRecoveryResumeTimer();
            return false;
        }

        clearActiveRunRecoveryResumeTimer();
        const delayMs = reason === 'init'
            ? ACTIVE_RUN_RECOVERY_AUTO_RESUME_DELAY_MS
            : Math.min(500, ACTIVE_RUN_RECOVERY_AUTO_RESUME_DELAY_MS);

        activeRunRecoveryResumeTimer = setTimeout(() => {
            activeRunRecoveryResumeTimer = null;

            const latest = loadActiveRunRecoveryRecord();
            if (!shouldAutoResumeActiveRunRecovery(latest)) return;

            if (runtime) {
                runtime.lastError = '';
                saveRuntime();
                renderStatus();
            }

            if (latest.mode === 'first-sync-cloud') {
                void runFirstSyncCloudOverwrite(buildActiveRunRecoveryTrigger(latest));
                return;
            }

            void runSync(latest.mode, buildActiveRunRecoveryTrigger(latest));
        }, delayMs);

        return true;
    }

    function maybeRecoverInterruptedRunOnInit() {
        if (isRecoveryLockActive()) return false;
        const recovery = loadActiveRunRecoveryRecord();
        if (!recovery) return false;

        if (getActiveRunRecoveryAgeMs(recovery) > ACTIVE_RUN_RECOVERY_MAX_AGE_MS) {
            clearActiveRunRecoveryRecord();
            return false;
        }

        const willAutoResume = shouldAutoResumeActiveRunRecovery(recovery);
        runtime.lastError = buildActiveRunRecoveryNotice(recovery, willAutoResume);
        saveRuntime();
        renderStatus();
        toast(runtime.lastError);

        // Do not auto-rerun interrupted foreground syncs from current page state.
        // If no recovery lock exists, we no longer have a frozen bundle to replay safely.
        clearActiveRunRecoveryRecord();
        return true;
    }

    function normalizeRecoveryLockKind(value) {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'push-bundle' || raw === 'pull-bundle' || raw === 'conflict-choice') {
            return raw;
        }
        return '';
    }

    function normalizeRecoveryLockStage(value) {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return 'prepared';
        if (
            raw === 'prepared'
            || raw === 'uploading'
            || raw === 'verifying'
            || raw === 'downloaded'
            || raw === 'applying-local'
            || raw === 'applying-permanent'
            || raw === 'finishing'
        ) {
            return raw;
        }
        return 'prepared';
    }

    function normalizeRecoveryLockSourcePanel(value) {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'conflict' || raw === 'first-sync') {
            return raw;
        }
        return 'sync';
    }

    function normalizeRecoveryLockRecord(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const kind = normalizeRecoveryLockKind(source.kind);
        if (!kind) return null;
        return {
            version: 1,
            id: String(source.id || '').trim() || `recovery-${Date.now().toString(36)}`,
            kind,
            sourcePanel: normalizeRecoveryLockSourcePanel(source.sourcePanel),
            trigger: String(source.trigger || '').trim(),
            mode: normalizeActiveRunRecoveryMode(source.mode),
            choice: String(source.choice || '').trim().toLowerCase(),
            stage: normalizeRecoveryLockStage(source.stage),
            targetPackageHash: String(source.targetPackageHash || '').trim(),
            baseRemoteSha: String(source.baseRemoteSha || '').trim(),
            targetRemoteSha: String(source.targetRemoteSha || '').trim(),
            summary: String(source.summary || '').trim(),
            createdAt: Math.max(0, Number(source.createdAt) || 0),
            updatedAt: Math.max(0, Number(source.updatedAt) || 0)
        };
    }

    function isRecoveryLockActive(lock = null) {
        const current = lock ? normalizeRecoveryLockRecord(lock) : recoveryLockState;
        return !!(current && current.kind);
    }

    function getRecoveryLockAgeMs(lock = null) {
        const current = lock ? normalizeRecoveryLockRecord(lock) : normalizeRecoveryLockRecord(recoveryLockState || loadRecoveryLockState());
        if (!current) return Number.POSITIVE_INFINITY;
        const baseTs = Math.max(0, Number(current.updatedAt) || 0, Number(current.createdAt) || 0);
        if (!baseTs) return Number.POSITIVE_INFINITY;
        return Math.max(0, Date.now() - baseTs);
    }

    function mapRecoveryLockSourcePanel(trigger, fallback = 'sync') {
        const text = String(trigger || '').trim().toLowerCase();
        if (text.includes('conflict')) return 'conflict';
        if (text.includes('first-sync')) return 'first-sync';
        return normalizeRecoveryLockSourcePanel(fallback);
    }


    function shouldStagePushRecoveryLockForTrigger(trigger) {
        const text = String(trigger || '').trim().toLowerCase();
        if (!text) return false;
        if (text.includes('conflict')) return false;
        return text === 'manual-push'
            || text === 'manual-push-recovery'
            || text === 'auto-push-recovery';
    }

    function shouldForceRecoveryLockForTrigger(trigger) {
        const text = String(trigger || '').trim().toLowerCase();
        if (!text) return false;
        if (text.startsWith('manual')) return true;
        if (text.startsWith('first-sync')) return true;
        if (text.includes('conflict')) return true;
        if (text.includes('format-migration')) return true;
        if (text.startsWith('recovery-')) return true;
        return false;
    }

    function shouldBlockOrdinarySyncActionsForRecoveryLock() {
        return isRecoveryLockActive() && !recoveryLockResumeInFlight;
    }

    function readRawRecoveryLockStorage() {
        try {
            const localRaw = String(localStorage.getItem(RECOVERY_LOCK_KEY) || '').trim();
            if (localRaw) return localRaw;
        } catch (_) { }
        return String(getSyncMetaRaw(RECOVERY_LOCK_KEY) || '').trim();
    }

    function loadRecoveryLockState() {
        const raw = readRawRecoveryLockStorage();
        if (!raw) return null;
        const parsed = safeParse(raw, null);
        return normalizeRecoveryLockRecord(parsed);
    }

    function persistRecoveryLockState(record) {
        const normalized = normalizeRecoveryLockRecord(record);
        if (!normalized) {
            try { localStorage.removeItem(RECOVERY_LOCK_KEY); } catch (_) { }
            setSyncMetaRaw(RECOVERY_LOCK_KEY, null);
            recoveryLockState = null;
            return null;
        }

        const raw = JSON.stringify(normalized);
        try { localStorage.setItem(RECOVERY_LOCK_KEY, raw); } catch (_) { }
        setSyncMetaRaw(RECOVERY_LOCK_KEY, raw);
        recoveryLockState = normalized;
        return normalized;
    }

    function updateRecoveryLockState(patch) {
        const current = normalizeRecoveryLockRecord(recoveryLockState || loadRecoveryLockState());
        if (!current) return null;
        return persistRecoveryLockState(Object.assign({}, current, patch || {}, {
            updatedAt: Date.now()
        }));
    }

    function openRecoveryBundleDb() {
        return new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open(RECOVERY_BUNDLE_DB_NAME, 1);
                request.onupgradeneeded = () => {
                    try {
                        const db = request.result;
                        if (!db.objectStoreNames.contains(RECOVERY_BUNDLE_STORE_NAME)) {
                            db.createObjectStore(RECOVERY_BUNDLE_STORE_NAME, { keyPath: 'key' });
                        }
                    } catch (_) { }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error || new Error('Recovery bundle IndexedDB open failed'));
            } catch (error) {
                reject(error);
            }
        });
    }

    async function saveRecoveryBundlePayload(payload) {
        if (!global.indexedDB) throw new Error(textByLang('当前环境不支持恢复缓存', 'Recovery staging is unavailable in this environment'));
        const db = await openRecoveryBundleDb();
        await new Promise((resolve, reject) => {
            try {
                const tx = db.transaction([RECOVERY_BUNDLE_STORE_NAME], 'readwrite');
                const store = tx.objectStore(RECOVERY_BUNDLE_STORE_NAME);
                store.put({
                    key: RECOVERY_BUNDLE_ACTIVE_KEY,
                    payload,
                    updatedAt: Date.now()
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('Recovery bundle write failed'));
                tx.onabort = () => reject(tx.error || new Error('Recovery bundle write aborted'));
            } catch (error) {
                reject(error);
            }
        });
        try { db.close(); } catch (_) { }
    }

    async function loadRecoveryBundlePayload() {
        if (!global.indexedDB) return null;
        const db = await openRecoveryBundleDb();
        try {
            const result = await new Promise((resolve, reject) => {
                try {
                    const tx = db.transaction([RECOVERY_BUNDLE_STORE_NAME], 'readonly');
                    const store = tx.objectStore(RECOVERY_BUNDLE_STORE_NAME);
                    const request = store.get(RECOVERY_BUNDLE_ACTIVE_KEY);
                    request.onsuccess = () => resolve(request.result || null);
                    request.onerror = () => reject(request.error || new Error('Recovery bundle read failed'));
                } catch (error) {
                    reject(error);
                }
            });
            return result && result.payload ? result.payload : null;
        } finally {
            try { db.close(); } catch (_) { }
        }
    }

    async function clearRecoveryBundlePayload() {
        if (!global.indexedDB) return;
        const db = await openRecoveryBundleDb();
        await new Promise((resolve, reject) => {
            try {
                const tx = db.transaction([RECOVERY_BUNDLE_STORE_NAME], 'readwrite');
                const store = tx.objectStore(RECOVERY_BUNDLE_STORE_NAME);
                store.delete(RECOVERY_BUNDLE_ACTIVE_KEY);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('Recovery bundle delete failed'));
                tx.onabort = () => reject(tx.error || new Error('Recovery bundle delete aborted'));
            } catch (error) {
                reject(error);
            }
        });
        try { db.close(); } catch (_) { }
    }

    async function clearRecoveryLockCompletely() {
        persistRecoveryLockState(null);
        try {
            await clearRecoveryBundlePayload();
        } catch (_) { }
    }

    async function ensureUsableRecoveryLockState(options = {}) {
        const current = normalizeRecoveryLockRecord(recoveryLockState || loadRecoveryLockState());
        if (!current) {
            recoveryLockState = null;
            return null;
        }

        const shouldRender = options.render !== false;
        const clearInvalidLock = async () => {
            await clearRecoveryLockCompletely();
            handleRecoveryLockReleased();
            if (shouldRender) {
                renderRecoveryLockPanel();
                renderStatus();
                updateSyncEnabledDependentFieldState();
            }
            return null;
        };

        if (getRecoveryLockAgeMs(current) > RECOVERY_LOCK_MAX_AGE_MS) {
            return await clearInvalidLock();
        }

        if (current.kind === 'push-bundle' || current.kind === 'pull-bundle') {
            const expectedBundleKind = current.kind === 'push-bundle' ? 'local-bundle' : 'remote-bundle';
            let stagedBundle = null;
            try {
                stagedBundle = await loadRecoveryBundlePayload();
            } catch (_) {
                stagedBundle = null;
            }
            if (!stagedBundle || typeof stagedBundle !== 'object' || stagedBundle.kind !== expectedBundleKind) {
                return await clearInvalidLock();
            }
        }

        recoveryLockState = current;
        return current;
    }


    function handleRecoveryLockReleased() {
        renderConflictPanel();
        updateStatusPanelActionPlacement();
    }

    function encodeBytesToBase64(bytes) {
        const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
        if (!source.length) return '';
        let binary = '';
        for (let i = 0; i < source.length; i++) {
            binary += String.fromCharCode(source[i]);
        }
        return btoa(binary);
    }

    function normalizeManagedTextBundleEntries(entriesInput) {
        const source = Array.isArray(entriesInput) ? entriesInput : [];
        return source
            .map((entry) => {
                const path = normalizeSyncPath(entry && entry.path);
                if (!path) return null;
                const content = String(entry && entry.content != null ? entry.content : '');
                const meta = normalizeObsidianFileMeta(entry && entry.meta);
                return {
                    path,
                    content,
                    meta,
                    hash: hashString(content)
                };
            })
            .filter(Boolean)
            .sort((left, right) => left.path.localeCompare(right.path));
    }

    function buildManagedTextBundleHash(entriesInput) {
        return buildLocalObsidianRevisionFromEntries(normalizeManagedTextBundleEntries(entriesInput));
    }

    function serializeRemoteFolderFilesMap(folderFiles) {
        const entries = [];
        if (!(folderFiles instanceof Map)) return entries;
        folderFiles.forEach((bytes, path) => {
            const normalizedPath = normalizeSyncPath(path);
            if (!normalizedPath) return;
            entries.push({
                path: normalizedPath,
                contentBase64: encodeBytesToBase64(bytes)
            });
        });
        return entries.sort((left, right) => left.path.localeCompare(right.path));
    }

    function deserializeRemoteFolderFilesEntries(entriesInput) {
        const map = new Map();
        const source = Array.isArray(entriesInput) ? entriesInput : [];
        source.forEach((entry) => {
            const path = normalizeSyncPath(entry && entry.path);
            if (!path) return;
            map.set(path, decodeBase64ToBytes(entry && entry.contentBase64));
        });
        return map;
    }

    function buildManagedTextBundleHashFromRemoteFolderEntries(entriesInput) {
        const source = Array.isArray(entriesInput) ? entriesInput : [];
        const normalized = source.map((entry) => {
            const path = normalizeSyncPath(entry && entry.path);
            if (!path) return null;
            const text = new TextDecoder().decode(decodeBase64ToBytes(entry && entry.contentBase64));
            return {
                path,
                hash: hashString(text)
            };
        }).filter(Boolean);
        return buildLocalObsidianRevisionFromEntries(normalized);
    }

    async function buildCurrentLocalManagedBundleHash() {
        const bridge = global.CanvasObsidianExportBridge;
        if (!bridge || typeof bridge.buildSyncFiles !== 'function') return '';
        const bundle = await bridge.buildSyncFiles({
            exportFormat: settings && settings.obsidianExportFormat,
            exportRoot: settings && settings.obsidianExportRoot
        });
        return buildManagedTextBundleHash(bundle && bundle.files);
    }

    async function buildCurrentRemoteManagedBundleHash(rootPath) {
        const remoteListRaw = await listRemoteObsidianFilesByPath(rootPath || (settings && settings.obsidianExportRoot));
        const remoteList = filterRemoteListForManagedSyncFiles(remoteListRaw, rootPath || (settings && settings.obsidianExportRoot));
        const files = remoteList && Array.isArray(remoteList.files) ? remoteList.files : [];
        if (!files.length) return '';
        const serialized = [];
        for (let i = 0; i < files.length; i++) {
            const path = normalizeSyncPath(files[i] && files[i].path);
            if (!path || (!/\.(md|json)$/i.test(path) && !/\.canvas$/i.test(path))) continue;
            const state = await readRemoteFileAtPath(path);
            if (state.notFound) continue;
            serialized.push({ path, contentBase64: encodeBytesToBase64(state.bytes) });
        }
        return buildManagedTextBundleHashFromRemoteFolderEntries(serialized);
    }


    async function readCurrentRemoteManagedRevision(rootPath) {
        const resolvedRootPath = rootPath || (settings && settings.obsidianExportRoot);
        const remoteListRaw = await listRemoteObsidianFilesByPath(resolvedRootPath);
        const remoteList = filterRemoteListForManagedSyncFiles(remoteListRaw, resolvedRootPath);
        return buildRemoteObsidianRevisionFromList(remoteList);
    }

    function isPushLikeRecoveryLock(lock) {
        return !!(lock && (lock.kind === 'push-bundle' || lock.choice === 'local'));
    }

    function isPullLikeRecoveryLock(lock) {
        return !!(lock && (lock.kind === 'pull-bundle' || lock.choice === 'remote'));
    }

    function buildRecoveryLockTaskLabel(lock) {
        if (!lock) return textByLang('同步', 'Sync');
        if (lock.mode === 'first-sync-cloud' || lock.sourcePanel === 'first-sync') {
            return textByLang('首次同步', 'First Sync');
        }
        if (lock.mode === 'full') {
            return textByLang('同步', 'Sync');
        }
        if (lock.kind === 'conflict-choice') {
            return textByLang('冲突处理', 'Conflict Resolution');
        }
        if (isPushLikeRecoveryLock(lock)) {
            return textByLang('上传', 'Upload');
        }
        if (isPullLikeRecoveryLock(lock)) {
            return textByLang('拉取', 'Pull');
        }
        return textByLang('同步', 'Sync');
    }

    function buildRecoveryLockPhaseLabel(lock) {
        if (!lock) return '';
        if (isPullLikeRecoveryLock(lock)) {
            return textByLang('云端覆盖本地', 'Cloud Overwrite Local');
        }
        if (isPushLikeRecoveryLock(lock)) {
            return textByLang('本地覆盖云端', 'Local Overwrite Cloud');
        }
        return '';
    }

    function buildRecoveryLockContinueText(lock) {
        if (!lock) return textByLang('继续上次操作', 'Continue previous action');
        if (lock.mode === 'first-sync-cloud' || lock.sourcePanel === 'first-sync') {
            return textByLang('继续上次首次同步', 'Continue previous first sync');
        }
        if (lock.mode === 'full') {
            return textByLang('继续上次同步', 'Continue previous sync');
        }
        if (lock.kind === 'conflict-choice') {
            return textByLang('继续上次冲突处理', 'Continue previous conflict resolution');
        }
        if (isPushLikeRecoveryLock(lock)) {
            return textByLang('继续上次上传', 'Continue previous upload');
        }
        if (isPullLikeRecoveryLock(lock)) {
            return textByLang('继续上次拉取', 'Continue previous pull');
        }
        return textByLang('继续上次操作', 'Continue previous action');
    }

    function buildRecoveryLockRollbackText(lock) {
        if (!lock) return textByLang('回滚到开始前状态', 'Rollback to start state');
        if (lock.kind === 'conflict-choice') {
            return textByLang('回滚到冲突处理前状态', 'Rollback to pre-conflict state');
        }
        if (isPullLikeRecoveryLock(lock)) {
            return textByLang('回滚到最近可用快照', 'Rollback to latest available snapshot');
        }
        if (lock.mode === 'first-sync-cloud' || lock.sourcePanel === 'first-sync') {
            return textByLang('回滚到最近可用快照', 'Rollback to latest available snapshot');
        }
        if (lock.mode === 'full') {
            return textByLang('回滚到最近可用快照', 'Rollback to latest available snapshot');
        }
        return textByLang('回滚到开始前状态', 'Rollback to start state');
    }

    function canRollbackRecoveryLock(lock) {
        if (!lock) return false;
        if (lock.kind === 'pull-bundle') return true;
        if (lock.kind === 'conflict-choice' && lock.choice === 'remote') return true;
        return false;
    }

    function buildRecoveryLockTitle(lock) {
        if (!lock) return textByLang('检测到未完成的同步恢复', 'Detected an unfinished sync recovery');
        if (lock.mode === 'first-sync-cloud' || lock.sourcePanel === 'first-sync') {
            return textByLang('检测到未完成的首次同步', 'Detected an unfinished first sync');
        }
        if (lock.mode === 'full') {
            return textByLang('检测到未完成的同步', 'Detected an unfinished sync');
        }
        if (lock.kind === 'conflict-choice') {
            return textByLang('检测到未完成的冲突处理', 'Detected an unfinished conflict resolution');
        }
        if (isPullLikeRecoveryLock(lock)) {
            if (lock.sourcePanel === 'sync' && lock.mode === 'pull') {
                return textByLang('检测到未完成的拉取', 'Detected an unfinished pull');
            }
            return textByLang('检测到未完成的云端覆盖本地', 'Detected an unfinished cloud-overwrite-local action');
        }
        if (isPushLikeRecoveryLock(lock)) {
            if (lock.sourcePanel === 'sync' && lock.mode === 'push') {
                return textByLang('检测到未完成的上传', 'Detected an unfinished upload');
            }
            return textByLang('检测到未完成的本地覆盖云端', 'Detected an unfinished local-overwrite-cloud action');
        }
        return textByLang('检测到未完成的同步恢复', 'Detected an unfinished sync recovery');
    }

    function buildRecoveryLockSummary(lock) {
        if (!lock) return '';
        if (lock.mode === 'first-sync-cloud' || lock.sourcePanel === 'first-sync') {
            return textByLang(
                '上次首次同步已进入“云端覆盖本地”阶段。为避免半写本地状态参与新的判断，请先继续完成该阶段。',
                'The previous first sync had already entered the cloud-overwrite-local stage. Finish this stage first so a half-applied local state cannot affect a new decision.'
            );
        }
        if (lock.mode === 'full' && isPushLikeRecoveryLock(lock)) {
            return textByLang(
                '上次同步在“本地覆盖云端”阶段中断。请先继续完成该阶段；若本轮仍包含后续拉取，系统会在上传完成后自动继续剩余同步步骤。',
                'The previous sync was interrupted during the local-overwrite-cloud stage. Finish this stage first; if the original sync still includes a follow-up pull, it will continue automatically afterward.'
            );
        }
        if (lock.mode === 'full' && isPullLikeRecoveryLock(lock)) {
            return textByLang(
                '上次同步在“云端覆盖本地”阶段中断。请先继续完成该阶段。',
                'The previous sync was interrupted during the cloud-overwrite-local stage. Finish this stage first.'
            );
        }
        if (isPullLikeRecoveryLock(lock)) {
            return textByLang(
                '上次已进入“使用云端覆盖本地”的执行阶段。为避免半写本地状态参与新的判断，请先继续完成这次覆盖。',
                'The previous cloud-overwrite-local action had already entered execution. Finish this overwrite first so a half-applied local state cannot affect a new decision.'
            );
        }
        if (isPushLikeRecoveryLock(lock)) {
            return textByLang(
                '上次已进入“使用本地覆盖云端”的执行阶段。请先继续完成这次上传，再进行新的同步。',
                'The previous local-overwrite-cloud action had already entered execution. Finish this upload before starting a new sync.'
            );
        }
        if (lock.kind === 'conflict-choice') {
            return textByLang(
                '上次冲突处理已经开始执行。为避免中间状态和新的方向混在一起，请先继续完成上次的冲突处理。',
                'The previous conflict resolution had already started. Finish that resolution first so an in-between state cannot mix with a new direction.'
            );
        }
        return textByLang('检测到未完成的同步恢复，请先继续完成上次操作。', 'Detected an unfinished sync recovery. Finish the previous action first.');
    }

    function buildRecoveryLockDetailsHtml(lock) {
        if (!lock) return '';
        const details = [];
        const sourceLabel = (lock.sourcePanel === 'conflict')
            ? textByLang('冲突面板', 'Conflict panel')
            : (lock.sourcePanel === 'first-sync'
                ? textByLang('首次同步面板', 'First sync panel')
                : textByLang('同步主流程', 'Main sync flow'));
        details.push(textByLang(`来源：${sourceLabel}`, `Source: ${sourceLabel}`));
        details.push(textByLang(`任务：${buildRecoveryLockTaskLabel(lock)}`, `Task: ${buildRecoveryLockTaskLabel(lock)}`));
        const phaseLabel = buildRecoveryLockPhaseLabel(lock);
        if (phaseLabel) {
            details.push(textByLang(`当前阶段：${phaseLabel}`, `Current phase: ${phaseLabel}`));
        }
        if (lock.stage) {
            details.push(textByLang(`阶段状态：${lock.stage}`, `Stage state: ${lock.stage}`));
        }
        if (lock.targetPackageHash) {
            details.push(textByLang(`目标包：${lock.targetPackageHash}`, `Target package: ${lock.targetPackageHash}`));
        }
        if (lock.targetRemoteSha) {
            details.push(textByLang(`目标云端版本：${lock.targetRemoteSha}`, `Target remote revision: ${lock.targetRemoteSha}`));
        }
        if (lock.baseRemoteSha) {
            details.push(textByLang(`起始云端版本：${lock.baseRemoteSha}`, `Base remote revision: ${lock.baseRemoteSha}`));
        }
        return `<div class="canvas-sync-other-lines">${details.map((line) => `<span>${escapeHtml(line)}</span>`).join('')}</div>`;
    }

    function renderRecoveryLockPanel() {
        const panel = getElement('canvasSyncRecoveryPanel');
        const closeBtn = getElement('canvasSyncModalClose');

        if (recoveryLockState && !isRecoveryLockActive(recoveryLockState)) {
            recoveryLockState = null;
        }
        if (closeBtn) {
            closeBtn.disabled = false;
            closeBtn.title = '';
        }
        if (!panel) return;

        const lock = recoveryLockState;
        if (!isRecoveryLockActive(lock)) {
            panel.hidden = true;
            return;
        }

        panel.hidden = false;
        const title = getElement('canvasSyncRecoveryTitle');
        if (title) title.innerHTML = `<i class="fas fa-life-ring"></i> ${escapeHtml(buildRecoveryLockTitle(lock))}`;
        const detectedAt = getElement('canvasSyncRecoveryDetectedAt');
        if (detectedAt) detectedAt.textContent = formatTime(lock.updatedAt || lock.createdAt || Date.now());
        const summary = getElement('canvasSyncRecoverySummary');
        if (summary) summary.textContent = buildRecoveryLockSummary(lock);
        const details = getElement('canvasSyncRecoveryDetails');
        if (details) details.innerHTML = buildRecoveryLockDetailsHtml(lock);
        const rollbackBtn = getElement('canvasSyncRecoveryRollbackBtn');
        if (rollbackBtn) rollbackBtn.hidden = !canRollbackRecoveryLock(lock);
        const rollbackText = getElement('canvasSyncRecoveryRollbackText');
        if (rollbackText) rollbackText.textContent = buildRecoveryLockRollbackText(lock);
        const continueText = getElement('canvasSyncRecoveryContinueText');
        if (continueText) continueText.textContent = buildRecoveryLockContinueText(lock);
        const dismissText = getElement('canvasSyncRecoveryDismissText');
        if (dismissText) dismissText.textContent = textByLang('关闭恢复锁（手动处理）', 'Dismiss Recovery Lock (Manual Handling)');
    }

    async function stagePushRecoveryLock(bundlePayload, options = {}) {
        const normalizedFiles = normalizeManagedTextBundleEntries(bundlePayload && bundlePayload.files);
        try {
            await saveRecoveryBundlePayload({
                kind: 'local-bundle',
                exportRoot: String(bundlePayload && bundlePayload.exportRoot || settings && settings.obsidianExportRoot || ''),
                files: normalizedFiles
            });
        } catch (error) {
            console.warn('[Canvas Sync] stage push recovery lock failed:', error);
            await clearRecoveryLockCompletely();
            return null;
        }
        const lock = persistRecoveryLockState({
            id: `recovery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            kind: 'push-bundle',
            sourcePanel: mapRecoveryLockSourcePanel(options.sourcePanel || options.trigger),
            trigger: String(options.trigger || '').trim(),
            mode: normalizeActiveRunRecoveryMode(options.mode || 'push') || 'push',
            stage: normalizeRecoveryLockStage(options.stage || 'prepared'),
            targetPackageHash: buildManagedTextBundleHash(normalizedFiles),
            baseRemoteSha: String(options.baseRemoteSha || '').trim(),
            targetRemoteSha: '',
            summary: '',
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        if (!lock) {
            await clearRecoveryBundlePayload();
            return null;
        }
        renderRecoveryLockPanel();
        renderConflictPanel();
        updateStatusPanelActionPlacement();
        return lock;
    }

    async function stagePullRecoveryLock(bundlePayload, options = {}) {
        const serializedFolderFiles = serializeRemoteFolderFilesMap(bundlePayload && bundlePayload.folderFiles);
        const targetPackageHash = serializedFolderFiles.length
            ? buildManagedTextBundleHashFromRemoteFolderEntries(serializedFolderFiles)
            : (bundlePayload && bundlePayload.snapshot ? `snapshot:${getSnapshotHash(bundlePayload.snapshot)}` : '');
        try {
            await saveRecoveryBundlePayload({
                kind: 'remote-bundle',
                rootPath: String(bundlePayload && bundlePayload.rootPath || settings && settings.obsidianExportRoot || ''),
                folderName: String(bundlePayload && bundlePayload.folderName || ''),
                snapshot: bundlePayload && bundlePayload.snapshot ? normalizeSnapshot(bundlePayload.snapshot) : null,
                rollbackLocalSnapshot: null,
                folderFiles: serializedFolderFiles,
                remoteFilesByPath: bundlePayload && bundlePayload.remoteFilesByPath && typeof bundlePayload.remoteFilesByPath === 'object'
                    ? bundlePayload.remoteFilesByPath
                    : null
            });
        } catch (error) {
            console.warn('[Canvas Sync] stage pull recovery lock failed:', error);
            await clearRecoveryLockCompletely();
            return null;
        }
        const lock = persistRecoveryLockState({
            id: `recovery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            kind: 'pull-bundle',
            sourcePanel: mapRecoveryLockSourcePanel(options.sourcePanel || options.trigger),
            trigger: String(options.trigger || '').trim(),
            mode: normalizeActiveRunRecoveryMode(options.mode || 'pull') || 'pull',
            stage: normalizeRecoveryLockStage(options.stage || 'downloaded'),
            targetPackageHash,
            baseRemoteSha: String(options.baseRemoteSha || '').trim(),
            targetRemoteSha: String(options.targetRemoteSha || '').trim(),
            summary: '',
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        if (!lock) {
            await clearRecoveryBundlePayload();
            return null;
        }
        renderRecoveryLockPanel();
        renderConflictPanel();
        updateStatusPanelActionPlacement();
        return lock;
    }

    function stageConflictRecoveryLock(choice, options = {}) {
        const lock = persistRecoveryLockState({
            id: `recovery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            kind: 'conflict-choice',
            sourcePanel: 'conflict',
            trigger: String(options.trigger || '').trim(),
            mode: choice === 'remote' ? 'pull' : 'push',
            choice: String(choice || '').trim().toLowerCase(),
            stage: normalizeRecoveryLockStage(options.stage || 'prepared'),
            targetPackageHash: '',
            baseRemoteSha: String(options.baseRemoteSha || '').trim(),
            targetRemoteSha: String(options.targetRemoteSha || '').trim(),
            summary: '',
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        renderRecoveryLockPanel();
        renderConflictPanel();
        updateStatusPanelActionPlacement();
        return lock;
    }


    async function maybeHandleRecoveryLockOnInit() {
        const usableLock = await ensureUsableRecoveryLockState();
        if (!usableLock) return false;
        runtime.lastError = buildRecoveryLockSummary(usableLock);
        saveRuntime();
        renderRecoveryLockPanel();
        renderStatus();
        openPanel({ activeTab: 'status' });
        return true;
    }

    async function clearRecoverySourceStateAfterSuccess(lock) {
        if (!lock) return;
        if (lock.sourcePanel === 'conflict') {
            clearPendingConflict();
        }
        clearRecoverySnapshotsByReasonKeywords(collectRecoverySnapshotReasonKeywordsForLock(lock));
    }

    function buildHashMapFromManagedEntries(entriesInput) {
        const map = {};
        normalizeManagedTextBundleEntries(entriesInput).forEach((entry) => {
            map[entry.path] = entry.hash;
        });
        return map;
    }

    async function uploadPreparedLocalBundleOverwrite(stagedBundle, trigger = 'recovery-push') {
        const normalizedFiles = normalizeManagedTextBundleEntries(stagedBundle && stagedBundle.files);
        if (!normalizedFiles.length) {
            throw new Error(textByLang('恢复缓存为空，无法继续上传', 'The staged recovery bundle is empty; cannot continue the upload'));
        }

        const rootPath = normalizeObsidianExportRoot(
            stagedBundle && stagedBundle.exportRoot ? stagedBundle.exportRoot : (settings && settings.obsidianExportRoot),
            DEFAULT_SETTINGS.obsidianExportRoot,
            { allowEmpty: true }
        );
        const remoteListRaw = await listRemoteObsidianFilesByPath(rootPath);
        const remoteList = filterRemoteListForManagedSyncFiles(remoteListRaw, rootPath);
        const remoteFilesByPath = remoteList && remoteList.filesByPath && typeof remoteList.filesByPath === 'object'
            ? remoteList.filesByPath
            : {};
        const localPathSet = new Set(normalizedFiles.map((file) => file.path));
        const batchChanges = normalizedFiles.map((file) => ({
            path: file.path,
            content: file.content
        }));

        Object.keys(remoteFilesByPath).forEach((path) => {
            const normalizedPath = normalizeSyncPath(path);
            if (!normalizedPath || localPathSet.has(normalizedPath)) return;
            batchChanges.push({ path: normalizedPath, delete: true });
        });

        const batchResult = await applyRemoteFilesBatch(
            batchChanges,
            `Bookmark Canvas Sync: ${trigger || 'recovery-push'} staged overwrite`
        );

        saveObsidianFileHashes(buildHashMapFromManagedEntries(normalizedFiles));
        savePathMap(buildPathMapFromObsidianFiles(normalizedFiles));
        saveDirtyState(createDefaultDirtyState());

        const nextPrevSyncIndex = normalizePrevSyncIndex(loadPrevSyncIndex());
        const fileShas = batchResult && batchResult.fileShas && typeof batchResult.fileShas === 'object'
            ? batchResult.fileShas
            : {};
        const visiblePaths = new Set(normalizedFiles.map((file) => file.path));
        Object.keys(nextPrevSyncIndex.files).forEach((path) => {
            if (!visiblePaths.has(path)) {
                delete nextPrevSyncIndex.files[path];
            }
        });
        const nowTs = Date.now();
        normalizedFiles.forEach((file) => {
            nextPrevSyncIndex.files[file.path] = {
                hash: file.hash,
                sha: String(fileShas[file.path] || (nextPrevSyncIndex.files[file.path] && nextPrevSyncIndex.files[file.path].sha) || ''),
                size: getUtf8Size(file.content),
                mtime: nowTs,
                syncedAt: nowTs
            };
        });
        nextPrevSyncIndex.updatedAt = nowTs;
        savePrevSyncIndex(nextPrevSyncIndex);

        return {
            batchResult,
            targetPackageHash: buildManagedTextBundleHash(normalizedFiles),
            totalCount: normalizedFiles.length,
            rootPath
        };
    }

    function resolveRemotePermanentTreeSnapshotForApply(stagedBundle, folderFiles) {
        const snapshotTree = normalizeBookmarkTreeSnapshot(
            stagedBundle && stagedBundle.snapshot && stagedBundle.snapshot.permanentTreeSnapshot
        );
        if (snapshotTree) return snapshotTree;

        const files = folderFiles instanceof Map ? folderFiles : new Map();
        if (!files.size) return null;

        const bridge = global.CanvasObsidianExportBridge;
        if (!bridge || typeof bridge.rebuildPermanentTreeSnapshotFromSyncFolderFiles !== 'function') {
            return null;
        }

        try {
            return normalizeBookmarkTreeSnapshot(
                bridge.rebuildPermanentTreeSnapshotFromSyncFolderFiles(files)
            ) || null;
        } catch (error) {
            console.warn('[Canvas Sync] resolve remote permanent snapshot from folder files failed:', error);
            return null;
        }
    }

    async function rollbackRemoteLocalApplyFromSnapshot(snapshot, reason = 'remote-apply') {
        const baseSnapshot = normalizeSnapshot(snapshot || null);
        if (!baseSnapshot) {
            return {
                restored: false,
                errors: [textByLang('缺少可回滚的本地快照', 'Missing local rollback snapshot')]
            };
        }

        const errors = [];
        const isPermanentOnlySnapshot = String(baseSnapshot && baseSnapshot.format || '').trim().toLowerCase() === 'bookmark-canvas-permanent-tree';

        if (!isPermanentOnlySnapshot) {
            try {
                applySnapshotToLocal(baseSnapshot);
            } catch (error) {
                errors.push(error && error.message ? error.message : String(error));
            }
        }

        const rollbackTree = normalizeBookmarkTreeSnapshot(baseSnapshot.permanentTreeSnapshot);
        if (rollbackTree) {
            try {
                await overwriteLocalPermanentTreeFromSnapshot(rollbackTree, null, {
                    reason: `rollback:${String(reason || 'remote-apply')}`
                });
            } catch (error) {
                errors.push(error && error.message ? error.message : String(error));
            }
        }

        return {
            restored: errors.length <= 0,
            errors
        };
    }

    async function applyPreparedRemoteBundleToLocal(stagedBundle, trigger = 'recovery-pull', options = {}) {
        const folderFiles = deserializeRemoteFolderFilesEntries(stagedBundle && stagedBundle.folderFiles);
        const hasRemoteFiles = folderFiles.size > 0;
        const rollbackReason = String(trigger || 'recovery-pull');

        let localRollbackSnapshot = normalizeSnapshot(options && options.localRollbackSnapshot);
        if (!localRollbackSnapshot) {
            localRollbackSnapshot = await buildLocalSnapshot(`before-${rollbackReason}-apply-remote-bundle`, {
                includePermanentTree: true,
                includeTempSection: true
            });
        }

        let applyResult = null;
        let remotePermanentTreeSnapshot = resolveRemotePermanentTreeSnapshotForApply(stagedBundle, folderFiles);
        let permanentApplied = false;

        try {
            const overwriteResult = await maybeOverwriteLocalPermanentTreeFromRemoteSnapshot(remotePermanentTreeSnapshot, trigger, {
                force: true,
                permanentPullMode: options && options.permanentPullMode,
                onProgress: (message) => updateSyncUiProgress(message, 82)
            });
            permanentApplied = !!(overwriteResult && overwriteResult.applied);

            if (hasRemoteFiles && settings.obsidianFilePushEnabled !== false) {
                const bridge = global.CanvasObsidianExportBridge;
                if (bridge && typeof bridge.applySyncFilesReplace === 'function') {
                    const rootPath = normalizeSyncPath(stagedBundle && stagedBundle.rootPath);
                    const folderName = String(stagedBundle && stagedBundle.folderName || '').trim()
                        || ((rootPath ? rootPath.split('/').filter(Boolean).slice(-1)[0] : '') || DEFAULT_SETTINGS.obsidianExportRoot);
                    const rawApplyResult = await bridge.applySyncFilesReplace(folderFiles, folderName, {
                        trigger: rollbackReason
                    });
                    const applyPermanentTreeSnapshot = normalizeBookmarkTreeSnapshot(
                        rawApplyResult && rawApplyResult.permanentTreeSnapshot
                    );
                    if (!remotePermanentTreeSnapshot && applyPermanentTreeSnapshot) {
                        remotePermanentTreeSnapshot = applyPermanentTreeSnapshot;
                    }
                    applyResult = {
                        applied: !!(rawApplyResult && rawApplyResult.success),
                        permanentTreeSnapshot: applyPermanentTreeSnapshot
                    };
                }
            }

            if (!(applyResult && applyResult.applied)) {
                const stagedSnapshot = stagedBundle && stagedBundle.snapshot ? normalizeSnapshot(stagedBundle.snapshot) : null;
                if (!stagedSnapshot) {
                    throw new Error(textByLang('恢复缓存缺少可用云端快照，无法继续覆盖本地', 'The staged recovery bundle is missing a usable remote snapshot; cannot continue overwriting local'));
                }
                applySnapshotToLocal(buildSnapshotForRemoteLocalApply(stagedSnapshot));
            }

            if (!permanentApplied && remotePermanentTreeSnapshot) {
                const retryOverwrite = await maybeOverwriteLocalPermanentTreeFromRemoteSnapshot(remotePermanentTreeSnapshot, trigger, {
                    force: true,
                    permanentPullMode: options && options.permanentPullMode,
                    onProgress: (message) => updateSyncUiProgress(message, 82)
                });
                permanentApplied = !!(retryOverwrite && retryOverwrite.applied);
            }
        } catch (error) {
            const rollbackResult = await rollbackRemoteLocalApplyFromSnapshot(
                localRollbackSnapshot,
                `apply-prepared:${rollbackReason}`
            );
            if (rollbackResult && Array.isArray(rollbackResult.errors) && rollbackResult.errors.length > 0) {
                const rollbackErrorText = rollbackResult.errors.join(' | ');
                throw new Error(textByLang(
                    `应用云端覆盖失败：${error && error.message ? error.message : String(error)}；自动回滚也失败：${rollbackErrorText}`,
                    `Applying cloud overwrite failed: ${error && error.message ? error.message : String(error)}; automatic rollback also failed: ${rollbackErrorText}`
                ));
            }
            throw error;
        }

        if (settings.obsidianFilePushEnabled !== false) {
            const rebuiltIndex = await rebuildObsidianIndexesFromLocalSnapshot(`recovery:${trigger || 'pull'}`, {
                clearDirty: true,
                syncedAt: Date.now(),
                remoteFilesByPath: stagedBundle && stagedBundle.remoteFilesByPath && typeof stagedBundle.remoteFilesByPath === 'object'
                    ? stagedBundle.remoteFilesByPath
                    : null
            });
            if (rebuiltIndex && rebuiltIndex.enabled) {
                runtime.lastLocalFilesSha = String(rebuiltIndex.localRevision || runtime.lastLocalFilesSha || '');
                runtime.lastObsidianPushTotal = Number(rebuiltIndex.totalCount) || runtime.lastObsidianPushTotal;
                runtime.lastObsidianPushChanged = 0;
            }
        } else {
            saveDirtyState(createDefaultDirtyState());
        }

        return {
            targetPackageHash: String(recoveryLockState && recoveryLockState.targetPackageHash || ''),
            localPackageHash: (stagedBundle && Array.isArray(stagedBundle.folderFiles) && stagedBundle.folderFiles.length > 0)
                ? await buildCurrentLocalManagedBundleHash()
                : ((stagedBundle && stagedBundle.snapshot)
                    ? `snapshot:${getSnapshotHash(await buildLocalSnapshot('recovery-verify', { includePermanentTree: true }))}`
                    : ''),
            remotePermanentTreeSnapshot
        };
    }

    async function handoffRecoveryLockToPendingState(lock, remoteSha, message) {
        const safeMessage = String(message || textByLang(
            '检测到云端状态已变化，请重新处理当前同步动作',
            'Cloud state changed. Re-handle the current sync action.'
        ));
        await clearRecoveryLockCompletely();
        clearActiveRunRecoveryRecord();
        handleRecoveryLockReleased();

        if (lock && lock.sourcePanel === 'conflict' && hasPendingConflict()) {
            runtime.lastError = safeMessage;
            saveRuntime();
            renderStatus();
            renderConflictPanel();
            ensureStatusPanelVisible('conflict', safeMessage);
            toast(safeMessage);
            return false;
        }

        try {
            await setPendingConflictState(remoteSha, safeMessage, {
                reason: 'recovery-handoff-conflict'
            });
        } catch (_) {
            const localSnapshot = normalizeSnapshot(await buildLocalSnapshot('recovery-handoff-conflict', {
                includePermanentTree: true,
                includeTempSection: true,
                includeBlankSectionFiles: true
            }));
            const remoteSnapshot = normalizeSnapshot({ updatedAt: Date.now(), data: {} });
            setPendingConflict(createPendingConflictPayload(localSnapshot, remoteSnapshot, {
                sha: String(remoteSha || ''),
                path: String(settings && settings.obsidianExportRoot || ''),
                snapshot: remoteSnapshot
            }, {
                reason: 'recovery-handoff-conflict-fallback'
            }));
            runtime.lastError = safeMessage;
            saveRuntime();
            renderStatus();
            ensureStatusPanelVisible('conflict', safeMessage);
        }

        toast(safeMessage);
        return false;
    }

    async function rebuildPullRecoveryBundleFromRemote(lock) {
        const remoteState = await readRemoteSnapshotWithPathRecovery({
            interactive: false,
            continueAfterConfirm: false,
            throwWhenDetected: false
        });
        const currentRemoteSha = String(
            (remoteState && remoteState.sha)
            || buildRemoteObsidianRevisionFromList(remoteState && remoteState.remoteList)
            || ''
        ).trim();
        const expectedRemoteSha = String(lock && lock.targetRemoteSha || '').trim();
        if (expectedRemoteSha && currentRemoteSha !== expectedRemoteSha) {
            return {
                changed: true,
                remoteSha: currentRemoteSha,
                message: textByLang(
                    '上次拉取对应的云端版本已变化，无法继续原目标包，请重新选择处理方式。',
                    'The cloud revision for the previous pull has changed. Re-choose how to handle it.'
                )
            };
        }

        let serializedFolderFiles = [];
        if (remoteState && remoteState.remoteList && Array.isArray(remoteState.remoteList.files) && remoteState.remoteList.files.length > 0) {
            updateSyncUiProgress(textByLang('恢复缓存缺失，正在重新拉取上次目标包...', 'Recovery cache missing. Re-downloading the previous target package...'), 42);
            const fetched = await fetchRemoteObsidianFolderFiles(remoteState.remoteList, makeProgressRange(42, 58));
            serializedFolderFiles = serializeRemoteFolderFilesMap(fetched.folderFiles);
        }

        const rebuiltBundle = {
            kind: 'remote-bundle',
            rootPath: String(remoteState && remoteState.path ? remoteState.path : (settings && settings.obsidianExportRoot || '')),
            folderName: (() => {
                const rootPath = normalizeSyncPath(remoteState && remoteState.path ? remoteState.path : (settings && settings.obsidianExportRoot || ''));
                return (rootPath ? rootPath.split('/').filter(Boolean).slice(-1)[0] : '') || DEFAULT_SETTINGS.obsidianExportRoot;
            })(),
            snapshot: remoteState && remoteState.snapshot ? normalizeSnapshot(remoteState.snapshot) : null,
            folderFiles: serializedFolderFiles,
            remoteFilesByPath: remoteState && remoteState.remoteList && remoteState.remoteList.filesByPath && typeof remoteState.remoteList.filesByPath === 'object'
                ? remoteState.remoteList.filesByPath
                : null
        };

        const rebuiltTargetPackageHash = serializedFolderFiles.length
            ? buildManagedTextBundleHashFromRemoteFolderEntries(serializedFolderFiles)
            : (rebuiltBundle.snapshot ? `snapshot:${getSnapshotHash(rebuiltBundle.snapshot)}` : '');
        const expectedTargetPackageHash = String(lock && lock.targetPackageHash || '').trim();
        if ((expectedTargetPackageHash || rebuiltTargetPackageHash) && rebuiltTargetPackageHash !== expectedTargetPackageHash) {
            return {
                changed: true,
                remoteSha: currentRemoteSha,
                message: textByLang(
                    '上次拉取对应的目标包已变化，无法继续原覆盖流程，请重新选择处理方式。',
                    'The target package for the previous pull has changed. Re-choose how to handle it.'
                )
            };
        }

        await saveRecoveryBundlePayload(rebuiltBundle);
        return {
            changed: false,
            bundle: rebuiltBundle,
            remoteSha: currentRemoteSha,
            targetPackageHash: rebuiltTargetPackageHash
        };
    }

    function findLatestRecoverySnapshotByReasons(reasonKeywords = []) {
        const keywords = Array.isArray(reasonKeywords)
            ? reasonKeywords
                .map((item) => String(item || '').trim())
                .filter(Boolean)
            : [];
        if (!keywords.length) return null;

        const list = safeParse(getSyncMetaRaw(RECOVERY_KEY), []);
        const records = Array.isArray(list) ? list : [];
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            if (!record || typeof record !== 'object') continue;
            const reason = String(record.reason || '').trim();
            if (!reason) continue;
            if (!keywords.some((keyword) => reason.includes(keyword))) continue;
            const snapshot = normalizeSnapshot(record.snapshot || null);
            if (!snapshot) continue;
            return snapshot;
        }
        return null;
    }

    function getLatestRecoverySnapshotRecord(options = {}) {
        const requireSnapshot = options && options.requireSnapshot !== false;
        const list = safeParse(getSyncMetaRaw(RECOVERY_KEY), []);
        const records = Array.isArray(list) ? list : [];
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            if (!record || typeof record !== 'object') continue;
            const reason = String(record.reason || '').trim();
            const ts = Math.max(0, Number(record.ts) || 0);
            const snapshot = normalizeSnapshot(record.snapshot || null);
            if (requireSnapshot && !snapshot) continue;
            const snapshotHash = String(record.snapshotHash || '').trim() || (snapshot ? getSnapshotHash(snapshot) : '');
            return {
                reason,
                ts,
                snapshot,
                snapshotHash
            };
        }
        return null;
    }

    function formatRecoverySnapshotReason(reason) {
        const normalized = String(reason || '').trim().toLowerCase();
        if (normalized === RECOVERY_SNAPSHOT_IDLE_REASON) {
            return textByLang('空闲定时备份', 'Idle periodic backup');
        }
        if (normalized === RECOVERY_SNAPSHOT_MANUAL_REASON || normalized.startsWith('manual')) {
            return textByLang('手动备份', 'Manual backup');
        }
        return String(reason || '').trim() || textByLang('未记录原因', 'No reason recorded');
    }

    function buildRecoverySnapshotDownloadFileName(record) {
        const ts = Math.max(0, Number(record && record.ts) || Date.now());
        const date = new Date(ts);
        const pad2 = (num) => String(num).padStart(2, '0');
        const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
        const rawReason = String(record && record.reason || '').trim().toLowerCase();
        const reasonToken = rawReason
            ? rawReason.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
            : '';
        const suffix = reasonToken ? `-${reasonToken.slice(0, 48)}` : '';
        return `bookmark-canvas-recovery-${stamp}${suffix}.json`;
    }

    function renderRecoverySnapshotDownloadStatus() {
        const hintEl = getElement('canvasSyncRecoverySnapshotHint');
        if (!hintEl) return;

        const latestRecord = getLatestRecoverySnapshotRecord({ requireSnapshot: true });
        const purposeHintZh = '备份的是永久栏目快照（浏览器书签树快照），用于覆盖恢复流程中若浏览器崩溃时可回滚。恢复快照仅保留最近 1 份（永久保留，新备份会覆盖旧备份）。';
        const purposeHintEn = 'This backup stores the permanent-section snapshot (browser bookmark tree snapshot) for rollback if the browser crashes during overwrite recovery. Only the latest snapshot is kept (retained indefinitely; each new backup replaces the previous one).';
        if (!latestRecord) {
            hintEl.textContent = textByLang(
                purposeHintZh,
                purposeHintEn
            );
            return;
        }

        const capturedAtText = formatTime(latestRecord.ts);
        const reasonText = formatRecoverySnapshotReason(latestRecord.reason);
        hintEl.textContent = textByLang(
            `${purposeHintZh} 最近快照：${capturedAtText}（${reasonText}）。`,
            `${purposeHintEn} Latest snapshot: ${capturedAtText} (${reasonText}).`
        );
    }

    async function downloadLatestRecoverySnapshotAction() {
        const latestRecord = getLatestRecoverySnapshotRecord({ requireSnapshot: true });
        if (!latestRecord || !latestRecord.snapshot) {
            toast(textByLang('当前没有可下载的恢复快照', 'No downloadable recovery snapshot is currently available.'));
            return false;
        }

        const payload = {
            schemaVersion: 1,
            format: 'bookmark-canvas-recovery-export',
            exportedAt: Date.now(),
            exportedAtIso: new Date().toISOString(),
            retentionPolicy: 'latest-only-unlimited',
            source: {
                reason: String(latestRecord.reason || ''),
                capturedAt: Math.max(0, Number(latestRecord.ts) || 0),
                capturedAtIso: latestRecord.ts ? new Date(latestRecord.ts).toISOString() : '',
                snapshotHash: String(latestRecord.snapshotHash || '')
            },
            snapshot: latestRecord.snapshot
        };

        try {
            const jsonText = JSON.stringify(payload, null, 2);
            const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = buildRecoverySnapshotDownloadFileName(latestRecord);
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => {
                try { URL.revokeObjectURL(blobUrl); } catch (_) { }
            }, 2000);
            toast(textByLang('恢复快照已开始下载', 'Recovery snapshot download started.'));
            return true;
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            toast(textByLang(`下载恢复快照失败：${message}`, `Failed to download recovery snapshot: ${message}`));
            return false;
        }
    }

    async function createManualRecoverySnapshotAction() {
        try {
            const response = await sendRuntimeMessage({
                action: 'canvasGitSyncRunRecoverySnapshotNow'
            }, 15000);
            const ok = !!(response && response.success === true);
            const skipped = !!(response && response.skipped === true);
            const reason = String(response && response.reason || '');
            if (!ok) {
                const message = response && response.error ? String(response.error) : textByLang('手动备份失败', 'Manual backup failed');
                toast(textByLang(`手动备份失败：${message}`, `Manual backup failed: ${message}`));
                return false;
            }

            if (skipped && reason === 'same-as-latest') {
                toast(textByLang('手动备份完成：与最近快照一致，未重复保存', 'Manual backup completed: same as latest snapshot, skipped duplicate save.'));
            } else if (skipped) {
                toast(textByLang('手动备份已跳过', 'Manual backup was skipped.'));
            } else {
                toast(textByLang('手动备份完成', 'Manual backup completed.'));
            }
            renderRecoverySnapshotDownloadStatus();
            renderStatus();
            return true;
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            toast(textByLang(`手动备份失败：${message}`, `Manual backup failed: ${message}`));
            return false;
        }
    }

    function dedupeRecoverySnapshotReasonKeywords(reasonKeywords = []) {
        const source = Array.isArray(reasonKeywords) ? reasonKeywords : [];
        const normalized = [];
        const seen = new Set();
        source.forEach((item) => {
            const keyword = String(item || '').trim();
            if (!keyword || seen.has(keyword)) return;
            seen.add(keyword);
            normalized.push(keyword);
        });
        return normalized;
    }

    function clearRecoverySnapshotsByReasonKeywords(reasonKeywords = []) {
        const keywords = dedupeRecoverySnapshotReasonKeywords(reasonKeywords);
        if (!keywords.length) return 0;
        const list = safeParse(getSyncMetaRaw(RECOVERY_KEY), []);
        const records = Array.isArray(list) ? list : [];
        if (!records.length) return 0;

        const kept = [];
        let removed = 0;
        records.forEach((record) => {
            const reason = String(record && record.reason || '').trim();
            if (reason && keywords.some((keyword) => reason.includes(keyword))) {
                removed += 1;
                return;
            }
            kept.push(record);
        });
        if (!removed) return 0;

        try {
            if (kept.length > 0) {
                setSyncMetaRaw(RECOVERY_KEY, JSON.stringify(kept.slice(0, RECOVERY_SNAPSHOT_KEEP_LATEST)));
            } else {
                setSyncMetaRaw(RECOVERY_KEY, null);
            }
        } catch (error) {
            console.warn('[Canvas Sync] clear recovery snapshots by reason failed:', error);
            return 0;
        }
        return removed;
    }

    function collectRecoverySnapshotReasonKeywordsForLock(lock) {
        const source = lock && typeof lock === 'object' ? lock : null;
        if (!source) return [];

        const trigger = String(source.trigger || '').trim();
        const keywords = [];
        if (trigger) {
            keywords.push(`before-${trigger}-remote-overwrite`);
            keywords.push(`before-permanent-overwrite:${trigger}`);
        }

        if (source.kind === 'conflict-choice' && source.choice === 'remote') {
            keywords.push('before-apply-remote-conflict');
            keywords.push('before-permanent-overwrite:manual-conflict-use-remote');
        }

        if (source.mode === 'first-sync-cloud' || source.sourcePanel === 'first-sync') {
            keywords.push('before-first-sync-cloud-overwrite');
            keywords.push('before-permanent-overwrite:first-sync-cloud-overwrite');
        }

        return dedupeRecoverySnapshotReasonKeywords(keywords);
    }

    function resolveRecoveryLockRollbackSnapshot(lock, stagedBundle = null) {
        const bundleSnapshot = normalizeSnapshot(stagedBundle && stagedBundle.rollbackLocalSnapshot);
        if (bundleSnapshot) return bundleSnapshot;

        if (lock && lock.kind === 'conflict-choice' && lock.choice === 'remote') {
            const conflictLocalSnapshot = normalizeSnapshot(pendingConflict && pendingConflict.localSnapshot);
            if (conflictLocalSnapshot) return conflictLocalSnapshot;
            const conflictSnapshot = findLatestRecoverySnapshotByReasons(['before-apply-remote-conflict']);
            if (conflictSnapshot) return conflictSnapshot;
        }

        if (lock && (lock.mode === 'first-sync-cloud' || lock.sourcePanel === 'first-sync')) {
            const firstSyncSnapshot = findLatestRecoverySnapshotByReasons(['before-first-sync-cloud-overwrite']);
            if (firstSyncSnapshot) return firstSyncSnapshot;
        }

        if (lock && lock.kind === 'pull-bundle') {
            const triggerText = String(lock.trigger || '').trim();
            const reasonKeywords = [];
            if (triggerText) {
                reasonKeywords.push(`before-${triggerText}-remote-overwrite`);
            }
            reasonKeywords.push('-remote-overwrite');
            const pullSnapshot = findLatestRecoverySnapshotByReasons(reasonKeywords);
            if (pullSnapshot) return pullSnapshot;
        }

        const latestRecord = getLatestRecoverySnapshotRecord({ requireSnapshot: true });
        return latestRecord && latestRecord.snapshot ? latestRecord.snapshot : null;
    }

    async function rollbackRecoveryLockAction() {
        const lock = normalizeRecoveryLockRecord(recoveryLockState || loadRecoveryLockState());
        if (!lock || recoveryLockResumeInFlight) return false;
        if (!canRollbackRecoveryLock(lock)) {
            toast(textByLang(
                '当前恢复锁不支持自动回滚，请手动处理。',
                'The current recovery lock does not support automatic rollback. Handle it manually.'
            ));
            return false;
        }

        recoveryLockResumeInFlight = true;
        syncUiProgressEnabled = true;
        updateSyncUiProgress(textByLang('准备回滚未完成任务...', 'Preparing to rollback unfinished task...'), 0);
        renderRecoveryLockPanel();
        updateSyncEnabledDependentFieldState();

        try {
            openPanel({ activeTab: 'status' });
            updateSyncUiProgress(textByLang('已进入恢复面板...', 'Recovery panel opened...'), 8);

            let stagedBundle = null;
            if (lock.kind === 'pull-bundle') {
                updateSyncUiProgress(textByLang('读取恢复缓存...', 'Loading staged recovery bundle...'), 20);
                const loadedBundle = await loadRecoveryBundlePayload();
                if (loadedBundle && typeof loadedBundle === 'object' && loadedBundle.kind === 'remote-bundle') {
                    stagedBundle = loadedBundle;
                }
            }

            const rollbackSnapshot = resolveRecoveryLockRollbackSnapshot(lock, stagedBundle);
            if (!rollbackSnapshot) {
                throw new Error(textByLang(
                    '未找到可用快照，无法自动回滚。请手动处理。',
                    'No usable snapshot was found, so automatic rollback is unavailable. Handle it manually.'
                ));
            }

            updateSyncUiProgress(textByLang('正在回滚本地状态...', 'Rolling back local state...'), 52);
            const rollbackResult = await rollbackRemoteLocalApplyFromSnapshot(
                rollbackSnapshot,
                `manual-recovery-rollback:${String(lock.trigger || lock.mode || lock.kind || 'unknown')}`
            );
            if (rollbackResult && Array.isArray(rollbackResult.errors) && rollbackResult.errors.length > 0) {
                const rollbackErrorText = rollbackResult.errors.join(' | ');
                throw new Error(textByLang(
                    `回滚失败：${rollbackErrorText}`,
                    `Rollback failed: ${rollbackErrorText}`
                ));
            }

            let effectiveRollbackSnapshot = rollbackSnapshot;
            if (String(rollbackSnapshot && rollbackSnapshot.format || '').trim().toLowerCase() === 'bookmark-canvas-permanent-tree') {
                try {
                    effectiveRollbackSnapshot = await buildLocalSnapshot('recovery-rollback-post', {
                        includePermanentTree: true,
                        includeTempSection: true
                    });
                } catch (_) {
                    effectiveRollbackSnapshot = rollbackSnapshot;
                }
            }

            runtime.lastLocalHash = getSnapshotHash(effectiveRollbackSnapshot);
            runtime.lastAppliedDirection = 'recovery-rollback';
            runtime.lastError = '';
            runtime.lastSuccessAt = Date.now();
            if (normalizeBookmarkTreeSnapshot(effectiveRollbackSnapshot.permanentTreeSnapshot)) {
                runtime.lastPermanentTreeSnapshotAt = Date.now();
            }
            updateRuntimeSectionBaselineHashes(effectiveRollbackSnapshot, {
                forcePermanent: true,
                forceOther: true
            });
            saveRuntime();

            if (settings.obsidianFilePushEnabled !== false) {
                try {
                    const rebuiltIndex = await rebuildObsidianIndexesFromLocalSnapshot('recovery-rollback', {
                        clearDirty: false,
                        syncedAt: Date.now()
                    });
                    if (rebuiltIndex && rebuiltIndex.enabled) {
                        runtime.lastLocalFilesSha = String(rebuiltIndex.localRevision || runtime.lastLocalFilesSha || '');
                        saveRuntime();
                    }
                } catch (error) {
                    console.warn('[Canvas Sync] rebuild local obsidian index after recovery rollback failed:', error);
                }
            }

            await clearRecoveryLockCompletely();
            clearActiveRunRecoveryRecord();
            handleRecoveryLockReleased();
            clearRecoverySnapshotsByReasonKeywords(collectRecoverySnapshotReasonKeywordsForLock(lock));

            if (lock.sourcePanel === 'conflict' && hasPendingConflict()) {
                const conflictMsg = textByLang(
                    '已回滚到冲突处理前状态，请重新选择保留本地或使用云端。',
                    'Rolled back to the pre-conflict state. Re-choose keep local or use cloud.'
                );
                runtime.lastError = conflictMsg;
                saveRuntime();
                renderStatus();
                renderConflictPanel();
                ensureStatusPanelVisible('conflict', conflictMsg);
                toast(conflictMsg);
            } else if (lock.sourcePanel === 'first-sync' || lock.mode === 'first-sync-cloud') {
                setFirstSyncStatus(
                    textByLang('首次同步已回滚到最近可用快照状态，请重新执行首次同步', 'First sync was rolled back to the latest available snapshot state. Run first sync again.'),
                    'neutral'
                );
                runtime.lastError = '';
                saveRuntime();
                renderStatus();
                toast(textByLang('已回滚到最近可用快照状态', 'Rolled back to the latest available snapshot state'));
            } else {
                const pendingMsg = textByLang(
                    '已回滚到最近可用快照状态，请重新选择同步方向。',
                    'Rolled back to the latest available snapshot state. Re-choose the sync direction.'
                );
                await setPendingConflictState(lock.targetRemoteSha || runtime.lastRemoteSha || '', pendingMsg, {
                    reason: 'recovery-rollback-pending-conflict'
                });
                toast(pendingMsg);
            }

            updateSyncUiProgress(textByLang('回滚完成', 'Rollback completed'), 100);
            return true;
        } catch (error) {
            runtime.lastError = error && error.message ? error.message : String(error);
            saveRuntime();
            renderStatus();
            toast(textByLang(`回滚失败：${runtime.lastError}`, `Rollback failed: ${runtime.lastError}`));
            return false;
        } finally {
            clearSyncUiProgress();
            syncUiProgressEnabled = false;
            recoveryLockResumeInFlight = false;
            renderRecoveryLockPanel();
            updateSyncEnabledDependentFieldState();
        }
    }

    async function continueRecoveryLockAction() {
        const lock = normalizeRecoveryLockRecord(recoveryLockState || loadRecoveryLockState());
        if (!lock || recoveryLockResumeInFlight) return false;

        recoveryLockResumeInFlight = true;
        syncUiProgressEnabled = true;
        updateSyncUiProgress(textByLang('准备恢复未完成任务...', 'Preparing to resume the unfinished task...'), 0);
        renderRecoveryLockPanel();
        updateSyncEnabledDependentFieldState();

        try {
            openPanel({ activeTab: 'status' });
            updateSyncUiProgress(textByLang('已进入恢复面板...', 'Recovery panel opened...'), 8);

            if (lock.kind === 'conflict-choice') {
                if (lock.choice === 'remote' && pendingConflict) {
                    updateSyncUiProgress(textByLang('校验冲突对应的云端版本...', 'Verifying the cloud revision for the previous conflict choice...'), 20);
                    let currentRemoteSha = '';
                    try {
                        currentRemoteSha = await readCurrentRemoteManagedRevision((pendingConflict && pendingConflict.remotePath) || (settings && settings.obsidianExportRoot));
                    } catch (error) {
                        throw new Error(textByLang(
                            `无法校验云端版本：${error && error.message ? error.message : String(error)}`,
                            `Unable to verify cloud revision: ${error && error.message ? error.message : String(error)}`
                        ));
                    }
                    const expectedRemoteSha = String((pendingConflict && pendingConflict.remoteSha) || lock.targetRemoteSha || '').trim();
                    if (String(currentRemoteSha || '').trim() !== expectedRemoteSha) {
                        return await handoffRecoveryLockToPendingState(
                            lock,
                            currentRemoteSha,
                            textByLang(
                                '冲突处理对应的云端版本已变化，无法继续上次“使用云端”操作。已回到冲突待处理状态，请重新选择。',
                                'The cloud revision for the previous conflict choice has changed. The earlier “Use Cloud” action can no longer continue safely. It was moved back to a pending conflict state.'
                            )
                        );
                    }
                }
                updateSyncUiProgress(textByLang('继续执行上次冲突处理...', 'Continuing the previous conflict resolution...'), 24);
                await resolvePendingConflict(lock.choice, { bypassRecoveryLock: true, recoveryResume: true });
                updateSyncUiProgress(textByLang('上次冲突处理已完成', 'Previous conflict resolution completed'), 100);
                return true;
            }

            if (lock.kind === 'push-bundle') {
                updateSyncUiProgress(textByLang('读取恢复缓存...', 'Loading staged recovery bundle...'), 16);
                const stagedBundle = await loadRecoveryBundlePayload();
                if (!stagedBundle || typeof stagedBundle !== 'object' || stagedBundle.kind !== 'local-bundle' || !Array.isArray(stagedBundle.files)) {
                    return await handoffRecoveryLockToPendingState(
                        lock,
                        '',
                        textByLang(
                            '上传恢复缓存已丢失，无法精确继续上次上传。已转回待处理状态，请重新选择保留本地或使用云端。',
                            'The staged upload bundle was lost, so the previous upload can no longer continue exactly. It was moved back to a pending state. Choose local or cloud again.'
                        )
                    );
                }

                updateRecoveryLockState({ stage: 'verifying' });
                updateSyncUiProgress(textByLang('校验云端状态...', 'Verifying remote state...'), 28);
                let currentRemoteHash = '';
                try {
                    currentRemoteHash = await buildCurrentRemoteManagedBundleHash(stagedBundle.exportRoot || settings && settings.obsidianExportRoot);
                } catch (error) {
                    throw new Error(textByLang(
                        `无法校验云端状态：${error && error.message ? error.message : String(error)}`,
                        `Unable to verify cloud state: ${error && error.message ? error.message : String(error)}`
                    ));
                }
                const normalizedCurrentRemoteHash = String(currentRemoteHash || '').trim();
                const expectedTargetPackageHash = String(lock.targetPackageHash || '').trim();
                const expectedBaseRemoteSha = String(lock.baseRemoteSha || '').trim();

                if (expectedTargetPackageHash && normalizedCurrentRemoteHash === expectedTargetPackageHash) {
                    saveObsidianFileHashes(buildHashMapFromManagedEntries(stagedBundle.files));
                    savePathMap(buildPathMapFromObsidianFiles(stagedBundle.files));
                    saveDirtyState(createDefaultDirtyState());
                    runtime.lastRemoteSha = normalizedCurrentRemoteHash;
                    runtime.lastLocalFilesSha = expectedTargetPackageHash;
                    runtime.lastAppliedDirection = 'push';
                    runtime.lastError = '';
                    runtime.lastSuccessAt = Date.now();
                    saveRuntime();
                    await clearRecoverySourceStateAfterSuccess(lock);
                    await clearRecoveryLockCompletely();
                    clearActiveRunRecoveryRecord();
                    handleRecoveryLockReleased();
                    renderStatus();
                    toast(textByLang('检测到上次上传其实已经完成，已解除恢复锁', 'The previous upload had already finished. The recovery lock has been cleared.'));
                    return true;
                }

                if (normalizedCurrentRemoteHash !== expectedBaseRemoteSha) {
                    return await handoffRecoveryLockToPendingState(
                        lock,
                        normalizedCurrentRemoteHash,
                        textByLang(
                            '远端基线已变化，无法安全继续上次上传。已转回待处理状态，请重新选择保留本地或使用云端。',
                            'The remote base revision has changed, so the previous upload can no longer resume safely. It was moved back to a pending state. Choose local or cloud again.'
                        )
                    );
                }

                updateRecoveryLockState({ stage: 'uploading' });
                updateSyncUiProgress(textByLang('继续上传上次本地包...', 'Continuing the previous local bundle upload...'), 52);
                const pushResult = await uploadPreparedLocalBundleOverwrite(stagedBundle, lock.trigger || 'recovery-push');
                updateSyncUiProgress(textByLang('校验上传结果...', 'Verifying upload result...'), 86);
                currentRemoteHash = await buildCurrentRemoteManagedBundleHash(pushResult.rootPath);
                const normalizedRemoteHashAfterUpload = String(currentRemoteHash || '').trim();
                if (expectedTargetPackageHash && normalizedRemoteHashAfterUpload !== expectedTargetPackageHash) {
                    throw new Error(textByLang('恢复上传后远端状态仍未达到目标包，请稍后重试', 'The remote state still does not match the target package after recovery upload. Please retry later.'));
                }
                runtime.lastRemoteSha = normalizedRemoteHashAfterUpload || runtime.lastRemoteSha;
                runtime.lastLocalFilesSha = pushResult.targetPackageHash || runtime.lastLocalFilesSha;
                runtime.lastAppliedDirection = 'push';
                runtime.lastError = '';
                runtime.lastSuccessAt = Date.now();
                saveRuntime();
                const needsFollowUpPull = lock.mode === 'full';
                await clearRecoverySourceStateAfterSuccess(lock);
                await clearRecoveryLockCompletely();
                clearActiveRunRecoveryRecord();
                handleRecoveryLockReleased();
                renderStatus();
                if (needsFollowUpPull) {
                    updateSyncUiProgress(textByLang('上传已完成，继续执行同步中的后续拉取...', 'Upload resumed. Continuing the follow-up pull from the same sync...'), 92);
                    toast(textByLang('已继续完成上次同步的上传阶段，正在继续后续拉取', 'Finished the upload stage of the previous sync. Continuing the follow-up pull.'));
                    await runSync('pull', 'recovery-followup-pull', { bypassRecoveryLock: true });
                    updateSyncUiProgress(textByLang('上次同步已恢复完成', 'Previous sync recovery completed'), 100);
                    return true;
                }
                updateSyncUiProgress(textByLang('上次上传已恢复完成', 'Previous upload recovery completed'), 100);
                toast(textByLang('已继续完成上次上传', 'Finished continuing the previous upload'));
                return true;
            }

            if (lock.kind === 'pull-bundle') {
                updateRecoveryLockState({ stage: 'verifying' });
                updateSyncUiProgress(textByLang('校验本地状态...', 'Verifying local state...'), 28);
                const currentLocalHash = (lock.targetPackageHash && lock.targetPackageHash.startsWith('snapshot:'))
                    ? `snapshot:${getSnapshotHash(await buildLocalSnapshot('recovery-verify', { includePermanentTree: true }))}`
                    : await buildCurrentLocalManagedBundleHash();
                if (currentLocalHash && lock.targetPackageHash && currentLocalHash === lock.targetPackageHash) {
                    saveDirtyState(createDefaultDirtyState());
                    runtime.lastError = '';
                    runtime.lastSuccessAt = Date.now();
                    runtime.lastAppliedDirection = lock.mode === 'first-sync-cloud' ? 'first-sync-overwrite' : 'pull';
                    runtime.lastLocalFilesSha = currentLocalHash.startsWith('files:') ? currentLocalHash : runtime.lastLocalFilesSha;
                    runtime.lastRemoteSha = lock.targetRemoteSha || runtime.lastRemoteSha;
                    if (lock.mode === 'first-sync-cloud') {
                        runtime.lastSyncMode = 'first-sync-cloud';
                        setFirstSyncStatus(textByLang('首次同步完成：已继续完成上次云端覆盖', 'First sync completed: resumed the previous cloud overwrite'), 'ok');
                        setFirstSyncFoldOpen(false);
                    }
                    saveRuntime();
                    await clearRecoverySourceStateAfterSuccess(lock);
                    await clearRecoveryLockCompletely();
                    clearActiveRunRecoveryRecord();
                    handleRecoveryLockReleased();
                    renderStatus();
                    toast(lock.mode === 'full'
                        ? textByLang('检测到上次同步的拉取阶段其实已经完成，已解除恢复锁', 'The pull stage of the previous sync had already finished. The recovery lock has been cleared.')
                        : textByLang('检测到上次云端覆盖本地其实已经完成，已解除恢复锁', 'The previous cloud-overwrite-local action had already finished. The recovery lock has been cleared.'));
                    return true;
                }

                updateSyncUiProgress(textByLang('读取恢复缓存...', 'Loading staged recovery bundle...'), 36);
                let stagedBundle = await loadRecoveryBundlePayload();
                if (!stagedBundle || typeof stagedBundle !== 'object' || stagedBundle.kind !== 'remote-bundle') {
                    const rebuilt = await rebuildPullRecoveryBundleFromRemote(lock);
                    if (rebuilt && rebuilt.changed) {
                        return await handoffRecoveryLockToPendingState(lock, rebuilt.remoteSha, rebuilt.message);
                    }
                    stagedBundle = rebuilt && rebuilt.bundle ? rebuilt.bundle : null;
                }
                if (!stagedBundle || typeof stagedBundle !== 'object' || stagedBundle.kind !== 'remote-bundle') {
                    throw new Error(textByLang('未找到可用的拉取恢复缓存，请重新发起拉取', 'A usable staged pull bundle was not found. Please start the pull again.'));
                }

                updateSyncUiProgress(textByLang('校验上次拉取对应的云端版本...', 'Verifying the cloud revision for the previous pull...'), 46);
                let currentPullRemoteSha = '';
                try {
                    currentPullRemoteSha = await readCurrentRemoteManagedRevision(stagedBundle.rootPath || (settings && settings.obsidianExportRoot));
                } catch (error) {
                    throw new Error(textByLang(
                        `无法校验拉取目标版本：${error && error.message ? error.message : String(error)}`,
                        `Unable to verify the target revision for the previous pull: ${error && error.message ? error.message : String(error)}`
                    ));
                }
                const expectedPullRemoteSha = String(lock.targetRemoteSha || '').trim();
                if (String(currentPullRemoteSha || '').trim() !== expectedPullRemoteSha) {
                    return await handoffRecoveryLockToPendingState(
                        lock,
                        currentPullRemoteSha,
                        textByLang(
                            '上次拉取对应的云端版本已变化，无法继续原目标包，请重新选择处理方式。',
                            'The cloud revision for the previous pull has changed. Re-choose how to handle it.'
                        )
                    );
                }

                updateRecoveryLockState({ stage: 'applying-local' });
                updateSyncUiProgress(
                    lock.mode === 'full'
                        ? textByLang('继续完成上次同步中的拉取阶段...', 'Continuing the pull stage from the previous sync...')
                        : (lock.mode === 'first-sync-cloud'
                            ? textByLang('继续完成上次首次同步...', 'Continuing the previous first sync...')
                            : textByLang('继续应用上次云端覆盖...', 'Continuing the previous cloud overwrite...')),
                    56
                );
                const pullResult = await applyPreparedRemoteBundleToLocal(
                    stagedBundle,
                    lock.trigger || 'recovery-pull',
                    {
                        permanentPullMode: lock.mode === 'first-sync-cloud' ? 'overwrite' : ''
                    }
                );
                if (lock.targetPackageHash && pullResult.localPackageHash && pullResult.localPackageHash !== lock.targetPackageHash) {
                    throw new Error(textByLang('恢复覆盖后本地状态仍未达到目标包，请稍后重试', 'The local state still does not match the target package after recovery apply. Please retry later.'));
                }
                runtime.lastError = '';
                runtime.lastSuccessAt = Date.now();
                runtime.lastAppliedDirection = lock.mode === 'first-sync-cloud' ? 'first-sync-overwrite' : 'pull';
                runtime.lastRemoteSha = lock.targetRemoteSha || runtime.lastRemoteSha;
                if (pullResult.localPackageHash && pullResult.localPackageHash.startsWith('files:')) {
                    runtime.lastLocalFilesSha = pullResult.localPackageHash;
                }
                if (lock.mode === 'first-sync-cloud') {
                    runtime.lastSyncMode = 'first-sync-cloud';
                    setFirstSyncStatus(textByLang('首次同步完成：已继续完成上次云端覆盖', 'First sync completed: resumed the previous cloud overwrite'), 'ok');
                    setFirstSyncFoldOpen(false);
                }
                saveRuntime();
                await clearRecoverySourceStateAfterSuccess(lock);
                await clearRecoveryLockCompletely();
                clearActiveRunRecoveryRecord();
                handleRecoveryLockReleased();
                renderStatus();
                if (lock.mode === 'full') {
                    updateSyncUiProgress(textByLang('上次同步已恢复完成', 'Previous sync recovery completed'), 100);
                    toast(textByLang('已继续完成上次同步', 'Finished continuing the previous sync'));
                    return true;
                }
                updateSyncUiProgress(
                    lock.mode === 'first-sync-cloud'
                        ? textByLang('上次首次同步已恢复完成', 'Previous first sync recovery completed')
                        : textByLang('上次云端覆盖已恢复完成', 'Previous cloud overwrite recovery completed'),
                    100
                );
                toast(lock.mode === 'first-sync-cloud'
                    ? textByLang('已继续完成上次首次同步', 'Finished continuing the previous first sync')
                    : textByLang('已继续完成上次拉取', 'Finished continuing the previous pull'));
                return true;
            }

            throw new Error(textByLang('当前恢复锁类型暂不支持继续执行', 'The current recovery-lock type is not supported for continuation yet.'));
        } catch (error) {
            runtime.lastError = error && error.message ? error.message : String(error);
            saveRuntime();
            renderStatus();
            toast(textByLang(`恢复失败：${runtime.lastError}`, `Recovery failed: ${runtime.lastError}`));
            return false;
        } finally {
            clearSyncUiProgress();
            syncUiProgressEnabled = false;
            recoveryLockResumeInFlight = false;
            renderRecoveryLockPanel();
            updateSyncEnabledDependentFieldState();
        }
    }


    async function dismissRecoveryLockManually(options = {}) {
        const activeLock = normalizeRecoveryLockRecord(recoveryLockState || loadRecoveryLockState());
        if (!isRecoveryLockActive(activeLock)) return true;
        if (recoveryLockResumeInFlight || (runtime && runtime.isRunning)) {
            toast(textByLang('正在恢复，请等待当前流程结束后再关闭恢复锁', 'Recovery is running. Wait for the current flow to finish before dismissing the lock.'));
            return false;
        }

        await clearRecoveryLockCompletely();
        clearActiveRunRecoveryRecord();
        handleRecoveryLockReleased();

        runtime.lastError = textByLang(
            '你已手动关闭恢复锁；可在策略中手动同步 / 推送 / 拉取。',
            'Recovery lock dismissed manually. You can run sync/push/pull from Strategy.'
        );
        saveRuntime();
        renderRecoveryLockPanel();
        renderStatus();
        renderConflictPanel();
        updateSyncEnabledDependentFieldState();

        toast(textByLang(
            '已关闭恢复锁：现在可手动处理同步方向',
            'Recovery lock dismissed. Manual sync actions are now available.'
        ));

        if (options && options.closePanel === true) {
            const modal = getElement('canvasSyncModal');
            if (modal) {
                modal.style.display = 'none';
            }
            if (!(runtime && runtime.isRunning)) {
                setFloatingProgress(false, '', null);
            } else {
                updateFloatingProgressVisibility();
            }
        }

        return true;
    }

    function cloneSyncJsonValue(value) {
        if (value == null) return value;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            if (Array.isArray(value)) {
                return value.map((item) => cloneSyncJsonValue(item));
            }
            if (typeof value === 'object') {
                return Object.keys(value).reduce((acc, key) => {
                    acc[key] = cloneSyncJsonValue(value[key]);
                    return acc;
                }, {});
            }
            return value;
        }
    }

    function isCanvasTempStatePayloadForSync(state) {
        return !!(
            state
            && typeof state === 'object'
            && (
                Array.isArray(state.sections)
                || Array.isArray(state.tempSections)
                || Array.isArray(state.mdNodes)
                || Array.isArray(state.cards)
                || Array.isArray(state.edges)
            )
        );
    }

    function isSandboxImportedNodeForSync(node) {
        if (!node || typeof node !== 'object') return false;
        if (String(node.__importMode || '') === 'sandbox') return true;
        if (node.subtype === 'import-container' && String(node.importMode || '') === 'sandbox') return true;
        return false;
    }

    function isPermanentCanvasNodeIdForSync(nodeId) {
        const id = String(nodeId || '').trim();
        return !!(id && (id === 'permanent-section' || id.startsWith('permanent-section-copy-')));
    }

    function buildPersistedCanvasTempStateForSync(stateInput, fallbackStateInput = null) {
        const state = stateInput && typeof stateInput === 'object' ? stateInput : {};
        const fallbackState = fallbackStateInput && typeof fallbackStateInput === 'object' ? fallbackStateInput : {};
        const sourceSections = Array.isArray(state.sections)
            ? state.sections
            : (Array.isArray(state.tempSections) ? state.tempSections : []);
        const sourceMdNodes = Array.isArray(state.mdNodes)
            ? state.mdNodes
            : (Array.isArray(state.cards) ? state.cards : []);
        const sourceEdges = Array.isArray(state.edges) ? state.edges : [];

        const protocolBridge = global && global.CanvasProtocolBridge && typeof global.CanvasProtocolBridge.normalizeCanvasTempState === 'function'
            ? global.CanvasProtocolBridge
            : null;
        if (protocolBridge) {
            try {
                const normalized = protocolBridge.normalizeCanvasTempState({
                    ...state,
                    sections: sourceSections,
                    mdNodes: sourceMdNodes,
                    edges: sourceEdges
                });
                if (normalized && typeof normalized === 'object') {
                    const normalizedSections = Array.isArray(normalized.sections) ? normalized.sections : [];
                    const normalizedMdNodes = Array.isArray(normalized.mdNodes) ? normalized.mdNodes : [];
                    const normalizedEdges = Array.isArray(normalized.edges) ? normalized.edges : [];
                    const timestamp = Number(normalized.timestamp) || Number(state.timestamp) || Number(fallbackState.timestamp) || 0;
                    const tempSectionCounter = Number(normalized.tempSectionCounter) || Number(state.tempSectionCounter) || Number(fallbackState.tempSectionCounter) || normalizedSections.length;
                    const tempItemCounter = Number(normalized.tempItemCounter) || Number(state.tempItemCounter) || Number(fallbackState.tempItemCounter) || 0;
                    const colorCursor = Number(normalized.colorCursor) || Number(state.colorCursor) || Number(fallbackState.colorCursor) || 0;
                    const mdNodeCounter = Number(normalized.mdNodeCounter) || Number(state.mdNodeCounter) || Number(fallbackState.mdNodeCounter) || normalizedMdNodes.length;
                    const edgeCounter = Number(normalized.edgeCounter) || Number(state.edgeCounter) || Number(fallbackState.edgeCounter) || normalizedEdges.length;

                    return {
                        sections: normalizedSections,
                        tempSectionCounter,
                        tempItemCounter,
                        colorCursor,
                        tempSectionLastColor: normalized.tempSectionLastColor || state.tempSectionLastColor || fallbackState.tempSectionLastColor || null,
                        tempSectionPrevColor: normalized.tempSectionPrevColor || state.tempSectionPrevColor || fallbackState.tempSectionPrevColor || null,
                        mdNodes: normalizedMdNodes,
                        mdNodeCounter,
                        edges: normalizedEdges,
                        edgeCounter,
                        timestamp
                    };
                }
            } catch (_) { }
        }

        const persistedSections = sourceSections
            .map((section) => cloneSyncJsonValue(section))
            .filter((section) => !!section && !isSandboxImportedNodeForSync(section));
        const persistedMdNodes = sourceMdNodes
            .map((node) => cloneSyncJsonValue(node))
            .filter((node) => !!node && !isSandboxImportedNodeForSync(node));

        const validIds = new Set();
        persistedSections.forEach((section) => {
            if (section && section.id) validIds.add(section.id);
        });
        persistedMdNodes.forEach((node) => {
            if (node && node.id) validIds.add(node.id);
        });

        const persistedEdges = sourceEdges
            .map((edge) => cloneSyncJsonValue(edge))
            .filter((edge) => {
                if (!edge || typeof edge !== 'object') return false;
                const fromNode = String(edge.fromNode || '');
                const toNode = String(edge.toNode || '');
                if (!fromNode || !toNode) return false;
                const fromValid = validIds.has(fromNode) || isPermanentCanvasNodeIdForSync(fromNode);
                const toValid = validIds.has(toNode) || isPermanentCanvasNodeIdForSync(toNode);
                return fromValid && toValid;
            });

        const timestamp = Number(state.timestamp) || Number(fallbackState.timestamp) || 0;
        const tempSectionCounter = Number(state.tempSectionCounter) || Number(fallbackState.tempSectionCounter) || persistedSections.length;
        const tempItemCounter = Number(state.tempItemCounter) || Number(fallbackState.tempItemCounter) || 0;
        const colorCursor = Number(state.colorCursor) || Number(fallbackState.colorCursor) || 0;
        const mdNodeCounter = Number(state.mdNodeCounter) || Number(fallbackState.mdNodeCounter) || persistedMdNodes.length;
        const edgeCounter = Number(state.edgeCounter) || Number(fallbackState.edgeCounter) || persistedEdges.length;

        return {
            sections: persistedSections,
            tempSectionCounter,
            tempItemCounter,
            colorCursor,
            tempSectionLastColor: state.tempSectionLastColor || fallbackState.tempSectionLastColor || null,
            tempSectionPrevColor: state.tempSectionPrevColor || fallbackState.tempSectionPrevColor || null,
            mdNodes: persistedMdNodes,
            mdNodeCounter,
            edges: persistedEdges,
            edgeCounter,
            timestamp
        };
    }

    function getLiveCanvasTempStateForSync(rawInput = null) {
        const liveState = global.CanvasModule && global.CanvasModule.CanvasState
            ? global.CanvasModule.CanvasState
            : (global.CanvasState && typeof global.CanvasState === 'object' ? global.CanvasState : null);
        if (!liveState || typeof liveState !== 'object') return null;
        if (!Array.isArray(liveState.tempSections) && !Array.isArray(liveState.mdNodes) && !Array.isArray(liveState.edges)) {
            return null;
        }
        return buildPersistedCanvasTempStateForSync({
            tempSections: Array.isArray(liveState.tempSections) ? liveState.tempSections : [],
            tempSectionCounter: liveState.tempSectionCounter,
            tempItemCounter: liveState.tempItemCounter,
            colorCursor: liveState.colorCursor,
            tempSectionLastColor: liveState.tempSectionLastColor || null,
            tempSectionPrevColor: liveState.tempSectionPrevColor || null,
            mdNodes: Array.isArray(liveState.mdNodes) ? liveState.mdNodes : [],
            mdNodeCounter: liveState.mdNodeCounter,
            edges: Array.isArray(liveState.edges) ? liveState.edges : [],
            edgeCounter: liveState.edgeCounter,
            timestamp: Number((rawInput && rawInput.timestamp) || 0)
        }, rawInput && typeof rawInput === 'object' ? rawInput : null);
    }

    async function resolveCanvasTempStateForSync(rawInput = '') {
        const parsedRaw = safeParse(rawInput, null);
        const livePayload = getLiveCanvasTempStateForSync(parsedRaw);
        if (livePayload) return livePayload;

        if (isCanvasTempStatePayloadForSync(parsedRaw)) {
            return buildPersistedCanvasTempStateForSync(parsedRaw);
        }

        return null;
    }

    function normalizeCanvasTempStatePayloadForSync(stateInput, fallbackStateInput = null) {
        const parsedState = typeof stateInput === 'string' ? safeParse(stateInput, null) : stateInput;
        if (!isCanvasTempStatePayloadForSync(parsedState)) {
            return null;
        }
        return buildPersistedCanvasTempStateForSync(parsedState, fallbackStateInput);
    }

    function readLimitedCache(cacheMap, key) {
        if (!(cacheMap instanceof Map)) return undefined;
        if (!cacheMap.has(key)) return undefined;
        const value = cacheMap.get(key);
        cacheMap.delete(key);
        cacheMap.set(key, value);
        return value;
    }

    function writeLimitedCache(cacheMap, key, value, maxEntries = TEMP_STATE_CACHE_MAX_ENTRIES) {
        if (!(cacheMap instanceof Map)) return;
        if (cacheMap.has(key)) {
            cacheMap.delete(key);
        }
        cacheMap.set(key, value);
        const safeMax = Math.max(1, Number(maxEntries) || TEMP_STATE_CACHE_MAX_ENTRIES);
        while (cacheMap.size > safeMax) {
            const oldestKey = cacheMap.keys().next().value;
            cacheMap.delete(oldestKey);
        }
    }

    function buildNormalizedCanvasTempStateRawForSync(rawInput = '', fallbackStateInput = null) {
        const canUseCache = typeof rawInput === 'string' && !fallbackStateInput;
        if (canUseCache) {
            const cached = readLimitedCache(tempStateNormalizedRawCache, rawInput);
            if (typeof cached === 'string') return cached;
        }
        const normalizedState = normalizeCanvasTempStatePayloadForSync(rawInput, fallbackStateInput);
        const normalizedRaw = normalizedState ? JSON.stringify(normalizedState) : '';
        if (canUseCache) {
            writeLimitedCache(tempStateNormalizedRawCache, rawInput, normalizedRaw);
        }
        return normalizedRaw;
    }

    function compareCanvasTempStateIdsForSync(left, right) {
        return String(left || '').localeCompare(String(right || ''), undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    }

    function normalizeCanvasTempStateNumberForSync(value) {
        const normalized = Number(value);
        return Number.isFinite(normalized) ? normalized : null;
    }

    function buildComparableTempSectionEntryForSync(sectionInput) {
        const section = sectionInput && typeof sectionInput === 'object' ? sectionInput : null;
        if (!section) return null;

        const protocolBridge = global && global.CanvasProtocolBridge ? global.CanvasProtocolBridge : null;
        let normalizedProtocol = null;
        if (protocolBridge && typeof protocolBridge.normalizeTempSectionProtocol === 'function') {
            try {
                normalizedProtocol = protocolBridge.normalizeTempSectionProtocol(section);
            } catch (_) {
                normalizedProtocol = null;
            }
        }

        const sectionMeta = normalizedProtocol && normalizedProtocol.sectionMeta && typeof normalizedProtocol.sectionMeta === 'object'
            ? normalizedProtocol.sectionMeta
            : {};
        const bookmarkTree = normalizedProtocol && normalizedProtocol.bookmarkTree
            ? cloneSyncJsonValue(normalizedProtocol.bookmarkTree)
            : null;

        return {
            id: String(section.id || '').trim(),
            x: normalizeCanvasTempStateNumberForSync(section.x),
            y: normalizeCanvasTempStateNumberForSync(section.y),
            width: normalizeCanvasTempStateNumberForSync(section.width),
            height: normalizeCanvasTempStateNumberForSync(section.height),
            color: String(section.color || '').trim(),
            isSnapshot: section.isSnapshot === true,
            sectionMeta: {
                label: String(sectionMeta.label || '').trim(),
                title: String(sectionMeta.title || section.title || '').trim(),
                source: String(sectionMeta.source || '').trim(),
                sequenceNumber: normalizeCanvasTempStateNumberForSync(sectionMeta.sequenceNumber),
                descriptionMd: String(sectionMeta.descriptionMd || '').trim()
            },
            bookmarkTree
        };
    }

    function buildComparableMdNodeEntryForSync(nodeInput) {
        const node = nodeInput && typeof nodeInput === 'object' ? nodeInput : null;
        if (!node) return null;

        if (node.subtype === 'import-container') {
            return {
                id: String(node.id || '').trim(),
                subtype: 'import-container',
                x: normalizeCanvasTempStateNumberForSync(node.x),
                y: normalizeCanvasTempStateNumberForSync(node.y),
                width: normalizeCanvasTempStateNumberForSync(node.width),
                height: normalizeCanvasTempStateNumberForSync(node.height),
                groupLabel: String(node.groupLabel || '').trim(),
                groupHint: String(node.groupHint || '').trim(),
                color: String(node.color || '').trim(),
                colorHex: String(node.colorHex || '').trim(),
                style: String(node.style || '').trim(),
                importMode: String(node.importMode || '').trim(),
                containedTempIds: (Array.isArray(node.containedTempIds) ? node.containedTempIds : [])
                    .map((id) => String(id || '').trim())
                    .filter(Boolean)
                    .sort(compareCanvasTempStateIdsForSync),
                containedMdIds: (Array.isArray(node.containedMdIds) ? node.containedMdIds : [])
                    .map((id) => String(id || '').trim())
                    .filter(Boolean)
                    .sort(compareCanvasTempStateIdsForSync)
            };
        }

        const protocolBridge = global && global.CanvasProtocolBridge ? global.CanvasProtocolBridge : null;
        let normalizedNode = node;
        if (protocolBridge && typeof protocolBridge.normalizeBlankMarkdownNode === 'function') {
            try {
                normalizedNode = protocolBridge.normalizeBlankMarkdownNode(node, { refreshCachesFromMarkdown: true }) || node;
            } catch (_) {
                normalizedNode = node;
            }
        }

        return {
            id: String(normalizedNode.id || '').trim(),
            subtype: String(normalizedNode.subtype || '').trim(),
            source: String(normalizedNode.source || '').trim(),
            x: normalizeCanvasTempStateNumberForSync(normalizedNode.x),
            y: normalizeCanvasTempStateNumberForSync(normalizedNode.y),
            width: normalizeCanvasTempStateNumberForSync(normalizedNode.width),
            height: normalizeCanvasTempStateNumberForSync(normalizedNode.height),
            color: String(normalizedNode.color || '').trim(),
            colorHex: String(normalizedNode.colorHex || '').trim(),
            markdownSource: String(normalizedNode.markdownSource || '').replace(/\r\n?/g, '\n'),
            text: String(normalizedNode.text || '').replace(/\r\n?/g, '\n')
        };
    }

    function buildComparableEdgeEntryForSync(edgeInput) {
        const edge = edgeInput && typeof edgeInput === 'object' ? edgeInput : null;
        if (!edge) return null;
        return {
            id: String(edge.id || '').trim(),
            fromNode: String(edge.fromNode || '').trim(),
            fromSide: String(edge.fromSide || '').trim(),
            toNode: String(edge.toNode || '').trim(),
            toSide: String(edge.toSide || '').trim(),
            label: String(edge.label || '').trim(),
            color: String(edge.color || '').trim(),
            colorHex: String(edge.colorHex || '').trim(),
            style: String(edge.style || '').trim()
        };
    }

    function buildCanvasTempStateComparableString(rawInput = '') {
        const canUseCache = typeof rawInput === 'string';
        if (canUseCache) {
            const cached = readLimitedCache(tempStateComparableCache, rawInput);
            if (typeof cached === 'string') return cached;
        }

        let payload = null;
        if (typeof rawInput === 'string') {
            const normalizedRaw = buildNormalizedCanvasTempStateRawForSync(rawInput);
            payload = normalizedRaw ? safeParse(normalizedRaw, null) : null;
        } else {
            payload = normalizeCanvasTempStatePayloadForSync(rawInput);
        }

        let comparable = '';
        if (!payload) {
            comparable = String(rawInput || '');
            if (canUseCache) {
                writeLimitedCache(tempStateComparableCache, rawInput, comparable);
            }
            return comparable;
        }
        const comparableSections = (Array.isArray(payload.sections) ? payload.sections : [])
            .map(buildComparableTempSectionEntryForSync)
            .filter(Boolean)
            .sort((a, b) => compareCanvasTempStateIdsForSync(a.id, b.id));
        const comparableMdNodes = (Array.isArray(payload.mdNodes) ? payload.mdNodes : [])
            .map(buildComparableMdNodeEntryForSync)
            .filter(Boolean)
            .sort((a, b) => compareCanvasTempStateIdsForSync(a.id, b.id));
        const comparableEdges = (Array.isArray(payload.edges) ? payload.edges : [])
            .map(buildComparableEdgeEntryForSync)
            .filter(Boolean)
            .sort((a, b) => {
                const byId = compareCanvasTempStateIdsForSync(a.id, b.id);
                if (byId !== 0) return byId;
                const byFrom = compareCanvasTempStateIdsForSync(a.fromNode, b.fromNode);
                if (byFrom !== 0) return byFrom;
                return compareCanvasTempStateIdsForSync(a.toNode, b.toNode);
            });
        // Compare only sync-semantic temp content here.
        // Runtime allocators/cursors can legitimately diverge after protocol rebuilds
        // and should not be treated as user-visible content changes.
        comparable = JSON.stringify({
            sections: comparableSections,
            mdNodes: comparableMdNodes,
            edges: comparableEdges
        });
        if (canUseCache) {
            writeLimitedCache(tempStateComparableCache, rawInput, comparable);
        }
        return comparable;
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

    function bindSyncMetaStorageChangeListener() {
        if (syncMetaStorageChangeBound) return;
        const api = getRuntimeApi();
        if (!api || !api.storage || !api.storage.onChanged || typeof api.storage.onChanged.addListener !== 'function') {
            return;
        }

        syncMetaStorageChangeBound = true;
        api.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local' || !changes || typeof changes !== 'object') return;

            let recoveryChanged = false;
            SYNC_META_KEYS.forEach((key) => {
                if (!Object.prototype.hasOwnProperty.call(changes, key)) return;
                const change = changes[key];
                if (!change || typeof change !== 'object') return;
                const nextValue = change.newValue;
                if (nextValue === null || typeof nextValue === 'undefined') {
                    delete syncMetaStorageCache[key];
                } else {
                    syncMetaStorageCache[key] = String(nextValue);
                }
                if (key === RECOVERY_KEY) {
                    recoveryChanged = true;
                }
            });

            if (recoveryChanged) {
                renderRecoverySnapshotDownloadStatus();
                updateSyncEnabledDependentFieldState();
            }
        });
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
        if (value === 'keep_newer' || value === 'latest' || value === 'latest_modified') {
            return 'newer';
        }
        if (value === 'manual_panel' || value === 'keep_larger' || value === 'keep_both') {
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

    function toSafeInt(value, fallback) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return fallback;
        return parsed;
    }

    function toSafeNumber(value, fallback) {
        const parsed = Number.parseFloat(value);
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
            Math.min(CUSTOM_UPLOAD_INTERVAL_SECONDS_RANGE.max, toSafeNumber(fallback, 5))
        );
        const seconds = toSafeNumber(value, safeFallback);
        const normalized = Math.max(
            CUSTOM_UPLOAD_INTERVAL_SECONDS_RANGE.min,
            Math.min(CUSTOM_UPLOAD_INTERVAL_SECONDS_RANGE.max, seconds)
        );
        if (normalized <= 0) return 0;
        return Math.round(normalized * 10) / 10;
    }

    function normalizeObsidianExportFormat(value, fallback = DEFAULT_SETTINGS.obsidianExportFormat) {
        const format = String(value || '').trim().toLowerCase();
        return OBSIDIAN_EXPORT_FORMATS.has(format) ? format : fallback;
    }

    function getCurrentObsidianExportFormatForSync() {
        return normalizeObsidianExportFormat(
            settings && settings.obsidianExportFormat,
            DEFAULT_SETTINGS.obsidianExportFormat
        );
    }

    function getStoredSyncedObsidianExportFormat() {
        const raw = String(getSyncMetaRaw(LAST_SYNC_EXPORT_FORMAT_KEY) || '').trim();
        return raw ? normalizeObsidianExportFormat(raw, '') : '';
    }

    function setStoredSyncedObsidianExportFormat(format) {
        const normalized = normalizeObsidianExportFormat(format, '');
        setSyncMetaRaw(LAST_SYNC_EXPORT_FORMAT_KEY, normalized || null);
        return normalized;
    }

    function hasPendingLocalObsidianExportFormatChange() {
        const currentFormat = getCurrentObsidianExportFormatForSync();
        const storedFormat = getStoredSyncedObsidianExportFormat();
        return !!(currentFormat && storedFormat && currentFormat !== storedFormat);
    }

    function formatObsidianExportFormatLabel(format) {
        const normalized = normalizeObsidianExportFormat(format, '');
        if (normalized === 'json') return textByLang('JSON模式（供AI）', 'JSON mode (for AI)');
        if (normalized === 'visual-no-icon') return textByLang('视觉模式（无图标）', 'Visual mode (no icon)');
        if (normalized === 'visual') return textByLang('视觉模式', 'Visual mode');
        return '';
    }

    function resolveObsidianExportFormatMigration(remoteState) {
        const currentFormat = getCurrentObsidianExportFormatForSync();
        const remoteFormat = normalizeObsidianExportFormat(remoteState && remoteState.exportFormat, '');
        const storedFormat = getStoredSyncedObsidianExportFormat();
        const baseFormat = remoteFormat || storedFormat;
        const hasRemoteFiles = !!(
            remoteState
            && remoteState.notFound !== true
            && remoteState.remoteList
            && Array.isArray(remoteState.remoteList.files)
            && remoteState.remoteList.files.length > 0
        );
        const remoteMissing = !!(remoteState && remoteState.notFound === true);

        if (!currentFormat || !baseFormat || baseFormat === currentFormat) {
            return null;
        }
        if (!hasRemoteFiles && !remoteMissing && remoteState) {
            return null;
        }

        return {
            currentFormat,
            baseFormat,
            remoteFormat,
            storedFormat,
            remoteMissing,
            source: remoteFormat ? 'remote' : 'local-meta'
        };
    }

    function adoptRemoteObsidianExportFormat(remoteFormat, options = {}) {
        const normalized = normalizeObsidianExportFormat(remoteFormat, '');
        if (!normalized) return false;

        let changed = false;
        if (settings) {
            const currentFormat = normalizeObsidianExportFormat(
                settings.obsidianExportFormat,
                DEFAULT_SETTINGS.obsidianExportFormat
            );
            if (currentFormat !== normalized) {
                settings.obsidianExportFormat = normalized;
                saveSettings();
                if (options.applyForm !== false) {
                    applySettingsToForm();
                }
                changed = true;
            }
        }

        setStoredSyncedObsidianExportFormat(normalized);
        return changed;
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
        // Main UI no longer exposes Git-style sync methods; normalize legacy values
        // back to the standard sync path to avoid hidden behavior changes.
        merged.syncMethod = DEFAULT_SETTINGS.syncMethod;
        merged.toastEnabled = merged.toastEnabled !== false;
        delete merged.pushOnSync;
        delete merged.pullOnSync;

        merged.firstSyncMode = ensureFirstSyncMode(merged.firstSyncMode);
        merged.permanentPullMode = ensurePermanentPullMode(merged.permanentPullMode);
        merged.permanentIncrementalMaxChanges = normalizePermanentIncrementalMaxChanges(
            merged.permanentIncrementalMaxChanges,
            DEFAULT_SETTINGS.permanentIncrementalMaxChanges
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
        try {
            global.dispatchEvent(new CustomEvent('canvas-obsidian-git-sync-settings-updated', {
                detail: {
                    enabled: !!(settings && settings.enabled)
                }
            }));
        } catch (_) { }
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

        const rawType = String(rawMeta.type || '').trim().toLowerCase();
        if (!rawType) return null;
        const isBlankType = rawType === 'blank' || rawType === 'blank-native-text' || rawType === 'md';
        const type = isBlankType ? 'blank' : rawType;

        const meta = { type };
        if (type === 'temporary') {
            const sectionId = String(rawMeta.sectionId || '').trim();
            if (sectionId) meta.sectionId = sectionId;
            const sectionSerial = normalizeTemporarySerial(rawMeta.sectionSerial || rawMeta.sectionLabel);
            if (sectionSerial) meta.sectionSerial = sectionSerial;
        } else if (type === 'blank') {
            const nodeId = String(rawMeta.nodeId || rawMeta.id || '').trim();
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
        if (text.includes('format-migration')) return true;
        return text.includes('first-sync') || text.includes('bootstrap') || text.includes('startup');
    }

    function shouldForceWriteAllFilesForPush(trigger) {
        const text = String(trigger || '').toLowerCase();
        if (!text) return false;
        return text.includes('first-sync') || text.includes('bootstrap') || text.includes('format-migration');
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
            if (!allPermanentPaths.length || allPermanentPaths.every((path) => syncedSet.has(path))) {
                dirty.permanent.all = false;
            }
        }

        if (dirty.temporary.all) {
            const allTemporaryPaths = uniqueStringList(typedPaths.allTemporaryPaths, normalizeSyncPath);
            if (!allTemporaryPaths.length || allTemporaryPaths.every((path) => syncedSet.has(path))) {
                dirty.temporary.all = false;
            }
        }

        if (dirty.blank.all) {
            const allBlankPaths = uniqueStringList(typedPaths.allBlankPaths, normalizeSyncPath);
            if (!allBlankPaths.length || allBlankPaths.every((path) => syncedSet.has(path))) {
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

    const BOOKMARK_ROOT_KIND_ORDER = {
        bookmark_bar: 1,
        other: 2,
        mobile: 3,
        managed: 4
    };

    function normalizeBookmarkRootFolderType(folderType) {
        const raw = String(folderType || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
        if (!raw) return '';
        if (raw === 'bookmarks-bar' || raw === 'bookmark-bar' || raw === 'favorites-bar') return 'bookmarks-bar';
        if (raw === 'other' || raw === 'other-bookmarks' || raw === 'other-bookmark' || raw === 'other-favorites' || raw === 'other-favorite') return 'other';
        if (raw === 'mobile' || raw === 'mobile-bookmarks' || raw === 'mobile-bookmark' || raw === 'mobile-favorites' || raw === 'mobile-favorite' || raw === 'synced') return 'mobile';
        if (raw === 'managed' || raw === 'managed-bookmarks' || raw === 'managed-bookmark') return 'managed';
        return raw;
    }

    function normalizeBookmarkRootSyncing(value) {
        if (value === true || value === 1) return true;
        if (value === false || value === 0) return false;
        const text = String(value ?? '').trim().toLowerCase();
        if (!text) return null;
        if (text === 'true' || text === '1') return true;
        if (text === 'false' || text === '0') return false;
        return null;
    }

    function getBookmarkRootKindFromFolderType(folderType) {
        const normalized = normalizeBookmarkRootFolderType(folderType);
        if (normalized === 'bookmarks-bar') return 'bookmark_bar';
        if (normalized === 'other') return 'other';
        if (normalized === 'mobile') return 'mobile';
        if (normalized === 'managed') return 'managed';
        return '';
    }

    function buildBookmarkRootFolderTypeSyncingKey(folderType = '', syncing = null) {
        const normalizedFolderType = normalizeBookmarkRootFolderType(folderType);
        const normalizedSyncing = normalizeBookmarkRootSyncing(syncing);
        if (!normalizedFolderType || normalizedSyncing === null) return '';
        return `folderType:${normalizedFolderType}|syncing:${normalizedSyncing ? 'true' : 'false'}`;
    }

    function normalizeBookmarkRootTitle(title) {
        const text = String(title || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (!text) return '';
        if (
            text === 'bookmark bar'
            || text === 'bookmarks bar'
            || text === 'favorites bar'
            || text === '书签栏'
            || text === '收藏夹栏'
        ) {
            return 'bookmark_bar';
        }
        if (
            text === 'other bookmarks'
            || text === 'other bookmark'
            || text === 'other favorites'
            || text === 'other favorite'
            || text === '其他书签'
            || text === '其他收藏夹'
        ) {
            return 'other';
        }
        if (
            text === 'mobile bookmarks'
            || text === 'mobile bookmark'
            || text === 'mobile favorites'
            || text === 'mobile favorite'
            || text === '移动设备书签'
            || text === '移动收藏夹'
            || text === '手机收藏夹'
            || text === '手机书签'
        ) {
            return 'mobile';
        }
        if (
            text === 'managed bookmarks'
            || text === 'managed bookmark'
        ) {
            return 'managed';
        }
        return `custom:${text}`;
    }

    function getBookmarkRootLegacyMatchKey(node) {
        if (!node || typeof node !== 'object') return '';
        const nodeId = String(node.id || '').trim();
        if (nodeId === '1') return 'bookmark_bar';
        if (nodeId === '2') return 'other';
        if (nodeId === '3') return 'mobile';
        return normalizeBookmarkRootTitle(node.title || node.name || '');
    }

    function getBookmarkRootMatchKeys(node, options = {}) {
        if (!node || typeof node !== 'object') return [];
        const keys = [];
        const pushKey = (value) => {
            const normalizedValue = String(value || '').trim();
            if (!normalizedValue || keys.includes(normalizedValue)) return;
            keys.push(normalizedValue);
        };

        const folderType = normalizeBookmarkRootFolderType(node.folderType || node.folder_type || '');
        const folderTypeCounts = options && options.folderTypeCounts instanceof Map
            ? options.folderTypeCounts
            : null;
        const generalKeyMode = String(options && options.generalKeyMode || 'always').trim().toLowerCase();
        const allowFolderTypeKey = !folderType
            ? false
            : (generalKeyMode !== 'unique_only' || Number(folderTypeCounts && folderTypeCounts.get(folderType) || 0) <= 1);
        const preciseKey = buildBookmarkRootFolderTypeSyncingKey(folderType, node.syncing);
        const legacyKey = getBookmarkRootLegacyMatchKey(node);

        if (preciseKey) {
            pushKey(preciseKey);
        }
        if (allowFolderTypeKey && folderType) {
            pushKey(`folderType:${folderType}`);
        }
        if (legacyKey) {
            pushKey(legacyKey);
        }
        return keys;
    }

    function getBookmarkRootMatchKey(node) {
        return getBookmarkRootMatchKeys(node)[0] || '';
    }

    function buildBookmarkRootFolderTypeCounts(nodes = []) {
        const counts = new Map();
        (Array.isArray(nodes) ? nodes : []).forEach((node) => {
            const folderType = normalizeBookmarkRootFolderType(node && (node.folderType || node.folder_type) || '');
            if (!folderType) return;
            counts.set(folderType, (counts.get(folderType) || 0) + 1);
        });
        return counts;
    }

    function getBookmarkRootComparableKey(node, folderTypeCounts = null) {
        if (!node || typeof node !== 'object') return '';
        const folderType = normalizeBookmarkRootFolderType(node.folderType || node.folder_type || '');
        const legacyKey = getBookmarkRootLegacyMatchKey(node);
        if (folderType) {
            const duplicateCount = folderTypeCounts instanceof Map
                ? Number(folderTypeCounts.get(folderType) || 0)
                : 0;
            if (duplicateCount > 1) {
                const preciseKey = buildBookmarkRootFolderTypeSyncingKey(folderType, node.syncing);
                return preciseKey || legacyKey || `folderType:${folderType}`;
            }
            return `folderType:${folderType}`;
        }
        return legacyKey || 'custom:root';
    }

    function extractBookmarkRootKindForSort(value) {
        const normalizedValue = String(value || '').trim().toLowerCase();
        if (!normalizedValue) return '';
        if (Object.prototype.hasOwnProperty.call(BOOKMARK_ROOT_KIND_ORDER, normalizedValue)) {
            return normalizedValue;
        }
        const folderTypeMatch = /^foldertype:([^|]+)(?:\|.*)?$/.exec(normalizedValue);
        if (folderTypeMatch && folderTypeMatch[1]) {
            return getBookmarkRootKindFromFolderType(folderTypeMatch[1]);
        }
        return normalizedValue;
    }

    function compareBookmarkRootMatchKeys(left, right) {
        const leftKey = String(left || '');
        const rightKey = String(right || '');
        const leftKind = extractBookmarkRootKindForSort(leftKey);
        const rightKind = extractBookmarkRootKindForSort(rightKey);
        const leftOrder = Object.prototype.hasOwnProperty.call(BOOKMARK_ROOT_KIND_ORDER, leftKind)
            ? BOOKMARK_ROOT_KIND_ORDER[leftKind]
            : 100;
        const rightOrder = Object.prototype.hasOwnProperty.call(BOOKMARK_ROOT_KIND_ORDER, rightKind)
            ? BOOKMARK_ROOT_KIND_ORDER[rightKind]
            : 100;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return leftKey.localeCompare(rightKey);
    }

    function setBookmarkRootMatchMapEntry(targetMap, node, value, options = {}) {
        if (!(targetMap instanceof Map) || !node || typeof node !== 'object') return;
        const keys = getBookmarkRootMatchKeys(node, options);
        keys.forEach((key) => {
            if (!targetMap.has(key)) {
                targetMap.set(key, value);
            }
        });
    }

    function getBookmarkRootMatchMapValue(targetMap, node, options = {}) {
        if (!(targetMap instanceof Map) || !node || typeof node !== 'object') return null;
        const keys = getBookmarkRootMatchKeys(node, options);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (targetMap.has(key)) {
                return targetMap.get(key);
            }
        }
        return null;
    }

    function buildCanonicalBookmarkComparableNode(node) {
        if (!node || typeof node !== 'object') return null;
        if (typeof node.url === 'string' && node.url.trim()) {
            const url = String(node.url || '').trim();
            const title = String(node.title || node.name || url).trim() || url;
            return {
                type: 'bookmark',
                title,
                url
            };
        }

        const title = String(node.title || node.name || 'Folder').trim() || 'Folder';
        const children = (Array.isArray(node.children) ? node.children : [])
            .map((child) => buildCanonicalBookmarkComparableNode(child))
            .filter(Boolean);

        return {
            type: 'folder',
            title,
            children
        };
    }

    function buildCanonicalBookmarkTreeComparable(treeSnapshot) {
        const normalized = normalizeBookmarkTreeSnapshot(treeSnapshot);
        if (!normalized) return null;
        const rootNodes = extractBookmarkRootFolders(normalized);
        const folderTypeCounts = buildBookmarkRootFolderTypeCounts(rootNodes);

        const roots = rootNodes
            .map((node) => {
                const rootKey = getBookmarkRootComparableKey(node, folderTypeCounts);
                const normalizedRootKey = rootKey || normalizeBookmarkRootTitle(node && (node.title || node.name) || '') || 'custom:root';
                return {
                    rootKey: normalizedRootKey,
                    children: (Array.isArray(node && node.children) ? node.children : [])
                        .map((child) => buildCanonicalBookmarkComparableNode(child))
                        .filter(Boolean)
                };
            })
            .filter(Boolean)
            .sort((left, right) => compareBookmarkRootMatchKeys(left.rootKey, right.rootKey));

        return [{
            title: '',
            children: roots
        }];
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
	        const normalized = buildCanonicalBookmarkTreeComparable(treeSnapshot);
	        if (!normalized) return '';
	        try {
	            return hashString(JSON.stringify(normalized));
	        } catch (_) {
	            return '';
	        }
	    }

	    // Permanent-section remote -> local overwrite entry (shared by pull-related flows).
	    // Unified callers:
	    // - pull-only (manual-pull)
	    // - conflict panel -> use remote
	    // - full sync when winner resolves to remote pull
	    // - conflict panel -> use remote (via force=true)
	    async function maybeOverwriteLocalPermanentTreeFromRemoteSnapshot(remoteTreeSnapshot, reason, options = {}) {
	        const remoteTree = normalizeBookmarkTreeSnapshot(remoteTreeSnapshot);
	        if (!remoteTree) {
	            return { applied: false, skipped: 'remote-missing' };
	        }
	        const persistRemoteRootMeta = () => {
	            try {
	                const protocolBridge = global && global.CanvasProtocolBridge && typeof global.CanvasProtocolBridge.persistPermanentRootMetaFromTree === 'function'
	                    ? global.CanvasProtocolBridge
	                    : null;
	                if (protocolBridge) {
	                    protocolBridge.persistPermanentRootMetaFromTree(remoteTree);
	                }
	            } catch (_) { }
	        };

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
	            persistRemoteRootMeta();
	            return { applied: false, skipped: 'same' };
	        }

	        const permanentPullMode = ensurePermanentPullMode(
	            options && options.permanentPullMode
	                ? options.permanentPullMode
	                : (settings && settings.permanentPullMode)
	        );
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
	                persistRemoteRootMeta();
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
	            if (incrementalResult && incrementalResult.skipped === 'same') {
	                persistRemoteRootMeta();
	                return {
	                    applied: false,
	                    skipped: 'same',
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
	        persistRemoteRootMeta();

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
	        let normalized = null;
	        try {
	            const protocolBridge = global && global.CanvasProtocolBridge && typeof global.CanvasProtocolBridge.normalizePermanentTreeSnapshot === 'function'
	                ? global.CanvasProtocolBridge
	                : null;
	            if (protocolBridge) {
	                normalized = protocolBridge.normalizePermanentTreeSnapshot(tree);
	                if (normalized && typeof protocolBridge.persistPermanentRootMetaFromTree === 'function') {
	                    try { protocolBridge.persistPermanentRootMetaFromTree(normalized); } catch (_) { }
	                }
	            }
	        } catch (_) { }
	        if (!normalized) {
	            normalized = normalizeBookmarkTreeSnapshot(tree);
	        }
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
        const remoteFolderTypeCounts = buildBookmarkRootFolderTypeCounts(remoteRoots);
        const remoteByTitle = new Map();
        remoteRoots.forEach((node) => {
            setBookmarkRootMatchMapEntry(remoteByTitle, node, node, {
                generalKeyMode: 'unique_only',
                folderTypeCounts: remoteFolderTypeCounts
            });
        });

        const plans = [];
        let logicalChangeCount = 0;
        for (let i = 0; i < localRoots.length; i++) {
            const localRoot = localRoots[i];
            if (!localRoot || !localRoot.id) continue;
            const remoteRoot = getBookmarkRootMatchMapValue(remoteByTitle, localRoot) || remoteRoots[i] || null;
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
        const remoteFolderTypeCounts = buildBookmarkRootFolderTypeCounts(remoteRoots);
        const remoteByTitle = new Map();
        remoteRoots.forEach((node) => {
            setBookmarkRootMatchMapEntry(remoteByTitle, node, node, {
                generalKeyMode: 'unique_only',
                folderTypeCounts: remoteFolderTypeCounts
            });
        });

        return await withPermanentTreeBulkMode(options && options.reason || 'sync-permanent-overwrite', async () => {
            const counters = { folders: 0, bookmarks: 0 };
            for (let i = 0; i < localRoots.length; i++) {
                const localRoot = localRoots[i];
                if (!localRoot || !localRoot.id) continue;

                const remoteRoot = getBookmarkRootMatchMapValue(remoteByTitle, localRoot) || remoteRoots[i] || null;
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
                }
        renderStatus();
        return wasEnabled;
    }

    function dismissOpenSyncActionDialog(result = 'cancel') {
        if (typeof syncActionDialogCleanup !== 'function') return false;
        try {
            syncActionDialogCleanup(result);
            return true;
        } catch (_) {
            return false;
        }
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
                    <div style="margin-bottom: 8px;">Please follow the steps below to ensure Obsidian can locate the exported sync files (.md/.json).</div>
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
                    <div style="margin-bottom: 8px;">请按以下流程选择位置，确保 Obsidian 能正确找到导出的同步文件（.md/.json）。</div>
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

            let settled = false;
            const cleanup = (result) => {
                if (settled) return;
                settled = true;
                if (syncActionDialogCleanup === cleanup) {
                    syncActionDialogCleanup = null;
                }
                try { dialog.remove(); } catch (_) { }
                resolve(result);
            };
            syncActionDialogCleanup = cleanup;

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

    function escapeSyncDialogText(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function openSyncActionDialog(options = {}) {
        return new Promise((resolve) => {
            const existing = document.getElementById('canvasSyncActionDialog');
            if (existing) {
                try { existing.remove(); } catch (_) { }
            }

            const title = String(options.title || textByLang('同步确认', 'Sync Confirmation'));
            const lines = Array.isArray(options.lines) ? options.lines : [];
            const actions = Array.isArray(options.actions) && options.actions.length
                ? options.actions
                : [
                    { id: 'cancel', label: textByLang('取消', 'Cancel'), tone: 'secondary' },
                    { id: 'confirm', label: textByLang('继续', 'Continue'), tone: 'primary' }
                ];
            const keywordExpected = String(options.keywordExpected || '').trim().toUpperCase();
            const keywordLabel = String(options.keywordLabel || textByLang('确认关键词', 'Confirmation keyword'));
            const keywordPlaceholder = String(options.keywordPlaceholder || keywordExpected || 'OVERWRITE');
            const keywordHint = String(options.keywordHint || '');
            const noticeHtml = String(options.noticeHtml || '');
            const dangerActionId = String(options.dangerActionId || 'confirm');
            const dialogMaxWidth = String(options.dialogMaxWidth || 'min(92vw, 660px)');
            const fixedPanelLayout = !!(options && options.fixedPanelLayout);
            const dialogHeight = String(options.dialogHeight || 'min(80vh, 720px)');
            const bodyHtml = lines.map((line) => {
                const text = String(line || '');
                if (!text) return '<div style="height:8px;"></div>';
                return `<div style="font-size:13px; line-height:1.7; color:var(--text-primary); white-space:pre-wrap;">${escapeSyncDialogText(text)}</div>`;
            }).join('');
            const actionHtml = actions.map((action, index) => {
                const actionId = String(action && action.id || `action-${index}`);
                const label = escapeSyncDialogText(action && action.label || actionId);
                const tone = String(action && action.tone || '').trim().toLowerCase();
                const isDanger = actionId === dangerActionId;
                const background = tone === 'secondary'
                    ? 'var(--bg-secondary)'
                    : (isDanger ? 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)' : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)');
                const color = tone === 'secondary' ? 'var(--text-primary)' : '#fff';
                const border = tone === 'secondary'
                    ? '1px solid var(--border-color)'
                    : '1px solid rgba(37, 99, 235, 0.45)';
                return `<button type="button" data-sync-action="${escapeSyncDialogText(actionId)}" class="import-option-btn" style="width:auto; min-width:118px; padding:10px 14px; justify-content:center; background:${background}; color:${color}; border:${border}; box-shadow:none;">${label}</button>`;
            }).join('');
            const keywordHtml = keywordExpected ? `
                <div class="canvas-sync-action-dialog-keyword" style="display:flex; flex-direction:column; gap:8px; margin-top:4px; padding:12px 12px 10px; border-radius:12px; background:color-mix(in srgb, #2563eb 7%, var(--bg-secondary)); border:1px solid color-mix(in srgb, #2563eb 18%, var(--border-color));">
                    <div style="font-size:12px; font-weight:700; color:var(--text-secondary);">${escapeSyncDialogText(keywordLabel)}</div>
                    <input id="canvasSyncActionDialogKeywordInput" type="text" autocomplete="off" spellcheck="false" style="width:100%; box-sizing:border-box; padding:10px 12px; border-radius:10px; border:1px solid var(--border-color); background:var(--bg-primary); color:var(--text-primary); font-weight:700; letter-spacing:0.04em;" placeholder="${escapeSyncDialogText(keywordPlaceholder)}" />
                    ${keywordHint ? `<div style="font-size:12px; line-height:1.5; color:var(--text-secondary);">${escapeSyncDialogText(keywordHint)}</div>` : ''}
                </div>
            ` : '';
            const contentHtml = `
                ${noticeHtml}
                <div class="canvas-sync-action-dialog-lines" style="display:flex; flex-direction:column; gap:8px;">${bodyHtml}</div>
                ${keywordHtml}
            `;
            const dialogContentClass = fixedPanelLayout
                ? 'import-dialog-content canvas-sync-action-dialog-content canvas-sync-action-dialog-content--fixed'
                : 'import-dialog-content';
            const dialogContentStyle = fixedPanelLayout
                ? `width:${escapeSyncDialogText(dialogMaxWidth)}; max-width:${escapeSyncDialogText(dialogMaxWidth)}; height:${escapeSyncDialogText(dialogHeight)}; box-sizing:border-box; border-radius:16px; overflow:hidden;`
                : `width:max-content; max-width:${escapeSyncDialogText(dialogMaxWidth)}; box-sizing:border-box; border-radius:16px; overflow:hidden;`;
            const dialogBodyClass = fixedPanelLayout
                ? 'import-dialog-body canvas-sync-action-dialog-body canvas-sync-action-dialog-body--fixed'
                : 'import-dialog-body';
            const dialogBodyStyle = fixedPanelLayout
                ? 'padding:0; display:flex; flex-direction:column; min-height:0; overflow:hidden;'
                : 'padding:18px; display:flex; flex-direction:column; gap:12px;';
            const dialogBodyHtml = fixedPanelLayout
                ? `<div class="canvas-sync-action-dialog-scroll">${contentHtml}</div><div class="canvas-sync-action-dialog-actions">${actionHtml}</div>`
                : `${contentHtml}<div style="display:flex; justify-content:flex-end; flex-wrap:wrap; gap:10px; margin-top:4px;">${actionHtml}</div>`;

            const dialog = document.createElement('div');
            dialog.className = 'import-dialog';
            dialog.id = 'canvasSyncActionDialog';
            dialog.style.zIndex = '2147483647';
            dialog.innerHTML = `
                <div class="${dialogContentClass}" style="${dialogContentStyle}">
                    <div class="import-dialog-header">
                        <h3>${escapeSyncDialogText(title)}</h3>
                        <button class="import-dialog-close" id="closeCanvasSyncActionDialog" type="button">&times;</button>
                    </div>
                    <div class="${dialogBodyClass}" style="${dialogBodyStyle}">
                        ${dialogBodyHtml}
                    </div>
                </div>
            `;

            const cleanup = (result) => {
                try { dialog.remove(); } catch (_) { }
                resolve(result);
            };

            const keywordInput = () => document.getElementById('canvasSyncActionDialogKeywordInput');
            const isKeywordSatisfied = () => {
                if (!keywordExpected) return true;
                return String((keywordInput() && keywordInput().value) || '').trim().toUpperCase() === keywordExpected;
            };
            const refreshPrimaryState = () => {
                if (!keywordExpected) return;
                const buttons = Array.from(dialog.querySelectorAll('[data-sync-action]'));
                buttons.forEach((button) => {
                    const actionId = String(button.getAttribute('data-sync-action') || '');
                    if (actionId !== dangerActionId) return;
                    const enabled = isKeywordSatisfied();
                    button.disabled = !enabled;
                    button.style.opacity = enabled ? '1' : '0.55';
                    button.style.cursor = enabled ? 'pointer' : 'not-allowed';
                });
            };

            dialog.addEventListener('click', (event) => {
                if (event.target === dialog) cleanup('cancel');
            });

            document.body.appendChild(dialog);

            const closeBtn = document.getElementById('closeCanvasSyncActionDialog');
            if (closeBtn) closeBtn.addEventListener('click', () => cleanup('cancel'));

            const inputEl = keywordInput();
            if (inputEl) {
                refreshPrimaryState();
                setTimeout(() => {
                    try { inputEl.focus(); inputEl.select(); } catch (_) { }
                }, 0);
                inputEl.addEventListener('input', refreshPrimaryState);
                inputEl.addEventListener('keydown', (event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        cleanup('cancel');
                        return;
                    }
                    if (event.key === 'Enter' && isKeywordSatisfied()) {
                        event.preventDefault();
                        cleanup(dangerActionId);
                    }
                });
            }

            Array.from(dialog.querySelectorAll('[data-sync-action]')).forEach((button) => {
                button.addEventListener('click', () => {
                    const actionId = String(button.getAttribute('data-sync-action') || 'cancel');
                    if (actionId === dangerActionId && !isKeywordSatisfied()) {
                        refreshPrimaryState();
                        return;
                    }
                    cleanup(actionId);
                });
            });
        });
    }

    async function requestFirstSyncCloudPermanentApplyConfirmationAsync(treeStats, decision) {
        const stats = treeStats && typeof treeStats === 'object' ? treeStats : { roots: 0, folders: 0, bookmarks: 0 };
        const source = decision && typeof decision === 'object' ? decision : {};
        const applyMode = source.result === 'incremental' ? 'incremental' : 'overwrite';
        const decisionText = formatPermanentPullDecisionText(source);
        const lines = (getSyncLang() === 'en'
            ? [
                'First sync will use cloud as source of truth:',
                applyMode === 'incremental'
                    ? '1) Cloud permanent section will align local browser bookmarks via incremental sync'
                    : '1) Cloud permanent section will overwrite local browser bookmark tree',
                source.reason === 'same'
                    ? '2) Permanent section already matches cloud; other sync files will still continue to align locally'
                    : '2) Cloud sync snapshot/files will still align local sync data',
                decisionText,
                `Cloud stats: roots ${stats.roots}, folders ${stats.folders}, bookmarks ${stats.bookmarks}`
            ]
            : [
                '首次同步将以云端为准：',
                applyMode === 'incremental'
                    ? '1) 永久栏目本次会按增量同步对齐到本地浏览器书签'
                    : '1) 使用云端永久栏目覆盖本地浏览器书签树',
                source.reason === 'same'
                    ? '2) 永久栏目已经与云端一致，其余同步文件仍会继续对齐到本地'
                    : '2) 云端同步快照/文件仍会继续对齐本地同步数据',
                decisionText,
                `云端统计：根目录 ${stats.roots}，文件夹 ${stats.folders}，书签 ${stats.bookmarks}`
            ]);
        const result = await openSyncActionDialog({
            title: textByLang('首次同步确认', 'First Sync Confirmation'),
            lines,
            keywordExpected: 'OVERWRITE',
            keywordLabel: textByLang('输入 OVERWRITE 以继续', 'Type OVERWRITE to continue'),
            keywordHint: textByLang('该操作不会中断其他同步文件的对齐流程。', 'This will not stop the remaining sync-file alignment flow.'),
            actions: [
                { id: 'cancel', label: textByLang('取消', 'Cancel'), tone: 'secondary' },
                { id: 'confirm', label: textByLang('继续首次同步', 'Continue first sync'), tone: 'primary' }
            ]
        });
        return result === 'confirm';
    }

    async function requestFirstSyncLocalOverwriteConfirmationAsync(localStats, remoteStats) {
        const local = localStats && typeof localStats === 'object' ? localStats : { roots: 0, folders: 0, bookmarks: 0 };
        const remote = remoteStats && typeof remoteStats === 'object' ? remoteStats : { roots: 0, folders: 0, bookmarks: 0 };
        const lines = (getSyncLang() === 'en'
            ? [
                'First sync will use local as source of truth:',
                '1) Local permanent section snapshot will overwrite cloud',
                '2) Existing cloud permanent section will be replaced',
                `Local stats: roots ${local.roots}, folders ${local.folders}, bookmarks ${local.bookmarks}`,
                `Cloud stats: roots ${remote.roots}, folders ${remote.folders}, bookmarks ${remote.bookmarks}`
            ]
            : [
                '首次同步将以本地为准：',
                '1) 本地永久栏目快照会覆盖云端',
                '2) 云端现有永久栏目会被替换',
                `本地统计：根目录 ${local.roots}，文件夹 ${local.folders}，书签 ${local.bookmarks}`,
                `云端统计：根目录 ${remote.roots}，文件夹 ${remote.folders}，书签 ${remote.bookmarks}`
            ]);
        const result = await openSyncActionDialog({
            title: textByLang('首次同步确认', 'First Sync Confirmation'),
            lines,
            keywordExpected: 'OVERWRITE',
            keywordLabel: textByLang('输入 OVERWRITE 以继续', 'Type OVERWRITE to continue'),
            actions: [
                { id: 'cancel', label: textByLang('取消', 'Cancel'), tone: 'secondary' },
                { id: 'confirm', label: textByLang('继续首次同步', 'Continue first sync'), tone: 'primary' }
            ]
        });
        return result === 'confirm';
    }

    async function requestOneWayOverwriteConfirmationAsync(mode, summary = {}) {
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

        const lines = (direction === 'pull'
            ? (getSyncLang() === 'en'
                ? [
                    'Pull-only is about to use cloud content to overwrite local data.',
                    'A local recovery snapshot will be saved before overwrite.',
                    ''
                ].concat(detailLinesEn)
                : [
                    '“仅拉取”即将使用云端内容覆盖本地数据。',
                    '执行前会自动保存一份本地恢复快照。',
                    ''
                ].concat(detailLinesZh))
            : (getSyncLang() === 'en'
                ? [
                    'Push-only is about to use local content to overwrite cloud data.',
                    'This operation does not pull cloud content first.',
                    ''
                ].concat(detailLinesEn)
                : [
                    '“仅上传”即将使用本地内容覆盖云端数据。',
                    '该操作不会先拉取云端内容。',
                    ''
                ].concat(detailLinesZh)));

        const result = await openSyncActionDialog({
            title: direction === 'pull'
                ? textByLang('仅拉取确认', 'Pull-only Confirmation')
                : textByLang('仅上传确认', 'Push-only Confirmation'),
            lines,
            keywordExpected: 'OVERWRITE',
            keywordLabel: textByLang('输入 OVERWRITE 以继续', 'Type OVERWRITE to continue'),
            actions: [
                { id: 'cancel', label: textByLang('取消', 'Cancel'), tone: 'secondary' },
                { id: 'confirm', label: textByLang('继续', 'Continue'), tone: 'primary' }
            ]
        });
        return result === 'confirm';
    }

    async function requestFormatMigrationLocalOverwriteConfirmationAsync(formatMigration, options = {}) {
        const migration = formatMigration && typeof formatMigration === 'object' ? formatMigration : {};
        const baseFormatLabel = formatObsidianExportFormatLabel(migration.baseFormat)
            || String(migration.baseFormat || textByLang('旧格式', 'previous format'));
        const currentFormatLabel = formatObsidianExportFormatLabel(migration.currentFormat)
            || String(migration.currentFormat || textByLang('新格式', 'new format'));
        const triggerText = String(options && options.trigger || '').trim();
        const lines = (getSyncLang() === 'en'
            ? [
                'Detected an export format switch.',
                `Format migration: ${baseFormatLabel} -> ${currentFormatLabel}`,
                'To continue, this run must overwrite cloud with local in the new format.',
                'Cloud content in the old format will be replaced.',
                triggerText ? `Trigger: ${triggerText}` : ''
            ]
            : [
                '检测到导出格式已切换。',
                `格式迁移：${baseFormatLabel} -> ${currentFormatLabel}`,
                '继续本次同步需要执行“本地覆盖云端（新格式）”。',
                '云端旧格式内容会被替换。',
                triggerText ? `触发来源：${triggerText}` : ''
            ])
            .filter((line) => !!String(line || '').trim());

        const result = await openSyncActionDialog({
            title: textByLang('格式迁移确认', 'Format Migration Confirmation'),
            lines,
            keywordExpected: 'OVERWRITE',
            keywordLabel: textByLang('输入 OVERWRITE 后可执行“本地覆盖云端”', 'Type OVERWRITE to enable "Local Overwrite Cloud"'),
            keywordHint: textByLang(
                '确认后将按当前格式重新导出，并覆盖云端同步文件。',
                'After confirmation, the current format will be re-exported and cloud sync files will be overwritten.'
            ),
            actions: [
                { id: 'cancel', label: textByLang('取消', 'Cancel'), tone: 'secondary' },
                { id: 'overwrite-cloud', label: textByLang('本地覆盖云端（格式迁移）', 'Local Overwrite Cloud (Format Migration)'), tone: 'primary' }
            ],
            dangerActionId: 'overwrite-cloud'
        });
        return result === 'overwrite-cloud';
    }

    function getFirstSyncDataKeyLabel(key) {
        const rawKey = String(key || '');
        if (rawKey === TEMP_SECTION_STORAGE_KEY) {
            return textByLang('临时/空白画布状态', 'Temporary/blank canvas state');
        }
        if (rawKey === BCS_META_KEY) {
            return textByLang('画布元数据', 'Canvas metadata');
        }
        if (rawKey === BCS_CANVAS_KEY) {
            return textByLang('画布布局(.canvas)', 'Canvas layout (.canvas)');
        }
        if (rawKey === BCS_PERM_MAIN_KEY) {
            return textByLang('永久栏目说明', 'Permanent-section description');
        }
        if (rawKey.startsWith(BCS_PERM_COPY_PREFIX)) {
            return textByLang('永久栏目副本说明', 'Permanent-section copy description');
        }
        if (rawKey.startsWith(BCS_SECTION_PREFIX)) {
            return textByLang('临时栏目分片', 'Temporary section shard');
        }
        if (rawKey.startsWith(BCS_MD_PREFIX)) {
            return textByLang('空白卡片分片', 'Blank card shard');
        }
        switch (rawKey) {
            case 'canvas-appearance-settings-v1':
                return textByLang('外观设置', 'Appearance settings');
            case 'canvas-other-settings-v1':
                return textByLang('其他设置', 'Other settings');
            case PERMANENT_VIEW_SHELL_COMPARE_KEY:
                return textByLang('永久栏目视图壳', 'Permanent view shells');
            default:
                return rawKey || textByLang('未知项', 'Unknown item');
        }
    }

    function buildFirstSyncPermanentRootSummary(localTreeSnapshot, remoteTreeSnapshot) {
        const localRoots = extractBookmarkRootFolders(localTreeSnapshot);
        const remoteRoots = extractBookmarkRootFolders(remoteTreeSnapshot);
        const localFolderTypeCounts = buildBookmarkRootFolderTypeCounts(localRoots);
        const remoteFolderTypeCounts = buildBookmarkRootFolderTypeCounts(remoteRoots);
        const localKeys = uniqueStringList(
            localRoots
                .map((node) => String(getBookmarkRootComparableKey(node, localFolderTypeCounts) || '').trim())
                .filter(Boolean),
            (value) => String(value || '').trim()
        );
        const remoteKeys = uniqueStringList(
            remoteRoots
                .map((node) => String(getBookmarkRootComparableKey(node, remoteFolderTypeCounts) || '').trim())
                .filter(Boolean),
            (value) => String(value || '').trim()
        );
        const localSet = new Set(localKeys);
        const remoteSet = new Set(remoteKeys);
        return {
            localKeys,
            remoteKeys,
            matched: localKeys.filter((key) => remoteSet.has(key)),
            onlyLocal: localKeys.filter((key) => !remoteSet.has(key)),
            onlyRemote: remoteKeys.filter((key) => !localSet.has(key))
        };
    }

    function buildFirstSyncOtherDataComparison(localSnapshotInput, remoteSnapshotInput) {
        const localSnapshot = buildSnapshotForRemoteLocalApply(localSnapshotInput || { data: {} });
        const remoteSnapshot = buildSnapshotForRemoteLocalApply(remoteSnapshotInput || { data: {} });
        const localData = localSnapshot && localSnapshot.data && typeof localSnapshot.data === 'object'
            ? localSnapshot.data
            : {};
        const remoteData = remoteSnapshot && remoteSnapshot.data && typeof remoteSnapshot.data === 'object'
            ? remoteSnapshot.data
            : {};
        const keyStates = SYNC_KEYS.map((key) => {
            const localRaw = typeof localData[key] === 'string' ? localData[key] : '';
            const remoteRaw = typeof remoteData[key] === 'string' ? remoteData[key] : '';
            const localComparable = key === TEMP_SECTION_STORAGE_KEY
                ? buildCanvasTempStateComparableString(localRaw)
                : localRaw;
            const remoteComparable = key === TEMP_SECTION_STORAGE_KEY
                ? buildCanvasTempStateComparableString(remoteRaw)
                : remoteRaw;
            return {
                key,
                label: getFirstSyncDataKeyLabel(key),
                same: localComparable === remoteComparable
            };
        });
        keyStates.push({
            key: PERMANENT_VIEW_SHELL_COMPARE_KEY,
            label: getFirstSyncDataKeyLabel(PERMANENT_VIEW_SHELL_COMPARE_KEY),
            same: buildPermanentViewShellComparableString(localSnapshot && localSnapshot.permanentViewShellSnapshot)
                === buildPermanentViewShellComparableString(remoteSnapshot && remoteSnapshot.permanentViewShellSnapshot)
        });
        const sameCount = keyStates.filter((item) => item.same).length;
        const differingKeys = keyStates.filter((item) => !item.same);
        const tempStateEntry = keyStates.find((item) => item.key === TEMP_SECTION_STORAGE_KEY);
        const shellEntry = keyStates.find((item) => item.key === PERMANENT_VIEW_SHELL_COMPARE_KEY);
        const contentStructureSame = !!(tempStateEntry && tempStateEntry.same && (!shellEntry || shellEntry.same));
        return {
            same: contentStructureSame,
            contentStructureSame,
            totalCount: keyStates.length,
            sameCount,
            diffCount: differingKeys.length,
            differingKeys,
            hiddenSettingDiffCount: differingKeys.filter((item) =>
                item.key !== TEMP_SECTION_STORAGE_KEY && item.key !== PERMANENT_VIEW_SHELL_COMPARE_KEY
            ).length
        };
    }

    function getManagedSyncRelativePath(pathInput, rootPath = '') {
        const path = normalizeSyncPath(pathInput);
        const normalizedRoot = normalizeSyncPath(rootPath);
        if (!path) return '';
        if (!normalizedRoot) return path;
        if (path === normalizedRoot) return '';
        const prefix = `${normalizedRoot}/`;
        if (!path.startsWith(prefix)) return '';
        return path.slice(prefix.length);
    }

    function classifyManagedSyncRelativePath(relativePath) {
        const relative = normalizeSyncPath(relativePath);
        if (!relative) return '';
        if (/^(永久栏目|Permanent)\/.+\.(md|json)$/i.test(relative)) return 'permanent';
        if (/^(临时栏目|Temporary)\/.+\.(md|json)$/i.test(relative)) return 'temporary';
        if (/^(空白栏目|Blank)\/.+\.(md|json)$/i.test(relative)) return 'blank';
        if (/^[^/]+\.canvas$/i.test(relative)) return 'canvas';
        if (/^(说明导入规则\.md|README_Import_Rules\.md|说明_导入规则\.md)$/i.test(relative)) return 'guide';
        return 'other';
    }

    function buildManagedSyncFileStats(filesInput, rootPath = '') {
        const stats = {
            total: 0,
            permanent: 0,
            temporary: 0,
            blank: 0,
            canvas: 0,
            guide: 0,
            other: 0
        };
        const sourceFiles = Array.isArray(filesInput) ? filesInput : [];
        sourceFiles.forEach((entry) => {
            const path = normalizeSyncPath(entry && (entry.path || entry.repoPath));
            const relativePath = getManagedSyncRelativePath(path, rootPath);
            if (!relativePath) return;
            const kind = classifyManagedSyncRelativePath(relativePath);
            if (!kind) return;
            stats.total += 1;
            if (Object.prototype.hasOwnProperty.call(stats, kind)) {
                stats[kind] += 1;
            } else {
                stats.other += 1;
            }
        });
        return stats;
    }

    function decodeManagedSyncBytesToText(bytes) {
        try {
            if (bytes instanceof Uint8Array) {
                return new TextDecoder().decode(bytes);
            }
            if (Array.isArray(bytes)) {
                return new TextDecoder().decode(new Uint8Array(bytes));
            }
        } catch (_) { }
        return '';
    }

    function normalizeManagedSyncTextContent(content) {
        return String(content == null ? '' : content)
            .replace(/^\uFEFF/, '')
            .replace(/\r\n?/g, '\n');
    }

    function buildStableComparableJsonValue(value) {
        if (Array.isArray(value)) {
            return value.map((item) => buildStableComparableJsonValue(item));
        }
        if (value && typeof value === 'object') {
            return Object.keys(value).sort().reduce((acc, key) => {
                acc[key] = buildStableComparableJsonValue(value[key]);
                return acc;
            }, {});
        }
        return value;
    }

    function normalizeManagedSyncComparableContent(pathInput, contentInput) {
        const path = normalizeSyncPath(pathInput);
        const content = normalizeManagedSyncTextContent(contentInput);
        if (path && /\.canvas$/i.test(path)) {
            try {
                const parsed = JSON.parse(content || '{}');
                return JSON.stringify(buildStableComparableJsonValue(parsed));
            } catch (_) {
                return content;
            }
        }
        return content;
    }

    function buildManagedSyncComparableLocalBundle(bundleInput) {
        const bundle = bundleInput && typeof bundleInput === 'object' ? bundleInput : {};
        const rootPath = normalizeSyncPath(bundle.exportRoot || (settings && settings.obsidianExportRoot) || '');
        const files = Array.isArray(bundle.files) ? bundle.files : [];
        const fileMap = new Map();
        files.forEach((file) => {
            const path = normalizeSyncPath(file && file.path);
            if (!path) return;
            fileMap.set(path, normalizeManagedSyncComparableContent(path, file && file.content != null ? file.content : ''));
        });
        return {
            rootPath,
            files,
            fileMap,
            stats: buildManagedSyncFileStats(files, rootPath)
        };
    }

    function buildManagedSyncComparableRemoteFiles(remoteManagedFiles, remoteFolderFiles, remoteRootPath = '') {
        const files = Array.isArray(remoteManagedFiles) ? remoteManagedFiles : [];
        const fileMap = new Map();
        const folderFiles = remoteFolderFiles && typeof remoteFolderFiles.forEach === 'function'
            ? remoteFolderFiles
            : new Map();
        folderFiles.forEach((bytes, rawPath) => {
            const path = normalizeSyncPath(rawPath);
            if (!path) return;
            fileMap.set(path, normalizeManagedSyncComparableContent(path, decodeManagedSyncBytesToText(bytes)));
        });
        return {
            rootPath: normalizeSyncPath(remoteRootPath || (settings && settings.obsidianExportRoot) || ''),
            files,
            fileMap,
            stats: buildManagedSyncFileStats(files, remoteRootPath)
        };
    }

    function compareManagedSyncFileMaps(localFileMapInput, remoteFileMapInput) {
        const localFileMap = localFileMapInput instanceof Map ? localFileMapInput : new Map();
        const remoteFileMap = remoteFileMapInput instanceof Map ? remoteFileMapInput : new Map();
        const allPaths = new Set();
        localFileMap.forEach((_value, key) => allPaths.add(key));
        remoteFileMap.forEach((_value, key) => allPaths.add(key));

        let onlyLocalCount = 0;
        let onlyRemoteCount = 0;
        let changedCount = 0;
        let sameCount = 0;
        const onlyLocalPaths = [];
        const onlyRemotePaths = [];
        const changedPaths = [];

        allPaths.forEach((path) => {
            const hasLocal = localFileMap.has(path);
            const hasRemote = remoteFileMap.has(path);
            if (hasLocal && !hasRemote) {
                onlyLocalCount += 1;
                onlyLocalPaths.push(path);
                return;
            }
            if (!hasLocal && hasRemote) {
                onlyRemoteCount += 1;
                onlyRemotePaths.push(path);
                return;
            }
            if (String(localFileMap.get(path) || '') !== String(remoteFileMap.get(path) || '')) {
                changedCount += 1;
                changedPaths.push(path);
                return;
            }
            sameCount += 1;
        });

        return {
            totalCount: allPaths.size,
            sameCount,
            onlyLocalCount,
            onlyRemoteCount,
            changedCount,
            onlyLocalPaths,
            onlyRemotePaths,
            changedPaths,
            same: onlyLocalCount === 0 && onlyRemoteCount === 0 && changedCount === 0
        };
    }

    function buildManagedSyncDiffReasonText(managedFileComparisonInput, rootPathInput = '') {
        const comparison = managedFileComparisonInput && typeof managedFileComparisonInput === 'object'
            ? managedFileComparisonInput
            : null;
        const diffSummary = comparison && comparison.diffSummary && typeof comparison.diffSummary === 'object'
            ? comparison.diffSummary
            : null;
        if (!comparison || !diffSummary) return '';

        const rootPath = normalizeSyncPath(rootPathInput || comparison.rootPath || '');
        const stats = {
            canvas: 0,
            guide: 0,
            temporary: 0,
            blank: 0,
            permanent: 0,
            other: 0
        };
        const allPaths = []
            .concat(Array.isArray(diffSummary.changedPaths) ? diffSummary.changedPaths : [])
            .concat(Array.isArray(diffSummary.onlyLocalPaths) ? diffSummary.onlyLocalPaths : [])
            .concat(Array.isArray(diffSummary.onlyRemotePaths) ? diffSummary.onlyRemotePaths : []);

        uniqueStringList(allPaths, normalizeSyncPath).forEach((path) => {
            const relative = getManagedSyncRelativePath(path, rootPath) || normalizeSyncPath(path);
            const kind = classifyManagedSyncRelativePath(relative) || 'other';
            if (Object.prototype.hasOwnProperty.call(stats, kind)) {
                stats[kind] += 1;
            } else {
                stats.other += 1;
            }
        });

        const parts = [];
        if (stats.canvas > 0) parts.push(textByLang(`画布文件 ${stats.canvas}`, `Canvas file ${stats.canvas}`));
        if (stats.blank > 0) parts.push(textByLang(`空白栏目文件 ${stats.blank}`, `Blank files ${stats.blank}`));
        if (stats.temporary > 0) parts.push(textByLang(`临时栏目文件 ${stats.temporary}`, `Temporary files ${stats.temporary}`));
        if (stats.guide > 0) parts.push(textByLang(`说明文件 ${stats.guide}`, `Guide files ${stats.guide}`));
        if (stats.permanent > 0) parts.push(textByLang(`永久栏目文件 ${stats.permanent}`, `Permanent files ${stats.permanent}`));
        if (stats.other > 0) parts.push(textByLang(`其他文件 ${stats.other}`, `Other files ${stats.other}`));
        if (!parts.length) return '';
        return textByLang(`变化来源：${parts.join('，')}`, `Changed in: ${parts.join(', ')}`);
    }

    async function buildFirstSyncManagedFileComparison(options = {}) {
        if (settings && settings.obsidianFilePushEnabled === false) return null;
        const bridge = global.CanvasObsidianExportBridge;
        if (!bridge || typeof bridge.buildSyncFiles !== 'function') return null;
        try {
            const localBundle = await bridge.buildSyncFiles({
                exportFormat: settings && settings.obsidianExportFormat,
                exportRoot: settings && settings.obsidianExportRoot
            });
            const localInfo = buildManagedSyncComparableLocalBundle(localBundle);
            const remoteInfo = buildManagedSyncComparableRemoteFiles(
                options && Array.isArray(options.remoteManagedFiles) ? options.remoteManagedFiles : [],
                options && options.remoteFolderFiles,
                options && typeof options.remoteRootPath === 'string' ? options.remoteRootPath : ''
            );
            const diffSummary = compareManagedSyncFileMaps(localInfo.fileMap, remoteInfo.fileMap);
            const resolvedRootPath = remoteInfo.rootPath || localInfo.rootPath || '';
            return {
                same: diffSummary.same,
                rootPath: resolvedRootPath,
                localStats: localInfo.stats,
                remoteStats: remoteInfo.stats,
                diffSummary,
                diffReasonText: buildManagedSyncDiffReasonText({
                    rootPath: resolvedRootPath,
                    diffSummary
                }, resolvedRootPath)
            };
        } catch (error) {
            console.warn('[Canvas Sync] build first-sync managed file comparison failed:', error);
            return null;
        }
    }


    function formatFirstSyncRemoteCommittedAt(ts) {
        const raw = Number(ts) || 0;
        if (raw <= 0) return textByLang('未获取', 'Unavailable');
        return formatTime(raw);
    }

    function extractCanvasSectionCountsFromSnapshot(snapshotInput) {
        const snapshot = normalizeSnapshot(snapshotInput || { data: {} });
        const raw = snapshot && snapshot.data && typeof snapshot.data[TEMP_SECTION_STORAGE_KEY] === 'string'
            ? snapshot.data[TEMP_SECTION_STORAGE_KEY]
            : '';
        const parsed = safeParse(raw, null);
        const payload = isCanvasTempStatePayloadForSync(parsed)
            ? buildPersistedCanvasTempStateForSync(parsed)
            : null;
        const sections = Array.isArray(payload && payload.sections) ? payload.sections : [];
        const mdNodes = Array.isArray(payload && payload.mdNodes)
            ? payload.mdNodes.filter((node) => node && node.subtype !== 'import-container')
            : [];
        return {
            temporary: sections.length,
            blank: mdNodes.length
        };
    }

    function buildFirstSyncModeComparisonSummary(localSnapshotInput, remoteSnapshotInput, options = {}) {
        const localSnapshot = normalizeSnapshot(localSnapshotInput || { data: {} });
        const remoteSnapshot = normalizeSnapshot(remoteSnapshotInput || { data: {} });
        const localPermanentTree = normalizeBookmarkTreeSnapshot(localSnapshot.permanentTreeSnapshot);
        const remotePermanentTree = normalizeBookmarkTreeSnapshot(remoteSnapshot.permanentTreeSnapshot);
        const permanentDecision = evaluatePermanentPullDecision(localPermanentTree, remotePermanentTree);
        const permanentSame = !!(permanentDecision && permanentDecision.reason === 'same');
        const fallbackOtherStateComparison = buildFirstSyncOtherDataComparison(localSnapshot, remoteSnapshot);
        const managedFileComparison = options && options.managedFileComparison && typeof options.managedFileComparison === 'object'
            ? options.managedFileComparison
            : null;
        const localOtherCounts = managedFileComparison && managedFileComparison.localStats
            ? {
                temporary: Math.max(0, Number(managedFileComparison.localStats.temporary) || 0),
                blank: Math.max(0, Number(managedFileComparison.localStats.blank) || 0)
            }
            : extractCanvasSectionCountsFromSnapshot(localSnapshot);
        const remoteOtherCounts = managedFileComparison && managedFileComparison.remoteStats
            ? {
                temporary: Math.max(0, Number(managedFileComparison.remoteStats.temporary) || 0),
                blank: Math.max(0, Number(managedFileComparison.remoteStats.blank) || 0)
            }
            : extractCanvasSectionCountsFromSnapshot(remoteSnapshot);
        const otherStateComparison = managedFileComparison
            ? Object.assign({}, fallbackOtherStateComparison, {
                same: managedFileComparison.same === true,
                contentStructureSame: managedFileComparison.same === true,
                localOtherCounts,
                remoteOtherCounts,
                managedFileComparison,
                diffReasonText: String(managedFileComparison.diffReasonText || '')
            })
            : fallbackOtherStateComparison;
        const otherSame = !!otherStateComparison.same;
        return {
            localSnapshot,
            remoteSnapshot,
            permanentDecision,
            permanentSame,
            otherSame,
            localStats: getBookmarkTreeStats(localPermanentTree),
            remoteStats: getBookmarkTreeStats(remotePermanentTree),
            localOtherCounts,
            remoteOtherCounts,
            permanentRootSummary: buildFirstSyncPermanentRootSummary(localPermanentTree, remotePermanentTree),
            otherStateComparison,
            otherDiffReason: String(otherStateComparison && otherStateComparison.diffReasonText || ''),
            localUpdatedAt: Number(localSnapshot && localSnapshot.updatedAt) || 0,
            remoteUpdatedAt: Number(remoteSnapshot && remoteSnapshot.updatedAt) || 0,
            remoteCommittedAt: Math.max(0, Number(options && options.remoteCommittedAt) || 0)
        };
    }

    function buildSyncStatusBadgeHtml(label, tone = 'diff') {
        const normalizedTone = tone === 'match' || tone === 'warn' ? tone : 'diff';
        return `<span class="canvas-sync-first-check-badge is-${normalizedTone}">${escapeSyncDialogText(label)}</span>`;
    }

    function normalizeComparisonSectionState(state, fallback = 'change') {
        const raw = String(state || '').trim().toLowerCase();
        if (raw === 'same' || raw === 'change' || raw === 'conflict') {
            return raw;
        }
        return fallback === 'same' || fallback === 'conflict' ? fallback : 'change';
    }

    function resolveComparisonSectionState(summaryInput, key, mode = 'change') {
        const summary = summaryInput && typeof summaryInput === 'object' ? summaryInput : {};
        const normalizedKey = key === 'other' ? 'other' : 'permanent';
        const explicitState = normalizedKey === 'permanent'
            ? summary.permanentState
            : summary.otherState;
        if (explicitState) {
            return normalizeComparisonSectionState(explicitState, mode === 'conflict' ? 'conflict' : 'change');
        }
        const isSame = normalizedKey === 'permanent'
            ? !!summary.permanentSame
            : !!summary.otherSame;
        if (isSame) {
            return 'same';
        }
        return mode === 'conflict' ? 'conflict' : 'change';
    }

    function getComparisonSectionStatus(stateInput) {
        const state = normalizeComparisonSectionState(stateInput, 'change');
        if (state === 'same') {
            return {
                badgeLabel: textByLang('结果：一致', 'Result: Match'),
                badgeTone: 'match',
                mergedValue: textByLang('一致', 'Match')
            };
        }
        if (state === 'conflict') {
            return {
                badgeLabel: textByLang('结果：有冲突', 'Result: Conflict'),
                badgeTone: 'warn',
                mergedValue: textByLang('存在冲突', 'Conflict')
            };
        }
        return {
            badgeLabel: textByLang('结果：有变化', 'Result: Changed'),
            badgeTone: 'diff',
            mergedValue: textByLang('有变化', 'Changed')
        };
    }

    function buildComparisonTableData(summaryInput, options = {}) {
        const summary = summaryInput && typeof summaryInput === 'object' ? summaryInput : {};
        const mode = String(options && options.mode || 'change').trim().toLowerCase();
        const includeTimeRow = options && options.includeTimeRow === true;
        const localTs = Math.max(0, Number(options && options.localUpdatedAt) || Number(summary.localUpdatedAt) || 0);
        const remoteTs = Math.max(
            0,
            Number(options && options.remoteUpdatedAt) || Number(summary.remoteCommittedAt) || Number(summary.remoteUpdatedAt) || 0
        );
        const localStats = summary.localStats && typeof summary.localStats === 'object'
            ? summary.localStats
            : { roots: 0, folders: 0, bookmarks: 0 };
        const remoteStats = summary.remoteStats && typeof summary.remoteStats === 'object'
            ? summary.remoteStats
            : { roots: 0, folders: 0, bookmarks: 0 };
        const localOtherCounts = summary.localOtherCounts && typeof summary.localOtherCounts === 'object'
            ? summary.localOtherCounts
            : { temporary: 0, blank: 0 };
        const remoteOtherCounts = summary.remoteOtherCounts && typeof summary.remoteOtherCounts === 'object'
            ? summary.remoteOtherCounts
            : { temporary: 0, blank: 0 };

        const buildRows = (kind) => {
            const rows = [];
            if (includeTimeRow) {
                rows.push({
                    label: textByLang('最新修改时间', 'Latest Modification Time'),
                    local: formatTime(localTs),
                    remote: formatTime(remoteTs)
                });
            }
            if (kind === 'permanent') {
                rows.push(
                    {
                        label: textByLang('根目录数', 'Root Count'),
                        local: String(localStats.roots || 0),
                        remote: String(remoteStats.roots || 0)
                    },
                    {
                        label: textByLang('文件夹数', 'Folder Count'),
                        local: String(localStats.folders || 0),
                        remote: String(remoteStats.folders || 0)
                    },
                    {
                        label: textByLang('书签数', 'Bookmark Count'),
                        local: String(localStats.bookmarks || 0),
                        remote: String(remoteStats.bookmarks || 0)
                    }
                );
                return rows;
            }
            rows.push(
                {
                    label: textByLang('临时栏目数', 'Temporary Section Count'),
                    local: String(localOtherCounts.temporary || 0),
                    remote: String(remoteOtherCounts.temporary || 0)
                },
                {
                    label: textByLang('空白栏目数', 'Blank Section Count'),
                    local: String(localOtherCounts.blank || 0),
                    remote: String(remoteOtherCounts.blank || 0)
                }
            );
            return rows;
        };

        const permanentStatus = getComparisonSectionStatus(resolveComparisonSectionState(summary, 'permanent', mode));
        const otherStatus = getComparisonSectionStatus(resolveComparisonSectionState(summary, 'other', mode));

        return {
            permanent: {
                title: textByLang('永久栏目（浏览器书签）', 'Permanent Section (Browser Bookmarks)'),
                rows: buildRows('permanent'),
                mergedLabel: textByLang('整体内容与结构', 'Overall Content & Structure'),
                mergedValue: permanentStatus.mergedValue,
                badgeLabel: permanentStatus.badgeLabel,
                badgeTone: permanentStatus.badgeTone
            },
            other: {
                title: textByLang('其他同步数据', 'Other Sync Data'),
                rows: buildRows('other'),
                mergedLabel: textByLang('整体内容与结构', 'Overall Content & Structure'),
                mergedValue: otherStatus.mergedValue,
                badgeLabel: otherStatus.badgeLabel,
                badgeTone: otherStatus.badgeTone,
                note: String(summary.otherDiffReason || '')
            }
        };
    }

    function buildFirstSyncTableData(summaryInput) {
        return buildComparisonTableData(summaryInput, {
            mode: 'change',
            includeTimeRow: false
        });
    }

    function buildSyncStatusTableSectionHtml(sectionInput) {
        const section = sectionInput && typeof sectionInput === 'object' ? sectionInput : {};
        const rows = Array.isArray(section.rows) ? section.rows : [];
        const tone = String(section.badgeTone || '').trim().toLowerCase();
        const badgeTone = tone === 'match' || tone === 'warn' ? tone : 'diff';
        const badgeLabel = String(section.badgeLabel || '').trim();
        const rowHtml = rows.map((row) => `
            <tr>
                <th scope="row">${escapeSyncDialogText(row && row.label || '')}</th>
                <td>${escapeSyncDialogText(row && row.local || '-')}</td>
                <td>${escapeSyncDialogText(row && row.remote || '-')}</td>
            </tr>
        `).join('');
        return `
            <section class="canvas-sync-first-table-section">
                <div class="canvas-sync-first-table-head">
                    <div class="canvas-sync-first-table-title">${escapeSyncDialogText(section.title || '')}</div>
                    ${badgeLabel ? buildSyncStatusBadgeHtml(badgeLabel, badgeTone) : ''}
                </div>
                <div class="canvas-sync-first-table-wrap">
                    <table class="canvas-sync-first-table">
                        <thead>
                            <tr>
                                <th>${escapeSyncDialogText(textByLang('对比项', 'Item'))}</th>
                                <th>${escapeSyncDialogText(textByLang('本地', 'Local'))}</th>
                                <th>${escapeSyncDialogText(textByLang('云端', 'Cloud'))}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowHtml}
                            <tr class="canvas-sync-first-table-merged-row">
                                <th scope="row">${escapeSyncDialogText(section.mergedLabel || '')}</th>
                                <td colspan="2">${escapeSyncDialogText(section.mergedValue || '-')}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                ${section.note ? `<div class="canvas-sync-first-table-note">${escapeSyncDialogText(section.note)}</div>` : ''}
            </section>
        `;
    }

    function buildFirstSyncTableSectionHtml(sectionInput) {
        return buildSyncStatusTableSectionHtml(sectionInput);
    }


    function isBaselineOnlyComparisonSummary(summaryInput) {
        const summary = summaryInput && typeof summaryInput === 'object' ? summaryInput : {};
        return !!(summary.permanentSame && summary.otherSame);
    }


    function canUseCloudSourceFromComparisonSummary(summaryInput) {
        const summary = summaryInput && typeof summaryInput === 'object' ? summaryInput : null;
        if (!summary) return true;

        const remoteTreeStats = summary.remoteStats && typeof summary.remoteStats === 'object'
            ? summary.remoteStats
            : {};
        const remoteOtherCounts = summary.remoteOtherCounts && typeof summary.remoteOtherCounts === 'object'
            ? summary.remoteOtherCounts
            : {};

        return (Number(remoteTreeStats.roots) || 0) > 0
            || (Number(remoteTreeStats.folders) || 0) > 0
            || (Number(remoteTreeStats.bookmarks) || 0) > 0
            || (Number(remoteOtherCounts.temporary) || 0) > 0
            || (Number(remoteOtherCounts.blank) || 0) > 0;
    }


    function buildEmptyCloudMismatchHintText() {
        return textByLang(
            '云端当前为空，无法使用“云端覆盖本地”。如需继续，请使用“保留本地并覆盖云端”。',
            'Cloud is currently empty, so “Use Cloud” is unavailable. If you want to continue, choose “Keep Local and Overwrite Cloud”.'
        );
    }

    function buildBaselineOnlyNoteText() {
        return textByLang(
            '当前本地与云端内容已经一致，本次只会校准同步基线，不会改动浏览器书签，也不会改动云端或本地文件。',
            'Local and cloud content already match. This will only align the sync baseline, without changing browser bookmarks or local/cloud files.'
        );
    }

    function buildFirstSyncSummaryText(summaryInput) {
        const summary = summaryInput && typeof summaryInput === 'object' ? summaryInput : {};
        if (summary.permanentSame && summary.otherSame) {
            return textByLang(
                '永久栏目和其他同步数据都已一致，本次主要是建立首次同步基线。',
                'Both the permanent section and the remaining sync data already match; this run mainly establishes the first-sync baseline.'
            );
        }
        if (summary.permanentSame && !summary.otherSame) {
            return textByLang(
                '永久栏目已一致，本次不会改动浏览器书签；只需要决定其他同步数据以谁为准。',
                'The permanent section already matches, so browser bookmarks stay unchanged; only the remaining sync data needs a direction decision.'
            );
        }
        if (!summary.permanentSame && summary.otherSame) {
            return textByLang(
                '其他同步数据已一致；只需要决定永久栏目以谁为准。',
                'The remaining sync data already matches; only the permanent section needs a direction decision.'
            );
        }
        return textByLang(
            '永久栏目和其他同步数据都存在差异，请先确认同步方向。',
            'Both the permanent section and the remaining sync data differ, so confirm the sync direction first.'
        );
    }

    function buildFirstSyncModeChoiceNoticeHtml(summary = null) {
        const source = summary && typeof summary === 'object' ? summary : {};
        const remoteCommittedAtText = textByLang(
            `云端最新修改时间：${formatFirstSyncRemoteCommittedAt(source.remoteCommittedAt)}`,
            `Latest cloud modification time: ${formatFirstSyncRemoteCommittedAt(source.remoteCommittedAt)}`
        );
        const tableData = buildFirstSyncTableData(source);
        const baselineOnly = isBaselineOnlyComparisonSummary(source);

        return `
            <div class="canvas-sync-first-check-wrap">
                <div class="canvas-sync-first-check-intro">${escapeSyncDialogText(textByLang('已先对比云端与本地当前数据，请先确认下面两部分结果。', 'Local and cloud data were compared first. Review these two sections before choosing a sync direction.'))}</div>
                <div class="canvas-sync-first-check-meta">${escapeSyncDialogText(remoteCommittedAtText)}</div>
                <div class="canvas-sync-first-table-stack">
                    ${buildFirstSyncTableSectionHtml(tableData.permanent)}
                    ${buildFirstSyncTableSectionHtml(tableData.other)}
                </div>
                ${baselineOnly
                    ? `<div class="canvas-sync-first-table-note canvas-sync-first-table-note--baseline">${escapeSyncDialogText(buildBaselineOnlyNoteText())}</div>`
                    : `<div class="canvas-sync-first-check-summary">${escapeSyncDialogText(buildFirstSyncSummaryText(source))}</div>`}
            </div>
        `;
    }

    function buildFirstSyncModeChoiceLines(summary = null) {
        const source = summary && typeof summary === 'object' ? summary : {};
        if (isBaselineOnlyComparisonSummary(source)) {
            return [];
        }
        const cloudText = source.permanentSame
            ? textByLang(
                '以云端为准：保持当前浏览器书签不变，并把其他同步数据按云端对齐到本地。',
                'Use cloud: keep current browser bookmarks unchanged and align the remaining sync data from cloud to local.'
            )
            : textByLang(
                '以云端为准：按上面的永久栏目判断结果应用到本地，并继续对齐其他同步数据。',
                'Use cloud: apply the permanent-section decision above to local bookmarks, then continue aligning the remaining sync data.'
            );
        const localText = source.permanentSame
            ? textByLang(
                '以本地为准：保持当前浏览器书签不变，并把当前本地同步数据推回云端。',
                'Use local: keep current browser bookmarks unchanged and push the current local sync data back to cloud.'
            )
            : textByLang(
                '以本地为准：保留当前本地浏览器书签/同步数据，并用本地状态覆盖云端。',
                'Use local: keep the current local browser bookmarks/sync data and overwrite cloud with the local state.'
            );
        return [
            textByLang('请选择首次同步方式：', 'Choose how the first sync should proceed:'),
            cloudText,
            localText
        ];
    }

    async function resolveFirstSyncModeAsync(preferredMode, hasRemotePermanentSnapshot, hasRemoteManagedFiles = false, comparisonSummary = null) {
        const mode = ensureFirstSyncMode(preferredMode);
        if (mode === 'auto') {
            if (!hasRemoteManagedFiles) {
                return 'local';
            }
            if (!hasRemotePermanentSnapshot) {
                return 'remote-data-without-permanent';
            }
            const baselineOnly = isBaselineOnlyComparisonSummary(comparisonSummary);
            const result = await openSyncActionDialog({
                title: textByLang('首次同步预检查', 'First Sync Precheck'),
                dialogMaxWidth: 'min(96vw, 920px)',
                dialogHeight: 'min(80vh, 720px)',
                fixedPanelLayout: true,
                noticeHtml: buildFirstSyncModeChoiceNoticeHtml(comparisonSummary),
                lines: buildFirstSyncModeChoiceLines(comparisonSummary),
                actions: baselineOnly
                    ? [
                        { id: 'cancel', label: textByLang('取消', 'Cancel'), tone: 'secondary' },
                        { id: 'baseline', label: textByLang('校准基线', 'Align Baseline'), tone: 'primary' }
                    ]
                    : [
                        { id: 'cancel', label: textByLang('取消', 'Cancel'), tone: 'secondary' },
                        { id: 'local', label: textByLang('以本地为准', 'Use Local'), tone: 'secondary' },
                        { id: 'cloud', label: textByLang('以云端为准', 'Use Cloud'), tone: 'primary' }
                    ],
                dangerActionId: baselineOnly ? 'baseline' : 'cloud'
            });
            if (result === 'cloud' || result === 'local' || result === 'baseline') return result;
            return 'cancel';
        }
        return mode;
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

    function hasReadyRepoConfig(config) {
        return !getRepoConfigMissingReason(config || {});
    }

    function hasEstablishedSyncBaseline() {
        if (!runtime || typeof runtime !== 'object') return false;
        if ((Number(runtime.lastSuccessAt) || 0) > 0) return true;
        if (String(runtime.lastRemoteSha || '').trim()) return true;
        if (String(runtime.lastLocalHash || '').trim()) return true;
        return false;
    }

    function resolvePanelOpenState(options = {}) {
        const explicitTab = options && options.activeTab;
        if (SYNC_TAB_KEYS.includes(explicitTab)) {
            return { tab: explicitTab, openFirstSyncFold: false };
        }

        if (!hasReadyRepoConfig(repoConfig || {})) {
            return { tab: 'repo', openFirstSyncFold: false };
        }

        const baselineReady = hasEstablishedSyncBaseline();
        return {
            tab: baselineReady ? 'status' : 'behavior',
            openFirstSyncFold: !baselineReady
        };
    }

    function isManualSyncTrigger(_mode, trigger) {
        const triggerText = String(trigger || '').toLowerCase();
        if (!triggerText) return false;
        // Explicit user-initiated actions should show determinate progress on the button,
        // and should not be silently ignored.
        if (triggerText.startsWith('manual') || triggerText === 'user') return true;
        if (triggerText === 'obsidian-export-format-change') return true;
        return false;
    }

    function isFirstSyncTrigger(trigger) {
        const triggerText = String(trigger || '').toLowerCase();
        return triggerText.includes('first-sync');
    }

    function shouldShowFirstSyncCompletionToast() {
        return !isSyncPanelOpen();
    }


    function getEmptyRemotePullGuardText(isManualTrigger = false) {
        return isManualTrigger
            ? textByLang(
                '检测到云端同步目录为空。为避免用空内容覆盖本地，本次仅拉取已停止；如需重建云端，请改用“仅上传”或“首次同步”。',
                'Cloud sync folder is empty. Pull-only was stopped to avoid overwriting local content with an empty cloud; use Push-only or First Sync to rebuild the cloud instead.'
            )
            : textByLang(
                '检测到云端同步目录为空，已跳过本次自动拉取。',
                'Cloud sync folder is empty. This automatic pull was skipped.'
            );
    }


    function shouldDelayFloatingProgressForTrigger(trigger) {
        return !isManualSyncTrigger('', trigger);
    }

    function resetFloatingProgressDelay() {
        if (floatingProgressDelayTimer) {
            clearTimeout(floatingProgressDelayTimer);
            floatingProgressDelayTimer = null;
        }
        floatingProgressDisplayReady = false;
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
        if (value === 'newer') return textByLang('按最近修改时间决定', 'Use the latest modification time');
        return textByLang('手动选择', 'Choose manually');
    }

    function decideWinnerByLatestModified(localUpdatedAt, remoteUpdatedAt) {
        const localTs = Math.max(0, Number(localUpdatedAt) || 0);
        const remoteTs = Math.max(0, Number(remoteUpdatedAt) || 0);
        if (!localTs || !remoteTs || localTs === remoteTs) return '';
        return localTs > remoteTs ? 'local' : 'remote';
    }

    function decidePendingConflictByLatestModified(conflictData = pendingConflict) {
        const source = conflictData && typeof conflictData === 'object' ? conflictData : null;
        if (!source) {
            return { choice: '', localTs: 0, remoteTs: 0 };
        }
        const localTs = Math.max(
            Number(source.localMeta && source.localMeta.updatedAt) || 0,
            Number(runtime && runtime.lastLocalMutationAt) || 0
        );
        const remoteTs = Math.max(
            Number(source.remoteMeta && source.remoteMeta.updatedAt) || 0,
            Number(runtime && runtime.lastRemoteCommittedAt) || 0
        );
        return {
            choice: decideWinnerByLatestModified(localTs, remoteTs),
            localTs,
            remoteTs
        };
    }

    // Triggers that should be treated as "user explicitly chose cloud -> local"
    // for permanent-section overwrite semantics.
    function isExplicitRemoteOverwriteTrigger(trigger) {
        const text = String(trigger || '').trim().toLowerCase();
        if (!text) return false;
        return text === 'manual-pull';
    }

    function shouldBypassPullPlanConflictCheck(trigger) {
        return false;
    }

    function isManualPushOnlyTrigger(trigger) {
        return String(trigger || '').trim().toLowerCase() === 'manual-push';
    }

    function getSyncNotificationSettings() {
        const source = settings || loadSettings();
        return {
            toastEnabled: !(source && source.toastEnabled === false)
        };
    }

    function getSyncToastOptionsByTrigger(trigger, options = {}) {
        return Object.assign({}, options || {});
    }

    function markForegroundUserInteraction() {
        try {
            if (document && document.visibilityState === 'hidden') return;
        } catch (_) { }
        const now = Date.now();
        if ((now - (Number(lastForegroundUserInteractionAt) || 0)) < FOREGROUND_ACTIVITY_THROTTLE_MS) return;
        lastForegroundUserInteractionAt = now;
    }

    function isForegroundUserInteractionBusy() {
        try {
            if (!document || document.visibilityState !== 'visible') return false;
        } catch (_) {
            return false;
        }
        const lastTs = Number(lastForegroundUserInteractionAt) || 0;
        if (lastTs <= 0) return false;
        return (Date.now() - lastTs) < USER_INTERACTION_IDLE_GRACE_MS;
    }

    function shouldAllowFloatingProgressForCurrentTrigger() {
        const notificationSettings = getSyncNotificationSettings();
        if (!notificationSettings.toastEnabled) return false;
        const trigger = String(runtime && runtime.lastTrigger || '').trim().toLowerCase();
        if (!trigger) return false;
        return trigger.startsWith('manual')
            || trigger.startsWith('first-sync')
            || trigger.startsWith('recovery-');
    }

    function getClientId() {
        let id = String(getSyncMetaRaw(CLIENT_ID_KEY) || '').trim();
        if (id) return id;
        id = `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        setSyncMetaRaw(CLIENT_ID_KEY, id);
        return id;
    }

    function isNecessaryToastMessage(message) {
        const text = String(message || '').trim().toLowerCase();
        if (!text) return false;
        return /error|fail|failed|forbidden|unauthorized|rate limit|403|401|conflict|protected|refused|拒绝|失败|错误|冲突|保护分支|限制/.test(text);
    }

    function toast(message, options = {}) {
        const text = String(message || '').trim();
        if (!text) return;

        const normalizedOptions = options && typeof options === 'object' ? options : {};
        const necessary = normalizedOptions.necessary === true || isNecessaryToastMessage(text);
        const notificationSettings = getSyncNotificationSettings();

        if (!necessary) {
            if (!notificationSettings.toastEnabled) return;
        }

        if (typeof global.showToast === 'function') {
            try {
                global.showToast(text, { position: 'top-right' });
                return;
            } catch (_) { }
        }
        console.log('[Canvas Obsidian Git Sync]', text);
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
        const fallbackMessage = String(message || textByLang('同步中...', 'Syncing...'));
        if (normalized == null) {
            buttonEl.classList.remove('is-determinate');
            buttonEl.style.removeProperty('--canvas-sync-btn-progress');
            if (label) {
                label.textContent = fallbackMessage;
            }
            return;
        }

        buttonEl.classList.add('is-determinate');
        buttonEl.style.setProperty('--canvas-sync-btn-progress', String(Math.max(0, Math.min(1, normalized / 100))));
        if (label) {
            label.textContent = `${fallbackMessage} · ${Math.round(normalized)}%`;
        }
    }

    function setButtonBusy(buttonEl, busy) {
        if (!buttonEl) return;
        buttonEl.classList.toggle('is-busy', !!busy);
        buttonEl.classList.toggle('canvas-sync-busy-btn', !!busy);
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

    async function requestManualSync(trigger = 'manual') {
        return runSync('full', trigger || 'manual');
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
        floatingProgressEl.setAttribute('role', 'button');
        floatingProgressEl.setAttribute('tabindex', '0');
        floatingProgressEl.title = textByLang('点击查看同步详情', 'Click to view sync details');

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

        floatingProgressHintEl = document.createElement('div');
        floatingProgressHintEl.className = 'canvas-sync-floating-progress-hint';
        floatingProgressHintEl.textContent = textByLang('点击查看详情', 'Click for details');

        track.appendChild(bar);
        floatingProgressEl.appendChild(meta);
        floatingProgressEl.appendChild(track);
        floatingProgressEl.appendChild(floatingProgressHintEl);
        floatingProgressEl.addEventListener('click', () => {
            if (!floatingProgressActive) return;
            openPanel({ activeTab: 'status' });
        });
        floatingProgressEl.addEventListener('keydown', (event) => {
            if (!floatingProgressActive) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openPanel({ activeTab: 'status' });
            }
        });
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
        if (floatingProgressHintEl) {
            floatingProgressHintEl.textContent = textByLang('点击查看详情', 'Click for details');
        }

        const running = !!(runtime && runtime.isRunning);
        const shouldShow = floatingProgressActive
            && floatingProgressDisplayReady
            && determinate
            && normalized < 100
            && running
            && !isSyncPanelOpen()
            && shouldAllowFloatingProgressForCurrentTrigger();
        floatingProgressEl.hidden = !shouldShow;
    }

    function setFloatingProgress(active, message = '', percent = null) {
        floatingProgressActive = !!active;
        floatingProgressMessage = String(message || '');
        floatingProgressPercent = percent == null ? null : Number(percent);

        if (!floatingProgressActive) {
            resetFloatingProgressDelay();
            updateFloatingProgressVisibility();
            return;
        }

        const trigger = String(runtime && runtime.lastTrigger || '');
        if (!shouldDelayFloatingProgressForTrigger(trigger)) {
            if (floatingProgressDelayTimer) {
                clearTimeout(floatingProgressDelayTimer);
                floatingProgressDelayTimer = null;
            }
            floatingProgressDisplayReady = true;
            updateFloatingProgressVisibility();
            return;
        }

        if (!floatingProgressDisplayReady && !floatingProgressDelayTimer) {
            floatingProgressDelayTimer = setTimeout(() => {
                floatingProgressDelayTimer = null;
                if (!floatingProgressActive || !(runtime && runtime.isRunning)) return;
                floatingProgressDisplayReady = true;
                updateFloatingProgressVisibility();
            }, 900);
        }
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

    function renderStatusCompareSections(elementId, sectionsInput) {
        const element = getElement(elementId);
        if (!element) return;
        const sections = Array.isArray(sectionsInput) ? sectionsInput : [];
        element.hidden = false;
        element.innerHTML = `<div class="canvas-sync-first-table-stack">${sections.map((section) => buildSyncStatusTableSectionHtml(section)).join('')}</div>`;
    }

    function buildComparisonPanelSummaryText(summaryInput, mode = 'change') {
        const summary = summaryInput && typeof summaryInput === 'object' ? summaryInput : {};
        const normalizedMode = String(mode || 'change').trim().toLowerCase();
        const permanentState = (() => {
            const state = resolveComparisonSectionState(summary, 'permanent', normalizedMode);
            return state === 'same'
                ? textByLang('一致', 'Match')
                : (state === 'conflict' ? textByLang('存在冲突', 'Conflict') : textByLang('有变化', 'Changed'));
        })();
        const otherState = (() => {
            const state = resolveComparisonSectionState(summary, 'other', normalizedMode);
            return state === 'same'
                ? textByLang('一致', 'Match')
                : (state === 'conflict' ? textByLang('存在冲突', 'Conflict') : textByLang('有变化', 'Changed'));
        })();
        if (isBaselineOnlyComparisonSummary(summary)) {
            return textByLang(
                '检测结果：永久栏目一致；其他同步数据一致。本次只需校准同步基线。',
                'Detection: permanent section matches; other sync data matches. Only sync baseline alignment is needed.'
            );
        }
        return textByLang(
            `检测结果：永久栏目${permanentState}；其他同步数据${otherState}。请先确认处理方向。`,
            `Detection: permanent section ${permanentState}; other sync data ${otherState}. Confirm the resolution direction first.`
        );
    }

    function buildComparisonPanelSections(summaryInput, options = {}) {
        const mode = String(options && options.mode || 'change').trim().toLowerCase();
        const tableData = buildComparisonTableData(summaryInput, {
            mode,
            includeTimeRow: true,
            localUpdatedAt: Number(options && options.localUpdatedAt) || 0,
            remoteUpdatedAt: Number(options && options.remoteUpdatedAt) || 0
        });
        return [tableData.permanent, tableData.other];
    }

    async function ensureLatestRemoteCommittedAt(rootPath = '') {
        const cached = Number(runtime && runtime.lastRemoteCommittedAt) || 0;
        if (cached > 0) return cached;
        if (remoteCommittedAtRefreshPromise) {
            try {
                return await remoteCommittedAtRefreshPromise;
            } catch (_) {
                return 0;
            }
        }
        remoteCommittedAtRefreshPromise = (async () => {
            try {
                const signal = await readRemoteObsidianSignal(rootPath || (settings && settings.obsidianExportRoot));
                const committedAt = Math.max(0, Number(signal && signal.committedAt) || 0);
                const signalSha = String(signal && signal.revisionSha || '').trim();
                if (runtime) {
                    let runtimeChanged = false;
                    if (signalSha && runtime.lastRemoteSignalSha !== signalSha) {
                        runtime.lastRemoteSignalSha = signalSha;
                        runtimeChanged = true;
                    }
                    if (committedAt > 0 && runtime.lastRemoteCommittedAt !== committedAt) {
                        runtime.lastRemoteCommittedAt = committedAt;
                        runtimeChanged = true;
                    }
                    if (runtimeChanged) {
                        saveRuntime();
                    }
                }
                return committedAt;
            } catch (error) {
                console.warn('[Canvas Sync] ensure latest remote committedAt failed:', error);
                return 0;
            } finally {
                remoteCommittedAtRefreshPromise = null;
            }
        })();
        return await remoteCommittedAtRefreshPromise;
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
                const normalizedRaw = buildNormalizedCanvasTempStateRawForSync(localStorage.getItem(TEMP_SECTION_STORAGE_KEY) || '');
                const rawState = normalizedRaw ? safeParse(normalizedRaw, null) : null;
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

        const recoveryPanel = getElement('canvasSyncRecoveryPanel');
        const conflictPanel = getElement('canvasSyncConflictPanel');

        const hasVisiblePanel = !!(
            (recoveryPanel && !recoveryPanel.hidden)
            || (conflictPanel && !conflictPanel.hidden)
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
        const recoverySnapshotAtEl = getElement('canvasSyncStatusRecoverySnapshotAt');
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
            remoteShaEl.textContent = cloudHash || textByLang('无', 'None');
        }
        if (localHashEl) {
            const recordedCloudHash = String(getRecordedCloudHashForDisplay() || '').trim();
            localHashEl.textContent = recordedCloudHash || textByLang('无', 'None');
        }
        if (otherEl) {
            otherEl.innerHTML = `<div class="canvas-sync-other-lines">${buildDirtySerialLinesHtml()}</div>`;
        }
        if (recoverySnapshotAtEl) {
            const latestRecord = getLatestRecoverySnapshotRecord({ requireSnapshot: true });
            recoverySnapshotAtEl.textContent = latestRecord && Number(latestRecord.ts) > 0
                ? formatTime(latestRecord.ts)
                : '-';
        }
        if (errorEl) {
            const missingReason = getRepoConfigMissingReason(repoConfig);
            const repoNotReadyText = missingReason
                ? textByLang(`仓库未就绪：${missingReason}`, `Repository not ready: ${missingReason}`)
                : '';
            errorEl.textContent = runtime.lastError || repoNotReadyText || textByLang('无', 'None');
        }
        renderRecoverySnapshotDownloadStatus();

        renderRecoveryLockPanel();
        updateStatusPanelActionPlacement();
        updateSyncEnabledDependentFieldState();
        scheduleStatusSubNavSyncFromScroll();
    }

	    function setFirstSyncModeToForm(mode) {
	        const resolvedMode = ensureFirstSyncMode(mode);
	        const autoInput = getElement('canvasSyncFirstSyncModeAutoInput');
	        const cloudInput = getElement('canvasSyncFirstSyncModeCloudInput');
	        const localInput = getElement('canvasSyncFirstSyncModeLocalInput');

	        if (autoInput) autoInput.checked = resolvedMode === 'auto';
	        if (cloudInput) cloudInput.checked = resolvedMode === 'cloud';
	        if (localInput) localInput.checked = resolvedMode === 'local';

	        const legacySelect = getElement('canvasSyncFirstSyncModeSelect');
	        if (legacySelect) legacySelect.value = resolvedMode;
	    }

	    function getFirstSyncModeFromForm(fallbackMode) {
	        const autoInput = getElement('canvasSyncFirstSyncModeAutoInput');
	        const cloudInput = getElement('canvasSyncFirstSyncModeCloudInput');
	        const localInput = getElement('canvasSyncFirstSyncModeLocalInput');
	        const legacySelect = getElement('canvasSyncFirstSyncModeSelect');

	        // Prefer the radio that just changed.
	        try {
	            const active = global.document && global.document.activeElement ? global.document.activeElement : null;
	            const activeId = active && active.id ? String(active.id) : '';
	            if (active && typeof active.value === 'string') {
	                if (
	                    activeId === 'canvasSyncFirstSyncModeAutoInput'
	                    || activeId === 'canvasSyncFirstSyncModeCloudInput'
	                    || activeId === 'canvasSyncFirstSyncModeLocalInput'
	                ) {
	                    return ensureFirstSyncMode(active.value);
	                }
	            }
	        } catch (_) { }

	        if (autoInput && autoInput.checked) return 'auto';
	        if (cloudInput && cloudInput.checked) return 'cloud';
	        if (localInput && localInput.checked) return 'local';
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
        if (disabledFlag && hint) {
            controlEl.setAttribute('data-disabled-hint', String(hint));
        } else {
            controlEl.removeAttribute('data-disabled-hint');
        }
        controlEl.title = '';

        const rowEl = typeof controlEl.closest === 'function'
            ? controlEl.closest('.canvas-sync-row')
            : null;
        if (!rowEl) return;

        rowEl.classList.toggle('canvas-sync-row--disabled', disabledFlag);
        rowEl.setAttribute('aria-disabled', disabledFlag ? 'true' : 'false');
        if (disabledFlag && hint) {
            rowEl.setAttribute('data-disabled-hint', String(hint));
        } else {
            rowEl.removeAttribute('data-disabled-hint');
        }
        rowEl.title = '';
    }

    function setActionDisabledState(buttonEl, disabled, hint) {
        if (!buttonEl) return;
        const disabledFlag = !!disabled;
        buttonEl.disabled = disabledFlag;
        buttonEl.title = disabledFlag ? (hint || '') : '';
    }

    function isMismatchPreviewActive() {
        return false;
    }

    function isConflictPreviewActive() {
        return previewPanelMode === 'conflict' && !pendingConflict;
    }

    function buildPreviewConflictPayload() {
        const now = Date.now();
        const localPreviewTempState = normalizeCanvasTempStatePayloadForSync({
            sections: [{ id: 'preview-local-section', title: 'Local Temp' }],
            mdNodes: [{ id: 'preview-local-card', title: 'local card' }],
            edges: [],
            timestamp: now - 90 * 1000
        });
        const remotePreviewTempState = normalizeCanvasTempStatePayloadForSync({
            sections: [{ id: 'preview-remote-section', title: 'Remote Temp' }],
            mdNodes: [
                { id: 'preview-remote-card-1', title: 'remote card 1' },
                { id: 'preview-remote-card-2', title: 'remote card 2' }
            ],
            edges: [],
            timestamp: now - 50 * 1000
        });
        const localSnapshot = normalizeSnapshot({
            updatedAt: now - 90 * 1000,
            data: {
                [TEMP_SECTION_STORAGE_KEY]: JSON.stringify(localPreviewTempState || {
                    sections: [{ id: 'preview-local-section', title: 'Local Temp' }],
                    mdNodes: [{ id: 'preview-local-card', title: 'local card' }],
                    edges: [],
                    timestamp: now - 90 * 1000
                }),
                [PERMANENT_VIEW_SHELL_COMPARE_KEY]: JSON.stringify({
                    version: 1,
                    views: [{
                        viewId: 'permanent-section',
                        copyId: null,
                        descriptionMd: 'preview-local',
                        cardState: {},
                        scrollState: {},
                        foldState: {}
                    }]
                })
            }
        });
        const remoteSnapshot = normalizeSnapshot({
            updatedAt: now - 50 * 1000,
            data: {
                [TEMP_SECTION_STORAGE_KEY]: JSON.stringify(remotePreviewTempState || {
                    sections: [{ id: 'preview-remote-section', title: 'Remote Temp' }],
                    mdNodes: [
                        { id: 'preview-remote-card-1', title: 'remote card 1' },
                        { id: 'preview-remote-card-2', title: 'remote card 2' }
                    ],
                    edges: [],
                    timestamp: now - 50 * 1000
                }),
                [PERMANENT_VIEW_SHELL_COMPARE_KEY]: JSON.stringify({
                    version: 1,
                    views: [{
                        viewId: 'permanent-section',
                        copyId: null,
                        descriptionMd: 'preview-remote',
                        cardState: {},
                        scrollState: {},
                        foldState: {}
                    }]
                })
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
            remoteMeta: buildSnapshotMeta(remoteSnapshot),
            sectionStates: {
                permanent: 'conflict',
                other: 'conflict'
            }
        };
    }

    function updatePreviewActionButtonState() {
        const enabledOn = isSyncEnabledToggleChecked();
        const disabledByMaster = !enabledOn;
        const disabledByRunning = !!(runtime && runtime.isRunning);
        const disabledByRecoveryLock = isRecoveryLockActive();
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
        const recoveryHint = textByLang(
            '检测到未完成的同步恢复：请先继续上次操作',
            'An unfinished sync recovery was detected: continue the previous action first'
        );

        const conflictPreview = isConflictPreviewActive();

        const conflictLocalBtn = getElement('canvasSyncConflictUseLocalBtn');
        setActionDisabledState(
            conflictLocalBtn,
            disabledByMaster || conflictPreview || disabledByRunning || disabledByRecoveryLock,
            disabledByMaster ? disabledHint : (conflictPreview ? previewHint : (disabledByRunning ? runningHint : (disabledByRecoveryLock ? recoveryHint : '')))
        );

        const conflictRemoteBtn = getElement('canvasSyncConflictUseRemoteBtn');
        setActionDisabledState(
            conflictRemoteBtn,
            disabledByMaster || conflictPreview || disabledByRunning || disabledByRecoveryLock,
            disabledByMaster ? disabledHint : (conflictPreview ? previewHint : (disabledByRunning ? runningHint : (disabledByRecoveryLock ? recoveryHint : '')))
        );

        const conflictRetryMergeBtn = getElement('canvasSyncConflictRetryMergeBtn');
        setActionDisabledState(
            conflictRetryMergeBtn,
            disabledByMaster || conflictPreview || disabledByRunning || disabledByRecoveryLock,
            disabledByMaster ? disabledHint : (conflictPreview ? previewHint : (disabledByRunning ? runningHint : (disabledByRecoveryLock ? recoveryHint : '')))
        );
    }

    function setPreviewPanelMode(mode) {
        const targetMode = mode === 'conflict' ? mode : '';
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
        const containerEl = getStatusScrollContainer() || statusPanel;

        const targetId = 'canvasSyncConflictPanel';
        const targetPanel = getElement(targetId);
        if (!targetPanel) return;

        const doScroll = () => {
            const containerRect = containerEl.getBoundingClientRect();
            const targetRect = targetPanel.getBoundingClientRect();
            const currentTop = Number(containerEl.scrollTop) || 0;
            const top = Math.max(0, currentTop + (targetRect.top - containerRect.top) - 8);
            if (typeof containerEl.scrollTo === 'function') {
                try {
                    containerEl.scrollTo({ top, behavior: 'smooth' });
                    scheduleStatusSubNavSyncFromScroll();
                    return;
                } catch (_) { }
            }
            containerEl.scrollTop = top;
            scheduleStatusSubNavSyncFromScroll();
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
            const containerEl = getStatusScrollContainer() || statusPanel;
            const goTop = () => {
                if (typeof containerEl.scrollTo === 'function') {
                    try {
                        containerEl.scrollTo({ top: 0, behavior: 'auto' });
                        scheduleStatusSubNavSyncFromScroll();
                        return;
                    } catch (_) { }
                }
                containerEl.scrollTop = 0;
                scheduleStatusSubNavSyncFromScroll();
            };

            global.requestAnimationFrame(() => {
                global.requestAnimationFrame(goTop);
            });
        }

        if (noticeText) {
            toast(noticeText);
        }
    }


    async function resolveStaleRunningUiLockIfNeeded() {
        if (!runtime || !runtime.isRunning) return false;
        try {
            const backgroundState = await getBackgroundSyncState();
            const bgRuntime = backgroundState && backgroundState.runtime && typeof backgroundState.runtime === 'object'
                ? backgroundState.runtime
                : null;
            const bgRunning = !!(bgRuntime && bgRuntime.isRunning === true);
            if (bgRunning) return false;

            runtime.isRunning = false;
            saveRuntime();
            renderStatus();
            updateSyncEnabledDependentFieldState();
            return true;
        } catch (_) {
            return false;
        }
    }

    function scheduleStaleRunningUiCheck() {
        if (syncActionStaleCheckScheduled) return;
        syncActionStaleCheckScheduled = true;
        if (syncActionStaleCheckTimer) {
            clearTimeout(syncActionStaleCheckTimer);
            syncActionStaleCheckTimer = null;
        }
        syncActionStaleCheckTimer = setTimeout(async () => {
            syncActionStaleCheckTimer = null;
            syncActionStaleCheckScheduled = false;
            await resolveStaleRunningUiLockIfNeeded();
        }, 800);
    }

    function clearStaleRunningUiCheck() {
        if (syncActionStaleCheckTimer) {
            clearTimeout(syncActionStaleCheckTimer);
            syncActionStaleCheckTimer = null;
        }
        syncActionStaleCheckScheduled = false;
    }

    function updateSyncEnabledDependentFieldState() {
        const enabledOn = isSyncEnabledToggleChecked();
        const disabledByRecoveryLock = isRecoveryLockActive();
        const disabledHint = textByLang(
            '启用同步已关闭：此项不可用',
            'Sync is disabled: this field is unavailable'
        );
        const recoveryHint = textByLang(
            '检测到未完成的同步恢复：请先继续上次操作',
            'An unfinished sync recovery was detected: continue the previous action first'
        );
        const shouldDisable = !enabledOn;

        [
            'canvasSyncFirstSyncModeAutoInput',
            'canvasSyncFirstSyncModeCloudInput',
            'canvasSyncFirstSyncModeLocalInput',
            'canvasSyncToastToggle',
            'canvasSyncConflictSelect',
            'canvasSyncConflictFineToggle',
            'canvasSyncPermanentPullModeSelect',
            'canvasSyncPermanentIncrementalThresholdInput',
            'canvasSyncObsidianFilePushToggle',
            'canvasSyncObsidianExportFormatSelect',
            'canvasSyncObsidianExportRootInput'
        ].forEach((id) => {
            setControlDisabledState(getElement(id), shouldDisable, disabledHint);
        });

        const disabledByRunning = !!(runtime && runtime.isRunning);
        if (disabledByRunning) {
            scheduleStaleRunningUiCheck();
        } else {
            clearStaleRunningUiCheck();
        }
        const runningHint = textByLang(
            '正在同步：请等待当前同步完成',
            'Sync is running: please wait for completion'
        );

        [
            'canvasSyncNowBtn',
            'canvasSyncPushOnlyBtn',
            'canvasSyncPullOnlyBtn',
            'canvasSyncFirstSyncPathCheckBtn',
            'canvasSyncFirstSyncOverwriteBtn',
            'canvasSyncRunBgCheckBtn',
            'canvasSyncConflictUseLocalBtn',
            'canvasSyncConflictUseRemoteBtn',
            'canvasSyncConflictUseNewestBtn',
            'canvasSyncConflictApplyFineBtn',
            'canvasSyncConflictRetryMergeBtn',
            'canvasSyncConflictDismissBtn'
        ].forEach((id) => {
            setActionDisabledState(
                getElement(id),
                shouldDisable || disabledByRunning || disabledByRecoveryLock,
                shouldDisable ? disabledHint : (disabledByRunning ? runningHint : (disabledByRecoveryLock ? recoveryHint : ''))
            );
        });

        setActionDisabledState(
            getElement('canvasSyncRecoveryContinueBtn'),
            !disabledByRecoveryLock || recoveryLockResumeInFlight,
            disabledByRecoveryLock ? '' : recoveryHint
        );
        setActionDisabledState(
            getElement('canvasSyncRecoveryDismissBtn'),
            !disabledByRecoveryLock || recoveryLockResumeInFlight,
            disabledByRecoveryLock ? '' : recoveryHint
        );
        const activeRecoveryLock = normalizeRecoveryLockRecord(recoveryLockState || loadRecoveryLockState());
        const canRollbackCurrentRecovery = disabledByRecoveryLock && canRollbackRecoveryLock(activeRecoveryLock);
        setActionDisabledState(
            getElement('canvasSyncRecoveryRollbackBtn'),
            !canRollbackCurrentRecovery || recoveryLockResumeInFlight,
            canRollbackCurrentRecovery
                ? ''
                : (disabledByRecoveryLock
                    ? textByLang('当前恢复锁不支持自动回滚', 'The current recovery lock does not support automatic rollback')
                    : recoveryHint)
        );
        const latestRecoverySnapshot = getLatestRecoverySnapshotRecord({ requireSnapshot: true });
        const canDownloadRecoverySnapshot = !!(latestRecoverySnapshot && latestRecoverySnapshot.snapshot);
        const canManualRecoverySnapshot = !disabledByRunning && !disabledByRecoveryLock;
        setActionDisabledState(
            getElement('canvasSyncDownloadRecoverySnapshotBtn'),
            !canDownloadRecoverySnapshot,
            canDownloadRecoverySnapshot
                ? ''
                : textByLang('暂无可下载的恢复快照', 'No downloadable recovery snapshot is available')
        );
        setActionDisabledState(
            getElement('canvasSyncManualRecoverySnapshotBtn'),
            !canManualRecoverySnapshot,
            canManualRecoverySnapshot
                ? ''
                : (disabledByRunning
                    ? runningHint
                    : (disabledByRecoveryLock ? recoveryHint : ''))
        );
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
    function applySettingsToForm() {
        const enabled = getElement('canvasSyncEnabledToggle');
        const toastToggle = getElement('canvasSyncToastToggle');
        const conflict = getElement('canvasSyncConflictSelect');
        const permanentPullMode = getElement('canvasSyncPermanentPullModeSelect');
        const permanentIncrementalThreshold = getElement('canvasSyncPermanentIncrementalThresholdInput');
        const obsidianFilePushEnabled = getElement('canvasSyncObsidianFilePushToggle');
        const obsidianExportFormat = getElement('canvasSyncObsidianExportFormatSelect');
        const obsidianExportRoot = getElement('canvasSyncObsidianExportRootInput');

        if (enabled) enabled.checked = !!settings.enabled;
        setFirstSyncModeToForm(settings.firstSyncMode);
        if (toastToggle) toastToggle.checked = settings.toastEnabled !== false;
        if (conflict) conflict.value = ensureConflictPolicy(settings.conflictPolicy);
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
    }

    function pullSettingsFromForm(options = {}) {
        const silentFormatToast = !!(options && options.silentFormatToast === true);
        const enabled = getElement('canvasSyncEnabledToggle');
        const toastToggle = getElement('canvasSyncToastToggle');
        const conflict = getElement('canvasSyncConflictSelect');
        const permanentPullMode = getElement('canvasSyncPermanentPullModeSelect');
        const permanentIncrementalThreshold = getElement('canvasSyncPermanentIncrementalThresholdInput');
        const obsidianFilePushEnabled = getElement('canvasSyncObsidianFilePushToggle');
        const obsidianExportFormat = getElement('canvasSyncObsidianExportFormatSelect');
        const obsidianExportRoot = getElement('canvasSyncObsidianExportRootInput');
        const previousObsidianExportFormat = normalizeObsidianExportFormat(
            settings && settings.obsidianExportFormat,
            DEFAULT_SETTINGS.obsidianExportFormat
        );

        settings.enabled = enabled ? !!enabled.checked : settings.enabled;
        settings.firstSyncMode = getFirstSyncModeFromForm(settings.firstSyncMode);
        setFirstSyncModeToForm(settings.firstSyncMode);
        settings.toastEnabled = toastToggle ? !!toastToggle.checked : settings.toastEnabled;

        settings.syncMethod = DEFAULT_SETTINGS.syncMethod;
        settings.conflictPolicy = ensureConflictPolicy(conflict ? conflict.value : settings.conflictPolicy);
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
        saveSettings();

        const currentObsidianExportFormat = getCurrentObsidianExportFormatForSync();
        if (previousObsidianExportFormat !== currentObsidianExportFormat) {
            updateDirtyStateByReason('obsidian-export-format-change', {
                dirty: {
                    permanentAll: true,
                    temporaryAll: true,
                    blankAll: true
                }
            });
            if (!silentFormatToast) {
                const previousFormatLabel = formatObsidianExportFormatLabel(previousObsidianExportFormat) || previousObsidianExportFormat;
                const currentFormatLabel = formatObsidianExportFormatLabel(currentObsidianExportFormat) || currentObsidianExportFormat;
                toast(textByLang(
                    `已切换导出格式：${previousFormatLabel} -> ${currentFormatLabel}`,
                    `Export format switched: ${previousFormatLabel} -> ${currentFormatLabel}`
                ), { optional: true });
            }
        }

        void updateBackgroundSyncContext('settings-change');
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
        setStatusSubNavVisible(nextTab === 'status');
        if (nextTab === 'behavior') {
            const currentActiveSubButton = getCurrentActiveBehaviorSubButtonId();
            if (currentActiveSubButton) {
                setBehaviorSubNavActive(currentActiveSubButton);
            } else if (BEHAVIOR_SUBNAV_CONFIG.length > 0) {
                setBehaviorSubNavActive(BEHAVIOR_SUBNAV_CONFIG[0].buttonId);
            }
            scheduleBehaviorSubNavSyncFromScroll();
        } else if (nextTab === 'status') {
            const currentActiveSubButton = getCurrentActiveStatusSubButtonId();
            if (currentActiveSubButton) {
                setStatusSubNavActive(currentActiveSubButton);
            } else if (STATUS_SUBNAV_CONFIG.length > 0) {
                setStatusSubNavActive(STATUS_SUBNAV_CONFIG[0].buttonId);
            }
            scheduleStatusSubNavSyncFromScroll();
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

    function setStatusSubNavVisible(visible) {
        const subNavEl = getElement('canvasSyncStatusSubNav');
        if (!subNavEl) return;
        subNavEl.hidden = !visible;
    }

    function setBehaviorCompatSubNavVisible(visible) {
        const subNavEl = getElement('canvasSyncBehaviorSubCompatNav');
        if (!subNavEl) return;
        subNavEl.hidden = !visible;
    }

    function getCurrentActiveStatusSubButtonId() {
        const subNavEl = getElement('canvasSyncStatusSubNav');
        if (!subNavEl) return '';
        const activeButton = subNavEl.querySelector('.canvas-sync-tab-subnav-btn.is-active, .canvas-sync-tab-subnav-btn[aria-current="true"]');
        if (!activeButton || !activeButton.id) return '';
        return activeButton.id;
    }

    function setStatusSubNavActive(buttonId) {
        STATUS_SUBNAV_CONFIG.forEach((item) => {
            const buttonEl = getElement(item.buttonId);
            if (!buttonEl) return;
            const isActive = item.buttonId === buttonId;
            buttonEl.classList.toggle('is-active', isActive);
            buttonEl.setAttribute('aria-current', isActive ? 'true' : 'false');
        });
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

    function getBehaviorScrollContainer() {
        const panelEl = getElement('canvasSyncTabBehaviorPanel');
        if (!panelEl) return null;
        if (document && document.documentElement && document.documentElement.classList.contains('side-panel-mode')) {
            const modal = getElement('canvasSyncModal');
            const bodyEl = modal && typeof modal.querySelector === 'function'
                ? modal.querySelector('.canvas-manage-modal-body')
                : null;
            if (bodyEl) return bodyEl;
        }
        return panelEl;
    }

    function getBehaviorStickyNavHeight() {
        const navEl = getElement('canvasSyncTabNav');
        if (!navEl) return 44;
        const rect = navEl.getBoundingClientRect();
        const h = Math.ceil(rect.height || 0);
        return h > 0 ? h : 44;
    }

    function scrollBehaviorSectionIntoView(targetId) {
        const panelEl = getElement('canvasSyncTabBehaviorPanel');
        const containerEl = getBehaviorScrollContainer();
        const targetEl = getElement(targetId);
        if (!panelEl || !containerEl || !targetEl) return;

        const containerRect = containerEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const currentTop = Number(containerEl.scrollTop) || 0;
        const stickyOffset = getBehaviorStickyNavHeight();
        const nextTop = Math.max(0, currentTop + (targetRect.top - containerRect.top) - stickyOffset - 6);

        if (typeof containerEl.scrollTo === 'function') {
            try {
                containerEl.scrollTo({ top: nextTop, behavior: 'auto' });
                scheduleBehaviorSubNavSyncFromScroll();
                return;
            } catch (_) { }
        }

        containerEl.scrollTop = nextTop;
        scheduleBehaviorSubNavSyncFromScroll();
    }

    function getStatusScrollContainer() {
        const panelEl = getElement('canvasSyncTabStatusPanel');
        if (!panelEl) return null;
        if (document && document.documentElement && document.documentElement.classList.contains('side-panel-mode')) {
            const modal = getElement('canvasSyncModal');
            const bodyEl = modal && typeof modal.querySelector === 'function'
                ? modal.querySelector('.canvas-manage-modal-body')
                : null;
            if (bodyEl) return bodyEl;
        }
        return panelEl;
    }

    function scrollStatusSectionIntoView(targetId) {
        const panelEl = getElement('canvasSyncTabStatusPanel');
        const containerEl = getStatusScrollContainer();
        const targetEl = getElement(targetId);
        if (!panelEl || !containerEl || !targetEl) return;

        const containerRect = containerEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const currentTop = Number(containerEl.scrollTop) || 0;
        const stickyOffset = getBehaviorStickyNavHeight();
        const nextTop = Math.max(0, currentTop + (targetRect.top - containerRect.top) - stickyOffset - 6);

        if (typeof containerEl.scrollTo === 'function') {
            try {
                containerEl.scrollTo({ top: nextTop, behavior: 'auto' });
                scheduleStatusSubNavSyncFromScroll();
                return;
            } catch (_) { }
        }

        containerEl.scrollTop = nextTop;
        scheduleStatusSubNavSyncFromScroll();
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
        const containerEl = getBehaviorScrollContainer();
        if (panelEl && panelEl.dataset.subnavScrollBound !== 'true') {
            panelEl.dataset.subnavScrollBound = 'true';
            panelEl.addEventListener('scroll', () => {
                scheduleBehaviorSubNavSyncFromScroll();
            }, { passive: true });
        }
        if (containerEl && containerEl !== panelEl && containerEl.dataset.subnavScrollBound !== 'true') {
            containerEl.dataset.subnavScrollBound = 'true';
            containerEl.addEventListener('scroll', () => {
                scheduleBehaviorSubNavSyncFromScroll();
            }, { passive: true });
        }
    }

    function bindStatusSubNavButtons() {
        STATUS_SUBNAV_CONFIG.forEach((item, index) => {
            const buttonEl = getElement(item.buttonId);
            if (!buttonEl) return;
            if (buttonEl.dataset.bound === 'true') return;

            buttonEl.dataset.bound = 'true';
            buttonEl.addEventListener('click', () => {
                setActiveTab('status');
                setStatusSubNavActive(item.buttonId);
                scrollStatusSectionIntoView(item.targetId);
            });

            if (index === 0) {
                buttonEl.classList.add('is-active');
                buttonEl.setAttribute('aria-current', 'true');
            } else {
                buttonEl.setAttribute('aria-current', 'false');
            }
        });

        const panelEl = getElement('canvasSyncTabStatusPanel');
        const containerEl = getStatusScrollContainer();
        if (panelEl && panelEl.dataset.statusSubnavScrollBound !== 'true') {
            panelEl.dataset.statusSubnavScrollBound = 'true';
            panelEl.addEventListener('scroll', () => {
                scheduleStatusSubNavSyncFromScroll();
            }, { passive: true });
        }
        if (containerEl && containerEl !== panelEl && containerEl.dataset.statusSubnavScrollBound !== 'true') {
            containerEl.dataset.statusSubnavScrollBound = 'true';
            containerEl.addEventListener('scroll', () => {
                scheduleStatusSubNavSyncFromScroll();
            }, { passive: true });
        }
    }

    function findBehaviorSubNavButtonIdByScroll() {
        const panelEl = getElement('canvasSyncTabBehaviorPanel');
        const containerEl = getBehaviorScrollContainer();
        if (!panelEl || !containerEl) return '';

        const containerRect = containerEl.getBoundingClientRect();
        const anchorTop = containerRect.top + getBehaviorStickyNavHeight() + 6;

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

    function findStatusSubNavButtonIdByScroll() {
        const panelEl = getElement('canvasSyncTabStatusPanel');
        const containerEl = getStatusScrollContainer();
        if (!panelEl || !containerEl) return '';

        const containerRect = containerEl.getBoundingClientRect();
        const anchorTop = containerRect.top + getBehaviorStickyNavHeight() + 6;

        let fallbackButtonId = '';
        let matchedButtonId = '';

        for (let i = 0; i < STATUS_SUBNAV_CONFIG.length; i++) {
            const item = STATUS_SUBNAV_CONFIG[i];
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
            const containerEl = getBehaviorScrollContainer();
            const anchorTop = containerEl ? containerEl.getBoundingClientRect().top + getBehaviorStickyNavHeight() + 6 : 0;
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

    function syncStatusSubNavActiveByScrollPosition() {
        if (activeTabKey !== 'status') return;
        const nextButtonId = findStatusSubNavButtonIdByScroll();
        if (!nextButtonId) return;

        const currentButtonId = getCurrentActiveStatusSubButtonId();
        if (currentButtonId !== nextButtonId) {
            setStatusSubNavActive(nextButtonId);
        }
    }

    function scheduleBehaviorSubNavSyncFromScroll() {
        if (behaviorSubNavScrollRaf != null) return;
        behaviorSubNavScrollRaf = global.requestAnimationFrame(() => {
            behaviorSubNavScrollRaf = null;
            syncBehaviorSubNavActiveByScrollPosition();
        });
    }

    function scheduleStatusSubNavSyncFromScroll() {
        if (statusSubNavScrollRaf != null) return;
        statusSubNavScrollRaf = global.requestAnimationFrame(() => {
            statusSubNavScrollRaf = null;
            syncStatusSubNavActiveByScrollPosition();
        });
    }

    function readTempStateTimestampFromRaw(raw) {
        if (!raw) return 0;
        const normalizedRaw = buildNormalizedCanvasTempStateRawForSync(raw);
        if (!normalizedRaw) return 0;
        try {
            const parsed = JSON.parse(normalizedRaw);
            const ts = Number(parsed && parsed.timestamp);
            return Number.isFinite(ts) && ts > 0 ? ts : 0;
        } catch (_) {
            return 0;
        }
    }

    const SNAPSHOT_COMPARABLE_DATA_KEYS = [
        TEMP_SECTION_STORAGE_KEY
    ];
    const PERMANENT_VIEW_SHELL_COMPARE_KEY = 'permanent-view-shell-snapshot';

    function parsePermanentViewNumericValueForSync(value) {
        const n = parseFloat(String(value == null ? '' : value).trim());
        return Number.isFinite(n) ? Math.round(n) : null;
    }

    function normalizePermanentViewCardStateForSync(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const out = {};
        ['left', 'top', 'width', 'height'].forEach((key) => {
            const normalized = parsePermanentViewNumericValueForSync(source[key]);
            if (normalized !== null) out[key] = normalized;
        });
        return out;
    }

    function normalizePermanentViewScrollStateForSync(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const out = {};
        ['page', 'sidepanel'].forEach((partitionKey) => {
            const partition = source[partitionKey];
            if (!partition || typeof partition !== 'object') return;
            const top = parsePermanentViewNumericValueForSync(partition.top);
            const left = parsePermanentViewNumericValueForSync(partition.left);
            if (top === null && left === null) return;
            out[partitionKey] = {
                top: top === null ? 0 : top,
                left: left === null ? 0 : left
            };
        });
        return out;
    }

    function normalizePermanentViewFoldStateForSync(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const out = {};
        ['page', 'sidepanel'].forEach((partitionKey) => {
            const partition = source[partitionKey];
            const expanded = Array.isArray(partition && partition.expanded)
                ? partition.expanded
                : (Array.isArray(partition) ? partition : []);
            const normalizedExpanded = Array.from(new Set(
                expanded
                    .map((id) => String(id || '').trim())
                    .filter(Boolean)
            )).sort();
            if (normalizedExpanded.length) {
                out[partitionKey] = { expanded: normalizedExpanded };
            }
        });
        return out;
    }

    function normalizePermanentViewShellEntryForSync(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const copyIdRaw = typeof source.copyId === 'string' ? source.copyId.trim() : '';
        const copyId = copyIdRaw || null;
        const displayIndexRaw = parseInt(source.displayIndex, 10);
        const displayIndex = copyId && Number.isFinite(displayIndexRaw) && displayIndexRaw > 0
            ? displayIndexRaw
            : null;
        const shell = {
            viewId: copyId ? `permanent-section-copy-${copyId}` : 'permanent-section',
            copyId,
            descriptionMd: String(source.descriptionMd || source.description || '').trim(),
            cardState: normalizePermanentViewCardStateForSync(source.cardState || source),
            scrollState: normalizePermanentViewScrollStateForSync(source.scrollState),
            foldState: normalizePermanentViewFoldStateForSync(source.foldState)
        };
        if (displayIndex) shell.displayIndex = displayIndex;
        return shell;
    }

    function buildFallbackPermanentViewShellSnapshotForSync(sourceInput = null) {
        const source = sourceInput && typeof sourceInput === 'object' ? sourceInput : {};

        if (Array.isArray(source.views)) {
            const deduped = new Map();
            source.views.forEach((view) => {
                const normalized = normalizePermanentViewShellEntryForSync(view);
                if (!normalized || !normalized.viewId) return;
                deduped.set(normalized.viewId, normalized);
            });
            if (!deduped.has('permanent-section')) {
                deduped.set('permanent-section', normalizePermanentViewShellEntryForSync({ copyId: null }));
            }
            return {
                version: Number(source.version) || 1,
                views: Array.from(deduped.values()).sort((a, b) => {
                    const aIsCopy = !!a.copyId;
                    const bIsCopy = !!b.copyId;
                    if (aIsCopy !== bIsCopy) return aIsCopy ? 1 : -1;
                    const aIndex = Number(a.displayIndex) || Number.MAX_SAFE_INTEGER;
                    const bIndex = Number(b.displayIndex) || Number.MAX_SAFE_INTEGER;
                    if (aIndex !== bIndex) return aIndex - bIndex;
                    return String(a.copyId || '').localeCompare(String(b.copyId || ''));
                })
            };
        }

        return {
            version: 1,
            views: [normalizePermanentViewShellEntryForSync({ copyId: null })]
        };
    }

    function collectLocalPermanentViewShellSnapshotForSync(dataInput = null) {
        const data = dataInput && typeof dataInput === 'object' ? dataInput : {};
        if (data && data[PERMANENT_VIEW_SHELL_COMPARE_KEY]) {
            try {
                const parsed = typeof data[PERMANENT_VIEW_SHELL_COMPARE_KEY] === 'string'
                    ? JSON.parse(data[PERMANENT_VIEW_SHELL_COMPARE_KEY])
                    : data[PERMANENT_VIEW_SHELL_COMPARE_KEY];
                const normalized = normalizePermanentViewShellSnapshotForSync(parsed);
                if (normalized && Array.isArray(normalized.views)) return normalized;
            } catch (_) { }
        }
        const protocolBridge = global && global.CanvasProtocolBridge ? global.CanvasProtocolBridge : null;
        if (protocolBridge && typeof protocolBridge.collectPermanentViewShellSnapshot === 'function') {
            try {
                const snapshot = protocolBridge.collectPermanentViewShellSnapshot();
                const normalized = normalizePermanentViewShellSnapshotForSync(snapshot);
                if (normalized && Array.isArray(normalized.views)) return normalized;
            } catch (_) { }
        }
        return buildFallbackPermanentViewShellSnapshotForSync(null);
    }

    function mergeMissingPermanentViewShellStateForApply(snapshotInput = null) {
        const nextSnapshot = normalizePermanentViewShellSnapshotForSync(snapshotInput);
        if (!nextSnapshot || !Array.isArray(nextSnapshot.views)) return nextSnapshot;

        const protocolBridge = global && global.CanvasProtocolBridge ? global.CanvasProtocolBridge : null;
        if (!protocolBridge || typeof protocolBridge.collectPermanentViewShellSnapshot !== 'function') {
            return nextSnapshot;
        }

        let localSnapshot = null;
        try {
            localSnapshot = protocolBridge.collectPermanentViewShellSnapshot();
        } catch (_) {
            localSnapshot = null;
        }
        if (!localSnapshot || !Array.isArray(localSnapshot.views)) {
            return nextSnapshot;
        }

        const localByViewId = new Map();
        localSnapshot.views.forEach((view) => {
            const normalized = normalizePermanentViewShellEntryForSync(view);
            if (!normalized || !normalized.viewId) return;
            localByViewId.set(normalized.viewId, normalized);
        });

        const hasPartitions = (state) => !!(state && typeof state === 'object' && Object.keys(state).length);
        const mergedViews = nextSnapshot.views.map((view) => {
            const normalized = normalizePermanentViewShellEntryForSync(view);
            const localView = localByViewId.get(normalized.viewId);
            if (!localView) return normalized;
            if (!hasPartitions(normalized.scrollState)) {
                normalized.scrollState = localView.scrollState || {};
            }
            if (!hasPartitions(normalized.foldState)) {
                normalized.foldState = localView.foldState || {};
            }
            return normalized;
        });

        mergedViews.sort((a, b) => {
            const aIsCopy = !!a.copyId;
            const bIsCopy = !!b.copyId;
            if (aIsCopy !== bIsCopy) return aIsCopy ? 1 : -1;
            const aIndex = Number(a.displayIndex) || Number.MAX_SAFE_INTEGER;
            const bIndex = Number(b.displayIndex) || Number.MAX_SAFE_INTEGER;
            if (aIndex !== bIndex) return aIndex - bIndex;
            return String(a.copyId || '').localeCompare(String(b.copyId || ''));
        });

        return {
            version: Number(nextSnapshot.version) || 1,
            views: mergedViews
        };
    }

    function normalizePermanentViewShellSnapshotForSync(snapshotInput = null, dataInput = null) {
        const protocolBridge = global && global.CanvasProtocolBridge ? global.CanvasProtocolBridge : null;
        if (snapshotInput && typeof protocolBridge?.normalizePermanentViewShellSnapshot === 'function') {
            try {
                const normalized = protocolBridge.normalizePermanentViewShellSnapshot(snapshotInput);
                if (normalized && typeof normalized === 'object') return normalized;
            } catch (_) { }
        }

        if (typeof protocolBridge?.collectPermanentViewShellSnapshot === 'function') {
            try {
                const collected = protocolBridge.collectPermanentViewShellSnapshot(
                    dataInput && typeof dataInput === 'object'
                        ? dataInput
                        : (snapshotInput && !Array.isArray(snapshotInput?.views) ? snapshotInput : null)
                );
                if (collected && typeof collected === 'object') return collected;
            } catch (_) { }
        }

        const fallbackSource = snapshotInput && typeof snapshotInput === 'object' && !Array.isArray(snapshotInput.views)
            ? snapshotInput
            : dataInput;
        return buildFallbackPermanentViewShellSnapshotForSync(fallbackSource);
    }

    function buildPermanentViewShellComparableString(snapshotInput) {
        const snapshot = normalizePermanentViewShellSnapshotForSync(snapshotInput);
        if (!snapshot || !Array.isArray(snapshot.views)) return '';
        try {
            const canonicalViews = snapshot.views.map((view) => {
                const normalized = normalizePermanentViewShellEntryForSync(view);
                return {
                    viewId: normalized.viewId,
                    copyId: normalized.copyId || null,
                    displayIndex: Number(normalized.displayIndex) || null,
                    descriptionMd: String(normalized.descriptionMd || ''),
                    cardState: normalizePermanentViewCardStateForSync(normalized.cardState)
                };
            });
            canonicalViews.sort((a, b) => {
                const aIsCopy = !!a.copyId;
                const bIsCopy = !!b.copyId;
                if (aIsCopy !== bIsCopy) return aIsCopy ? 1 : -1;
                const aIndex = Number(a.displayIndex) || Number.MAX_SAFE_INTEGER;
                const bIndex = Number(b.displayIndex) || Number.MAX_SAFE_INTEGER;
                if (aIndex !== bIndex) return aIndex - bIndex;
                return String(a.copyId || '').localeCompare(String(b.copyId || ''));
            });
            return JSON.stringify({
                version: Number(snapshot.version) || 1,
                views: canonicalViews
            });
        } catch (_) {
            return '';
        }
    }

    function snapshotDataStableString(data) {
        const source = (data && typeof data === 'object') ? data : {};
        const keys = SNAPSHOT_COMPARABLE_DATA_KEYS.slice().sort();
        const normalized = {};
        keys.forEach((key) => {
            const rawValue = Object.prototype.hasOwnProperty.call(source, key)
                ? source[key]
                : '';
            if (key === TEMP_SECTION_STORAGE_KEY) {
                normalized[key] = buildCanvasTempStateComparableString(rawValue);
            } else {
                normalized[key] = toSnapshotDataString(rawValue);
            }
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

        const normalizedSnapshotTempState = normalizeCanvasTempStatePayloadForSync(rawData[TEMP_SECTION_STORAGE_KEY]);
        if (normalizedSnapshotTempState) {
            data[TEMP_SECTION_STORAGE_KEY] = JSON.stringify(normalizedSnapshotTempState);
        } else if (isBackupPayload && (!data[TEMP_SECTION_STORAGE_KEY] || !String(data[TEMP_SECTION_STORAGE_KEY]).trim())) {
            const canvasState = snapshot.canvasState && typeof snapshot.canvasState === 'object' ? snapshot.canvasState : null;
            if (canvasState) {
                const normalizedCanvasTempState = normalizeCanvasTempStatePayloadForSync(canvasState);
                if (normalizedCanvasTempState) {
                    data[TEMP_SECTION_STORAGE_KEY] = JSON.stringify(normalizedCanvasTempState);
                }
            }
        }

        const permanentViewShellSnapshot = normalizePermanentViewShellSnapshotForSync(
            snapshot.permanentViewShellSnapshot || snapshot.permanentViewShells || snapshot.permanentViewShell,
            data
        );

        return {
            schemaVersion: Number(snapshot.schemaVersion) || 1,
            format: snapshot.format || 'bookmark-canvas-state',
            clientId: String(snapshot.clientId || ''),
            updatedAt: Number(snapshot.updatedAt) || Number(snapshot.generatedAt) || Number(snapshot.exportedAt ? Date.parse(snapshot.exportedAt) : 0) || 0,
            generatedAt: Number(snapshot.generatedAt) || Number(snapshot.exportedAt ? Date.parse(snapshot.exportedAt) : 0) || 0,
            trigger: String(snapshot.trigger || ''),
            permanentTreeSnapshot: normalizeBookmarkTreeSnapshot(snapshot.permanentTreeSnapshot || snapshot.permanentTree || snapshot.permanentTreeData),
            permanentViewShellSnapshot,
            data
        };
    }

    function buildOtherSnapshotComparableString(snapshotInput) {
        const snapshot = normalizeSnapshot(snapshotInput || { data: {} });
        const dataPart = snapshotDataStableString(snapshot && snapshot.data ? snapshot.data : {});
        const permanentViewShellPart = buildPermanentViewShellComparableString(snapshot && snapshot.permanentViewShellSnapshot);
        return `${dataPart}::${permanentViewShellPart}`;
    }

    function snapshotComparableString(snapshot) {
        const dataPart = buildOtherSnapshotComparableString(snapshot);
        const permanentTreePart = (() => {
            const tree = snapshot && snapshot.permanentTreeSnapshot ? snapshot.permanentTreeSnapshot : null;
            if (!tree) return '';
            try {
                return JSON.stringify(buildCanonicalBookmarkTreeComparable(tree));
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

    function buildPermanentTreeComparableString(treeSnapshot) {
        const tree = normalizeBookmarkTreeSnapshot(treeSnapshot);
        if (!tree) return '';
        try {
            return JSON.stringify(buildCanonicalBookmarkTreeComparable(tree));
        } catch (_) {
            return '';
        }
    }

    function buildSnapshotSectionHashes(snapshotInput) {
        const snapshot = normalizeSnapshot(snapshotInput || { data: {} });
        const permanentComparable = buildPermanentTreeComparableString(snapshot.permanentTreeSnapshot);
        const otherComparable = buildOtherSnapshotComparableString(snapshot);
        return {
            permanent: permanentComparable ? hashString(permanentComparable) : '',
            other: otherComparable ? hashString(otherComparable) : ''
        };
    }

    function getRuntimeSectionBaselineHashes(runtimeInput = runtime) {
        const source = runtimeInput && typeof runtimeInput === 'object' ? runtimeInput : {};
        return {
            permanent: String(source.lastPermanentSectionHash || ''),
            other: String(source.lastOtherSyncDataHash || '')
        };
    }

    function updateRuntimeSectionBaselineHashes(snapshotInput, options = {}) {
        const snapshot = normalizeSnapshot(snapshotInput || { data: {} });
        const hashes = buildSnapshotSectionHashes(snapshot);
        const hasPermanentTree = !!normalizeBookmarkTreeSnapshot(snapshot.permanentTreeSnapshot);
        const forcePermanent = options && options.forcePermanent === true;
        const forceOther = options && options.forceOther === true;
        if (runtime) {
            if (hasPermanentTree || forcePermanent) {
                runtime.lastPermanentSectionHash = hashes.permanent;
            }
            if ((snapshot && snapshot.data && typeof snapshot.data === 'object') || forceOther) {
                runtime.lastOtherSyncDataHash = hashes.other;
            }
        }
        return {
            permanent: hashes.permanent,
            other: hashes.other,
            hasPermanentTree
        };
    }

    function resolveConflictSectionState(localHash, remoteHash, baseHash) {
        if (localHash === remoteHash) {
            return 'same';
        }
        if (baseHash) {
            const localChanged = localHash !== baseHash;
            const remoteChanged = remoteHash !== baseHash;
            if (localChanged && remoteChanged) {
                return 'conflict';
            }
            if (localChanged || remoteChanged) {
                return 'change';
            }
        }
        return 'change';
    }

    function buildConflictSectionStates(localSnapshotInput, remoteSnapshotInput, baselineHashesInput = null) {
        const localHashes = buildSnapshotSectionHashes(localSnapshotInput || { data: {} });
        const remoteHashes = buildSnapshotSectionHashes(remoteSnapshotInput || { data: {} });
        const baselineHashes = baselineHashesInput && typeof baselineHashesInput === 'object'
            ? {
                permanent: String(baselineHashesInput.permanent || ''),
                other: String(baselineHashesInput.other || '')
            }
            : getRuntimeSectionBaselineHashes();
        return {
            permanent: resolveConflictSectionState(localHashes.permanent, remoteHashes.permanent, baselineHashes.permanent),
            other: resolveConflictSectionState(localHashes.other, remoteHashes.other, baselineHashes.other),
            localHashes,
            remoteHashes,
            baselineHashes
        };
    }

    function isManualOnlySyncMode() {
        return true;
    }

    function shouldIncludePermanentTreeSnapshot(trigger, options = {}) {
        if (options.includePermanentTree === true) return true;
        if (options.includePermanentTree === false) return false;
        return true;
    }

    function shouldIncludeTempSectionSnapshot(trigger, options = {}) {
        if (options.includeTempSection === true) return true;
        if (options.includeTempSection === false) return false;
        return true;
    }

    function shouldPushBlankSectionFiles(trigger, options = {}) {
        if (options.includeBlankSectionFiles === true) return true;
        if (options.includeBlankSectionFiles === false) return false;
        return true;
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
        const normalizedCachedRaw = cachedRaw ? buildNormalizedCanvasTempStateRawForSync(cachedRaw) : '';
        if (normalizedCachedRaw) {
            data[TEMP_SECTION_STORAGE_KEY] = normalizedCachedRaw;
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

        try {
            const resolvedTempState = await resolveCanvasTempStateForSync(data[TEMP_SECTION_STORAGE_KEY] || '');
            if (resolvedTempState) {
                data[TEMP_SECTION_STORAGE_KEY] = JSON.stringify(resolvedTempState);
            }
        } catch (error) {
            console.warn('[Canvas Sync] resolve local temp-state for snapshot failed:', error);
        }

        const tempSectionMeta = applyTempSectionSnapshotThrottle(data, trigger, options);

        const tempTs = readTempStateTimestampFromRaw(data[TEMP_SECTION_STORAGE_KEY]);
        const now = Date.now();
        const updatedAt = Math.max(now, Number(runtime.lastLocalMutationAt) || 0, tempTs);

        const includePermanentTree = shouldIncludePermanentTreeSnapshot(trigger, options);

        let permanentTreeSnapshot = null;
        if (includePermanentTree) {
            permanentTreeSnapshot = await getPermanentTreeSnapshotForSync();
        }

        let permanentViewShellSnapshot = null;
        try {
            permanentViewShellSnapshot = collectLocalPermanentViewShellSnapshotForSync(data);
        } catch (error) {
            console.warn('[Canvas Sync] collect local permanent view shell snapshot failed:', error);
            permanentViewShellSnapshot = buildFallbackPermanentViewShellSnapshotForSync(data);
        }

        const snapshot = {
            schemaVersion: 1,
            format: 'bookmark-canvas-state',
            clientId: getClientId(),
            updatedAt,
            generatedAt: now,
            trigger: trigger || 'manual',
            permanentTreeSnapshot,
            permanentViewShellSnapshot,
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
            obsidianExportRoot: normalizeObsidianExportRoot(
                current.obsidianExportRoot,
                DEFAULT_SETTINGS.obsidianExportRoot,
                { allowEmpty: true }
            )
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

        return {
            lastRemoteSha: String(mergedRuntime.lastRemoteSha || ''),
            lastLocalHash: String(mergedRuntime.lastLocalHash || ''),
            lastCheckRemoteSha: String(mergedRuntime.lastCheckRemoteSha || ''),
            lastSuccessAt: Number(mergedRuntime.lastSuccessAt) || 0,
            lastLocalMutationAt: Number(mergedRuntime.lastLocalMutationAt) || 0,
            lastRemoteCommittedAt: Number(mergedRuntime.lastRemoteCommittedAt) || 0,
            queueLength,
            isRunning,
            hasPendingWork: isRunning || queueLength > 0 || localDirty,
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

    function applyBackgroundRuntimeState(backgroundRuntime, options = {}) {
        if (!backgroundRuntime || typeof backgroundRuntime !== 'object') return false;

        const nextLastCheckRemoteSha = String(backgroundRuntime.lastCheckRemoteSha || '');
        const nextIsRunning = backgroundRuntime.isRunning === true;
        const nextQueueLength = Math.max(0, Number(backgroundRuntime.queueLength) || 0);
        const nextHasPendingWork = backgroundRuntime.hasPendingWork === true;

        let changed = false;

        if (runtime.lastCheckRemoteSha !== nextLastCheckRemoteSha) {
            runtime.lastCheckRemoteSha = nextLastCheckRemoteSha;
            changed = true;
        }

        if (!!runtime.isRunning !== nextIsRunning) {
            runtime.isRunning = nextIsRunning;
            if (!nextIsRunning) {
                clearStaleRunningUiCheck();
            }
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

        const nextLastRemoteCommittedAt = Number(backgroundRuntime.lastRemoteCommittedAt) || 0;
        if (nextLastRemoteCommittedAt > 0 && runtime.lastRemoteCommittedAt !== nextLastRemoteCommittedAt) {
            runtime.lastRemoteCommittedAt = nextLastRemoteCommittedAt;
            changed = true;
        }

        if (changed) {
            saveRuntime();
            renderStatus();
        }

        return changed;
    }

    function maybePromptPendingConflictOnInit() {
        if (isRecoveryLockActive()) return;
        if (conflictPromptShownOnInit) return;
        if (!pendingConflict) return;
        if (runtime && runtime.isRunning) return;

        conflictPromptShownOnInit = true;
        ensureStatusPanelVisible('conflict', textByLang(
            '检测到并发冲突，请在“状态”面板选择处理方式',
            'Concurrent changes detected. Choose an action in the Status panel.'
        ));
    }

    function buildSnapshotFromRemoteFolderParsed(parsedPayload, remoteRevision = '', options = {}) {
        const parsed = parsedPayload && typeof parsedPayload === 'object' ? parsedPayload : {};
        const storage = parsed.storage && typeof parsed.storage === 'object' ? parsed.storage : {};
        const tempState = parsed.tempState && typeof parsed.tempState === 'object' ? parsed.tempState : null;
        const primaryState = parsed.primaryState && typeof parsed.primaryState === 'object' ? parsed.primaryState : {};
        const remoteCommittedAt = Math.max(0, Number(options && options.remoteCommittedAt) || 0);
        const fallbackCommittedAt = Math.max(0, Number(options && options.fallbackCommittedAt) || 0);
        const snapshotTs = remoteCommittedAt
            || Math.max(
                0,
                Number(primaryState && primaryState.updatedAt) || 0,
                Number(primaryState && primaryState.generatedAt) || 0,
                Number(primaryState && primaryState.exportedAt ? Date.parse(primaryState.exportedAt) : 0) || 0
            )
            || fallbackCommittedAt;

        const data = {};
        Object.keys(storage).forEach((key) => {
            data[key] = toSnapshotDataString(storage[key]);
        });

        const normalizedTempState = normalizeCanvasTempStatePayloadForSync(tempState);
        if (normalizedTempState) {
            data[TEMP_SECTION_STORAGE_KEY] = JSON.stringify(normalizedTempState);
        }

        const normalized = normalizeSnapshot({
            schemaVersion: 1,
            format: 'bookmark-canvas-files',
            trigger: 'remote-files',
            updatedAt: snapshotTs,
            generatedAt: snapshotTs,
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
                remoteSignalSha: '',
                snapshot: normalizeSnapshot({ data: {} }),
                remoteList,
                folderFiles: new Map(),
                exportFormat: ''
            };
        }

        const bridge = global.CanvasObsidianExportBridge;
        const parseSyncFolderFiles = bridge && typeof bridge.parseSyncFolderFilesForSync === 'function'
            ? bridge.parseSyncFolderFilesForSync.bind(bridge)
            : (bridge && typeof bridge.parseSyncFolderFiles === 'function'
                ? bridge.parseSyncFolderFiles.bind(bridge)
                : null);
        const detectSyncFolderExportFormat = bridge && typeof bridge.detectSyncFolderExportFormat === 'function'
            ? bridge.detectSyncFolderExportFormat.bind(bridge)
            : null;
        if (!bridge || typeof parseSyncFolderFiles !== 'function') {
            throw new Error(textByLang('云端同步解析器不可用', 'Cloud sync parser is unavailable'));
        }

        const fetched = await fetchRemoteObsidianFolderFiles(remoteList);
        if (!fetched.folderFiles || fetched.folderFiles.size === 0) {
            return {
                notFound: true,
                path: rootPath,
                sha: remoteRevision || '',
                remoteSignalSha: '',
                snapshot: normalizeSnapshot({ data: {} }),
                remoteList,
                folderFiles: fetched.folderFiles || new Map(),
                exportFormat: ''
            };
        }

        const folderName = (rootPath ? rootPath.split('/').filter(Boolean).slice(-1)[0] : '') || DEFAULT_SETTINGS.obsidianExportRoot;
        let remoteExportFormat = '';
        if (typeof detectSyncFolderExportFormat === 'function') {
            try {
                remoteExportFormat = normalizeObsidianExportFormat(
                    detectSyncFolderExportFormat(fetched.folderFiles, folderName),
                    ''
                );
            } catch (error) {
                console.warn('[Canvas Sync] detect remote export format failed:', error);
            }
        }
        let parsed = null;
        try {
            parsed = await parseSyncFolderFiles(fetched.folderFiles, folderName);
        } catch (error) {
            if (isMissingCanvasOrBackupInRemoteParseError(error)) {
                return {
                    notFound: true,
                    path: rootPath,
                    sha: remoteRevision || '',
                    remoteSignalSha: '',
                    snapshot: normalizeSnapshot({ data: {} }),
                    remoteList,
                    folderFiles: fetched.folderFiles || new Map(),
                    exportFormat: remoteExportFormat
                };
            }
            throw error;
        }
        let remoteCommittedAt = 0;
        let remoteSignalSha = '';
        try {
            const remoteSignal = await readRemoteObsidianSignal(rootPath);
            remoteSignalSha = String(remoteSignal && remoteSignal.revisionSha || '').trim();
            remoteCommittedAt = Math.max(0, Number(remoteSignal && remoteSignal.committedAt) || 0);
            if (runtime) {
                let runtimeChanged = false;
                if (remoteCommittedAt > 0 && runtime.lastRemoteCommittedAt !== remoteCommittedAt) {
                    runtime.lastRemoteCommittedAt = remoteCommittedAt;
                    runtimeChanged = true;
                }
                if (remoteSignalSha && runtime.lastRemoteSignalSha !== remoteSignalSha) {
                    runtime.lastRemoteSignalSha = remoteSignalSha;
                    runtimeChanged = true;
                }
                if (runtimeChanged) {
                    saveRuntime();
                }
            }
        } catch (error) {
            console.warn('[Canvas Sync] read remote signal for snapshot timestamp failed:', error);
        }
        const snapshot = buildSnapshotFromRemoteFolderParsed(parsed, remoteRevision, {
            remoteCommittedAt,
            fallbackCommittedAt: Number(runtime && runtime.lastRemoteCommittedAt) || 0
        });

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

        if (typeof bridge.rebuildPermanentViewShellSnapshotFromSyncFolderFiles === 'function') {
            try {
                const rebuiltPermanentViewShell = bridge.rebuildPermanentViewShellSnapshotFromSyncFolderFiles(
                    fetched.folderFiles,
                    folderName
                );
                const normalizedPermanentViewShell = normalizePermanentViewShellSnapshotForSync(rebuiltPermanentViewShell);
                if (normalizedPermanentViewShell) {
                    snapshot.permanentViewShellSnapshot = normalizedPermanentViewShell;
                }
            } catch (error) {
                console.warn('[Canvas Sync] rebuild remote permanent view shell snapshot failed:', error);
            }
        }

        const sanitizedSnapshot = buildSnapshotForRemoteLocalApply(snapshot);

        return {
            notFound: false,
            path: rootPath,
            sha: remoteRevision || '',
            remoteSignalSha,
            snapshot: sanitizedSnapshot,
            remoteList,
            folderFiles: fetched.folderFiles || new Map(),
            exportFormat: remoteExportFormat
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

    async function applyRemoteFilesBatch(changes, commitMessage, timeoutMs = 120000, options = {}) {
        const mergeViaTempBranch = !!(options && options.mergeViaTempBranch === true);
        const tempBranchPrefix = String(options && options.tempBranchPrefix ? options.tempBranchPrefix : '').trim() || 'canvas-sync';
        const payload = {
            action: mergeViaTempBranch ? 'canvasGitMergeFilesViaTempBranch' : 'canvasGitApplyFilesBatch',
            changes: Array.isArray(changes) ? changes : [],
            commitMessage
        };
        if (mergeViaTempBranch) {
            payload.tempBranchPrefix = tempBranchPrefix;
        }

        if (!payload.changes.length) {
            throw new Error(textByLang('缺少变更列表', 'Missing change list'));
        }

        const resolvedTimeoutMs = Math.max(30000, Number(timeoutMs) || 120000);
        let response = null;
        try {
            response = await sendRuntimeMessage(payload, resolvedTimeoutMs);
        } catch (error) {
            const message = String(error && error.message ? error.message : error || '');
            const isTimeout = /timeout|超时/i.test(message);
            if (isTimeout) {
                throw new Error(textByLang(
                    `批量提交超时（已等待约 ${Math.ceil(resolvedTimeoutMs / 1000)} 秒），请检查网络或 GitHub 状态后重试`,
                    `Batch commit timed out (waited about ${Math.ceil(resolvedTimeoutMs / 1000)}s). Check network/GitHub status and retry.`
                ));
            }
            throw error;
        }
        if (!response || response.success !== true) {
            const message = (response && response.error) || textByLang('批量写入失败', 'Batch write failed');
            const error = new Error(message);
            if (response && response.errorCode) error.code = String(response.errorCode);
            if (response && Number.isFinite(Number(response.sizeBytes))) error.sizeBytes = Number(response.sizeBytes);
            if (response && Number.isFinite(Number(response.limitBytes))) error.limitBytes = Number(response.limitBytes);
            if (response && response.path) error.path = String(response.path);
            if (response && response.conflict === true) error.conflict = true;
            if (response && response.protectedBranch === true) error.protectedBranch = true;
            if (response && response.branch) error.branch = String(response.branch);
            if (response && response.tempBranch) error.tempBranch = String(response.tempBranch);
            if (response && response.tempCommitSha) error.tempCommitSha = String(response.tempCommitSha);
            if (response && response.tempBranchDeleteWarning) error.tempBranchDeleteWarning = String(response.tempBranchDeleteWarning);
            throw error;
        }

        return response;
    }

    async function pushObsidianFilesIncremental(trigger, onProgress = null, options = {}) {
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


        const resolveShardedDirtyInfo = async () => {
            const candidateFn = bridge
                ? (bridge.buildDirtySyncFilesFromShards
                    || bridge.getShardedDirtyPatch
                    || bridge.collectShardedDirtyInfo)
                : null;
            if (typeof candidateFn !== 'function') return null;
            try {
                return await candidateFn.call(bridge, {
                    exportFormat: settings.obsidianExportFormat,
                    exportRoot: settings.obsidianExportRoot,
                    trigger: trigger || ''
                });
            } catch (error) {
                console.warn('[Canvas Sync] resolve sharded dirty info failed:', error);
                return null;
            }
        };

        const applyDirtyPatchToState = (stateInput, patchInput, extraPaths) => {
            const next = normalizeDirtyState(stateInput);
            const patch = patchInput && typeof patchInput === 'object' ? patchInput : {};
            const patchCanvas = patch.canvas && typeof patch.canvas === 'object' ? patch.canvas : {};

            if (patch.canvasLayout === true || patchCanvas.layoutDirty === true) {
                next.canvas.layoutDirty = true;
            }
            if (patch.canvasFileRef === true || patchCanvas.fileRefDirty === true) {
                next.canvas.fileRefDirty = true;
            }

            if (patch.permanentAll === true) {
                next.permanent.all = true;
            }
            if (Array.isArray(patch.permanentPaths)) {
                next.permanent.paths = uniqueStringList([].concat(next.permanent.paths || [], patch.permanentPaths), normalizeSyncPath);
            }

            if (patch.temporaryAll === true) {
                next.temporary.all = true;
            }
            if (Array.isArray(patch.temporaryIds)) {
                next.temporary.ids = uniqueStringList([].concat(next.temporary.ids || [], patch.temporaryIds));
            }

            if (patch.blankAll === true) {
                next.blank.all = true;
            }
            if (Array.isArray(patch.blankIds)) {
                next.blank.ids = uniqueStringList([].concat(next.blank.ids || [], patch.blankIds));
            }

            if (Array.isArray(extraPaths) && extraPaths.length) {
                next.paths = uniqueStringList([].concat(next.paths || [], extraPaths), normalizeSyncPath);
            }

            return normalizeDirtyState(next);
        };

        const shardedDirtyInfo = await resolveShardedDirtyInfo();
        const shardedDirtySource = (shardedDirtyInfo && typeof shardedDirtyInfo === 'object') ? shardedDirtyInfo : null;
        const shardedDirtyPaths = uniqueStringList(
            (shardedDirtySource && (shardedDirtySource.dirtyPaths || shardedDirtySource.paths)) || [],
            normalizeSyncPath
        );
        let effectiveDirtyState = dirtyState;
        if (shardedDirtySource || shardedDirtyPaths.length) {
            const patch = Object.assign(
                {},
                (shardedDirtySource && (shardedDirtySource.dirtyPatch || shardedDirtySource.dirty || shardedDirtySource.patch)) || {}
            );
            if (!Array.isArray(patch.temporaryIds) && Array.isArray(shardedDirtySource && shardedDirtySource.temporaryIds)) {
                patch.temporaryIds = shardedDirtySource.temporaryIds;
            }
            if (!Array.isArray(patch.blankIds) && Array.isArray(shardedDirtySource && shardedDirtySource.blankIds)) {
                patch.blankIds = shardedDirtySource.blankIds;
            }
            if (!Array.isArray(patch.permanentPaths) && Array.isArray(shardedDirtySource && shardedDirtySource.permanentPaths)) {
                patch.permanentPaths = shardedDirtySource.permanentPaths;
            }
            if (typeof patch.canvasLayout !== 'boolean' && typeof shardedDirtySource.canvasLayout === 'boolean') {
                patch.canvasLayout = shardedDirtySource.canvasLayout;
            }
            if (typeof patch.canvasFileRef !== 'boolean' && typeof shardedDirtySource.canvasFileRef === 'boolean') {
                patch.canvasFileRef = shardedDirtySource.canvasFileRef;
            }
            if (typeof patch.temporaryAll !== 'boolean' && typeof shardedDirtySource.temporaryAll === 'boolean') {
                patch.temporaryAll = shardedDirtySource.temporaryAll;
            }
            if (typeof patch.blankAll !== 'boolean' && typeof shardedDirtySource.blankAll === 'boolean') {
                patch.blankAll = shardedDirtySource.blankAll;
            }
            if (typeof patch.permanentAll !== 'boolean' && typeof shardedDirtySource.permanentAll === 'boolean') {
                patch.permanentAll = shardedDirtySource.permanentAll;
            }

            const preferSharded = !!(
                shardedDirtySource.prefer === true
                || shardedDirtySource.preferSharded === true
                || shardedDirtySource.sharded === true
            );
            const baseState = preferSharded ? createDefaultDirtyState() : dirtyState;
            effectiveDirtyState = applyDirtyPatchToState(baseState, patch, shardedDirtyPaths);
        }

        const forceTrackAll = shouldTrackAllFilesForPush(trigger);
        const forceWriteAll = shouldForceWriteAllFilesForPush(trigger);
        const hasEffectiveDirty = hasLocalDirtyWork(effectiveDirtyState) || shardedDirtyPaths.length > 0;
        if (!forceTrackAll && !hasEffectiveDirty) {
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
            effectiveDirtyState,
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
        let remoteFilesByPathForMissingCheck = (options
            && options.remoteFilesByPathForMissingCheck
            && typeof options.remoteFilesByPathForMissingCheck === 'object')
            ? options.remoteFilesByPathForMissingCheck
            : null;
        const skipRemoteMissingPreflight = !!(options && options.skipRemoteMissingPreflight === true);
        if (forceTrackAll && !forceWriteAll && !remoteFilesByPathForMissingCheck && !skipRemoteMissingPreflight) {
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

        const needsPushRecoveryLock = changedFiles.length > 0 || removedPaths.length > 0;
        if (needsPushRecoveryLock && options.skipRecoveryLock !== true && (options.forceRecoveryLock === true || shouldStagePushRecoveryLockForTrigger(trigger))) {
            await stagePushRecoveryLock({
                exportRoot: bundle && bundle.exportRoot ? String(bundle.exportRoot) : settings.obsidianExportRoot,
                files: normalizedFiles
            }, {
                trigger,
                mode: options.recoveryMode || 'push',
                sourcePanel: options.sourcePanel || mapRecoveryLockSourcePanel(trigger),
                baseRemoteSha: String(options.baseRemoteSha || getCurrentCloudHashForDisplay() || ''),
                stage: 'prepared'
            });
        }

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

        let batchWriteNoChanges = false;
        let remoteSignalSha = '';
        if (batchChanges.length) {
            if (recoveryLockState && recoveryLockState.kind === 'push-bundle') {
                updateRecoveryLockState({ stage: 'uploading' });
            }
            let batchPayloadBytes = 0;
            for (let i = 0; i < batchChanges.length; i += 1) {
                const change = batchChanges[i];
                if (!change || change.delete === true) continue;
                batchPayloadBytes += getUtf8Size(change.content || '');
            }
            const batchFileCount = batchChanges.length;
            const timeoutByBytes = Math.ceil(batchPayloadBytes / (512 * 1024)) * 20000;
            const timeoutByCount = Math.ceil(batchFileCount / 50) * 10000;
            const batchTimeoutMs = Math.min(10 * 60 * 1000, Math.max(120000, 120000 + timeoutByBytes + timeoutByCount));
            reportProgress(
                0.65,
                textByLang(
                    `提交到云端...（${batchFileCount} 个文件）`,
                    `Committing to cloud... (${batchFileCount} files)`
                )
            );
            const batchStartedAt = Date.now();
            let batchHeartbeatTimer = null;
            if (typeof onProgress === 'function') {
                batchHeartbeatTimer = setInterval(() => {
                    const elapsedMs = Math.max(0, Date.now() - batchStartedAt);
                    const elapsedSec = Math.floor(elapsedMs / 1000);
                    const creep = Math.min(0.22, elapsedMs / (3 * 60 * 1000) * 0.22);
                    reportProgress(
                        0.65 + creep,
                        textByLang(
                            `提交到云端...（${batchFileCount} 个文件，已等待 ${elapsedSec} 秒）`,
                            `Committing to cloud... (${batchFileCount} files, waiting ${elapsedSec}s)`
                        )
                    );
                }, 2000);
            }
            let batchResult = null;
            try {
                batchResult = await applyRemoteFilesBatch(batchChanges, batchCommitMessage, batchTimeoutMs, {
                    mergeViaTempBranch: options && options.useTempBranchMerge === true,
                    tempBranchPrefix: options && options.tempBranchPrefix
                });
            } finally {
                if (batchHeartbeatTimer) {
                    clearInterval(batchHeartbeatTimer);
                }
            }
            batchWriteNoChanges = !!(batchResult && batchResult.noChanges === true);
            remoteSignalSha = String(batchResult && batchResult.commitSha ? batchResult.commitSha : '').trim();
            const fileShas = batchResult && typeof batchResult.fileShas === 'object' ? batchResult.fileShas : {};
            Object.keys(fileShas || {}).forEach((path) => {
                const sha = String(fileShas[path] || '');
                if (!sha) return;
                writeResultsByPath[path] = { fileSha: sha, commitSha: batchResult.commitSha || null };
            });
            reportProgress(0.9, batchWriteNoChanges
                ? textByLang('云端已是最新状态', 'Cloud already up to date')
                : textByLang('云端提交完成', 'Cloud commit completed'));
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
            const nextDirty = clearDirtyStateBySyncedPaths(effectiveDirtyState, syncedPaths, filesByPath, pathInfo);
            saveDirtyState(nextDirty);
            const clearShardedFn = bridge
                ? (bridge.clearShardedDirtyBySyncedFiles
                    || bridge.clearShardedDirtyBySyncedPaths
                    || bridge.markShardedFilesSynced)
                : null;
            if (typeof clearShardedFn === 'function') {
                const syncedFiles = syncedPaths
                    .map((path) => filesByPath[path])
                    .filter((file) => !!file)
                    .map((file) => ({ path: file.path, meta: file.meta }));
                try {
                    await clearShardedFn.call(bridge, {
                        files: syncedFiles,
                        paths: syncedPaths.slice(),
                        removedPaths: removedPaths.slice(),
                        exportRoot: bundle && bundle.exportRoot ? String(bundle.exportRoot) : settings.obsidianExportRoot,
                        exportFormat: bundle && bundle.exportFormat ? String(bundle.exportFormat) : settings.obsidianExportFormat,
                        trigger: trigger || ''
                    });
                } catch (error) {
                    console.warn('[Canvas Sync] clear sharded dirty failed:', error);
                }
            }
        }

        const exportRootForClassification = bundle && bundle.exportRoot
            ? String(bundle.exportRoot)
            : settings.obsidianExportRoot;
        const isBlankManagedFilePath = (path) => {
            const relativePath = getManagedSyncRelativePath(path, exportRootForClassification);
            return classifyManagedSyncRelativePath(relativePath) === 'blank';
        };
        const rawBlankChangedCount = changedFiles.reduce((count, file) => (
            isBlankManagedFilePath(file && file.path) ? count + 1 : count
        ), 0);
        const rawBlankDeletedCount = removedPaths.reduce((count, path) => (
            isBlankManagedFilePath(path) ? count + 1 : count
        ), 0);

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

        let remoteRevision = '';
        try {
            const revisionFiles = [];
            let complete = true;
            normalizedFiles.forEach((file) => {
                const path = normalizeSyncPath(file && file.path);
                if (!path) return;
                const entry = nextPrevSyncIndex.files && nextPrevSyncIndex.files[path]
                    ? nextPrevSyncIndex.files[path]
                    : null;
                const sha = String(entry && entry.sha ? entry.sha : '').trim();
                if (!sha) {
                    complete = false;
                    return;
                }
                revisionFiles.push({ path, sha });
            });
            if (complete && revisionFiles.length > 0) {
                remoteRevision = buildRemoteObsidianRevisionFromList({ files: revisionFiles });
            }
        } catch (_) {
            remoteRevision = '';
        }

        reportProgress(1, textByLang('上传完成', 'Upload completed'));
        return {
            enabled: true,
            changedCount: batchWriteNoChanges ? 0 : changedFiles.length,
            deletedCount: batchWriteNoChanges ? 0 : removedPaths.length,
            blankChangedCount: batchWriteNoChanges ? 0 : rawBlankChangedCount,
            blankDeletedCount: batchWriteNoChanges ? 0 : rawBlankDeletedCount,
            totalCount: normalizedFiles.length,
            candidateCount: processedPaths.length,
            skippedNoDirty: false,
            noChanges: batchWriteNoChanges,
            localRevision: buildLocalObsidianRevisionFromHashMap(nextHashes),
            remoteRevision,
            remoteSignalSha,
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


    async function readRemoteObsidianSignal(rootPath) {
        const normalizedRootPath = normalizeSyncPath(typeof rootPath === 'string' ? rootPath : (settings && settings.obsidianExportRoot));
        const response = await sendRuntimeMessage({
            action: 'canvasGitReadRemoteSignal',
            rootPath: normalizedRootPath
        }, 30000);

        if (!response || response.success !== true) {
            throw new Error((response && response.error) || textByLang('读取云端最新修改时间失败', 'Failed to read the latest cloud modification time'));
        }

        return {
            rootPath: normalizeSyncPath(response.rootPath) || normalizedRootPath,
            repoRootPath: normalizeSyncPath(response.repoRootPath),
            revisionSha: String(response.revisionSha || ''),
            committedAt: Math.max(0, Number(response.committedAt) || 0),
            notFound: response.notFound === true
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
                    `检测到云端路径可能已变化，请前往同步设置重新校验路径${suggestedRootLabel ? `（建议：${suggestedRootLabel}）` : ''}`,
                    `Cloud path change detected. Open sync settings and re-validate the path${suggestedRootLabel ? ` (suggested: ${suggestedRootLabel})` : ''}`
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

        if (/^(永久栏目|Permanent|临时栏目|Temporary|空白栏目|Blank)\/.+\.(md|json)$/i.test(relative)) {
            return true;
        }
        if (/^(说明导入规则\.md|README_Import_Rules\.md|说明_导入规则\.md)$/i.test(relative)) {
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
            .filter((path) => !!path && (/\.(md|json)$/i.test(path) || /\.canvas$/i.test(path)));

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
            if (getSnapshotHash(localSnapshot) === getSnapshotHash(remoteSnapshot)) {
                setSyncMetaRaw(PENDING_CONFLICT_KEY, null);
                return null;
            }
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
            const parsedSectionStates = parsed.sectionStates && typeof parsed.sectionStates === 'object'
                ? parsed.sectionStates
                : buildConflictSectionStates(localSnapshot, remoteSnapshot, getRuntimeSectionBaselineHashes());
            return {
                id: String(parsed.id || `conflict-${Date.now()}`),
                createdAt: Number(parsed.createdAt) || Date.now(),
                reason: String(parsed.reason || 'concurrent-change'),
                remoteSha: String(parsed.remoteSha || ''),
                remotePath: String(parsed.remotePath || ''),
                mergeConflict: parsed.mergeConflict === true,
                mergeApi: String(parsed.mergeApi || ''),
                tempBranch: String(parsed.tempBranch || ''),
                localSnapshot,
                remoteSnapshot,
                localMeta: parsed.localMeta || buildSnapshotMeta(localSnapshot),
                remoteMeta: parsed.remoteMeta || buildSnapshotMeta(remoteSnapshot),
                sectionStates: {
                    permanent: normalizeComparisonSectionState(parsedSectionStates.permanent, 'change'),
                    other: normalizeComparisonSectionState(parsedSectionStates.other, 'change')
                },
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


    function evaluatePermanentPullDecision(localTreeSnapshot, remoteTreeSnapshot, options = {}) {
        const mode = ensurePermanentPullMode(
            options && options.permanentPullMode
                ? options.permanentPullMode
                : (settings && settings.permanentPullMode)
        );
        const localTree = normalizeBookmarkTreeSnapshot(localTreeSnapshot);
        const remoteTree = normalizeBookmarkTreeSnapshot(remoteTreeSnapshot);
        if (!localTree || !remoteTree) {
            return { policy: mode, result: 'overwrite', reason: 'tree-missing', threshold: 0, logicalChangeCount: 0 };
        }
        const localHash = getBookmarkTreeHash(localTree);
        const remoteHash = getBookmarkTreeHash(remoteTree);
        if (localHash && remoteHash && localHash === remoteHash) {
            return { policy: mode, result: 'incremental', reason: 'same', threshold: buildPermanentIncrementalThreshold(localTree, remoteTree), logicalChangeCount: 0 };
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
        if (source.reason === 'same') {
            return textByLang('永久栏目处理：已与云端一致（其余同步内容仍会继续检查）', 'Permanent section handling: already matches cloud (other sync data will still be checked)');
        }
        return result === 'incremental'
            ? textByLang(`永久栏目处理：自动 → 本次使用增量同步（变更数 ${logicalChangeCount} / 阈值 ${threshold}）`, `Permanent section handling: auto → incremental sync this time (changes ${logicalChangeCount} / threshold ${threshold})`)
            : textByLang(`永久栏目处理：自动 → 本次使用覆盖恢复（变更数 ${logicalChangeCount} / 阈值 ${threshold}）`, `Permanent section handling: auto → overwrite restore this time (changes ${logicalChangeCount} / threshold ${threshold})`);
    }

    function setSyncActionTextHtml(elementId, html) {
        const element = getElement(elementId);
        if (!element) return;
        element.innerHTML = html;
    }

    function configureBaselineOnlyHint(hintEl, baselineOnly, fallbackText = '') {
        if (!hintEl) return;
        hintEl.classList.toggle('canvas-sync-note--baseline', !!baselineOnly);
        if (baselineOnly) {
            hintEl.hidden = false;
            hintEl.textContent = buildBaselineOnlyNoteText();
            return;
        }
        hintEl.hidden = !fallbackText;
        hintEl.textContent = fallbackText || '';
    }

    function updateConflictPanelActionUi(summaryInput, isPreview = false, fallbackHintText = '') {
        latestConflictComparisonSummary = summaryInput && typeof summaryInput === 'object' ? summaryInput : null;
        const baselineOnly = !isPreview && isBaselineOnlyComparisonSummary(latestConflictComparisonSummary);
        const remoteBtn = getElement('canvasSyncConflictUseRemoteBtn');
        const localBtn = getElement('canvasSyncConflictUseLocalBtn');
        const newestBtn = getElement('canvasSyncConflictUseNewestBtn');
        const dismissText = getElement('canvasSyncConflictDismissText');
        const hintEl = getElement('canvasSyncConflictPermanentModeHint');
        if (remoteBtn) remoteBtn.dataset.syncActionMode = baselineOnly ? 'baseline' : 'remote';
        if (localBtn) {
            localBtn.hidden = baselineOnly;
            localBtn.dataset.syncActionMode = 'local';
        }
        if (newestBtn) {
            newestBtn.hidden = baselineOnly;
            newestBtn.dataset.syncActionMode = 'newer';
        }
        setSyncActionTextHtml(
            'canvasSyncConflictUseRemoteText',
            baselineOnly
                ? escapeHtml(textByLang('校准基线', 'Align Baseline'))
                : `<span class="canvas-sync-action-keyword">${escapeHtml(textByLang('使用云端', 'Use Cloud'))}</span>${escapeHtml(textByLang('覆盖本地', ' Overwrite Local'))}`
        );
        setSyncActionTextHtml(
            'canvasSyncConflictUseLocalText',
            `<span class="canvas-sync-action-keyword">${escapeHtml(textByLang('保留本地', 'Keep Local'))}</span>${escapeHtml(textByLang('并覆盖云端', ' Overwrite Cloud'))}`
        );
        setSyncActionTextHtml(
            'canvasSyncConflictUseNewestText',
            `<span class="canvas-sync-action-keyword">${escapeHtml(textByLang('按最近修改时间', 'Use Latest Modified'))}</span>${escapeHtml(textByLang('决定', ' Decide'))}`
        );
        if (dismissText) {
            dismissText.textContent = isPreview
                ? textByLang('关闭预览', 'Close Preview')
                : textByLang('稍后处理', 'Handle later');
        }
        configureBaselineOnlyHint(hintEl, baselineOnly, fallbackHintText);
    }

    function normalizeConflictFineChoice(value) {
        return String(value || '').trim().toLowerCase() === 'remote' ? 'remote' : 'local';
    }

    function buildConflictFineChoices(conflictData) {
        const source = conflictData && typeof conflictData === 'object' ? conflictData : {};
        const fileConflicts = uniqueStringList(source.fileConflicts, normalizeSyncPath);
        const latestDecision = decidePendingConflictByLatestModified(source);
        const defaultChoice = latestDecision && latestDecision.choice
            ? normalizeConflictFineChoice(latestDecision.choice)
            : 'local';
        const nextChoiceMap = {};
        fileConflicts.forEach((path) => {
            nextChoiceMap[path] = normalizeConflictFineChoice(conflictFineChoiceByPath[path] || defaultChoice);
        });
        conflictFineChoiceByPath = nextChoiceMap;
        return {
            fileConflicts,
            choiceByPath: Object.assign({}, nextChoiceMap)
        };
    }

    function renderConflictFinePanel(conflictData, conflictPreview = false) {
        const toggleRow = getElement('canvasSyncConflictFineToggleRow');
        const toggle = getElement('canvasSyncConflictFineToggle');
        const hint = getElement('canvasSyncConflictFineHint');
        const list = getElement('canvasSyncConflictFineList');
        const applyBtn = getElement('canvasSyncConflictApplyFineBtn');

        if (!toggleRow || !toggle || !hint || !list || !applyBtn) return;
        if (!conflictData || conflictPreview) {
            toggleRow.hidden = true;
            hint.hidden = true;
            list.hidden = true;
            list.innerHTML = '';
            applyBtn.hidden = true;
            return;
        }

        const fineChoices = buildConflictFineChoices(conflictData);
        const paths = fineChoices.fileConflicts;
        const noFileConflicts = !paths.length;

        toggleRow.hidden = noFileConflicts;
        toggle.disabled = noFileConflicts;
        if (noFileConflicts) {
            toggle.checked = false;
            conflictFineModeEnabled = false;
            hint.hidden = false;
            hint.textContent = textByLang(
                '当前冲突没有可识别的文件级差异，请使用上方整体策略或“重试云端自动合并”。',
                'No file-level conflicts were identified for this conflict. Use the overall strategy above or retry cloud auto-merge.'
            );
            list.hidden = true;
            list.innerHTML = '';
            applyBtn.hidden = true;
            return;
        }

        toggle.checked = conflictFineModeEnabled === true;
        hint.hidden = false;
        hint.textContent = textByLang(
            '逐文件模式会先把你选择“本地”的文件推到云端，再统一回拉本地对齐。',
            'Fine-grained mode first pushes files you mark as local to cloud, then performs a unified pull to align local.'
        );

        if (!conflictFineModeEnabled) {
            list.hidden = true;
            list.innerHTML = '';
            applyBtn.hidden = true;
            return;
        }

        const rowsHtml = paths.map((path) => {
            const choice = normalizeConflictFineChoice(conflictFineChoiceByPath[path] || 'local');
            const localSelected = choice === 'local' ? ' selected' : '';
            const remoteSelected = choice === 'remote' ? ' selected' : '';
            return [
                '<div class="canvas-sync-row">',
                `<span title="${escapeHtml(path)}">${escapeHtml(path)}</span>`,
                `<select data-conflict-fine-path="${escapeHtml(path)}">`,
                `<option value="local"${localSelected}>${escapeHtml(textByLang('用本地版本', 'Use Local Version'))}</option>`,
                `<option value="remote"${remoteSelected}>${escapeHtml(textByLang('用云端版本', 'Use Cloud Version'))}</option>`,
                '</select>',
                '</div>'
            ].join('');
        }).join('');

        list.innerHTML = rowsHtml;
        list.hidden = false;
        applyBtn.hidden = false;
    }

    async function buildConflictFileSummaryFromCurrentPlan(reason = 'conflict-files-summary') {
        try {
            const pullPlanResult = await buildObsidianPullPlan(reason);
            if (!pullPlanResult || pullPlanResult.enabled !== true || !pullPlanResult.plan) {
                return { fileConflicts: [], filePlanSummary: null };
            }
            const plan = pullPlanResult.plan;
            const fileConflicts = uniqueStringList(
                (Array.isArray(plan.conflict) ? plan.conflict : []).map((entry) => entry && entry.path),
                normalizeSyncPath
            );
            return {
                fileConflicts,
                filePlanSummary: {
                    conflict: fileConflicts.length,
                    download: Array.isArray(plan.download) ? plan.download.length : 0,
                    deleteLocal: Array.isArray(plan.deleteLocal) ? plan.deleteLocal.length : 0,
                    upload: Array.isArray(plan.upload) ? plan.upload.length : 0,
                    deleteRemote: Array.isArray(plan.deleteRemote) ? plan.deleteRemote.length : 0,
                    skip: Array.isArray(plan.skip) ? plan.skip.length : 0
                }
            };
        } catch (_) {
            return { fileConflicts: [], filePlanSummary: null };
        }
    }

    async function resolvePendingConflictByFineChoices() {
        if (shouldBlockOrdinarySyncActionsForRecoveryLock()) {
            openPanel({ activeTab: 'status' });
            toast(textByLang('检测到未完成的同步恢复：请先继续上次操作', 'An unfinished sync recovery was detected: continue the previous action first'));
            return false;
        }
        if (!pendingConflict) {
            toast(textByLang('没有待处理冲突', 'No pending conflicts'));
            return false;
        }
        if (runtime.isRunning) {
            toast(textByLang('正在同步，请稍后', 'Sync is running, please wait'));
            return false;
        }

        const conflictData = pendingConflict;
        const desiredPaths = uniqueStringList(conflictData.fileConflicts, normalizeSyncPath);
        if (!desiredPaths.length) {
            toast(textByLang('当前冲突没有可处理的文件级差异', 'No file-level conflicts available to resolve'));
            return false;
        }

        const pullPlanResult = await buildObsidianPullPlan('manual-conflict-fine-plan');
        if (!pullPlanResult || pullPlanResult.enabled !== true) {
            throw new Error(textByLang('无法读取文件级冲突计划，请稍后重试', 'Cannot load file-level conflict plan. Please retry.'));
        }

        const localByPath = {};
        (Array.isArray(pullPlanResult.localFiles) ? pullPlanResult.localFiles : []).forEach((file) => {
            const path = normalizeSyncPath(file && file.path);
            if (!path) return;
            localByPath[path] = file;
        });
        const conflictPathSet = new Set(
            (Array.isArray(pullPlanResult.plan && pullPlanResult.plan.conflict) ? pullPlanResult.plan.conflict : [])
                .map((entry) => normalizeSyncPath(entry && entry.path))
                .filter(Boolean)
        );
        const targetPaths = desiredPaths.filter((path) => conflictPathSet.has(path));
        if (!targetPaths.length) {
            toast(textByLang('当前文件冲突已变化，请先重试“云端自动合并”或重新同步', 'File conflicts changed. Retry cloud auto-merge or sync again first.'));
            return false;
        }

        const localApplyChanges = [];
        targetPaths.forEach((path) => {
            const choice = normalizeConflictFineChoice(conflictFineChoiceByPath[path] || 'local');
            if (choice !== 'local') return;
            const localFile = localByPath[path];
            if (localFile) {
                localApplyChanges.push({ path, content: String(localFile.content == null ? '' : localFile.content) });
            } else {
                localApplyChanges.push({ path, delete: true });
            }
        });

        if (localApplyChanges.length) {
            await applyRemoteFilesBatch(
                localApplyChanges,
                `Bookmark Canvas Sync: manual fine conflict resolution (${localApplyChanges.length})`,
                120000,
                { mergeViaTempBranch: true, tempBranchPrefix: 'canvas-sync' }
            );
        }

        const preservedConflict = pendingConflict;
        const beforeSuccessAt = Number(runtime.lastSuccessAt) || 0;
        clearPendingConflict();
        await runSync('pull', 'manual-conflict-fine-pull');
        const successAdvanced = (Number(runtime.lastSuccessAt) || 0) > beforeSuccessAt;
        if (successAdvanced && !hasPendingConflict()) {
            toast(textByLang('逐文件冲突处理完成并已对齐本地', 'Fine-grained conflict resolution completed and local is aligned'));
            return true;
        }

        if (!hasPendingConflict()) {
            setPendingConflict(preservedConflict);
        }
        return false;
    }

    async function resolvePendingConflictByBaseline() {
        if (shouldBlockOrdinarySyncActionsForRecoveryLock()) {
            openPanel({ activeTab: 'status' });
            toast(textByLang('检测到未完成的同步恢复：请先继续上次操作', 'An unfinished sync recovery was detected: continue the previous action first'));
            return false;
        }
        if (!pendingConflict) {
            toast(textByLang('没有待处理冲突', 'No pending conflicts'));
            return false;
        }
        if (runtime.isRunning) {
            toast(textByLang('正在同步，请稍后', 'Sync is running, please wait'));
            return false;
        }
        const localSnapshot = normalizeSnapshot(pendingConflict.localSnapshot || { data: {} });
        runtime.lastLocalHash = getSnapshotHash(localSnapshot);
        runtime.lastLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha;
        runtime.lastRemoteSha = pendingConflict.remoteSha || runtime.lastRemoteSha;
        updateRuntimeSectionBaselineHashes(localSnapshot);
        runtime.lastAppliedDirection = 'conflict-baseline';
        clearPendingConflict();
        pendingReasons.clear();
        runtime.queueLength = 0;
        runtime.lastError = '';
        runtime.lastSuccessAt = Date.now();
        saveRuntime();
        renderStatus();
        toast(textByLang('已校准同步基线：未改动本地或云端内容', 'Sync baseline aligned: no local or cloud content was changed'));
        return true;
    }

    function renderConflictPanel() {
        const panel = getElement('canvasSyncConflictPanel');
        if (!panel) return;

        if (isRecoveryLockActive()) {
            panel.hidden = true;
            updateStatusPanelActionPlacement();
            return;
        }

        const conflictPreview = isConflictPreviewActive();
        if (conflictPreview && !previewConflict) {
            previewConflict = buildPreviewConflictPayload();
        }

        const conflictData = pendingConflict || (conflictPreview ? previewConflict : null);

        if (!conflictData) {
            panel.hidden = true;
            conflictFineModeEnabled = false;
            conflictFineChoiceByPath = {};
            const compareWhenHidden = getElement('canvasSyncConflictCompare');
            if (compareWhenHidden) {
                compareWhenHidden.innerHTML = '';
            }
            const summaryWhenHidden = getElement('canvasSyncConflictSummary');
            if (summaryWhenHidden) {
                delete summaryWhenHidden.dataset.dynamicSummary;
            }
            const dismissTextWhenHidden = getElement('canvasSyncConflictDismissText');
            if (dismissTextWhenHidden) {
                dismissTextWhenHidden.textContent = textByLang('稍后处理', 'Handle later');
            }
            renderConflictFinePanel(null, false);
            updatePreviewActionButtonState();
            updateStatusPanelActionPlacement();
            return;
        }

        panel.hidden = false;

        const detectedAt = getElement('canvasSyncConflictDetectedAt');
        if (detectedAt) detectedAt.textContent = formatTime(conflictData.createdAt);

        const localLatestTs = Math.max(
            Number(conflictData.localMeta && conflictData.localMeta.updatedAt) || 0,
            Number(runtime && runtime.lastLocalMutationAt) || 0
        );
        const remoteLatestTs = Math.max(
            Number(runtime && runtime.lastRemoteCommittedAt) || 0,
            Number(conflictData.remoteMeta && conflictData.remoteMeta.updatedAt) || 0
        );
        if (!conflictPreview && !(Number(runtime && runtime.lastRemoteCommittedAt) > 0)) {
            void ensureLatestRemoteCommittedAt(conflictData && conflictData.remotePath ? conflictData.remotePath : (settings && settings.obsidianExportRoot)).then((committedAt) => {
                if (committedAt > 0) {
                    renderConflictPanel();
                }
            });
        }

        const summary = getElement('canvasSyncConflictSummary');
        const compare = getElement('canvasSyncConflictCompare');
        const permanentHint = getElement('canvasSyncConflictPermanentModeHint');
        const conflictSectionStates = buildConflictSectionStates(
            conflictData.localSnapshot,
            conflictData.remoteSnapshot,
            getRuntimeSectionBaselineHashes()
        );
        const comparisonSummary = Object.assign(
            {},
            buildFirstSyncModeComparisonSummary(
                conflictData.localSnapshot,
                conflictData.remoteSnapshot,
                { remoteCommittedAt: remoteLatestTs }
            ),
            {
                permanentState: normalizeComparisonSectionState(conflictSectionStates.permanent, 'change'),
                otherState: normalizeComparisonSectionState(conflictSectionStates.other, 'change')
            }
        );
        const cloudMergeConflictHint = !conflictPreview && conflictData && (conflictData.mergeConflict === true || conflictData.reason === 'cloud-merge-conflict')
            ? textByLang(
                '已尝试通过 GitHub 云端合并接口自动合并，但仍有冲突，请手动选择处理方式。',
                'An automatic cloud merge via GitHub API was attempted but still conflicted. Please choose a manual resolution.'
            )
            : '';
        const cloudMergeBranchHint = !conflictPreview && conflictData && conflictData.tempBranch
            ? textByLang(
                `临时分支：${String(conflictData.tempBranch)}`,
                `Temporary branch: ${String(conflictData.tempBranch)}`
            )
            : '';
        if (summary) {
            summary.textContent = conflictPreview
                ? textByLang(
                    '这是“冲突面板”预览：用于展示两端都改时的处理方式。',
                    'This is a conflict panel preview showing how the UI looks when both sides changed.'
                )
                : [cloudMergeConflictHint, buildComparisonPanelSummaryText(comparisonSummary, 'conflict'), cloudMergeBranchHint]
                    .filter((text) => !!String(text || '').trim())
                    .join('\n');
            summary.dataset.dynamicSummary = 'true';
        }
        if (compare) {
            renderStatusCompareSections('canvasSyncConflictCompare', buildComparisonPanelSections(comparisonSummary, {
                mode: 'conflict',
                localUpdatedAt: localLatestTs,
                remoteUpdatedAt: remoteLatestTs
            }));
        }

        const localTree = conflictData && conflictData.localSnapshot ? conflictData.localSnapshot.permanentTreeSnapshot : null;
        const remoteTree = conflictData && conflictData.remoteSnapshot ? conflictData.remoteSnapshot.permanentTreeSnapshot : null;
        const permanentHintText = formatPermanentPullDecisionText(evaluatePermanentPullDecision(localTree, remoteTree));
        updateConflictPanelActionUi(comparisonSummary, conflictPreview, permanentHintText);
        renderConflictFinePanel(conflictData, conflictPreview);

        updatePreviewActionButtonState();
        updateStatusPanelActionPlacement();
    }

    function setPendingConflict(conflict) {
        pendingConflict = conflict;
        conflictFineModeEnabled = false;
        conflictFineChoiceByPath = {};
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
            queueLength: runtime.queueLength
        });
    }

    function clearPendingConflict() {
        pendingConflict = null;
        conflictFineModeEnabled = false;
        conflictFineChoiceByPath = {};
        runtime.hasPendingConflict = false;
        conflictPromptShownOnInit = false;
        persistPendingConflict();
        saveRuntime();
        renderStatus();
        renderConflictPanel();
        void updateBackgroundSyncContext('sync-conflict-cleared', {
            hasPendingWork: hasLocalDirtyWork(),
            isRunning: runtime.isRunning,
            queueLength: runtime.queueLength
        });
    }

    async function setPendingConflictState(remoteSha, message, options = {}) {
        const safeMessage = String(
            message || textByLang(
                '检测到本地与云端都有修改，已转入冲突面板，请选择处理方式',
                'Both local and cloud changed. Moved to the conflict panel. Please choose a resolution.'
            )
        ).trim();

        let localSnapshot = null;
        let remoteState = null;
        try {
            localSnapshot = await buildLocalSnapshot('pending-upgrade-to-conflict', {
                includePermanentTree: true,
                includeTempSection: true,
                includeBlankSectionFiles: true
            });
        } catch (_) {
            localSnapshot = normalizeSnapshot({ data: {} });
        }

        try {
            remoteState = await readRemoteSnapshotWithPathRecovery({
                interactive: false,
                continueAfterConfirm: false,
                throwWhenDetected: false
            });
        } catch (_) {
            remoteState = null;
        }

        const fallbackRemoteState = {
            notFound: false,
            sha: String(remoteSha || ''),
            path: String(settings && settings.obsidianExportRoot || ''),
            snapshot: normalizeSnapshot({ updatedAt: Date.now(), data: {} })
        };
        const resolvedRemoteState = (remoteState && !remoteState.notFound && remoteState.snapshot)
            ? remoteState
            : fallbackRemoteState;
        const fileConflictSummary = await buildConflictFileSummaryFromCurrentPlan('pending-upgrade-conflict');

        setPendingConflict(createPendingConflictPayload(
            normalizeSnapshot(localSnapshot || { data: {} }),
            normalizeSnapshot(resolvedRemoteState.snapshot || { data: {} }),
            resolvedRemoteState,
            {
                reason: String(options && options.reason || 'pending-upgraded'),
                fileConflicts: fileConflictSummary.fileConflicts,
                filePlanSummary: fileConflictSummary.filePlanSummary || undefined
            }
        ));

        runtime.lastError = safeMessage;
        saveRuntime();
        renderStatus();
        ensureStatusPanelVisible('conflict', safeMessage);
        await updateBackgroundSyncContext('pending-upgraded-to-conflict', {
            hasPendingWork: true,
            isRunning: runtime.isRunning,
            queueLength: runtime.queueLength,
            localDirty: hasLocalDirtyWork()
        });
    }

    function backupSnapshotForRecovery(snapshot, reason) {
        const nowTs = Date.now();
        const normalizedReason = String(reason || 'manual').trim() || 'manual';
        const snapshotHash = getSnapshotHash(snapshot);
        const record = {
            ts: nowTs,
            reason: normalizedReason,
            snapshotHash,
            snapshot
        };

        const warnQuota = (error) => {
            const warnTs = Date.now();
            if (warnTs - lastRecoverySnapshotWarningAt < 6000) return;
            lastRecoverySnapshotWarningAt = warnTs;
            console.warn('[Canvas Sync] save recovery snapshot skipped (storage quota):', error);
            toast(textByLang(
                '本地存储空间不足：恢复快照备份失败，请释放空间后重试。',
                'Storage quota exceeded: failed to save recovery snapshot. Free storage space and retry.'
            ));
        };

        try {
            const list = safeParse(getSyncMetaRaw(RECOVERY_KEY), []);
            const arr = (Array.isArray(list) ? list : [])
                .filter((item) => item && typeof item === 'object')
                .sort((a, b) => Math.max(0, Number(b && b.ts) || 0) - Math.max(0, Number(a && a.ts) || 0));
            const latestRecord = arr[0] && typeof arr[0] === 'object' ? arr[0] : null;
            if (latestRecord) {
                const latestSnapshot = normalizeSnapshot(latestRecord.snapshot || null);
                const latestHash = String(latestRecord.snapshotHash || '').trim() || (latestSnapshot ? getSnapshotHash(latestSnapshot) : '');
                if (snapshotHash && latestHash && snapshotHash === latestHash) {
                    return true;
                }
            }

            setSyncMetaRaw(RECOVERY_KEY, JSON.stringify([record]));
            return true;
        } catch (error) {
            try {
                setSyncMetaRaw(RECOVERY_KEY, JSON.stringify([{
                    ts: record.ts,
                    reason: record.reason,
                    snapshotHash: snapshotHash || getSnapshotHash(snapshot),
                    snapshotOmitted: true
                }]));
            } catch (_) { }
            warnQuota(error);
            return false;
        }

        return false;
    }

    function restartRecoverySnapshotTimer() {
        // Recovery snapshots are now produced by background alarms.
        // Foreground keeps only UI state in sync.
        renderRecoverySnapshotDownloadStatus();
        updateSyncEnabledDependentFieldState();
    }

    function applySnapshotToLocal(snapshot) {
        const nextData = snapshot && snapshot.data && typeof snapshot.data === 'object' ? snapshot.data : {};

        SYNC_KEYS.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(nextData, key)) {
                localStorage.setItem(key, String(nextData[key]));
            } else {
                localStorage.removeItem(key);
            }
        });

        try {
            const protocolBridge = global && global.CanvasProtocolBridge && typeof global.CanvasProtocolBridge.applyPermanentViewShellSnapshot === 'function'
                ? global.CanvasProtocolBridge
                : null;
            const permanentViewSnapshotForApply = snapshot && snapshot.permanentViewShellSnapshot
                ? mergeMissingPermanentViewShellStateForApply(snapshot.permanentViewShellSnapshot)
                : null;
            if (protocolBridge && permanentViewSnapshotForApply) {
                protocolBridge.applyPermanentViewShellSnapshot(permanentViewSnapshotForApply);
            }
        } catch (_) { }

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

        const tempState = normalizeCanvasTempStatePayloadForSync(tempRaw);
        if (!tempState) return snapshot;

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
                const fromRemoved = removedIds.has(fromNode) && !isPermanentCanvasNodeIdForSync(fromNode);
                const toRemoved = removedIds.has(toNode) && !isPermanentCanvasNodeIdForSync(toNode);
                return !fromRemoved && !toRemoved;
            });

        const nextTempState = buildPersistedCanvasTempStateForSync(Object.assign({}, tempState, {
            sections: filteredSections,
            edges: filteredEdges
        }), tempState);
        nextData[TEMP_SECTION_STORAGE_KEY] = JSON.stringify(nextTempState);

        return Object.assign({}, snapshot, { data: nextData });
    }

    function decideWinner(localSnapshot, remoteSnapshot, concurrentChanged, localChanged = false, remoteChanged = false, syncMethod = settings.syncMethod) {
        if (concurrentChanged) {
            if (settings.conflictPolicy === 'ours') return 'local';
            if (settings.conflictPolicy === 'theirs') return 'remote';
            if (settings.conflictPolicy === 'newer') {
                return decideWinnerByLatestModified(
                    Number(localSnapshot && localSnapshot.updatedAt) || 0,
                    Number(remoteSnapshot && remoteSnapshot.updatedAt) || 0
                );
            }
            return '';
        }

        if (syncMethod === 'reset' && !localChanged && remoteChanged) return 'remote-reset';

        if (localChanged && !remoteChanged) return 'local';
        if (remoteChanged && !localChanged) return 'remote';

        const localTs = Number(localSnapshot.updatedAt) || 0;
        const remoteTs = Number(remoteSnapshot.updatedAt) || 0;
        const localBytes = getSnapshotBytes(localSnapshot);
        const remoteBytes = getSnapshotBytes(remoteSnapshot);

        if (!localTs || !remoteTs) {
            if (localBytes === remoteBytes) return 'local';
            // Timestamp is missing on at least one side; avoid auto-picking a winner by implicit 0.
            return '';
        }

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
        const reason = String(extra && extra.reason || 'concurrent-change').trim() || 'concurrent-change';
        const mergeConflict = extra && extra.mergeConflict === true;
        const mergeApi = String(extra && extra.mergeApi || '').trim();
        const tempBranch = String(extra && extra.tempBranch || '').trim();
        const sectionStates = (() => {
            const source = extra && extra.sectionStates && typeof extra.sectionStates === 'object'
                ? extra.sectionStates
                : buildConflictSectionStates(localSnapshot, remoteSnapshot, getRuntimeSectionBaselineHashes());
            return {
                permanent: normalizeComparisonSectionState(source.permanent, 'change'),
                other: normalizeComparisonSectionState(source.other, 'change')
            };
        })();
        return {
            id: `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(),
            reason,
            remoteSha: String(remoteState && remoteState.sha || ''),
            remotePath: String(remoteState && remoteState.path || ''),
            mergeConflict,
            mergeApi,
            tempBranch,
            localSnapshot,
            remoteSnapshot,
            localMeta: buildSnapshotMeta(localSnapshot),
            remoteMeta: buildSnapshotMeta(remoteSnapshot),
            sectionStates,
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

        const remoteHash = remoteExists ? getSnapshotHash(remoteSnapshot) : '';
        const snapshotsMatch = !!(remoteExists && nextLocalHash && remoteHash && nextLocalHash === remoteHash);
        const remoteSha = String(remoteState && remoteState.sha || '');
        const hasLocalBase = !!runtime.lastLocalHash;
        const hasRemoteBase = !!runtime.lastRemoteSha;
        const localDirty = hasLocalDirtyWork();
        const localChanged = !snapshotsMatch && hasLocalBase && runtime.lastLocalHash !== nextLocalHash;
        const remoteChanged = !snapshotsMatch && hasRemoteBase && !!remoteSha && runtime.lastRemoteSha !== remoteSha;
        const concurrentChanged = localChanged && remoteChanged;
        const localUntracked = !snapshotsMatch && !hasLocalBase && localDirty;
        const remoteUntracked = !snapshotsMatch && !hasRemoteBase && !!remoteSha;
        const winner = remoteExists
            ? decideWinner(localSnapshot, remoteSnapshot, concurrentChanged, localChanged, remoteChanged, syncMethod)
            : 'local';

        return {
            remoteSnapshot,
            localHash: nextLocalHash,
            remoteHash,
            remoteSha,
            snapshotsMatch,
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

    async function resolvePendingConflict(choice, options = {}) {
        if (shouldBlockOrdinarySyncActionsForRecoveryLock() && options.bypassRecoveryLock !== true) {
            openPanel({ activeTab: 'status' });
            toast(textByLang('检测到未完成的同步恢复：请先继续上次操作', 'An unfinished sync recovery was detected: continue the previous action first'));
            return;
        }
        if (!pendingConflict) {
            toast(textByLang('没有待处理冲突', 'No pending conflicts'));
            return;
        }
        if (runtime.isRunning) {
            toast(textByLang('正在同步，请稍后', 'Sync is running, please wait'));
            return;
        }

        const requestedChoice = String(choice || '').trim().toLowerCase();
        let resolvedChoice = requestedChoice;
        if (resolvedChoice === 'newer') {
            const latestDecision = decidePendingConflictByLatestModified(pendingConflict);
            resolvedChoice = latestDecision.choice;
            if (!resolvedChoice) {
                toast(textByLang(
                    '无法按最近修改时间自动裁决：两边时间相同或时间信息不足，请手动选择本地或云端',
                    'Cannot resolve by latest modification time: timestamps are tied or unavailable. Choose local or cloud manually.'
                ));
                renderConflictPanel();
                return;
            }
        }

        if (options.bypassRecoveryLock !== true) {
            stageConflictRecoveryLock(resolvedChoice, {
                trigger: `manual-conflict-${resolvedChoice}`,
                targetRemoteSha: pendingConflict && pendingConflict.remoteSha ? pendingConflict.remoteSha : ''
            });
        }

        runtime.isRunning = true;
        saveRuntime();
        renderStatus();

        try {
            const localSnapshot = normalizeSnapshot(pendingConflict.localSnapshot);
            const remoteSnapshot = normalizeSnapshot(pendingConflict.remoteSnapshot);

            if (resolvedChoice === 'local') {
                if (settings.obsidianFilePushEnabled === false) {
                    throw new Error(textByLang('已关闭 Obsidian 文件推送，无法覆盖云端', 'Obsidian file push is disabled, cannot overwrite cloud'));
                }
                applySnapshotToLocal(localSnapshot);
                const pushResult = await pushObsidianFilesIncremental('manual-conflict-keep-local', null, { forceRecoveryLock: true, recoveryMode: 'push', sourcePanel: 'conflict', baseRemoteSha: pendingConflict && pendingConflict.remoteSha ? pendingConflict.remoteSha : '' });
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
                runtime.lastRemoteSignalSha = String(pushResult && pushResult.remoteSignalSha || runtime.lastRemoteSignalSha || '').trim();
                updateRuntimeSectionBaselineHashes(localSnapshot);
                runtime.lastAppliedDirection = 'conflict-local';
                storeConflictRecord(localSnapshot, remoteSnapshot, 'resolved-local', {
                    conflictId: pendingConflict.id,
                    remoteSha: remoteRevision || pendingConflict.remoteSha,
                    changedCount: Number(pushResult && pushResult.changedCount) || 0
                });
            } else if (resolvedChoice === 'remote') {
                // Conflict panel -> use remote:
                // overwrite permanent section first, then apply snapshot data,
                // so a permanent-overwrite failure won't leave temp/blank already switched.
                const currentLocal = await buildLocalSnapshot('conflict-local-backup', { includePermanentTree: true });
                let remotePermanentTreeSnapshot = remoteSnapshot && remoteSnapshot.permanentTreeSnapshot;
                try {
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
                    applySnapshotToLocal(buildSnapshotForRemoteLocalApply(remoteSnapshot));
                } catch (error) {
                    console.warn('[Canvas Sync] apply conflict(remote) to local failed:', error);
                    const rollbackResult = await rollbackRemoteLocalApplyFromSnapshot(
                        currentLocal,
                        'conflict-remote-overwrite'
                    );
                    if (rollbackResult && Array.isArray(rollbackResult.errors) && rollbackResult.errors.length > 0) {
                        const rollbackErrorText = rollbackResult.errors.join(' | ');
                        throw new Error(textByLang(
                            `冲突处理失败：${error && error.message ? error.message : String(error)}；自动回滚也失败：${rollbackErrorText}`,
                            `Conflict resolution failed: ${error && error.message ? error.message : String(error)}; automatic rollback also failed: ${rollbackErrorText}`
                        ));
                    }
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
                const syncedRemoteSnapshot = normalizeSnapshot(remoteSnapshot || { data: {} });
                if (!syncedRemoteSnapshot.permanentTreeSnapshot) {
                    syncedRemoteSnapshot.permanentTreeSnapshot = normalizeBookmarkTreeSnapshot(remotePermanentTreeSnapshot);
                }
                updateRuntimeSectionBaselineHashes(syncedRemoteSnapshot);
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
            if (resolvedChoice === 'remote') {
                clearRecoverySnapshotsByReasonKeywords([
                    'before-apply-remote-conflict',
                    'before-permanent-overwrite:manual-conflict-use-remote'
                ]);
            }
            await clearRecoveryLockCompletely();
            clearActiveRunRecoveryRecord();
            saveRuntime();
            renderStatus();

            if (requestedChoice === 'newer') {
                toast(resolvedChoice === 'local'
                    ? textByLang('冲突已处理：按最近修改时间决定，本地更新更晚，已保留本地并覆盖云端', 'Conflict resolved by latest modification time: local is newer, so local overwrote cloud')
                    : textByLang('冲突已处理：按最近修改时间决定，云端更新更晚，已使用云端覆盖本地', 'Conflict resolved by latest modification time: cloud is newer, so cloud overwrote local'));
            } else {
                toast(resolvedChoice === 'local'
                    ? textByLang('冲突已处理：已保留本地并覆盖云端', 'Conflict resolved: kept local and overwrote remote')
                    : textByLang('冲突已处理：已使用云端覆盖本地', 'Conflict resolved: used remote to overwrite local'));
            }
        } catch (error) {
            const activeLock = normalizeRecoveryLockRecord(recoveryLockState || loadRecoveryLockState());
            const shouldReleasePreparedConflictLock = !!(
                activeLock
                && activeLock.kind === 'conflict-choice'
                && activeLock.stage === 'prepared'
            );
            if (shouldReleasePreparedConflictLock) {
                await clearRecoveryLockCompletely();
                clearActiveRunRecoveryRecord();
                handleRecoveryLockReleased();
            }
            runtime.lastError = error && error.message ? error.message : String(error);
            saveRuntime();
            renderStatus();
            toast(textByLang(`冲突处理失败：${runtime.lastError}`, `Conflict resolution failed: ${runtime.lastError}`));
        } finally {
            runtime.isRunning = false;
            saveRuntime();
            renderStatus();
            renderConflictPanel();
        }
    }

    async function retryPendingConflictCloudMerge() {
        if (shouldBlockOrdinarySyncActionsForRecoveryLock()) {
            openPanel({ activeTab: 'status' });
            toast(textByLang('检测到未完成的同步恢复：请先继续上次操作', 'An unfinished sync recovery was detected: continue the previous action first'));
            return false;
        }
        if (!pendingConflict) {
            toast(textByLang('没有待处理冲突', 'No pending conflicts'));
            return false;
        }
        if (runtime.isRunning) {
            toast(textByLang('正在同步，请稍后', 'Sync is running, please wait'));
            return false;
        }

        const preservedConflict = pendingConflict;
        const beforeSuccessAt = Number(runtime.lastSuccessAt) || 0;
        clearPendingConflict();

        await runSync('full', 'manual-conflict-cloud-merge-retry');

        const successAdvanced = (Number(runtime.lastSuccessAt) || 0) > beforeSuccessAt;
        if (successAdvanced && !hasPendingConflict()) {
            toast(textByLang(
                '已重试云端自动合并并完成同步',
                'Cloud auto-merge retry succeeded and sync completed'
            ));
            return true;
        }

        if (!hasPendingConflict()) {
            setPendingConflict(preservedConflict);
            runtime.lastError = runtime.lastError || textByLang(
                '重试云端自动合并未完成，请继续在冲突面板中手动处理',
                'Cloud auto-merge retry did not complete. Continue manual handling in the conflict panel.'
            );
            saveRuntime();
            renderStatus();
            renderConflictPanel();
        }
        return false;
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
                '检测到同步文件超过 100MB，本次推送已停止。',
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
                'Sync file exceeded 100MB; this push has been stopped.',
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

    async function runSync(mode, trigger, options = {}) {
        if (options.bypassRecoveryLock !== true && shouldBlockOrdinarySyncActionsForRecoveryLock()) {
            const usableRecoveryLock = await ensureUsableRecoveryLockState();
            if (usableRecoveryLock && shouldBlockOrdinarySyncActionsForRecoveryLock()) {
                openPanel({ activeTab: 'status' });
                toast(textByLang('检测到未完成的同步恢复：请先继续上次操作', 'An unfinished sync recovery was detected: continue the previous action first'));
                return;
            }
        }
        if (!settings.enabled) {
            toast(textByLang('同步已关闭', 'Sync is disabled'));
            return;
        }

        const isManualTrigger = isManualSyncTrigger(mode, trigger);
        const isSilentAutoPullTrigger = false;
        const skipFormatMigrationSecondaryConfirm = !!(options && options.skipFormatMigrationSecondaryConfirm === true);
        const effectiveMode = mode;
        const syncMethod = DEFAULT_SETTINGS.syncMethod;
        const hasPendingLocalFormatChange = hasPendingLocalObsidianExportFormatChange();

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
            ;
        if (shouldRequireLocalDirty && !hasLocalDirtyWork() && !hasPendingLocalFormatChange) {
            pendingReasons.clear();
            runtime.queueLength = 0;
            runtime.lastError = '';
            saveRuntime();
            renderStatus();
            void updateBackgroundSyncContext('sync-skip-clean', {
                queueLength: 0,
                hasPendingWork: false,
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

        const syncStartedAt = Date.now();
        let syncCompletedSuccessfully = false;
        runtime.isRunning = true;
        runtime.lastTrigger = trigger || 'manual';
        runtime.lastSyncMode = `${effectiveMode}:${syncMethod}`;
        beginActiveRunRecovery(effectiveMode, trigger, { manual: isManualTrigger });
        saveRuntime();
        renderStatus();
        syncUiProgressEnabled = true;
        if (syncUiProgressEnabled) {
            updateSyncUiProgress(textByLang('准备同步...', 'Preparing sync...'), 0);
        }
        void updateBackgroundSyncContext('sync-running', {
            isRunning: true,
            queueLength: runtime.queueLength
        });

        try {
            const localSnapshot = await buildLocalSnapshot(trigger);
            let localHash = getSnapshotHash(localSnapshot);
            let abortedByPendingConflict = false;
            let skipSuccessToast = false;
            updateSyncUiProgress(textByLang('已读取本地状态', 'Loaded local state'), 10);

            const doPush = async (reason, pushOptions = {}) => {
                let obsidianPushResult = null;
                const syncTrigger = String((pushOptions && pushOptions.syncTrigger) || trigger || reason || 'sync');
                const formatMigration = pushOptions && pushOptions.formatMigration && typeof pushOptions.formatMigration === 'object'
                    ? pushOptions.formatMigration
                    : null;
                const preflightRemoteFilesByPath = (pushOptions
                    && pushOptions.remoteFilesByPathForMissingCheck
                    && typeof pushOptions.remoteFilesByPathForMissingCheck === 'object')
                    ? pushOptions.remoteFilesByPathForMissingCheck
                    : null;
                const preflightRemoteSignalSha = String(
                    pushOptions && pushOptions.remoteSignalSha ? pushOptions.remoteSignalSha : ''
                ).trim();
                const canPushBlankSectionFiles = shouldPushBlankSectionFiles(syncTrigger, {
                    includeBlankSectionFiles: formatMigration ? true : undefined
                });
                if (settings.obsidianFilePushEnabled !== false && canPushBlankSectionFiles) {
                    const pushProgress = makeProgressRange(15, 85);
                    obsidianPushResult = await pushObsidianFilesIncremental(syncTrigger, pushProgress, {
                        forceRecoveryLock: shouldForceRecoveryLockForTrigger(syncTrigger),
                        recoveryMode: effectiveMode,
                        sourcePanel: mapRecoveryLockSourcePanel(syncTrigger),
                        baseRemoteSha: getCurrentCloudHashForDisplay(),
                        remoteFilesByPathForMissingCheck: preflightRemoteFilesByPath,
                        skipRemoteMissingPreflight: !!preflightRemoteSignalSha,
                        useTempBranchMerge: !!(pushOptions && pushOptions.useTempBranchMerge === true),
                        tempBranchPrefix: String((pushOptions && pushOptions.tempBranchPrefix) || '').trim() || 'canvas-sync'
                    });
                    if (obsidianPushResult && obsidianPushResult.enabled) {
                        const pushedAt = Date.now();
                        runtime.lastObsidianPushAt = pushedAt;
                        runtime.lastObsidianPushChanged = Number(obsidianPushResult.changedCount) || 0;
                        runtime.lastObsidianPushTotal = Number(obsidianPushResult.totalCount) || 0;
                        runtime.lastLocalFilesSha = String(obsidianPushResult.localRevision || runtime.lastLocalFilesSha || '');
                        const pushedRemoteSignalSha = String(obsidianPushResult.remoteSignalSha || '').trim();
                        if (pushedRemoteSignalSha) {
                            runtime.lastRemoteSignalSha = pushedRemoteSignalSha;
                        }
                        const blankChangedCount = Number(obsidianPushResult.blankChangedCount) || 0;
                        const blankDeletedCount = Number(obsidianPushResult.blankDeletedCount) || 0;
                        if ((blankChangedCount + blankDeletedCount) > 0) {
                            runtime.lastBlankSectionFilePushAt = pushedAt;
                        }
                    }
                } else if (settings.obsidianFilePushEnabled === false) {
                    throw new Error(textByLang('已关闭 Obsidian 文件推送，无法执行上传同步', 'Obsidian file push is disabled, cannot perform upload sync'));
                } else {
                    throw new Error(textByLang(
                        '当前同步策略未启用文件推送，已中止本次上传',
                        'File push is disabled by the current sync policy; this upload was aborted.'
                    ));
                }

                let remoteRevision = '';
                if (settings.obsidianFilePushEnabled !== false) {
                    remoteRevision = String(obsidianPushResult && obsidianPushResult.remoteRevision || '').trim();
                    if (remoteRevision) {
                        updateSyncUiProgress(textByLang('云端状态已更新', 'Cloud state updated'), 95);
                    } else {
                        const noCloudWrite = !!(obsidianPushResult && (
                            obsidianPushResult.noChanges === true
                            || ((Number(obsidianPushResult.changedCount) || 0) === 0 && (Number(obsidianPushResult.deletedCount) || 0) === 0)
                        ));
                        const trustedBaselineRevision = String(runtime.lastRemoteSha || '').trim();
                        if (preflightRemoteSignalSha && noCloudWrite && trustedBaselineRevision) {
                            remoteRevision = trustedBaselineRevision;
                            updateSyncUiProgress(textByLang('云端状态已更新', 'Cloud state updated'), 95);
                        } else {
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
                    }
                }

                if (true) {
                    if (preflightRemoteSignalSha) {
                        runtime.lastRemoteSignalSha = preflightRemoteSignalSha;
                    }
                    runtime.lastLocalHash = localHash;
                    runtime.lastLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha;
                    runtime.lastRemoteSha = remoteRevision || runtime.lastRemoteSha;
                    if (remoteRevision) {
                        runtime.lastCheckRemoteSha = remoteRevision;
                    }
                    updateRuntimeSectionBaselineHashes(localSnapshot);
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
                        const normalizedPushedTempStateRaw = pushedTempStateRaw
                            ? buildNormalizedCanvasTempStateRawForSync(pushedTempStateRaw)
                            : '';
                        if (normalizedPushedTempStateRaw) {
                            setSyncMetaRaw(LAST_UPLOADED_TEMP_STATE_KEY, normalizedPushedTempStateRaw);
                        }
                    }
                    setStoredSyncedObsidianExportFormat(getCurrentObsidianExportFormatForSync());
                }
                runtime.lastAppliedDirection = formatMigration ? 'format-migration-push' : 'push';

                if (formatMigration) {
                    return textByLang(
                        `格式迁移：${formatObsidianExportFormatLabel(formatMigration.baseFormat)} -> ${formatObsidianExportFormatLabel(formatMigration.currentFormat)}，已重导出并覆盖云端`,
                        `Format migration: ${formatObsidianExportFormatLabel(formatMigration.baseFormat)} -> ${formatObsidianExportFormatLabel(formatMigration.currentFormat)}; re-exported and overwrote cloud`
                    );
                }

                if (obsidianPushResult && obsidianPushResult.enabled) {
                    return `push + files(${runtime.lastObsidianPushChanged}/${runtime.lastObsidianPushTotal})`;
                }
                return 'push';
            };

            const tryHandleManualSignalFastPush = async (fastPushReason) => {
                if (!isManualTrigger) return { handled: false, actionText: '' };
                if (settings.obsidianFilePushEnabled === false) return { handled: false, actionText: '' };
                if (hasPendingLocalFormatChange) return { handled: false, actionText: '' };

                const baselineRemoteSignalSha = String(runtime && runtime.lastRemoteSignalSha || '').trim();
                const baselineLocalHash = String(runtime && runtime.lastLocalHash || '').trim();
                if (!baselineRemoteSignalSha || !baselineLocalHash) {
                    return { handled: false, actionText: '' };
                }

                try {
                    updateSyncUiProgress(textByLang('快速校验云端状态...', 'Quick checking cloud state...'), 13);
                    const remoteSignal = await readRemoteObsidianSignal(settings && settings.obsidianExportRoot);
                    const signalSha = String(remoteSignal && remoteSignal.revisionSha || '').trim();
                    const committedAt = Math.max(0, Number(remoteSignal && remoteSignal.committedAt) || 0);
                    if (committedAt > 0) {
                        runtime.lastRemoteCommittedAt = committedAt;
                    }
                    if (!signalSha || signalSha !== baselineRemoteSignalSha) {
                        return { handled: false, actionText: '' };
                    }

                    runtime.lastRemoteSignalSha = signalSha;
                    const localChanged = baselineLocalHash !== localHash || hasLocalDirtyWork();
                    if (!localChanged) {
                        runtime.lastLocalHash = localHash;
                        runtime.lastLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha;
                        runtime.lastCheckRemoteSha = String(runtime.lastRemoteSha || runtime.lastCheckRemoteSha || '');
                        updateRuntimeSectionBaselineHashes(localSnapshot);
                        runtime.lastAppliedDirection = 'noop';
                        updateSyncUiProgress(
                            textByLang('云端未变化，跳过深度校验', 'Cloud unchanged, skipped deep validation'),
                            92
                        );
                        return { handled: true, actionText: 'noop' };
                    }

                    updateSyncUiProgress(
                        textByLang('云端未变化，执行快速上传...', 'Cloud unchanged, running fast upload...'),
                        18
                    );
                    const actionText = await doPush(fastPushReason, {
                        remoteSignalSha: signalSha
                    });
                    return { handled: true, actionText };
                } catch (error) {
                    console.warn('[Canvas Sync] signal fast path skipped:', error);
                    return { handled: false, actionText: '' };
                }
            };

            // Shared remote -> local apply path for sync-related pull actions.
            // Temp / blank sections are applied from sync files or snapshot data,
            // while permanent section is overwritten via maybeOverwriteLocalPermanentTreeFromRemoteSnapshot().
            const doPull = async (remoteState, reason, preparedPullPlan = null) => {
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
                    && getSnapshotHash(localSnapshot) !== getSnapshotHash(
                        remoteState && remoteState.snapshot
                            ? remoteState.snapshot
                            : { data: {} }
                    )
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

                let preparedRemoteBundle = null;
                let applyResult = null;
                const recoveryTrigger = trigger || reason || 'pull';
                const recoveryRootPath = settings && settings.obsidianExportRoot ? settings.obsidianExportRoot : '';
                const recoveryFolderName = (() => {
                    const normalizedRoot = normalizeSyncPath(recoveryRootPath);
                    return (normalizedRoot ? normalizedRoot.split('/').filter(Boolean).slice(-1)[0] : '') || DEFAULT_SETTINGS.obsidianExportRoot;
                })();
                const shouldStagePullRecoveryLock = shouldForceRecoveryLockForTrigger(recoveryTrigger);
                let pullRecoveryLockStagingFailed = false;

                if (settings.obsidianFilePushEnabled !== false && hasRemoteFiles) {
                    try {
                        const pullFilesProgress = makeProgressRange(25, 75);
                        const fetched = await fetchRemoteObsidianFolderFiles(pullPlanResult.remoteList, pullFilesProgress);
                        if (fetched.folderFiles.size) {
                            if (shouldStagePullRecoveryLock) {
                                const stagedPullLock = await stagePullRecoveryLock({
                                    rootPath: recoveryRootPath,
                                    folderName: recoveryFolderName,
                                    snapshot: remoteState && !remoteState.notFound ? remoteState.snapshot : null,
                                    folderFiles: fetched.folderFiles,
                                    remoteFilesByPath
                                }, {
                                    trigger: recoveryTrigger,
                                    sourcePanel: mapRecoveryLockSourcePanel(recoveryTrigger),
                                    baseRemoteSha: getCurrentCloudHashForDisplay(),
                                    targetRemoteSha: remoteState && remoteState.sha ? remoteState.sha : buildRemoteObsidianRevisionFromList(pullPlanResult.remoteList),
                                    stage: 'downloaded'
                                });
                                if (!stagedPullLock) {
                                    pullRecoveryLockStagingFailed = true;
                                }
                            }
                            preparedRemoteBundle = {
                                rootPath: recoveryRootPath,
                                folderName: recoveryFolderName,
                                snapshot: remoteState && !remoteState.notFound ? remoteState.snapshot : null,
                                folderFiles: serializeRemoteFolderFilesMap(fetched.folderFiles),
                                remoteFilesByPath
                            };
                        }
                    } catch (error) {
                        console.warn('[Canvas Sync] prepare staged remote bundle failed:', error);
                    }
                }

                if (!preparedRemoteBundle && remoteState && !remoteState.notFound && remoteState.snapshot) {
                    if (shouldStagePullRecoveryLock) {
                        const stagedPullLock = await stagePullRecoveryLock({
                            rootPath: recoveryRootPath,
                            folderName: recoveryFolderName,
                            snapshot: remoteState.snapshot,
                            folderFiles: new Map(),
                            remoteFilesByPath
                        }, {
                            trigger: recoveryTrigger,
                            sourcePanel: mapRecoveryLockSourcePanel(recoveryTrigger),
                            baseRemoteSha: getCurrentCloudHashForDisplay(),
                            targetRemoteSha: remoteState.sha || '',
                            stage: 'downloaded'
                        });
                        if (!stagedPullLock) {
                            pullRecoveryLockStagingFailed = true;
                        }
                    }
                    preparedRemoteBundle = {
                        rootPath: recoveryRootPath,
                        folderName: recoveryFolderName,
                        snapshot: remoteState.snapshot,
                        folderFiles: [],
                        remoteFilesByPath
                    };
                }

                if (shouldStagePullRecoveryLock && pullRecoveryLockStagingFailed) {
                    throw new Error(textByLang(
                        '恢复保护创建失败：已取消本次云端覆盖本地，以保护本地永久栏目。请检查浏览器存储空间后重试。',
                        'Recovery staging failed, so this cloud-overwrite-local action was cancelled to protect the local permanent section. Check browser storage space and retry.'
                    ));
                }

                if (!preparedRemoteBundle) {
                    if (settings.obsidianFilePushEnabled !== false && hasRemoteFiles) {
                        throw new Error(textByLang('云端文件存在，但恢复缓存未准备完成，无法继续仅拉取', 'Cloud files exist, but the staged recovery bundle is not ready; pull-only cannot continue'));
                    }
                    throw new Error(textByLang('云端同步目录为空，无法仅拉取', 'Cloud sync folder is empty; pull-only cannot continue'));
                }

                const pullApplyResult = await applyPreparedRemoteBundleToLocal(preparedRemoteBundle, recoveryTrigger, {
                    localRollbackSnapshot: localSnapshot
                });
                applyResult = pullApplyResult && pullApplyResult.remotePermanentTreeSnapshot
                    ? { permanentTreeSnapshot: pullApplyResult.remotePermanentTreeSnapshot }
                    : null;

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
                runtime.lastRemoteSignalSha = String(
                    remoteState && remoteState.remoteSignalSha
                        ? remoteState.remoteSignalSha
                        : runtime.lastRemoteSignalSha || ''
                ).trim();
                if (remoteState && !remoteState.notFound && remoteState.snapshot) {
                    const syncedRemoteSnapshot = normalizeSnapshot(remoteState.snapshot || { data: {} });
                    if (!syncedRemoteSnapshot.permanentTreeSnapshot) {
                        syncedRemoteSnapshot.permanentTreeSnapshot = normalizeBookmarkTreeSnapshot(
                            (applyResult && applyResult.permanentTreeSnapshot)
                            || (remoteState.snapshot && remoteState.snapshot.permanentTreeSnapshot)
                        );
                    }
                    updateRuntimeSectionBaselineHashes(syncedRemoteSnapshot);
                }
                const adoptedRemoteExportFormat = adoptRemoteObsidianExportFormat(remoteState && remoteState.exportFormat);
                runtime.lastAppliedDirection = adoptedRemoteExportFormat ? 'pull-adopt-remote-format' : 'pull';

                const adoptedLabel = formatObsidianExportFormatLabel(remoteState && remoteState.exportFormat);
                const adoptedSuffix = adoptedRemoteExportFormat
                    ? (adoptedLabel
                        ? textByLang(`（已沿用远端${adoptedLabel}）`, ` (adopted remote ${adoptedLabel})`)
                        : textByLang('（已沿用远端导出格式）', ' (adopted remote export format)'))
                    : '';
                if (reason) {
                    return `${reason}${adoptedSuffix}`;
                }
                if (adoptedRemoteExportFormat) {
                    return textByLang('pull（已沿用远端导出格式）', 'pull (adopted remote export format)');
                }
                return textByLang('pull（文件集）', 'pull (files)');
            };

            const doResetHead = async (remoteState, reason) => {
                runtime.lastLocalHash = localHash;
                runtime.lastLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha;
                runtime.lastRemoteSha = remoteState.sha || runtime.lastRemoteSha;
                runtime.lastRemoteSignalSha = String(
                    remoteState && remoteState.remoteSignalSha
                        ? remoteState.remoteSignalSha
                        : runtime.lastRemoteSignalSha || ''
                ).trim();
                updateRuntimeSectionBaselineHashes(localSnapshot);
                runtime.lastAppliedDirection = 'reset-head';
                return reason || textByLang('仅记云端版本（仅更新 HEAD）', 'Track remote revision only (update HEAD)');
            };

            const buildFormatMigrationPendingMessage = (formatMigration) => {
                const migration = formatMigration && typeof formatMigration === 'object' ? formatMigration : {};
                const baseFormatLabel = formatObsidianExportFormatLabel(migration.baseFormat)
                    || String(migration.baseFormat || textByLang('旧格式', 'previous format'));
                const currentFormatLabel = formatObsidianExportFormatLabel(migration.currentFormat)
                    || String(migration.currentFormat || textByLang('新格式', 'new format'));
                return textByLang(
                    `检测到导出格式迁移（${baseFormatLabel} -> ${currentFormatLabel}），已暂停自动覆盖。请手动同步，并在二级确认中点击“本地覆盖云端（格式迁移）”。`,
                    `Format migration detected (${baseFormatLabel} -> ${currentFormatLabel}). Automatic overwrite is paused. Run sync manually and click "Local Overwrite Cloud (Format Migration)" in the secondary confirmation.`
                );
            };

            const maybeRunFormatMigrationPush = async (formatMigration, triggerFallback = 'sync', pushContext = null) => {
                if (!formatMigration) {
                    return { handled: false, blocked: false, actionText: 'noop' };
                }
                const migrationRemoteFilesByPath = (pushContext
                    && pushContext.remoteFilesByPathForMissingCheck
                    && typeof pushContext.remoteFilesByPathForMissingCheck === 'object')
                    ? pushContext.remoteFilesByPathForMissingCheck
                    : null;

                if (skipFormatMigrationSecondaryConfirm) {
                    const migrationActionText = await doPush('format migration local overwrite cloud', {
                        syncTrigger: `${String(trigger || triggerFallback)}:format-migration`,
                        formatMigration,
                        remoteFilesByPathForMissingCheck: migrationRemoteFilesByPath
                    });
                    return { handled: true, blocked: false, actionText: migrationActionText };
                }

                const triggerText = String(trigger || '').trim().toLowerCase();
                const shouldPromptSecondaryUi = isManualTrigger || triggerText === 'obsidian-export-format-change';

                if (!shouldPromptSecondaryUi) {
                    runtime.lastAppliedDirection = 'format-migration-pending';
                    runtime.lastError = buildFormatMigrationPendingMessage(formatMigration);
                    saveRuntime();
                    renderStatus();
                    return { handled: true, blocked: true, actionText: 'noop' };
                }

                const confirmed = await requestFormatMigrationLocalOverwriteConfirmationAsync(formatMigration, {
                    trigger: trigger || triggerFallback
                });
                if (!confirmed) {
                    runtime.lastError = '';
                    saveRuntime();
                    renderStatus();
                    toast(textByLang('已取消格式迁移覆盖操作', 'Format migration overwrite cancelled'));
                    return { handled: true, blocked: true, actionText: 'noop' };
                }

                const migrationActionText = await doPush('format migration local overwrite cloud', {
                    syncTrigger: `${String(trigger || triggerFallback)}:format-migration`,
                    formatMigration,
                    remoteFilesByPathForMissingCheck: migrationRemoteFilesByPath
                });
                return { handled: true, blocked: false, actionText: migrationActionText };
            };

            let actionText = 'noop';

            if (effectiveMode === 'push') {
                const fastPushResult = await tryHandleManualSignalFastPush(
                    isManualPushOnlyTrigger(trigger) ? 'manual push (signal fast-path)' : 'push (signal fast-path)'
                );
                if (fastPushResult && fastPushResult.handled) {
                    actionText = fastPushResult.actionText;
                } else {
                    let allowPushOnly = true;

                    updateSyncUiProgress(textByLang('校验云端基线...', 'Checking cloud baseline...'), 15);
                    const remoteState = await readRemoteSnapshotWithPathRecovery({
                        interactive: isManualTrigger,
                        continueAfterConfirm: true
                    });
                    const remoteFilesByPathForMissingCheck = remoteState
                        && remoteState.remoteList
                        && remoteState.remoteList.filesByPath
                        ? remoteState.remoteList.filesByPath
                        : null;
                    const formatMigration = resolveObsidianExportFormatMigration(remoteState);
                    if (formatMigration) {
                        const migrationResult = await maybeRunFormatMigrationPush(formatMigration, 'push', {
                            remoteFilesByPathForMissingCheck
                        });
                        if (migrationResult.blocked) {
                            allowPushOnly = false;
                        } else {
                            actionText = migrationResult.actionText;
                        }
                    } else {
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
                                if (!await requestOneWayOverwriteConfirmationAsync('push', pushPreflight)) {
                                    runtime.lastError = '';
                                    saveRuntime();
                                    renderStatus();
                                    toast(textByLang('已取消当前上传操作', 'Current upload action cancelled'));
                                    allowPushOnly = false;
                                }
                            } else if (!isManualTrigger && riskyRemoteOverwrite && (pushPreflight.winner !== 'local' || pushPreflight.remoteUntracked)) {
                                await setPendingConflictState(
                                    pushPreflight.remoteSha || remoteState.sha || '',
                                    textByLang(
                                        '检测到云端已有更新，已暂停当前自动上传路径，请在“状态”面板选择处理方式',
                                        'Cloud updates were detected. The current automatic upload path has been paused; choose an action in Status.'
                                    ),
                                    { reason: 'auto-push-risk-pause' }
                                );
                                allowPushOnly = false;
                            }
                        }
                    }

                    if (!allowPushOnly) {
                        return;
                    }

                    if (actionText === 'noop') {
                        actionText = await doPush(isManualPushOnlyTrigger(trigger) ? 'manual push' : 'push', {
                            remoteFilesByPathForMissingCheck
                        });
                    }
                }
            } else {
                let handledByFastFullPath = false;
                if (effectiveMode === 'full') {
                    const fastFullResult = await tryHandleManualSignalFastPush('local newer push (signal fast-path)');
                    if (fastFullResult && fastFullResult.handled) {
                        actionText = fastFullResult.actionText;
                        handledByFastFullPath = true;
                    }
                }

                if (!handledByFastFullPath) {
                    updateSyncUiProgress(textByLang('读取云端状态...', 'Reading cloud state...'), 15);
                    const remoteState = await readRemoteSnapshotWithPathRecovery({
                        interactive: isManualTrigger,
                        continueAfterConfirm: true
                    });
                    const remoteFilesByPathForMissingCheck = remoteState
                        && remoteState.remoteList
                        && remoteState.remoteList.filesByPath
                        ? remoteState.remoteList.filesByPath
                        : null;
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
                            runtime.lastAppliedDirection = 'pull-empty-remote-blocked';
                            actionText = 'noop';
                            skipSuccessToast = true;
                            if (isManualTrigger) {
                                toast(getEmptyRemotePullGuardText(true));
                            }
                            return;
                        }

                        if (syncMethod === 'reset') {
                            runtime.lastLocalHash = localHash;
                            runtime.lastLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha;
                            runtime.lastRemoteSha = buildRemoteObsidianRevisionFromList(pullPlanWhenNoState.remoteList) || runtime.lastRemoteSha;
                            updateRuntimeSectionBaselineHashes(localSnapshot);
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
                                    if (!await requestOneWayOverwriteConfirmationAsync('pull', pullPreflight)) {
                                        runtime.lastError = '';
                                        saveRuntime();
                                        renderStatus();
                                        toast(textByLang('已取消当前拉取操作', 'Current pull action cancelled'));
                                        allowPullOnly = false;
                                    }
                                } else {
                                    if (pullPreflight.remoteChanged || pullPreflight.concurrentChanged || pullPreflight.remoteUntracked) {
                                        await setPendingConflictState(
                                            pullPreflight.remoteSha || remoteState.sha || '',
                                            textByLang(
                                                '检测到本地与云端都有更新，已暂停当前自动拉取路径，请在“状态”面板选择处理方式',
                                                'Both local and cloud changed. The current automatic pull path has been paused; choose an action in Status.'
                                            ),
                                            { reason: 'auto-pull-risk-pause' }
                                        );
                                    } else if (isSilentAutoPullTrigger) {
                                        runtime.lastError = '';
                                        saveRuntime();
                                        renderStatus();
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
                                if (!await requestOneWayOverwriteConfirmationAsync('pull', pullPreflight)) {
                                    runtime.lastError = '';
                                    saveRuntime();
                                    renderStatus();
                                    toast(textByLang('已取消当前拉取操作', 'Current pull action cancelled'));
                                    allowPullOnly = false;
                                }
                            } else {
                                if (pullPreflight.remoteChanged || pullPreflight.concurrentChanged || pullPreflight.remoteUntracked) {
                                    await setPendingConflictState(
                                        pullPreflight.remoteSha || remoteState.sha || '',
                                        textByLang(
                                            '检测到本地与云端都有更新，已暂停当前自动拉取路径，请在“状态”面板选择处理方式',
                                            'Both local and cloud changed. The current automatic pull path has been paused; choose an action in Status.'
                                        ),
                                        { reason: 'auto-pull-risk-pause' }
                                    );
                                } else if (isSilentAutoPullTrigger) {
                                    runtime.lastError = '';
                                    saveRuntime();
                                    renderStatus();
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

                        actionText = await doPull(remoteState, syncMethod === 'rebase' ? 'pull (rebase mode)' : 'pull');
                    }
                } else {
                    if (remoteState.notFound) {
                        const formatMigration = resolveObsidianExportFormatMigration(remoteState);
                        if (formatMigration) {
                            const migrationResult = await maybeRunFormatMigrationPush(formatMigration, 'sync', {
                                remoteFilesByPathForMissingCheck
                            });
                            if (migrationResult.blocked) {
                                return;
                            }
                            actionText = migrationResult.actionText;
                        } else {
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
                        }
                    } else {
                        const remoteSnapshot = remoteState.snapshot;
                        if (hydratePermanentTreeFromRemote(localSnapshot, remoteSnapshot)) {
                            localHash = getSnapshotHash(localSnapshot);
                        }
                        const remoteHash = getSnapshotHash(remoteSnapshot);
                        const formatMigration = resolveObsidianExportFormatMigration(remoteState);

                        if (formatMigration) {
                            const migrationResult = await maybeRunFormatMigrationPush(formatMigration, 'sync', {
                                remoteFilesByPathForMissingCheck
                            });
                            if (migrationResult.blocked) {
                                return;
                            }
                            actionText = migrationResult.actionText;
                        } else if (remoteHash === localHash) {
                            runtime.lastLocalHash = localHash;
                            runtime.lastLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha;
                            runtime.lastRemoteSha = remoteState.sha || runtime.lastRemoteSha;
                            runtime.lastRemoteSignalSha = String(
                                remoteState && remoteState.remoteSignalSha
                                    ? remoteState.remoteSignalSha
                                    : runtime.lastRemoteSignalSha || ''
                            ).trim();
                            updateRuntimeSectionBaselineHashes(localSnapshot);
                            runtime.lastAppliedDirection = 'noop';
                            actionText = 'noop';
                        } else {
                            const hasLocalBase = !!runtime.lastLocalHash;
                            const hasRemoteBase = !!runtime.lastRemoteSha;
                            const localChanged = hasLocalBase && runtime.lastLocalHash !== localHash;
                            const remoteChanged = hasRemoteBase && remoteState.sha && runtime.lastRemoteSha !== remoteState.sha;
                            const concurrentChanged = localChanged && remoteChanged;
                            const canUseDirtyMatrix = hasLocalBase && hasRemoteBase && !!remoteState.sha;

                            if (canUseDirtyMatrix && localChanged && !remoteChanged) {
                                actionText = await doPush(
                                    syncMethod === 'rebase' ? 'local newer push (rebase mode)' : 'local newer push',
                                    { remoteFilesByPathForMissingCheck }
                                );
                            } else if (canUseDirtyMatrix && !localChanged && remoteChanged) {
                                if (syncMethod === 'reset') {
                                    actionText = await doResetHead(remoteState);
                                } else {
                                    actionText = await doPull(remoteState, syncMethod === 'rebase' ? 'remote newer pull (rebase mode)' : 'remote newer pull');
                                }
                            } else if (canUseDirtyMatrix && concurrentChanged) {
                                try {
                                    await doPush('dual-dirty cloud merge', {
                                        syncTrigger: `${String(trigger || 'sync')}:dual-dirty-merge`,
                                        useTempBranchMerge: true,
                                        tempBranchPrefix: 'canvas-sync',
                                        remoteFilesByPathForMissingCheck
                                    });
                                } catch (mergeError) {
                                    const mergeErrorCode = String((mergeError && mergeError.code) || '');
                                    if (mergeErrorCode === 'MERGE_CONFLICT') {
                                        const fileConflictSummary = await buildConflictFileSummaryFromCurrentPlan('dual-dirty-cloud-merge-conflict');
                                        setPendingConflict(createPendingConflictPayload(localSnapshot, remoteSnapshot, remoteState, {
                                            reason: 'cloud-merge-conflict',
                                            mergeConflict: true,
                                            mergeApi: 'github-merges',
                                            tempBranch: String((mergeError && mergeError.tempBranch) || ''),
                                            fileConflicts: fileConflictSummary.fileConflicts,
                                            filePlanSummary: fileConflictSummary.filePlanSummary || undefined
                                        }));
                                        storeConflictRecord(localSnapshot, remoteSnapshot, 'pending-cloud-merge-conflict', {
                                            remoteSha: remoteState.sha || '',
                                            strategy: 'cloud-merge-api',
                                            syncMethod,
                                            tempBranch: String((mergeError && mergeError.tempBranch) || '')
                                        });
                                        runtime.lastAppliedDirection = 'conflict';
                                        runtime.lastError = textByLang(
                                            '检测到双向修改，且云端自动合并产生冲突，请在冲突面板中选择处理方式',
                                            'Both local and cloud changed, and cloud auto-merge produced conflicts. Resolve in the conflict panel.'
                                        );
                                        pendingReasons.clear();
                                        runtime.queueLength = 0;
                                        saveRuntime();
                                        renderStatus();
                                        renderConflictPanel();
                                        openPanel({ activeTab: 'status' });
                                        toast(textByLang(
                                            '云端自动合并冲突：请在冲突面板中选择本地或云端版本',
                                            'Cloud auto-merge conflict: choose local or cloud version in the conflict panel.'
                                        ));
                                        return;
                                    }

                                    if (mergeErrorCode === 'MERGE_PROTECTED_BRANCH') {
                                        runtime.lastAppliedDirection = 'protected-branch-blocked';
                                        runtime.lastError = textByLang(
                                            '目标分支开启保护或禁止直接合并，无法自动完成双向同步。请改用“仅拉取/仅上传”或调整分支规则。',
                                            'Target branch is protected or direct merge is blocked. Auto bidirectional sync cannot continue. Use pull-only/push-only or adjust branch rules.'
                                        );
                                        pendingReasons.clear();
                                        runtime.queueLength = 0;
                                        saveRuntime();
                                        renderStatus();
                                        openPanel({ activeTab: 'status' });
                                        toast(textByLang(
                                            '目标分支受保护，已停止自动合并；请手动选择仅拉取或仅上传',
                                            'Target branch is protected; auto-merge stopped. Choose pull-only or push-only manually.'
                                        ));
                                        return;
                                    }

                                    throw mergeError;
                                }

                                const mergedRemoteState = await readRemoteSnapshotWithPathRecovery({
                                    interactive: isManualTrigger,
                                    continueAfterConfirm: true
                                });
                                if (mergedRemoteState.notFound) {
                                    throw new Error(textByLang(
                                        '云端合并后未找到同步目录，请检查同步路径配置',
                                        'Sync directory not found after cloud merge. Check sync path settings.'
                                    ));
                                }
                                actionText = await doPull(
                                    mergedRemoteState,
                                    textByLang('双向更新已完成云端合并并回拉本地', 'Dual-side updates merged in cloud and pulled back locally')
                                );
                            } else if (!concurrentChanged && syncMethod === 'reset' && remoteChanged && !localChanged) {
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
                                                : 'local newer push',
                                        { remoteFilesByPathForMissingCheck }
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
            }

            if (abortedByPendingConflict) {
                return;
            }

            if (actionText === 'noop' && hasLocalDirtyWork()) {
                try {
                    const noopVerifySnapshot = await buildLocalSnapshot('post-noop-dirty-reconcile', {
                        includePermanentTree: true,
                        includeTempSection: true,
                        includeBlankSectionFiles: true
                    });
                    const noopVerifyHash = getSnapshotHash(noopVerifySnapshot);
                    if (!localHash || noopVerifyHash === localHash) {
                        saveDirtyState(createDefaultDirtyState());
                    }
                } catch (_) { }
            }

            pendingReasons.clear();
            runtime.queueLength = 0;
            runtime.lastError = '';
            runtime.lastSuccessAt = Date.now();
            syncCompletedSuccessfully = true;
            runtime.lastCheckRemoteSha = String(runtime.lastRemoteSha || runtime.lastCheckRemoteSha || '');
            saveRuntime();
            renderStatus();
            void updateBackgroundSyncContext('sync-success', {
                isRunning: false,
                queueLength: 0,
                hasPendingWork: false,
                localDirty: false,
                lastRemoteSha: runtime.lastRemoteSha,
                lastCheckRemoteSha: runtime.lastRemoteSha,
                lastLocalHash: runtime.lastLocalHash,
                lastSuccessAt: runtime.lastSuccessAt
            });

            const triggerText = trigger ? `（${trigger}）` : '';
            if (!skipSuccessToast) {
                if (actionText === 'noop') {
                    if (isManualTrigger) {
                        toast(textByLang(`Obsidian Git 同步完成${triggerText}：无变更`, `Obsidian Git sync completed${triggerText}: no changes`), getSyncToastOptionsByTrigger(trigger, { optional: true }));
                    }
                } else {
                    toast(textByLang(
                        `Obsidian Git 同步完成${triggerText}：${actionText}`,
                        `Obsidian Git sync completed${triggerText}: ${actionText}`
                    ), getSyncToastOptionsByTrigger(trigger, { optional: true }));
                }
            }
        } catch (error) {
            runtime.lastError = error && error.message ? error.message : String(error);
            saveRuntime();
            renderStatus();
            void updateBackgroundSyncContext('sync-error', {
                isRunning: false,
                queueLength: runtime.queueLength,
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
                    : '';
                ensureStatusPanelVisible(panelMode);
            }
        } finally {
            clearSyncUiProgress();
            syncUiProgressEnabled = false;
            runtime.isRunning = false;
            if (syncCompletedSuccessfully && recoveryLockState && (recoveryLockState.kind === 'push-bundle' || recoveryLockState.kind === 'pull-bundle')) {
                const completedRecoveryLock = normalizeRecoveryLockRecord(recoveryLockState);
                if (completedRecoveryLock) {
                    clearRecoverySnapshotsByReasonKeywords(collectRecoverySnapshotReasonKeywordsForLock(completedRecoveryLock));
                }
                await clearRecoveryLockCompletely();
                clearActiveRunRecoveryRecord();
                handleRecoveryLockReleased();
            } else if (!isRecoveryLockActive()) {
                clearActiveRunRecoveryRecord();
            }
            saveRuntime();
            renderStatus();
            handleQueuedLocalChangesAfterSync(syncStartedAt, trigger);
            void updateBackgroundSyncContext('sync-idle', {
                isRunning: false,
                queueLength: runtime.queueLength,
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
        const pushResult = await pushObsidianFilesIncremental(`manual-${reason || 'bootstrap-init'}`, bootstrapProgress, { forceRecoveryLock: true, recoveryMode: 'push', sourcePanel: 'first-sync', baseRemoteSha: getCurrentCloudHashForDisplay() });
        const guidePaths = Array.isArray(pushResult && pushResult.guidePaths)
            ? pushResult.guidePaths.filter((path) => !!normalizeSyncPath(path))
            : [];
        if (!guidePaths.length) {
            throw new Error(textByLang(
                '首次同步失败：首包未包含“说明导入规则.md”',
                'First sync failed: initial package does not include "说明导入规则.md"'
            ));
        }

        let remoteRevision = String(pushResult && pushResult.remoteRevision || '').trim();
        if (remoteRevision) {
            updateSyncUiProgress(textByLang('云端文件校验完成', 'Cloud files validated'), 95);
        } else {
            try {
                updateSyncUiProgress(textByLang('校验云端文件...', 'Validating cloud files...'), 90);
                const root = settings.obsidianExportRoot;
                const remoteListRaw = await listRemoteObsidianFilesByPath(root);
                const remoteList = filterRemoteListForManagedSyncFiles(remoteListRaw, root);
                remoteRevision = buildRemoteObsidianRevisionFromList(remoteList);
                updateSyncUiProgress(textByLang('云端文件校验完成', 'Cloud files validated'), 95);
            } catch (_) {
                remoteRevision = '';
            }
        }

        runtime.lastLocalHash = getSnapshotHash(localSnapshot);
        runtime.lastLocalFilesSha = String(pushResult && pushResult.localRevision || buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha || '');
        runtime.lastRemoteSha = remoteRevision || runtime.lastRemoteSha;
        runtime.lastRemoteSignalSha = String(pushResult && pushResult.remoteSignalSha || runtime.lastRemoteSignalSha || '').trim();
        runtime.lastCheckRemoteSha = String(runtime.lastRemoteSha || runtime.lastCheckRemoteSha || '');
        updateRuntimeSectionBaselineHashes(localSnapshot);
        runtime.lastPermanentTreeSnapshotAt = Date.now();
        runtime.lastTempSectionSnapshotAt = Date.now();
        const pushedTempStateRaw = localSnapshot
            && localSnapshot.data
            && typeof localSnapshot.data[TEMP_SECTION_STORAGE_KEY] === 'string'
            ? localSnapshot.data[TEMP_SECTION_STORAGE_KEY]
            : '';
        const normalizedPushedTempStateRaw = pushedTempStateRaw
            ? buildNormalizedCanvasTempStateRawForSync(pushedTempStateRaw)
            : '';
        if (normalizedPushedTempStateRaw) {
            setSyncMetaRaw(LAST_UPLOADED_TEMP_STATE_KEY, normalizedPushedTempStateRaw);
        }
        setStoredSyncedObsidianExportFormat(getCurrentObsidianExportFormatForSync());
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

    async function requestFirstSyncPathValidation(options = {}) {
        setFirstSyncFoldOpen(true);
        const confirmed = await openFirstSyncPathValidationDialog(options);
        return !!confirmed;
    }

    async function runFirstSyncCloudOverwrite(trigger = 'manual-first-sync-overwrite', options = {}) {
        if (shouldBlockOrdinarySyncActionsForRecoveryLock() && options.bypassRecoveryLock !== true) {
            openPanel({ activeTab: 'status' });
            toast(textByLang('检测到未完成的同步恢复：请先继续上次操作', 'An unfinished sync recovery was detected: continue the previous action first'));
            return false;
        }
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

        const syncStartedAt = Date.now();
        let firstSyncCompletedSuccessfully = false;
        runtime.isRunning = true;
        runtime.lastTrigger = trigger;
        runtime.lastSyncMode = 'first-sync';
        beginActiveRunRecovery('first-sync-cloud', trigger, {
            manual: isManualSyncTrigger('first-sync-cloud', trigger)
        });
        saveRuntime();
        renderStatus();
        setFirstSyncStatus(textByLang('首次同步进行中...', 'First sync is running...'), 'neutral');
        syncUiProgressEnabled = true;
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
            let remoteSignal = null;
            if (hasRemoteManagedFiles) {
                try {
                    remoteSignal = await readRemoteObsidianSignal(remoteState && remoteState.path ? remoteState.path : (settings && settings.obsidianExportRoot));
                } catch (error) {
                    console.warn('[Canvas Sync] read remote signal for first-sync failed:', error);
                }
            }

            let firstSyncComparisonSummary = null;
            if (preferredMode === 'auto' && hasRemotePermanentSnapshot && hasRemoteManagedFiles) {
                updateSyncUiProgress(textByLang('正在比较本地与云端...', 'Comparing local and cloud...'), 20);
                const localSnapshotForModeChoice = await buildLocalSnapshot('first-sync-mode-compare', { includePermanentTree: true, includeTempSection: true });
                const managedFileComparison = await buildFirstSyncManagedFileComparison({
                    remoteManagedFiles,
                    remoteFolderFiles: remoteState && remoteState.folderFiles ? remoteState.folderFiles : null,
                    remoteRootPath: remoteState && remoteState.path ? remoteState.path : (settings && settings.obsidianExportRoot ? settings.obsidianExportRoot : '')
                });
                firstSyncComparisonSummary = buildFirstSyncModeComparisonSummary(localSnapshotForModeChoice, remoteSnapshot, {
                    remoteManagedFiles,
                    remoteFolderFiles: remoteState && remoteState.folderFiles ? remoteState.folderFiles : null,
                    remoteRootPath: remoteState && remoteState.path ? remoteState.path : (settings && settings.obsidianExportRoot ? settings.obsidianExportRoot : ''),
                    remoteCommittedAt: remoteSignal && remoteSignal.committedAt ? remoteSignal.committedAt : 0,
                    managedFileComparison
                });
            }

            const effectiveMode = remoteState.notFound
                ? 'local'
                : await resolveFirstSyncModeAsync(preferredMode, hasRemotePermanentSnapshot, hasRemoteManagedFiles, firstSyncComparisonSummary);

            if (effectiveMode === 'cancel') {
                throw new Error(textByLang('已取消首次同步', 'First sync cancelled'));
            }

            if (effectiveMode === 'remote-data-without-permanent') {
                throw new Error(textByLang(
                    '检测到云端已有同步文件，但未恢复出可用于首次同步的永久栏目快照。为避免误判为“云端为空”并覆盖云端，请先检查云端路径/文件，或明确切换到“以本地为准”。',
                    'Cloud sync files were detected, but no permanent snapshot could be restored for first sync. To avoid treating the cloud as empty and overwriting it, verify the remote path/files first or explicitly switch to "Use local".'
                ));
            }

            if (effectiveMode === 'baseline') {
                const localBaselineSnapshot = await buildLocalSnapshot('first-sync-baseline', {
                    includePermanentTree: true,
                    includeTempSection: true,
                    includeBlankSectionFiles: true
                });
                runtime.lastLocalHash = getSnapshotHash(localBaselineSnapshot);
                runtime.lastLocalFilesSha = buildLocalObsidianRevisionFromHashMap(loadObsidianFileHashes()) || runtime.lastLocalFilesSha;
                runtime.lastRemoteSha = remoteState.sha || buildRemoteObsidianRevisionFromList(remoteState.remoteList) || runtime.lastRemoteSha;
                runtime.lastRemoteSignalSha = String(
                    remoteState && remoteState.remoteSignalSha
                        ? remoteState.remoteSignalSha
                        : runtime.lastRemoteSignalSha || ''
                ).trim();
                runtime.lastCheckRemoteSha = String(runtime.lastRemoteSha || runtime.lastCheckRemoteSha || '');
                updateRuntimeSectionBaselineHashes(localBaselineSnapshot);
                runtime.lastAppliedDirection = 'first-sync-baseline';
                runtime.lastSyncMode = 'first-sync-baseline';
                runtime.lastError = '';
                runtime.lastSuccessAt = Date.now();
                adoptRemoteObsidianExportFormat(remoteState && remoteState.exportFormat);
                firstSyncCompletedSuccessfully = true;
                pendingReasons.clear();
                runtime.queueLength = 0;
                saveRuntime();
                renderStatus();
                setFirstSyncStatus(textByLang('首次同步完成：已校准同步基线，未改动本地或云端内容', 'First sync completed: sync baseline aligned without changing local or cloud content'), 'ok');
                if (shouldShowFirstSyncCompletionToast()) {
                    toast(textByLang('首次同步完成：已校准同步基线，未改动本地或云端内容', 'First sync completed: sync baseline aligned without changing local or cloud content'));
                }
                setFirstSyncFoldOpen(false);
                return true;
            }

            if (effectiveMode === 'local') {
                if (remoteState && remoteState.notFound && !isFirstSyncPathValidated()) {
                    updateSyncUiProgress(textByLang('请先确认本地导出路径...', 'Confirming local export path...'), 19);
                    const pathConfirmed = await requestFirstSyncPathValidation({ continueAfterConfirm: true });
                    if (!pathConfirmed) {
                        throw new Error(textByLang('请先完成路径校验后再执行首次同步', 'Please complete path validation before running first sync'));
                    }
                    updateSyncUiProgress(textByLang('路径校验已完成', 'Path validation completed'), 20);
                }

                if (hasRemotePermanentSnapshot) {
                    const localSnapshotForConfirm = await buildLocalSnapshot('first-sync-local-confirm', { includePermanentTree: true });
                    const localTree = normalizeBookmarkTreeSnapshot(localSnapshotForConfirm.permanentTreeSnapshot);
                    const localStats = getBookmarkTreeStats(localTree);
                    const remoteStats = getBookmarkTreeStats(remotePermanentTree);
                    if (!await requestFirstSyncLocalOverwriteConfirmationAsync(localStats, remoteStats)) {
                        throw new Error(textByLang('已取消首次覆盖操作', 'First overwrite cancelled'));
                    }
                }

                updateSyncUiProgress(textByLang('正在以本地初始化云端...', 'Initializing cloud from local...'), 20);
                await initializeRemoteSnapshotFromLocal(hasRemotePermanentSnapshot ? 'first-sync-local-overwrite-cloud' : 'first-sync-local-bootstrap-cloud');
                updateSyncUiProgress(textByLang('云端初始化完成', 'Cloud initialized'), 95);

                runtime.lastSyncMode = 'first-sync-local';
                runtime.lastError = '';
                runtime.lastSuccessAt = Date.now();
                firstSyncCompletedSuccessfully = true;
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
                if (shouldShowFirstSyncCompletionToast()) {
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
                }
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
            const localBackupSnapshot = await buildLocalSnapshot('before-first-sync-overwrite', {
                includePermanentTree: true
            });
            const localPermanentTree = normalizeBookmarkTreeSnapshot(localBackupSnapshot.permanentTreeSnapshot);
            const permanentDecision = evaluatePermanentPullDecision(localPermanentTree, remotePermanentTree, {
                permanentPullMode: 'overwrite'
            });
            updateSyncUiProgress(formatPermanentPullDecisionText(permanentDecision), 22);

            const shouldConfirmPermanentApply = !(
                permanentDecision
                && (permanentDecision.reason === 'same')
            );

            if (shouldConfirmPermanentApply && !await requestFirstSyncCloudPermanentApplyConfirmationAsync(stats, permanentDecision)) {
                throw new Error(textByLang('已取消首次覆盖操作', 'First overwrite cancelled'));
            }

            updateSyncUiProgress(textByLang('准备恢复保护...', 'Preparing recovery protection...'), 25);

            let stagedFirstSyncRemoteBundle = null;
            if (remoteState && remoteState.remoteList && Array.isArray(remoteState.remoteList.files) && remoteState.remoteList.files.length > 0) {
                try {
                    const fetchedRemoteFiles = await fetchRemoteObsidianFolderFiles(remoteState.remoteList);
                    const stagedPullLock = await stagePullRecoveryLock({
                        rootPath: remoteState && remoteState.path ? remoteState.path : (settings && settings.obsidianExportRoot ? settings.obsidianExportRoot : ''),
                        folderName: (remoteState && remoteState.path ? remoteState.path : (settings && settings.obsidianExportRoot ? settings.obsidianExportRoot : '')).split('/').filter(Boolean).slice(-1)[0] || DEFAULT_SETTINGS.obsidianExportRoot,
                        snapshot: remoteSnapshot,
                        folderFiles: fetchedRemoteFiles.folderFiles,
                        remoteFilesByPath: remoteState && remoteState.remoteList && remoteState.remoteList.filesByPath ? remoteState.remoteList.filesByPath : null
                    }, {
                        trigger: 'first-sync-cloud-overwrite',
                        sourcePanel: 'first-sync',
                        mode: 'first-sync-cloud',
                        baseRemoteSha: getCurrentCloudHashForDisplay(),
                        targetRemoteSha: remoteState.sha || buildRemoteObsidianRevisionFromList(remoteState.remoteList),
                        stage: 'downloaded'
                    });
                    stagedFirstSyncRemoteBundle = !!stagedPullLock;
                } catch (error) {
                    console.warn('[Canvas Sync] stage first-sync remote bundle failed:', error);
                    stagedFirstSyncRemoteBundle = false;
                }
            } else if (remoteSnapshot) {
                try {
                    const stagedPullLock = await stagePullRecoveryLock({
                        rootPath: remoteState && remoteState.path ? remoteState.path : (settings && settings.obsidianExportRoot ? settings.obsidianExportRoot : ''),
                        folderName: (remoteState && remoteState.path ? remoteState.path : (settings && settings.obsidianExportRoot ? settings.obsidianExportRoot : '')).split('/').filter(Boolean).slice(-1)[0] || DEFAULT_SETTINGS.obsidianExportRoot,
                        snapshot: remoteSnapshot,
                        folderFiles: new Map(),
                        remoteFilesByPath: remoteState && remoteState.remoteList && remoteState.remoteList.filesByPath ? remoteState.remoteList.filesByPath : null
                    }, {
                        trigger: 'first-sync-cloud-overwrite',
                        sourcePanel: 'first-sync',
                        mode: 'first-sync-cloud',
                        baseRemoteSha: getCurrentCloudHashForDisplay(),
                        targetRemoteSha: remoteState.sha || '',
                        stage: 'downloaded'
                    });
                    stagedFirstSyncRemoteBundle = !!stagedPullLock;
                } catch (error) {
                    console.warn('[Canvas Sync] stage first-sync snapshot bundle failed:', error);
                    stagedFirstSyncRemoteBundle = false;
                }
            }

            if (!stagedFirstSyncRemoteBundle) {
                throw new Error(textByLang(
                    '首次同步恢复保护创建失败：已取消本次云端覆盖本地，以保护本地永久栏目。请检查浏览器存储空间后重试。',
                    'First-sync recovery staging failed, so this cloud-overwrite-local action was cancelled to protect the local permanent section. Check browser storage space and retry.'
                ));
            }

            updateSyncUiProgress(textByLang('正在应用永久栏目...', 'Applying permanent section...'), 45);
            const permanentApplyResult = await maybeOverwriteLocalPermanentTreeFromRemoteSnapshot(
                remotePermanentTree,
                'first-sync-cloud-overwrite',
                {
                    force: true,
                    permanentPullMode: 'overwrite',
                    onProgress: (message) => updateSyncUiProgress(message, 45)
                }
            );
            let permanentApplySummary = textByLang('永久栏目：未执行恢复', 'Permanent section: no restore executed');
            if (permanentApplyResult && permanentApplyResult.applied) {
                runtime.lastPermanentTreeSnapshotAt = Date.now();
                permanentApplySummary = permanentApplyResult.mode === 'incremental'
                    ? textByLang('永久栏目：已按增量同步对齐', 'Permanent section: aligned via incremental sync')
                    : textByLang('永久栏目：已按覆盖恢复对齐', 'Permanent section: aligned via overwrite restore');
            } else if (permanentApplyResult && permanentApplyResult.skipped === 'same') {
                permanentApplySummary = textByLang('永久栏目：本地与云端一致，已跳过恢复', 'Permanent section: local already matches cloud, skipped restore');
            }

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
                applySnapshotToLocal(buildSnapshotForRemoteLocalApply(remoteSnapshot));
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
            runtime.lastRemoteSignalSha = String(
                remoteState && remoteState.remoteSignalSha
                    ? remoteState.remoteSignalSha
                    : runtime.lastRemoteSignalSha || ''
            ).trim();
            runtime.lastCheckRemoteSha = String(runtime.lastRemoteSha || runtime.lastCheckRemoteSha || '');
            updateRuntimeSectionBaselineHashes(remoteSnapshot);
            runtime.lastAppliedDirection = 'first-sync-overwrite';
            runtime.lastSyncMode = 'first-sync-cloud';
            runtime.lastError = '';
            runtime.lastSuccessAt = Date.now();
            adoptRemoteObsidianExportFormat(remoteState && remoteState.exportFormat);
            pendingReasons.clear();
            runtime.queueLength = 0;
            firstSyncCompletedSuccessfully = true;
            saveRuntime();
            renderStatus();

            setFirstSyncStatus(
                textByLang(`首次同步完成：${permanentApplySummary}（云端统计：书签 ${stats.bookmarks}，文件夹 ${stats.folders}）`, `First sync completed: ${permanentApplySummary} (cloud stats: bookmarks ${stats.bookmarks}, folders ${stats.folders})`),
                'ok'
            );
            if (shouldShowFirstSyncCompletionToast()) {
                toast(textByLang(`首次同步完成：${permanentApplySummary}（云端统计：书签 ${stats.bookmarks}，文件夹 ${stats.folders}）`, `First sync completed: ${permanentApplySummary} (cloud stats: bookmarks ${stats.bookmarks}, folders ${stats.folders})`));
            }
            setFirstSyncFoldOpen(false);
            updateSyncUiProgress(textByLang('首次同步完成', 'First sync completed'), 100);
            return true;
        } catch (error) {
            runtime.lastError = error && error.message ? error.message : String(error);
            const isCanceled = /已取消首次同步|first sync cancelled|已取消首次覆盖操作|first overwrite cancelled/i.test(runtime.lastError)
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
            if (firstSyncCompletedSuccessfully && recoveryLockState && recoveryLockState.sourcePanel === 'first-sync') {
                const completedRecoveryLock = normalizeRecoveryLockRecord(recoveryLockState);
                if (completedRecoveryLock) {
                    clearRecoverySnapshotsByReasonKeywords(collectRecoverySnapshotReasonKeywordsForLock(completedRecoveryLock));
                }
                await clearRecoveryLockCompletely();
                clearActiveRunRecoveryRecord();
                handleRecoveryLockReleased();
            } else if (!isRecoveryLockActive()) {
                clearActiveRunRecoveryRecord();
            }
            saveRuntime();
            renderStatus();
            handleQueuedLocalChangesAfterSync(syncStartedAt, trigger);
        }
    }

    function hasUserDirtyMutationSince(syncStartedAt) {
        const startedAt = Number(syncStartedAt) || 0;
        if (!startedAt) return false;
        return Number(lastUserDirtyAt) > (startedAt + 100);
    }

    function handleQueuedLocalChangesAfterSync(syncStartedAt, trigger = '') {
        if (isFirstSyncTrigger(trigger)) return false;
        if (!hasUserDirtyMutationSince(syncStartedAt)) return false;
        updateDirtyStateByReason('during-sync-local-edit', {
            dirty: {
                canvasLayout: true,
                permanentAll: true,
                temporaryAll: true,
                blankAll: true
            }
        });
        pendingReasons.add('during-sync-local-edit');
        runtime.queueLength = pendingReasons.size;
        saveRuntime();
        renderStatus();
        void updateBackgroundSyncContext('local-dirty', {
            queueLength: runtime.queueLength,
            isRunning: runtime.isRunning,
            hasPendingWork: true,
            localDirty: true
        });
        return true;
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
        renderRecoveryLockPanel();
        renderStatus();
        renderConflictPanel();

        const openState = resolvePanelOpenState(options);
        setActiveTab(openState.tab, { persist: false });
        setFirstSyncFoldOpen(!!openState.openFirstSyncFold);
        modal.style.display = 'block';
        updateFloatingProgressVisibility();

        global.requestAnimationFrame(() => {
            positionPanel();
            scheduleBehaviorSubNavSyncFromScroll();
            scheduleStatusSubNavSyncFromScroll();
        });

        loadRepoConfigFromStorage().catch((error) => {
            setRepoStatus(textByLang(`读取仓库配置失败：${error && error.message ? error.message : String(error)}`, `Failed to read repository configuration: ${error && error.message ? error.message : String(error)}`), 'error');
        });
    }

    function closePanel() {
        dismissOpenSyncActionDialog('cancel');
        const modal = getElement('canvasSyncModal');
        if (!modal) return;
        if (previewPanelMode) {
            previewPanelMode = '';
            previewConflict = null;
            renderStatus();
            renderConflictPanel();
        }
        modal.style.display = 'none';
        if (!(runtime && runtime.isRunning)) {
            setFloatingProgress(false, '', null);
        } else {
            updateFloatingProgressVisibility();
        }
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
        bindStatusSubNavButtons();
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
	            'canvasSyncFirstSyncModeAutoInput',
	            'canvasSyncFirstSyncModeCloudInput',
	            'canvasSyncFirstSyncModeLocalInput',
            'canvasSyncToastToggle',
            'canvasSyncConflictSelect',
            'canvasSyncPermanentPullModeSelect',
            'canvasSyncPermanentIncrementalThresholdInput',
            'canvasSyncObsidianFilePushToggle',
            'canvasSyncObsidianExportRootInput'
        ].forEach((id) => {
            const el = getElement(id);
            if (!el) return;
            el.addEventListener('change', () => {
                pullSettingsFromForm();
                toast(textByLang('同步设置已保存', 'Sync settings saved'), { optional: true });
            });
        });

        const obsidianExportFormatSelect = getElement('canvasSyncObsidianExportFormatSelect');
        if (obsidianExportFormatSelect) {
            obsidianExportFormatSelect.addEventListener('change', () => {
                void (async () => {
                    const previousFormat = normalizeObsidianExportFormat(
                        settings && settings.obsidianExportFormat,
                        DEFAULT_SETTINGS.obsidianExportFormat
                    );
                    const nextFormat = normalizeObsidianExportFormat(
                        obsidianExportFormatSelect.value,
                        previousFormat
                    );

                    if (!nextFormat || nextFormat === previousFormat) {
                        pullSettingsFromForm();
                        toast(textByLang('同步设置已保存', 'Sync settings saved'), { optional: true });
                        return;
                    }

                    if (!hasEstablishedSyncBaseline()) {
                        pullSettingsFromForm({
                            disableFormatAutoSync: true,
                            silentFormatToast: true
                        });
                        toast(textByLang(
                            '首次同步前：仅保存导出格式，不触发格式迁移覆盖。',
                            'Before first sync: export format is saved only; format-migration overwrite is not triggered.'
                        ), { optional: true });
                        return;
                    }

                    const confirmed = await requestFormatMigrationLocalOverwriteConfirmationAsync({
                        baseFormat: previousFormat,
                        currentFormat: nextFormat,
                        source: 'ui-switch'
                    }, {
                        trigger: 'manual-format-switch'
                    });

                    if (!confirmed) {
                        obsidianExportFormatSelect.value = previousFormat;
                        toast(textByLang('已取消格式切换', 'Format switch cancelled'), { optional: true });
                        return;
                    }

                    pullSettingsFromForm({
                        disableFormatAutoSync: true,
                        silentFormatToast: true
                    });
                    toast(textByLang(
                        '格式已切换，正在执行“本地覆盖云端（格式迁移）”...',
                        'Format switched. Running "Local Overwrite Cloud (Format Migration)"...'
                    ), { optional: true });
                    void runSync('push', 'manual-format-switch', {
                        skipFormatMigrationSecondaryConfirm: true
                    });
                })();
            });
        }
        const syncNowBtn = getElement('canvasSyncNowBtn');
        if (syncNowBtn) {
            syncNowBtn.addEventListener('click', () => {
                void runWithButtonBusy(syncNowBtn, () => requestManualSync('manual'));
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
        const recoveryContinueBtn = getElement('canvasSyncRecoveryContinueBtn');
        if (recoveryContinueBtn) {
            recoveryContinueBtn.addEventListener('click', () => {
                void runWithButtonBusy(recoveryContinueBtn, () => continueRecoveryLockAction());
            });
        }
        const recoveryDismissBtn = getElement('canvasSyncRecoveryDismissBtn');
        if (recoveryDismissBtn) {
            recoveryDismissBtn.addEventListener('click', () => {
                void runWithButtonBusy(recoveryDismissBtn, () => dismissRecoveryLockManually());
            });
        }
        const recoveryRollbackBtn = getElement('canvasSyncRecoveryRollbackBtn');
        if (recoveryRollbackBtn) {
            recoveryRollbackBtn.addEventListener('click', () => {
                void runWithButtonBusy(recoveryRollbackBtn, () => rollbackRecoveryLockAction());
            });
        }
        const downloadRecoverySnapshotBtn = getElement('canvasSyncDownloadRecoverySnapshotBtn');
        if (downloadRecoverySnapshotBtn) {
            downloadRecoverySnapshotBtn.addEventListener('click', () => {
                void runWithButtonBusy(downloadRecoverySnapshotBtn, () => downloadLatestRecoverySnapshotAction());
            });
        }
        const manualRecoverySnapshotBtn = getElement('canvasSyncManualRecoverySnapshotBtn');
        if (manualRecoverySnapshotBtn) {
            manualRecoverySnapshotBtn.addEventListener('click', () => {
                void runWithButtonBusy(manualRecoverySnapshotBtn, () => createManualRecoverySnapshotAction());
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
                ), { optional: true });
            });
        }

        if (firstSyncOverwriteBtn) {
            firstSyncOverwriteBtn.addEventListener('click', () => {
                void (async () => {
                    pullSettingsFromForm();
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
                const actionMode = String(conflictUseRemoteBtn.dataset.syncActionMode || 'remote');
                if (actionMode === 'baseline') {
                    void resolvePendingConflictByBaseline();
                    return;
                }
                resolvePendingConflict('remote');
            });
        }

        const conflictUseNewestBtn = getElement('canvasSyncConflictUseNewestBtn');
        if (conflictUseNewestBtn) {
            conflictUseNewestBtn.addEventListener('click', () => {
                resolvePendingConflict('newer');
            });
        }

        const conflictFineToggle = getElement('canvasSyncConflictFineToggle');
        if (conflictFineToggle) {
            conflictFineToggle.addEventListener('change', () => {
                conflictFineModeEnabled = !!conflictFineToggle.checked;
                renderConflictPanel();
            });
        }

        const conflictFineList = getElement('canvasSyncConflictFineList');
        if (conflictFineList) {
            conflictFineList.addEventListener('change', (event) => {
                const target = event && event.target && event.target.closest
                    ? event.target.closest('select[data-conflict-fine-path]')
                    : null;
                if (!target) return;
                const path = normalizeSyncPath(target.getAttribute('data-conflict-fine-path'));
                if (!path) return;
                conflictFineChoiceByPath[path] = normalizeConflictFineChoice(target.value);
            });
        }

        const conflictApplyFineBtn = getElement('canvasSyncConflictApplyFineBtn');
        if (conflictApplyFineBtn) {
            conflictApplyFineBtn.addEventListener('click', () => {
                void runWithButtonBusy(conflictApplyFineBtn, () => resolvePendingConflictByFineChoices());
            });
        }

        const conflictRetryMergeBtn = getElement('canvasSyncConflictRetryMergeBtn');
        if (conflictRetryMergeBtn) {
            conflictRetryMergeBtn.addEventListener('click', () => {
                void runWithButtonBusy(conflictRetryMergeBtn, () => retryPendingConflictCloudMerge());
            });
        }

        const conflictDismissBtn = getElement('canvasSyncConflictDismissBtn');
        if (conflictDismissBtn) {
            conflictDismissBtn.addEventListener('click', () => {
                if (isConflictPreviewActive()) {
                    setPreviewPanelMode('');
                    toast(textByLang('已关闭“冲突面板”预览', 'Conflict panel preview closed'), { optional: true });
                    return;
                }
                toast(textByLang('冲突已保留，请手动选择处理方式后继续同步', 'Conflict kept. Resolve it manually and continue sync'), { optional: true });
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
            if (isRecoveryLockActive()) {
                renderRecoveryLockPanel();
                renderStatus();
                updateSyncEnabledDependentFieldState();
                return;
            }
            if (scheduleActiveRunRecoveryResume('online')) return;
            renderStatus();
        });

        global.addEventListener('offline', () => {
            runtime.lastError = textByLang('当前离线，已暂停云端同步，恢复网络后自动重试', 'Offline now. Remote sync paused and will retry when network is back');
            saveRuntime();
            renderStatus();
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            if (isRecoveryLockActive()) {
                renderRecoveryLockPanel();
                renderStatus();
                updateSyncEnabledDependentFieldState();
                return;
            }
            scheduleActiveRunRecoveryResume('visible');
            void maybePromptPendingConflictOnInit();
        });

        const markInterruptedSyncBeforePageExit = () => {
            if (!runtime || !runtime.isRunning) return;
            markActiveRunRecoveryInterrupted('pagehide');
        };

        const markInteraction = () => {
            markForegroundUserInteraction();
        };
        if (document.body && document.body.dataset.syncUserActivityBound !== 'true') {
            document.body.dataset.syncUserActivityBound = 'true';
            ['pointerdown', 'pointermove', 'keydown', 'input', 'wheel', 'touchstart'].forEach((eventName) => {
                document.addEventListener(eventName, markInteraction, { passive: true });
            });
        }

        global.addEventListener('pagehide', markInterruptedSyncBeforePageExit);
        global.addEventListener('beforeunload', markInterruptedSyncBeforePageExit);
    }

    async function init() {
        try {
            await hydrateSyncMetaStorage();
            bindSyncMetaStorageChangeListener();
        } catch (_) { }

        settings = loadSettings();
        runtime = loadRuntime();
        recoveryLockState = loadRecoveryLockState();
        // Foreground sync cannot survive a page reload; stale persisted running state would
        // disable action buttons incorrectly.
        runtime.isRunning = false;
        runtime.lastRemoteCommittedAt = Number(runtime.lastRemoteCommittedAt) || 0;
        runtime.lastBlankSectionFilePushAt = Number(runtime.lastBlankSectionFilePushAt) || 0;
        runtime.lastPermanentSectionHash = String(runtime.lastPermanentSectionHash || '');
        runtime.lastOtherSyncDataHash = String(runtime.lastOtherSyncDataHash || '');
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
        await maybeHandleRecoveryLockOnInit();
        maybeRecoverInterruptedRunOnInit();

        if (!isRecoveryLockActive()) {
            void maybePromptPendingConflictOnInit();
        }

        void updateBackgroundSyncContext('init', {
            isRunning: runtime.isRunning,
            queueLength: runtime.queueLength,
            lastRemoteSha: runtime.lastRemoteSha,
            lastCheckRemoteSha: runtime.lastCheckRemoteSha,
            lastLocalHash: runtime.lastLocalHash,
            lastSuccessAt: runtime.lastSuccessAt
        });
    }

    const syncApi = {
        openPanel,
        closePanel,
        requestSyncNow: (trigger) => requestManualSync(trigger || 'manual'),
        runFirstSyncCloudOverwrite,
        readRemoteSnapshotForImport,
        markDirty: (reason, options) => {
            lastUserDirtyAt = Date.now();
            updateDirtyStateByReason(reason, options || {});
            return;
        },
        getSettings: () => Object.assign({}, settings || loadSettings()),
        updateSettings: (patch) => {
            settings = Object.assign({}, settings || loadSettings(), patch || {});
            settings.conflictPolicy = ensureConflictPolicy(settings.conflictPolicy);
            settings.syncMethod = DEFAULT_SETTINGS.syncMethod;
            delete settings.pushOnSync;
            delete settings.pullOnSync;
            settings.toastEnabled = settings.toastEnabled !== false;
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
            renderStatus();
            void updateBackgroundSyncContext('settings-update', {
                isRunning: runtime && runtime.isRunning,
                queueLength: runtime && runtime.queueLength,
                lastRemoteSha: runtime && runtime.lastRemoteSha,
                lastLocalHash: runtime && runtime.lastLocalHash,
                lastSuccessAt: runtime && runtime.lastSuccessAt
            });
        }
,
        refreshI18n: () => {
            renderStatus();
            renderRecoveryLockPanel();
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
