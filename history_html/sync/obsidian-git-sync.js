(function (global) {
    const SETTINGS_KEY = 'canvas-obsidian-git-sync-settings-v1';
    const RUNTIME_KEY = 'canvas-obsidian-git-sync-runtime-v1';
    const CONFLICT_LOG_KEY = 'canvas-obsidian-git-sync-conflicts-v1';
    const PENDING_CONFLICT_KEY = 'canvas-obsidian-git-sync-pending-conflict-v1';
    const RECOVERY_KEY = 'canvas-obsidian-git-sync-recovery-v1';
    const CLIENT_ID_KEY = 'canvas-obsidian-git-sync-client-id-v1';
    const TAB_ACTIVE_KEY = 'canvas-obsidian-git-sync-active-tab-v1';
    const OBSIDIAN_FILE_HASHES_KEY = 'canvas-obsidian-git-sync-obsidian-file-hashes-v1';

    const REPO_CONFIG_KEYS = [
        'githubRepoToken',
        'githubRepoOwner',
        'githubRepoName',
        'githubRepoBranch',
        'githubRepoBasePath'
    ];

    const SYNC_TAB_KEYS = ['repo', 'behavior', 'status'];
    const DEFAULT_ACTIVE_TAB = 'repo';

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
    const SYNC_METHODS = new Set(['merge', 'rebase', 'reset']);
    const FIRST_SYNC_MODES = new Set(['auto', 'cloud', 'local']);
    const MAX_RECOVERY_RECORDS = 5;
    const PERMANENT_TREE_UPLOAD_INTERVALS = new Set([0, 5, 15, 30, 60]);
    const OBSIDIAN_EXPORT_FORMATS = new Set(['visual', 'editable']);

    const DEFAULT_SETTINGS = {
        enabled: false,
        autoSync: true,
        intervalSeconds: 180,
        debounceMs: 800,
        batchDebounceMs: 5000,
        splitIntervalCommitAndSync: false,
        autoPushIntervalMinutes: 0,
        autoPullIntervalMinutes: 0,
        pullOnStartup: false,
        pushOnSync: true,
        pullOnSync: true,
        hideNoChangeNotice: false,
        firstSyncMode: 'auto',
        permanentTreeUploadIntervalSeconds: 15,
        obsidianFilePushEnabled: true,
        obsidianExportFormat: 'editable',
        obsidianExportRoot: 'bookmark-canvas-sync',
        syncMethod: 'merge',
        conflictPolicy: 'none',
        deleteThresholdPercent: 20,
        filePath: ''
    };

    const DEFAULT_RUNTIME = {
        isRunning: false,
        queueLength: 0,
        lastSuccessAt: 0,
        lastError: '',
        lastTrigger: '',
        lastRemoteSha: '',
        lastLocalHash: '',
        lastAppliedDirection: '',
        lastSyncMode: '',
        lastLocalMutationAt: 0,
        lastPermanentTreeSnapshotAt: 0,
        lastObsidianPushAt: 0,
        lastObsidianPushChanged: 0,
        lastObsidianPushTotal: 0,
        hasPendingConflict: false
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
    let panelBound = false;
    let repoConfig = null;
    let activeTabKey = DEFAULT_ACTIVE_TAB;
    const pendingReasons = new Set();

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

    function toSafeInt(value, fallback) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return fallback;
        return parsed;
    }

    function normalizeIntervalMinutes(value, fallback = 0) {
        const minutes = toSafeInt(value, fallback);
        return Math.max(0, Math.min(24 * 60, minutes));
    }

    function normalizePermanentTreeUploadIntervalSeconds(value, fallback = DEFAULT_SETTINGS.permanentTreeUploadIntervalSeconds) {
        const seconds = toSafeInt(value, fallback);
        if (PERMANENT_TREE_UPLOAD_INTERVALS.has(seconds)) {
            return seconds;
        }
        return fallback;
    }

    function normalizeObsidianExportFormat(value, fallback = DEFAULT_SETTINGS.obsidianExportFormat) {
        const format = String(value || '').trim().toLowerCase();
        return OBSIDIAN_EXPORT_FORMATS.has(format) ? format : fallback;
    }

    function normalizeObsidianExportRoot(path, fallback = DEFAULT_SETTINGS.obsidianExportRoot) {
        const normalized = normalizeSyncPath(path);
        return normalized || normalizeSyncPath(fallback) || DEFAULT_SETTINGS.obsidianExportRoot;
    }

    function loadSettings() {
        const parsed = safeParse(localStorage.getItem(SETTINGS_KEY), null);
        const merged = Object.assign({}, DEFAULT_SETTINGS, parsed || {});

        merged.conflictPolicy = ensureConflictPolicy(merged.conflictPolicy);
        merged.syncMethod = ensureSyncMethod(merged.syncMethod);
        merged.filePath = normalizeSyncPath(merged.filePath);
        merged.splitIntervalCommitAndSync = !!merged.splitIntervalCommitAndSync;
        merged.autoPushIntervalMinutes = normalizeIntervalMinutes(merged.autoPushIntervalMinutes, DEFAULT_SETTINGS.autoPushIntervalMinutes);
        merged.autoPullIntervalMinutes = normalizeIntervalMinutes(merged.autoPullIntervalMinutes, DEFAULT_SETTINGS.autoPullIntervalMinutes);
        merged.pullOnStartup = !!merged.pullOnStartup;
        merged.pushOnSync = merged.pushOnSync !== false;
        merged.pullOnSync = merged.pullOnSync !== false;
        merged.hideNoChangeNotice = !!merged.hideNoChangeNotice;

        merged.firstSyncMode = ensureFirstSyncMode(merged.firstSyncMode);

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
        merged.obsidianFilePushEnabled = merged.obsidianFilePushEnabled !== false;
        merged.obsidianExportFormat = normalizeObsidianExportFormat(merged.obsidianExportFormat, DEFAULT_SETTINGS.obsidianExportFormat);
        merged.obsidianExportRoot = normalizeObsidianExportRoot(merged.obsidianExportRoot, DEFAULT_SETTINGS.obsidianExportRoot);

        return merged;
    }

    function saveSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function loadRuntime() {
        const parsed = safeParse(localStorage.getItem(RUNTIME_KEY), null);
        return Object.assign({}, DEFAULT_RUNTIME, parsed || {});
    }

    function saveRuntime() {
        localStorage.setItem(RUNTIME_KEY, JSON.stringify(runtime));
    }

    function loadActiveTab() {
        const raw = String(localStorage.getItem(TAB_ACTIVE_KEY) || '').trim();
        return SYNC_TAB_KEYS.includes(raw) ? raw : DEFAULT_ACTIVE_TAB;
    }

    function saveActiveTab(tabKey) {
        const nextTab = SYNC_TAB_KEYS.includes(tabKey) ? tabKey : DEFAULT_ACTIVE_TAB;
        localStorage.setItem(TAB_ACTIVE_KEY, nextTab);
    }

    function loadObsidianFileHashes() {
        const parsed = safeParse(localStorage.getItem(OBSIDIAN_FILE_HASHES_KEY), {});
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        return parsed;
    }

    function saveObsidianFileHashes(map) {
        const safeMap = (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
        localStorage.setItem(OBSIDIAN_FILE_HASHES_KEY, JSON.stringify(safeMap));
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

    async function overwriteLocalPermanentTreeFromSnapshot(treeSnapshot) {
        const remoteTree = normalizeBookmarkTreeSnapshot(treeSnapshot);
        if (!remoteTree) {
            throw new Error(textByLang('远端未提供永久栏目快照，无法覆盖', 'Remote permanent section snapshot is missing; cannot overwrite'));
        }

        const localTree = await bookmarksGetTree();
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
        const pathText = response.basePathExists === false ? textByLang('（Base Path 不存在，将在首次写入时创建）', '(Base Path does not exist; it will be created on first write)') : '';
        setRepoStatus(textByLang(`连接成功：${repoName} @ ${branch} ${pathText}`, `Connected: ${repoName} @ ${branch} ${pathText}`).trim(), 'ok');
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
        return triggerText.startsWith('manual') || triggerText === 'user';
    }

    function getSyncLang() {
        const lang = String((global && global.currentLang) || '').toLowerCase();
        return (lang === 'en' || lang.startsWith('en')) ? 'en' : 'zh_CN';
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

    function formatSyncMethodForDisplay(method) {
        const value = ensureSyncMethod(method);
        if (value === 'rebase') return textByLang('变基', 'Rebase');
        if (value === 'reset') return textByLang('其他同步服务', 'Other sync service');
        return textByLang('合并', 'Merge');
    }

    function formatConflictPolicyForDisplay(policy) {
        const value = ensureConflictPolicy(policy);
        if (value === 'ours') return textByLang('本地优先', 'Our changes');
        if (value === 'theirs') return textByLang('远端优先', 'Their changes');
        return textByLang('默认（Git）', 'None (git default)');
    }

    function resolveFullSyncMode() {
        if (settings.pullOnSync && settings.pushOnSync) return 'full';
        if (settings.pullOnSync && !settings.pushOnSync) return 'pull';
        if (!settings.pullOnSync && settings.pushOnSync) return 'push';
        return 'noop';
    }

    function getClientId() {
        let id = String(localStorage.getItem(CLIENT_ID_KEY) || '').trim();
        if (id) return id;
        id = `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(CLIENT_ID_KEY, id);
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

    function getDirectionText(direction) {
        const raw = String(direction || '').trim();
        if (!raw) return '-';
        if (raw === 'push') return textByLang('本地 → 远端', 'Local → Remote');
        if (raw === 'pull') return textByLang('远端 → 本地', 'Remote → Local');
        if (raw === 'noop') return textByLang('无变化', 'No Changes');
        if (raw === 'reset-head') return textByLang('其他同步服务（仅更新 HEAD，不覆盖本地）', 'Other sync service (update HEAD only, keep local working tree)');
        if (raw === 'conflict-local') return textByLang('冲突已选：本地优先', 'Conflict Resolved: Local Preferred');
        if (raw === 'conflict-remote') return textByLang('冲突已选：远端优先', 'Conflict Resolved: Remote Preferred');
        if (raw === 'conflict') return textByLang('等待冲突处理', 'Waiting for Conflict Resolution');
        return raw;
    }

    function renderStatus() {
        const runningEl = getElement('canvasSyncStatusRunning');
        const queueEl = getElement('canvasSyncStatusQueue');
        const lastEl = getElement('canvasSyncStatusLastSuccess');
        const directionEl = getElement('canvasSyncStatusLastDirection');
        const obsidianPushAtEl = getElement('canvasSyncStatusObsidianPushAt');
        const obsidianPushDeltaEl = getElement('canvasSyncStatusObsidianPushDelta');
        const remoteShaEl = getElement('canvasSyncStatusRemoteSha');
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
        if (remoteShaEl) remoteShaEl.textContent = shortText(runtime.lastRemoteSha, '-');
        if (errorEl) {
            const missingReason = getRepoConfigMissingReason(repoConfig);
            const repoNotReadyText = missingReason
                ? textByLang(`仓库未就绪：${missingReason}`, `Repository not ready: ${missingReason}`)
                : '';
            errorEl.textContent = runtime.lastError || repoNotReadyText || textByLang('无', 'None');
        }
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

        if (autoInput && autoInput.checked) return 'auto';
        if (cloudInput && cloudInput.checked) return 'cloud';
        if (localInput && localInput.checked) return 'local';
        if (legacySelect) return ensureFirstSyncMode(legacySelect.value);

        return ensureFirstSyncMode(fallbackMode);
    }

    function applySettingsToForm() {
        const enabled = getElement('canvasSyncEnabledToggle');
        const auto = getElement('canvasSyncAutoToggle');
        const splitInterval = getElement('canvasSyncSplitIntervalsToggle');
        const permanentTreeUploadInterval = getElement('canvasSyncPermanentTreeIntervalSelect');
        const interval = getElement('canvasSyncIntervalInput');
        const pushInterval = getElement('canvasSyncAutoPushIntervalInput');
        const pullInterval = getElement('canvasSyncAutoPullIntervalInput');
        const pullOnStartup = getElement('canvasSyncPullOnStartupToggle');
        const pushOnSync = getElement('canvasSyncPushOnSyncToggle');
        const pullOnSync = getElement('canvasSyncPullOnSyncToggle');
        const hideNoChangeNotice = getElement('canvasSyncHideNoChangeNoticeToggle');
        const syncMethod = getElement('canvasSyncMethodSelect');
        const conflict = getElement('canvasSyncConflictSelect');
        const threshold = getElement('canvasSyncDeleteThresholdInput');
        const filePath = getElement('canvasSyncFilePathInput');
        const obsidianFilePushEnabled = getElement('canvasSyncObsidianFilePushToggle');
        const obsidianExportFormat = getElement('canvasSyncObsidianExportFormatSelect');
        const obsidianExportRoot = getElement('canvasSyncObsidianExportRootInput');

        if (enabled) enabled.checked = !!settings.enabled;
        if (auto) auto.checked = !!settings.autoSync;
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
        if (interval) interval.value = String(secondsToMinutes(settings.intervalSeconds || DEFAULT_SETTINGS.intervalSeconds));
        if (pushInterval) pushInterval.value = String(normalizeIntervalMinutes(settings.autoPushIntervalMinutes, 0));
        if (pullInterval) pullInterval.value = String(normalizeIntervalMinutes(settings.autoPullIntervalMinutes, 0));
        if (pullOnStartup) pullOnStartup.checked = !!settings.pullOnStartup;
        if (pushOnSync) pushOnSync.checked = settings.pushOnSync !== false;
        if (pullOnSync) pullOnSync.checked = settings.pullOnSync !== false;
        if (hideNoChangeNotice) hideNoChangeNotice.checked = !!settings.hideNoChangeNotice;
        if (syncMethod) syncMethod.value = ensureSyncMethod(settings.syncMethod);
        if (conflict) conflict.value = settings.conflictPolicy || DEFAULT_SETTINGS.conflictPolicy;
        if (threshold) threshold.value = String(settings.deleteThresholdPercent || DEFAULT_SETTINGS.deleteThresholdPercent);
        if (filePath) filePath.value = settings.filePath || '';
        if (obsidianFilePushEnabled) obsidianFilePushEnabled.checked = settings.obsidianFilePushEnabled !== false;
        if (obsidianExportFormat) obsidianExportFormat.value = normalizeObsidianExportFormat(settings.obsidianExportFormat, DEFAULT_SETTINGS.obsidianExportFormat);
        if (obsidianExportRoot) obsidianExportRoot.value = settings.obsidianExportRoot || DEFAULT_SETTINGS.obsidianExportRoot;
    }

    function pullSettingsFromForm() {
        const enabled = getElement('canvasSyncEnabledToggle');
        const auto = getElement('canvasSyncAutoToggle');
        const splitInterval = getElement('canvasSyncSplitIntervalsToggle');
        const permanentTreeUploadInterval = getElement('canvasSyncPermanentTreeIntervalSelect');
        const interval = getElement('canvasSyncIntervalInput');
        const pushInterval = getElement('canvasSyncAutoPushIntervalInput');
        const pullInterval = getElement('canvasSyncAutoPullIntervalInput');
        const pullOnStartup = getElement('canvasSyncPullOnStartupToggle');
        const pushOnSync = getElement('canvasSyncPushOnSyncToggle');
        const pullOnSync = getElement('canvasSyncPullOnSyncToggle');
        const hideNoChangeNotice = getElement('canvasSyncHideNoChangeNoticeToggle');
        const syncMethod = getElement('canvasSyncMethodSelect');
        const conflict = getElement('canvasSyncConflictSelect');
        const threshold = getElement('canvasSyncDeleteThresholdInput');
        const filePath = getElement('canvasSyncFilePathInput');
        const obsidianFilePushEnabled = getElement('canvasSyncObsidianFilePushToggle');
        const obsidianExportFormat = getElement('canvasSyncObsidianExportFormatSelect');
        const obsidianExportRoot = getElement('canvasSyncObsidianExportRootInput');

        settings.enabled = enabled ? !!enabled.checked : settings.enabled;
        settings.autoSync = auto ? !!auto.checked : settings.autoSync;
        settings.splitIntervalCommitAndSync = splitInterval ? !!splitInterval.checked : settings.splitIntervalCommitAndSync;
        settings.firstSyncMode = getFirstSyncModeFromForm(settings.firstSyncMode);
        settings.permanentTreeUploadIntervalSeconds = normalizePermanentTreeUploadIntervalSeconds(
            permanentTreeUploadInterval ? permanentTreeUploadInterval.value : settings.permanentTreeUploadIntervalSeconds,
            DEFAULT_SETTINGS.permanentTreeUploadIntervalSeconds
        );

        const intervalMinutes = Math.max(1, Number.parseInt(interval ? interval.value : `${secondsToMinutes(settings.intervalSeconds)}`, 10) || secondsToMinutes(DEFAULT_SETTINGS.intervalSeconds));
        settings.intervalSeconds = minutesToSeconds(intervalMinutes);

        settings.autoPushIntervalMinutes = normalizeIntervalMinutes(pushInterval ? pushInterval.value : settings.autoPushIntervalMinutes, DEFAULT_SETTINGS.autoPushIntervalMinutes);
        settings.autoPullIntervalMinutes = normalizeIntervalMinutes(pullInterval ? pullInterval.value : settings.autoPullIntervalMinutes, DEFAULT_SETTINGS.autoPullIntervalMinutes);
        settings.pullOnStartup = pullOnStartup ? !!pullOnStartup.checked : settings.pullOnStartup;
        settings.pushOnSync = pushOnSync ? !!pushOnSync.checked : settings.pushOnSync;
        settings.pullOnSync = pullOnSync ? !!pullOnSync.checked : settings.pullOnSync;
        settings.hideNoChangeNotice = hideNoChangeNotice ? !!hideNoChangeNotice.checked : settings.hideNoChangeNotice;

        settings.syncMethod = ensureSyncMethod(syncMethod ? syncMethod.value : settings.syncMethod);
        settings.conflictPolicy = ensureConflictPolicy(conflict ? conflict.value : settings.conflictPolicy);
        settings.deleteThresholdPercent = Math.max(1, Math.min(100, Number.parseInt(threshold ? threshold.value : `${settings.deleteThresholdPercent}`, 10) || DEFAULT_SETTINGS.deleteThresholdPercent));
        settings.filePath = normalizeSyncPath(filePath ? filePath.value : settings.filePath);
        settings.obsidianFilePushEnabled = obsidianFilePushEnabled ? !!obsidianFilePushEnabled.checked : settings.obsidianFilePushEnabled;
        settings.obsidianExportFormat = normalizeObsidianExportFormat(
            obsidianExportFormat ? obsidianExportFormat.value : settings.obsidianExportFormat,
            DEFAULT_SETTINGS.obsidianExportFormat
        );
        settings.obsidianExportRoot = normalizeObsidianExportRoot(
            obsidianExportRoot ? obsidianExportRoot.value : settings.obsidianExportRoot,
            DEFAULT_SETTINGS.obsidianExportRoot
        );

        saveSettings();
        restartAutomationTimers();
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
            format: snapshot.format || 'bookmark-canvas-sync-state',
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

        const tempTs = readTempStateTimestampFromRaw(data[TEMP_SECTION_STORAGE_KEY]);
        const now = Date.now();
        const updatedAt = Math.max(now, Number(runtime.lastLocalMutationAt) || 0, tempTs);

        const includePermanentTree = shouldIncludePermanentTreeSnapshot(trigger, options);

        let permanentTreeSnapshot = null;
        if (includePermanentTree) {
            permanentTreeSnapshot = await getPermanentTreeSnapshotForSync();
        }

        return {
            schemaVersion: 1,
            format: 'bookmark-canvas-sync-state',
            clientId: getClientId(),
            updatedAt,
            generatedAt: now,
            trigger: trigger || 'manual',
            permanentTreeSnapshot,
            data
        };
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

    async function readRemoteSnapshot() {
        const response = await sendRuntimeMessage({
            action: 'canvasGitReadState',
            path: settings.filePath || ''
        });

        if (!response || response.success !== true) {
            throw new Error((response && response.error) || textByLang('读取远端同步文件失败', 'Failed to read remote sync file'));
        }

        if (response.notFound === true) {
            return { notFound: true, path: response.path || '' };
        }

        const text = decodeBase64ToText(response.contentBase64 || '');
        if (!text.trim()) {
            return {
                notFound: false,
                path: response.path || '',
                sha: response.sha || '',
                snapshot: normalizeSnapshot({ data: {} })
            };
        }

        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch (_) {
            throw new Error(textByLang('远端同步文件不是合法 JSON', 'Remote sync file is not valid JSON'));
        }

        return {
            notFound: false,
            path: response.path || '',
            sha: response.sha || '',
            snapshot: normalizeSnapshot(parsed)
        };
    }

    async function writeRemoteSnapshot(snapshot, commitMessage) {
        const payload = {
            action: 'canvasGitWriteState',
            path: settings.filePath || '',
            commitMessage,
            content: JSON.stringify(snapshot, null, 2)
        };

        const response = await sendRuntimeMessage(payload);
        if (!response || response.success !== true) {
            throw new Error((response && response.error) || textByLang('写入远端同步文件失败', 'Failed to write remote sync file'));
        }

        return response;
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
            throw new Error((response && response.error) || textByLang(`写入文件失败：${payload.path}`, `Failed to write file: ${payload.path}`));
        }

        return response;
    }

    async function pushObsidianFilesIncremental(trigger) {
        if (!settings || settings.obsidianFilePushEnabled === false) {
            return {
                enabled: false,
                changedCount: 0,
                totalCount: 0
            };
        }

        const bridge = global.CanvasObsidianExportBridge;
        if (!bridge || typeof bridge.buildSyncFiles !== 'function') {
            return {
                enabled: false,
                changedCount: 0,
                totalCount: 0,
                reason: 'bridge-unavailable'
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
            normalizedFiles.push({ path, content });
        });

        const previousHashes = loadObsidianFileHashes();
        const nextHashes = {};
        const changedFiles = [];

        normalizedFiles.forEach((file) => {
            const hash = hashString(file.content);
            nextHashes[file.path] = hash;
            if (previousHashes[file.path] !== hash) {
                changedFiles.push({ path: file.path, content: file.content });
            }
        });

        for (let i = 0; i < changedFiles.length; i++) {
            const file = changedFiles[i];
            const commitMessage = `Bookmark Canvas Sync: ${trigger || 'sync'} update ${file.path}`;
            await writeRemoteFile(file.path, file.content, commitMessage);
        }

        saveObsidianFileHashes(nextHashes);

        return {
            enabled: true,
            changedCount: changedFiles.length,
            totalCount: normalizedFiles.length,
            exportRoot: bundle && bundle.exportRoot ? String(bundle.exportRoot) : settings.obsidianExportRoot
        };
    }

    function storeConflictRecord(localSnapshot, remoteSnapshot, reason, extra = {}) {
        const list = safeParse(localStorage.getItem(CONFLICT_LOG_KEY), []);
        const arr = Array.isArray(list) ? list : [];
        arr.unshift({
            ts: Date.now(),
            reason,
            policy: settings.conflictPolicy,
            local: buildSnapshotMeta(localSnapshot),
            remote: buildSnapshotMeta(remoteSnapshot),
            extra
        });
        localStorage.setItem(CONFLICT_LOG_KEY, JSON.stringify(arr.slice(0, 20)));
    }

    function hasPendingConflict() {
        return !!pendingConflict;
    }

    function loadPendingConflict() {
        const parsed = safeParse(localStorage.getItem(PENDING_CONFLICT_KEY), null);
        if (!parsed) return null;
        try {
            const localSnapshot = normalizeSnapshot(parsed.localSnapshot || {});
            const remoteSnapshot = normalizeSnapshot(parsed.remoteSnapshot || {});
            return {
                id: String(parsed.id || `conflict-${Date.now()}`),
                createdAt: Number(parsed.createdAt) || Date.now(),
                reason: String(parsed.reason || 'concurrent-change'),
                remoteSha: String(parsed.remoteSha || ''),
                remotePath: String(parsed.remotePath || ''),
                localSnapshot,
                remoteSnapshot,
                localMeta: parsed.localMeta || buildSnapshotMeta(localSnapshot),
                remoteMeta: parsed.remoteMeta || buildSnapshotMeta(remoteSnapshot)
            };
        } catch (_) {
            return null;
        }
    }

    function persistPendingConflict() {
        if (!pendingConflict) {
            localStorage.removeItem(PENDING_CONFLICT_KEY);
            return;
        }
        localStorage.setItem(PENDING_CONFLICT_KEY, JSON.stringify(pendingConflict));
    }

    function renderConflictPanel() {
        const panel = getElement('canvasSyncConflictPanel');
        if (!panel) return;

        if (!pendingConflict) {
            panel.hidden = true;
            const summaryWhenHidden = getElement('canvasSyncConflictSummary');
            if (summaryWhenHidden) {
                delete summaryWhenHidden.dataset.dynamicSummary;
            }
            return;
        }

        panel.hidden = false;

        const detectedAt = getElement('canvasSyncConflictDetectedAt');
        if (detectedAt) detectedAt.textContent = formatTime(pendingConflict.createdAt);

        const summary = getElement('canvasSyncConflictSummary');
        if (summary) {
            const syncMethod = ensureSyncMethod(settings.syncMethod);
            const methodText = formatSyncMethodForDisplay(syncMethod);
            const policyText = formatConflictPolicyForDisplay(settings.conflictPolicy);
            const remotePathZh = pendingConflict.remotePath ? `远端文件：${pendingConflict.remotePath}` : '远端文件：默认路径';
            const remotePathEn = pendingConflict.remotePath ? `Remote file: ${pendingConflict.remotePath}` : 'Remote file: default path';
            const resetHint = syncMethod === 'reset'
                ? textByLang(
                    '选择远端时只会更新 HEAD，不会覆盖本地工作区。',
                    'Choosing remote will only update HEAD and will not overwrite the local working tree.'
                )
                : textByLang(
                    '建议先导出全量备份，再选择本地或远端。',
                    'Export a full backup first, then choose local or remote.'
                );

            summary.textContent = textByLang(
                `检测到两端都已修改。${remotePathZh}。当前合并策略：${methodText}；冲突策略：${policyText}。${resetHint}`,
                `Concurrent changes detected on both sides. ${remotePathEn}. Current merge strategy: ${methodText}; conflict strategy: ${policyText}. ${resetHint}`
            );
            summary.dataset.dynamicSummary = 'true';
        }

        const localUpdated = getElement('canvasSyncConflictLocalUpdated');
        const localSize = getElement('canvasSyncConflictLocalSize');
        const localHash = getElement('canvasSyncConflictLocalHash');
        if (localUpdated) localUpdated.textContent = formatTime(pendingConflict.localMeta.updatedAt);
        if (localSize) localSize.textContent = formatBytes(pendingConflict.localMeta.bytes);
        if (localHash) localHash.textContent = shortText(pendingConflict.localMeta.hash, '-');

        const remoteUpdated = getElement('canvasSyncConflictRemoteUpdated');
        const remoteSize = getElement('canvasSyncConflictRemoteSize');
        const remoteHash = getElement('canvasSyncConflictRemoteHash');
        if (remoteUpdated) remoteUpdated.textContent = formatTime(pendingConflict.remoteMeta.updatedAt);
        if (remoteSize) remoteSize.textContent = formatBytes(pendingConflict.remoteMeta.bytes);
        if (remoteHash) remoteHash.textContent = shortText(pendingConflict.remoteMeta.hash || pendingConflict.remoteSha, '-');
    }

    function setPendingConflict(conflict) {
        pendingConflict = conflict;
        runtime.hasPendingConflict = true;
        persistPendingConflict();
        saveRuntime();
        renderStatus();
        renderConflictPanel();
    }

    function clearPendingConflict() {
        pendingConflict = null;
        runtime.hasPendingConflict = false;
        persistPendingConflict();
        saveRuntime();
        renderStatus();
        renderConflictPanel();
    }

    function backupSnapshotForRecovery(snapshot, reason) {
        const list = safeParse(localStorage.getItem(RECOVERY_KEY), []);
        const arr = Array.isArray(list) ? list : [];
        arr.unshift({
            ts: Date.now(),
            reason: String(reason || 'manual'),
            snapshot
        });
        localStorage.setItem(RECOVERY_KEY, JSON.stringify(arr.slice(0, MAX_RECOVERY_RECORDS)));
    }

    function applySnapshotToLocal(snapshot) {
        const nextData = snapshot && snapshot.data && typeof snapshot.data === 'object' ? snapshot.data : {};

        const existingKeys = SYNC_KEYS.filter((key) => localStorage.getItem(key) !== null);
        const keysToDelete = existingKeys.filter((key) => !Object.prototype.hasOwnProperty.call(nextData, key));
        const deletePercent = existingKeys.length > 0
            ? (keysToDelete.length / existingKeys.length) * 100
            : 0;

        if (deletePercent > settings.deleteThresholdPercent) {
            throw new Error(textByLang(`远端删除比例 ${deletePercent.toFixed(1)}% 超过阈值 ${settings.deleteThresholdPercent}%`, `Remote deletion ratio ${deletePercent.toFixed(1)}% exceeds threshold ${settings.deleteThresholdPercent}%`));
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

    function createPendingConflictPayload(localSnapshot, remoteSnapshot, remoteState) {
        return {
            id: `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(),
            reason: 'concurrent-change',
            remoteSha: String(remoteState && remoteState.sha || ''),
            remotePath: String(remoteState && remoteState.path || ''),
            localSnapshot,
            remoteSnapshot,
            localMeta: buildSnapshotMeta(localSnapshot),
            remoteMeta: buildSnapshotMeta(remoteSnapshot)
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

            if (choice === 'local') {
                const writeResult = await writeRemoteSnapshot(localSnapshot, 'Bookmark Canvas Sync: conflict resolved keep local');
                runtime.lastLocalHash = getSnapshotHash(localSnapshot);
                runtime.lastRemoteSha = writeResult.fileSha || writeResult.commitSha || runtime.lastRemoteSha;
                runtime.lastAppliedDirection = 'conflict-local';
                storeConflictRecord(localSnapshot, remoteSnapshot, 'resolved-local', {
                    conflictId: pendingConflict.id,
                    remoteSha: pendingConflict.remoteSha
                });
            } else if (choice === 'remote') {
                const currentLocal = await buildLocalSnapshot('conflict-local-backup', { includePermanentTree: true });
                backupSnapshotForRecovery(currentLocal, 'before-apply-remote-conflict');
                applySnapshotToLocal(remoteSnapshot);
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
                ? textByLang('冲突已处理：已保留本地并覆盖远端', 'Conflict resolved: kept local and overwrote remote')
                : textByLang('冲突已处理：已使用远端覆盖本地（已生成本地恢复快照）', 'Conflict resolved: used remote to overwrite local (local recovery snapshot created)'));
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
            openPanel({ activeTab: 'status' });
            toast(textByLang('请先处理同步冲突', 'Please resolve sync conflicts first'));
            return;
        }

        if (runtime.isRunning) {
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

        try {
            const localSnapshot = await buildLocalSnapshot(trigger);
            let localHash = getSnapshotHash(localSnapshot);

            const doPush = async (reason) => {
                const writeResult = await writeRemoteSnapshot(
                    localSnapshot,
                    `Bookmark Canvas Sync: ${reason}`
                );

                const obsidianPushResult = await pushObsidianFilesIncremental(trigger || reason || 'sync');
                if (obsidianPushResult && obsidianPushResult.enabled) {
                    runtime.lastObsidianPushAt = Date.now();
                    runtime.lastObsidianPushChanged = Number(obsidianPushResult.changedCount) || 0;
                    runtime.lastObsidianPushTotal = Number(obsidianPushResult.totalCount) || 0;
                }

                runtime.lastLocalHash = localHash;
                runtime.lastRemoteSha = writeResult.fileSha || writeResult.commitSha || runtime.lastRemoteSha;
                if (localSnapshot && localSnapshot.permanentTreeSnapshot) {
                    runtime.lastPermanentTreeSnapshotAt = Date.now();
                }
                runtime.lastAppliedDirection = 'push';

                if (obsidianPushResult && obsidianPushResult.enabled) {
                    return `push + files(${runtime.lastObsidianPushChanged}/${runtime.lastObsidianPushTotal})`;
                }
                return 'push';
            };

            const doPull = async (remoteState, reason) => {
                applySnapshotToLocal(remoteState.snapshot);
                runtime.lastLocalHash = getSnapshotHash(remoteState.snapshot);
                runtime.lastRemoteSha = remoteState.sha || runtime.lastRemoteSha;
                runtime.lastAppliedDirection = 'pull';
                return reason || 'pull';
            };

            const doResetHead = async (remoteState, reason) => {
                runtime.lastLocalHash = localHash;
                runtime.lastRemoteSha = remoteState.sha || runtime.lastRemoteSha;
                runtime.lastAppliedDirection = 'reset-head';
                return reason || textByLang('其他同步服务（仅更新 HEAD）', 'Other sync service (only update HEAD)');
            };

            let actionText = 'noop';

            if (effectiveMode === 'noop') {
                runtime.lastAppliedDirection = 'noop';
                actionText = 'noop';
            } else if (effectiveMode === 'push') {
                if (!localSnapshot.permanentTreeSnapshot) {
                    try {
                        const remoteForPush = await readRemoteSnapshot();
                        if (!remoteForPush.notFound && hydratePermanentTreeFromRemote(localSnapshot, remoteForPush.snapshot)) {
                            localHash = getSnapshotHash(localSnapshot);
                        }
                    } catch (_) { }
                }
                actionText = await doPush('manual push');
            } else {
                const remoteState = await readRemoteSnapshot();
                if (effectiveMode === 'pull') {
                    if (remoteState.notFound) {
                        throw new Error(textByLang('远端同步文件不存在，无法仅拉取', 'Remote sync file does not exist; pull-only cannot continue'));
                    }
                    if (syncMethod === 'reset') {
                        actionText = await doResetHead(remoteState);
                    } else {
                        actionText = await doPull(remoteState, syncMethod === 'rebase' ? 'pull (rebase mode)' : 'pull');
                    }
                } else {
                    if (remoteState.notFound) {
                        actionText = await doPush('bootstrap push');
                    } else {
                        const remoteSnapshot = remoteState.snapshot;
                        if (hydratePermanentTreeFromRemote(localSnapshot, remoteSnapshot)) {
                            localHash = getSnapshotHash(localSnapshot);
                        }
                        const remoteHash = getSnapshotHash(remoteSnapshot);

                        if (remoteHash === localHash) {
                            runtime.lastLocalHash = localHash;
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
                                    `检测到冲突：当前冲突策略=默认（Git），当前合并策略=${formatSyncMethodForDisplay(syncMethod)}，请手动选择本地或远端`,
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
                                    toast(textByLang('检测到冲突：请在面板中选择本地或远端', 'Conflict detected: please choose local or remote in the panel'));
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

            pendingReasons.clear();
            runtime.queueLength = 0;
            runtime.lastError = '';
            runtime.lastSuccessAt = Date.now();
            saveRuntime();
            renderStatus();

            const triggerText = trigger ? `（${trigger}）` : '';
            if (actionText === 'noop') {
                if (!settings.hideNoChangeNotice) {
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

            const isRepoConfigError = /token 未配置|仓库未配置|仓库已禁用|owner\s*\/\s*repo 未配置|token not configured|repository not ready|repository disabled|owner\s*\/\s*repo not configured/i.test(runtime.lastError);
            if (!hasPendingConflict() && !isRepoConfigError) {
                scheduleRetry();
            }

            const offlineHint = isLikelyOfflineError(runtime.lastError)
                ? textByLang('（检测到网络异常，将自动重试）', ' (Network issue detected; will retry automatically)')
                : '';
            if (isManualTrigger || !isRepoConfigError) {
                toast(textByLang(`同步失败：${runtime.lastError}${offlineHint}`, `Sync failed: ${runtime.lastError}${offlineHint}`));
            }
        } finally {
            runtime.isRunning = false;
            saveRuntime();
            renderStatus();
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

        const remoteState = await readRemoteSnapshot();
        if (remoteState.notFound) {
            throw new Error(textByLang('云端同步文件不存在，请先在另一端执行一次同步', 'Cloud sync file does not exist. Run one sync on the other side first.'));
        }

        return {
            path: remoteState.path || '',
            sha: remoteState.sha || '',
            snapshot: remoteState.snapshot
        };
    }

    async function initializeRemoteSnapshotFromLocal(reason = 'bootstrap-init') {
        const localSnapshot = await buildLocalSnapshot(reason, { includePermanentTree: true });
        const writeResult = await writeRemoteSnapshot(
            localSnapshot,
            'Bookmark Canvas Sync: initialize remote with permanent tree snapshot'
        );

        runtime.lastLocalHash = getSnapshotHash(localSnapshot);
        runtime.lastRemoteSha = writeResult.fileSha || writeResult.commitSha || runtime.lastRemoteSha;
        runtime.lastPermanentTreeSnapshotAt = Date.now();
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

    function resolveFirstSyncMode(preferredMode, hasRemotePermanentSnapshot) {
        const mode = ensureFirstSyncMode(preferredMode);
        if (mode === 'auto') {
            if (!hasRemotePermanentSnapshot) {
                return 'local';
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
            return;
        }

        if (runtime.isRunning) {
            toast(textByLang('正在同步，请稍后再试', 'Sync is running, please try again later'));
            return;
        }

        await refreshRepoConfigFromStorage();
        const missingReason = getRepoConfigMissingReason(repoConfig);
        if (missingReason) {
            runtime.lastError = missingReason;
            saveRuntime();
            renderStatus();
            setFirstSyncStatus(textByLang(`首次同步未执行：${missingReason}`, `First sync skipped: ${missingReason}`), 'error');
            toast(textByLang(`首次同步未执行：${missingReason}`, `First sync skipped: ${missingReason}`));
            return;
        }

        runtime.isRunning = true;
        runtime.lastTrigger = trigger;
        runtime.lastSyncMode = 'first-sync';
        saveRuntime();
        renderStatus();
        setFirstSyncStatus(textByLang('首次同步进行中...', 'First sync is running...'), 'neutral');

        try {
            const preferredMode = ensureFirstSyncMode(settings.firstSyncMode);
            const remoteState = await readRemoteSnapshot();
            const remoteSnapshot = remoteState.notFound ? null : normalizeSnapshot(remoteState.snapshot || {});
            const remotePermanentTree = remoteSnapshot ? normalizeBookmarkTreeSnapshot(remoteSnapshot.permanentTreeSnapshot) : null;
            const hasRemotePermanentSnapshot = !!remotePermanentTree;

            const effectiveMode = resolveFirstSyncMode(preferredMode, hasRemotePermanentSnapshot);

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

                await initializeRemoteSnapshotFromLocal(hasRemotePermanentSnapshot ? 'first-sync-local-overwrite-cloud' : 'first-sync-local-bootstrap-cloud');

                runtime.lastSyncMode = 'first-sync-local';
                runtime.lastError = '';
                runtime.lastSuccessAt = Date.now();
                saveRuntime();
                renderStatus();

                setFirstSyncStatus(
                    hasRemotePermanentSnapshot
                        ? textByLang('首次同步完成：已按本地覆盖云端永久栏目', 'First sync completed: local permanent section overwrote cloud')
                        : textByLang('首次同步完成：检测到云端为空，已按本地初始化云端', 'First sync completed: cloud was empty, initialized from local'),
                    'ok'
                );
                toast(textByLang(
                    hasRemotePermanentSnapshot
                        ? '首次同步完成：已按本地覆盖云端永久栏目'
                        : '首次同步完成：云端为空，已按本地初始化',
                    hasRemotePermanentSnapshot
                        ? 'First sync completed: local overwrote cloud permanent section'
                        : 'First sync completed: cloud empty, initialized from local'
                ));
                return;
            }

            if (!hasRemotePermanentSnapshot) {
                throw new Error(textByLang(
                    '云端没有可用永久栏目快照，无法以云端为准。请改用“自动”或“以本地为准”。',
                    'Cloud has no permanent snapshot, cannot use cloud as source. Switch to "Auto" or "Use local".'
                ));
            }

            const stats = getBookmarkTreeStats(remotePermanentTree);
            if (!requestFirstSyncOverwriteConfirmation(stats)) {
                throw new Error(textByLang('已取消首次覆盖操作', 'First overwrite cancelled'));
            }

            const localBackupSnapshot = await buildLocalSnapshot('before-first-sync-overwrite', {
                includePermanentTree: true
            });
            backupSnapshotForRecovery(localBackupSnapshot, 'before-first-sync-cloud-overwrite');

            await overwriteLocalPermanentTreeFromSnapshot(remotePermanentTree);
            applySnapshotToLocal(remoteSnapshot);

            runtime.lastLocalHash = getSnapshotHash(remoteSnapshot);
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
        } catch (error) {
            runtime.lastError = error && error.message ? error.message : String(error);
            const isCanceled = /已取消首次覆盖操作|first overwrite cancelled/i.test(runtime.lastError);
            if (isCanceled) {
                runtime.lastError = '';
                setFirstSyncStatus(textByLang('首次同步已取消', 'First sync cancelled'), 'neutral');
            } else {
                setFirstSyncStatus(textByLang(`首次同步失败：${runtime.lastError}`, `First sync failed: ${runtime.lastError}`), 'error');
            }
            saveRuntime();
            renderStatus();
            if (!isCanceled) {
                toast(textByLang(`首次同步失败：${runtime.lastError}`, `First sync failed: ${runtime.lastError}`));
            }
        } finally {
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
            if (settings.enabled && settings.autoSync && !hasPendingConflict()) {
                runSync('full', 'retry');
            }
        }, delayMs);
    }

    function scheduleSync(reason, options = {}) {
        if (!settings.enabled || !settings.autoSync) return;
        if (hasPendingConflict()) return;
        if (getRepoConfigMissingReason(repoConfig || {})) return;

        runtime.lastLocalMutationAt = Date.now();

        pendingReasons.add(reason || 'unknown');
        runtime.queueLength = pendingReasons.size;
        saveRuntime();
        renderStatus();

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
                runSync('push', 'auto-push-interval');
            }, settings.autoPushIntervalMinutes * 60 * 1000);
        }

        if (settings.autoPullIntervalMinutes > 0) {
            autoPullTimer = setInterval(() => {
                if (hasPendingConflict()) return;
                runSync('pull', 'auto-pull-interval');
            }, settings.autoPullIntervalMinutes * 60 * 1000);
        }
    }

    function restartAutomationTimers() {
        restartFallbackTimer();
        restartPushPullTimers();
    }

    function scheduleStartupPull() {
        if (startupPullTimer) {
            clearTimeout(startupPullTimer);
            startupPullTimer = null;
        }
        if (!settings.enabled || !settings.autoSync) return;
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

        const targetTab = options && options.activeTab ? options.activeTab : activeTabKey;
        setActiveTab(targetTab, { persist: false });
        setFirstSyncFoldOpen(false);
        modal.style.display = 'block';

        global.requestAnimationFrame(() => {
            positionPanel();
        });

        loadRepoConfigFromStorage().catch((error) => {
            setRepoStatus(textByLang(`读取仓库配置失败：${error && error.message ? error.message : String(error)}`, `Failed to read repository configuration: ${error && error.message ? error.message : String(error)}`), 'error');
        });
    }

    function closePanel() {
        const modal = getElement('canvasSyncModal');
        if (!modal) return;
        modal.style.display = 'none';
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
                    await testRepoConfig(config);
                    const wasEnabled = await persistVerifiedRepoConfigAndEnableSync(config);

                    focusFirstSyncSetup();
                    toast(textByLang(
                        wasEnabled
                            ? '保存并测试成功，已跳转到首次同步策略'
                            : '保存并测试成功，已启用同步并跳转到首次同步策略',
                        wasEnabled
                            ? 'Saved and tested successfully, redirected to first sync strategy'
                            : 'Saved and tested successfully, sync enabled and redirected to first sync strategy'
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
                    await testRepoConfig(config);
                    const wasEnabled = await persistVerifiedRepoConfigAndEnableSync(config);
                    focusFirstSyncSetup();

                    toast(textByLang(
                        wasEnabled
                            ? '仓库连接测试成功'
                            : '仓库连接测试成功，已自动启用同步',
                        wasEnabled
                            ? 'Repository connection test succeeded'
                            : 'Repository connection test succeeded, sync has been enabled automatically'
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
            'canvasSyncIntervalInput',
            'canvasSyncSplitIntervalsToggle',
            'canvasSyncFirstSyncModeAutoInput',
            'canvasSyncFirstSyncModeCloudInput',
            'canvasSyncFirstSyncModeLocalInput',
            'canvasSyncPermanentTreeIntervalSelect',
            'canvasSyncAutoPushIntervalInput',
            'canvasSyncAutoPullIntervalInput',
            'canvasSyncPullOnStartupToggle',
            'canvasSyncPushOnSyncToggle',
            'canvasSyncPullOnSyncToggle',
            'canvasSyncHideNoChangeNoticeToggle',
            'canvasSyncMethodSelect',
            'canvasSyncConflictSelect',
            'canvasSyncDeleteThresholdInput',
            'canvasSyncFilePathInput',
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
        if (syncNowBtn) syncNowBtn.addEventListener('click', () => runSync('full', 'manual'));

        const pushOnlyBtn = getElement('canvasSyncPushOnlyBtn');
        if (pushOnlyBtn) pushOnlyBtn.addEventListener('click', () => runSync('push', 'manual-push'));

        const pullOnlyBtn = getElement('canvasSyncPullOnlyBtn');
        if (pullOnlyBtn) pullOnlyBtn.addEventListener('click', () => runSync('pull', 'manual-pull'));

        const rebuildBtn = getElement('canvasSyncRebuildBtn');
        if (rebuildBtn) {
            rebuildBtn.addEventListener('click', () => {
                runtime = Object.assign({}, DEFAULT_RUNTIME);
                clearPendingConflict();
                localStorage.removeItem(OBSIDIAN_FILE_HASHES_KEY);
                saveRuntime();
                renderStatus();
                renderConflictPanel();
                toast(textByLang('同步状态已重建', 'Sync state rebuilt'));
            });
        }

        const firstSyncOverwriteBtn = getElement('canvasSyncFirstSyncOverwriteBtn');
        if (firstSyncOverwriteBtn) {
            firstSyncOverwriteBtn.addEventListener('click', async () => {
                pullSettingsFromForm();
                await runFirstSyncCloudOverwrite();
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
                toast(textByLang('冲突已保留，自动同步暂停，待你手动选择后恢复', 'Conflict kept. Auto sync is paused until you resolve it manually'));
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
            global.requestAnimationFrame(() => positionPanel());
        });

        global.addEventListener('online', () => {
            if (!settings.enabled || !settings.autoSync || hasPendingConflict()) return;
            scheduleSync('online', { immediate: true });
        });

        global.addEventListener('offline', () => {
            runtime.lastError = textByLang('当前离线，已暂停远端同步，恢复网络后自动重试', 'Offline now. Remote sync paused and will retry when network is back');
            saveRuntime();
            renderStatus();
        });
    }

    function init() {
        settings = loadSettings();
        runtime = loadRuntime();
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
    }

    const syncApi = {
        openPanel,
        closePanel,
        requestSyncNow: (trigger) => runSync('full', trigger || 'manual'),
        runFirstSyncCloudOverwrite,
        readRemoteSnapshotForImport,
        markDirty: (reason, options) => scheduleSync(reason || 'save', options || {}),
        getSettings: () => Object.assign({}, settings || loadSettings()),
        updateSettings: (patch) => {
            settings = Object.assign({}, settings || loadSettings(), patch || {});
            settings.conflictPolicy = ensureConflictPolicy(settings.conflictPolicy);
            settings.syncMethod = ensureSyncMethod(settings.syncMethod);
            settings.filePath = normalizeSyncPath(settings.filePath);
            settings.splitIntervalCommitAndSync = !!settings.splitIntervalCommitAndSync;
            settings.autoPushIntervalMinutes = normalizeIntervalMinutes(settings.autoPushIntervalMinutes, DEFAULT_SETTINGS.autoPushIntervalMinutes);
            settings.autoPullIntervalMinutes = normalizeIntervalMinutes(settings.autoPullIntervalMinutes, DEFAULT_SETTINGS.autoPullIntervalMinutes);
            settings.pullOnStartup = !!settings.pullOnStartup;
            settings.pushOnSync = settings.pushOnSync !== false;
            settings.pullOnSync = settings.pullOnSync !== false;
            settings.hideNoChangeNotice = !!settings.hideNoChangeNotice;
            settings.firstSyncMode = ensureFirstSyncMode(settings.firstSyncMode);
            settings.permanentTreeUploadIntervalSeconds = normalizePermanentTreeUploadIntervalSeconds(
                settings.permanentTreeUploadIntervalSeconds,
                DEFAULT_SETTINGS.permanentTreeUploadIntervalSeconds
            );
            settings.obsidianFilePushEnabled = settings.obsidianFilePushEnabled !== false;
            settings.obsidianExportFormat = normalizeObsidianExportFormat(
                settings.obsidianExportFormat,
                DEFAULT_SETTINGS.obsidianExportFormat
            );
            settings.obsidianExportRoot = normalizeObsidianExportRoot(
                settings.obsidianExportRoot,
                DEFAULT_SETTINGS.obsidianExportRoot
            );
            saveSettings();
            applySettingsToForm();
            restartAutomationTimers();
            scheduleStartupPull();
            renderStatus();
        }
    };

    global.CanvasObsidianGitSync = syncApi;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window);
