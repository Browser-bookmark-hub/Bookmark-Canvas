/**
 * Bookmark-Canvas: 浏览历史访问统计服务 (HistoryStatsService, schemaVersion: 4)
 *
 * 设计原则：
 * 1. 打开后空闲预热：打开画布后趁浏览器空闲加载快照与增量同步，数据无变化不写盘；搜索与右键文件夹「信息」按需对齐。
 * 2. 两段式瘦身长期账本：
 *    - archiveMap：超过 95 天滚动封存线的历史累计底数。
 *    - recentDayBuckets：近 95 天按 UTC 天分桶（dayNum -> canonicalUrl -> [visitCount, lastVisitTime]）。
 *    - variantsMap：顶层变体原始 URL 表（每规范化地址最多保留 15 个原始变体）。
 *    - missingSinceMap：移出书签白名单后的 30 天软保留宽限期记录，防止剪切/粘贴或误删恢复丢失老账。
 *    - urlMap：仅存在于内存的 O(1) 运行时投影（不落盘）。
 * 3. 统一明细汇总与去重：
 *    - 剔除 reload 与 auto_subframe；
 *    - 同规范化 URL 重定向链去重（referringVisitId 命中且时间差 < 500ms 仅保留链尾）；
 *    - 异常未来时间戳钳制至 anchorTime。
 * 4. 删除分级对账（沿用 background.js 500 条溢出阈值）：
 *    - allHistory (purged_at)：彻底清空并仅补拉 purgedAt 之后的新访问。
 *    - 溢出 > 500 条 (overflow_at)：保留 archiveMap 与 < rebuildStartDay 老桶，仅重算近 89 个完整天。
 *    - 零星删 URL (deleted_urls)：前台只读并在落盘后更新 synced_at 供后台裁剪已消费元组，命中账本且在 85 天护栏内的条目重算近端天桶。
 * 5. 单书签独立直查：右键单个书签「信息」绝不触发全库扫描，按「老账底数 + 近端实时 getVisits」精确合算。
 * 6. 多端防覆盖同步：BroadcastChannel('bcs_visit_stats_v4') + savedAt 写前对齐，避免主页面与侧边栏互相覆盖。
 */

(function (root) {
    'use strict';

    const DAY_MS = 864e5;
    const DEFAULT_HISTORY_DAYS = 90;
    const RECENT_REBUILD_DAYS = 89;
    const ARCHIVE_ROLLUP_DAYS = 95;
    const DELTA_OVERLAP_MS = DAY_MS;
    const DELTA_DIRECT_REBUILD_DAYS = 21;
    const UNBOOKMARKED_RETENTION_DAYS = 30;
    const UNBOOKMARKED_RETENTION_MS = UNBOOKMARKED_RETENTION_DAYS * DAY_MS;
    const OLD_LEDGER_PROTECT_DAYS = 85;
    const MAX_VARIANTS_PER_CANONICAL = 15;
    const REDIRECT_DEDUP_WINDOW_MS = 500;
    const WATERMARK_INTERVAL_MS = 30 * 1000;
    const WATERMARK_PERSIST_INTERVAL_MS = 60 * 60 * 1000;
    const IDLE_UNLOAD_MS = 10 * 60 * 1000;
    const SAVE_DEBOUNCE_MS = 500;
    const NEW_BOOKMARK_SEED_THRESHOLD = 50;
    const SMALL_TARGET_DIRECT_URLS_MAX = 3500;
    const HISTORY_SIZE_PROBE_LIMIT = 3000;
    const DIRECT_GETVISITS_URL_CAP = 10000;
    const GET_VISITS_BATCH_SIZE = 100;
    const HISTORY_SCAN_YIELD_INTERVAL = 250;
    const LONG_TASK_BUDGET_MS = 10;
    const SCHEMA_VERSION = 4;
    const BROADCAST_CHANNEL_NAME = 'bcs_visit_stats_v4';

    const STORAGE_KEY_PURGED_AT = 'canvas_history_purged_at';
    const STORAGE_KEY_OVERFLOW_AT = 'canvas_history_overflow_at';
    const STORAGE_KEY_DELETED_URLS = 'canvas_history_deleted_urls';
    const STORAGE_KEY_SYNCED_AT = 'canvas_history_stats_synced_at';

    const INSTANCE_ID = `hss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    let registeredBookmarkProvider = null;

    const internalCache = {
        archiveMap: null,        // Map<canonicalUrl, { visitCount, lastVisitTime, domain, title }>
        recentDayBuckets: null,  // Map<dayNum, Map<canonicalUrl, [visitCount, lastVisitTime]>>
        variantsMap: null,       // Map<canonicalUrl, Set<rawUrl>>
        missingSinceMap: null,   // Map<canonicalUrl, timestampMs>
        knownTargets: null,      // Set<canonicalUrl>
        urlMap: null,            // Map<canonicalUrl, { visitCount, lastVisitTime, domain, title }>
        lastSyncTime: 0,
        lastPurgedAt: 0,
        lastPersistedSyncTime: 0,
        lastKnownSavedAt: 0,
        peerLatestSavedAt: 0,
        staleByPeer: false,
        syncedWithCompleteWhitelist: false,
        hasUnsavedDataChanges: false,
        loadingPromise: null,
        idleUnloadTimer: null
    };

    let saveDebounceTimer = null;
    let persistWriteChain = Promise.resolve();
    let statsBroadcastChannel = null;

    function initBroadcastChannel() {
        if (statsBroadcastChannel) return statsBroadcastChannel;
        if (typeof BroadcastChannel !== 'function') return null;
        try {
            const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
            channel.addEventListener('message', (event) => {
                const data = event && event.data;
                if (!data || typeof data !== 'object') return;
                if (data.senderId === INSTANCE_ID) return;

                if (data.type === 'stats-snapshot-saved') {
                    const savedAt = Math.max(0, Number(data.savedAt) || 0);
                    if (savedAt > (internalCache.lastKnownSavedAt || 0)) {
                        internalCache.staleByPeer = true;
                        if (savedAt > (internalCache.peerLatestSavedAt || 0)) {
                            internalCache.peerLatestSavedAt = savedAt;
                        }
                    }
                } else if (data.type === 'stats-snapshot-cleared') {
                    internalCache.staleByPeer = true;
                }
            });
            statsBroadcastChannel = channel;
        } catch (_) {
            statsBroadcastChannel = null;
        }
        return statsBroadcastChannel;
    }

    initBroadcastChannel();

    function broadcastPeerNotice(payload) {
        const channel = initBroadcastChannel();
        if (!channel) return;
        try {
            channel.postMessage({
                ...payload,
                senderId: INSTANCE_ID
            });
        } catch (_) {}
    }

    function getChromeApi(namespace) {
        if (typeof chrome !== 'undefined' && (!namespace || chrome[namespace])) return chrome;
        if (typeof browser !== 'undefined' && (!namespace || browser[namespace])) return browser;
        return null;
    }

    function storageLocalGet(keys) {
        const api = getChromeApi('storage');
        if (!api?.storage?.local?.get) return Promise.resolve({});
        return new Promise((resolve) => {
            try {
                api.storage.local.get(keys, (res) => {
                    if (api.runtime?.lastError) {
                        resolve({});
                        return;
                    }
                    resolve(res || {});
                });
            } catch (_) {
                resolve({});
            }
        });
    }

    function storageLocalSet(values) {
        const api = getChromeApi('storage');
        if (!api?.storage?.local?.set || !values || typeof values !== 'object') return Promise.resolve(false);
        return new Promise((resolve) => {
            try {
                api.storage.local.set(values, () => {
                    resolve(!api.runtime?.lastError);
                });
            } catch (_) {
                resolve(false);
            }
        });
    }

    function historySearch(query) {
        const api = getChromeApi('history');
        if (!api?.history?.search) return Promise.resolve([]);
        return new Promise((resolve) => {
            try {
                api.history.search(query, (results) => {
                    if (api.runtime?.lastError) {
                        resolve([]);
                        return;
                    }
                    resolve(Array.isArray(results) ? results : []);
                });
            } catch (_) {
                resolve([]);
            }
        });
    }

    function historyGetVisits(url) {
        const api = getChromeApi('history');
        if (!api?.history?.getVisits || !url) return Promise.resolve([]);
        return new Promise((resolve) => {
            try {
                api.history.getVisits({ url }, (visits) => {
                    if (api.runtime?.lastError) {
                        resolve([]);
                        return;
                    }
                    resolve(Array.isArray(visits) ? visits : []);
                });
            } catch (_) {
                resolve([]);
            }
        });
    }

    function fetchBookmarkTree() {
        const api = getChromeApi('bookmarks');
        if (!api?.bookmarks?.getTree) return Promise.resolve(null);
        return new Promise((resolve) => {
            try {
                api.bookmarks.getTree((tree) => {
                    if (api.runtime?.lastError) {
                        resolve(null);
                        return;
                    }
                    resolve(Array.isArray(tree) ? tree : null);
                });
            } catch (_) {
                resolve(null);
            }
        });
    }

    async function yieldToMainThread() {
        try {
            if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
                await scheduler.yield();
                return;
            }
        } catch (_) {}
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    function getPerfNow() {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }

    function getDayNum(timestampMs) {
        return Math.floor(timestampMs / DAY_MS);
    }

    function getRebuildStartDay(anchorTime) {
        return Math.max(0, Math.floor((anchorTime - (DEFAULT_HISTORY_DAYS * DAY_MS)) / DAY_MS) + 1);
    }

    function getArchiveCutoffDay(anchorTime) {
        return Math.max(0, Math.floor((anchorTime - (ARCHIVE_ROLLUP_DAYS * DAY_MS)) / DAY_MS));
    }

    /**
     * 极速 URL 规范化解析器（生成协议无关的 Canonical Key）
     * 规则：
     * 1. http:// 与 https:// 统一剥离协议头，仅保留 cleanHost + pathname + search
     * 2. 域名去 www.，严格小写；路径去除结尾 /
     * 3. 剥离 utm_*、spm、from、ref、fbclid 等常见跟踪参数
     * 4. file:// 等特殊协议保留协议前缀
     */
    function parseCanonicalUrl(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return null;
        const trimmed = rawUrl.trim();
        if (!trimmed) return null;

        try {
            const u = new URL(trimmed);
            u.hash = '';

            const hostnameLower = (u.hostname || '').toLowerCase();
            const hostLower = (u.host || hostnameLower).toLowerCase();
            const cleanHost = hostLower.startsWith('www.') ? hostLower.slice(4) : hostLower;
            const domain = hostnameLower.startsWith('www.') ? hostnameLower.slice(4) : hostnameLower;

            if (u.search && (u.search.includes('utm_') || u.search.includes('spm') || u.search.includes('fbclid') ||
                u.search.includes('gclid') || u.search.includes('_ga') || u.search.includes('from=') || u.search.includes('ref=') || u.search.includes('feature='))) {
                const isCodeRepoHost = cleanHost === 'github.com' || cleanHost.endsWith('.github.com') || cleanHost === 'gitlab.com' || cleanHost.endsWith('.gitlab.com');
                const trackingParams = [
                    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
                    'spm', 'from', 'feature', 'fbclid', 'gclid', '_ga'
                ];
                if (!isCodeRepoHost) {
                    trackingParams.push('ref');
                }
                for (let i = 0; i < trackingParams.length; i++) {
                    u.searchParams.delete(trackingParams[i]);
                }
            }

            let path = u.pathname;
            if (path.length > 1 && path.endsWith('/')) {
                path = path.slice(0, -1);
            } else if (path === '/') {
                path = '';
            }
            const query = u.search ? u.search : '';

            let canonicalUrl = '';
            if (u.protocol === 'http:' || u.protocol === 'https:') {
                canonicalUrl = cleanHost + path + query;
            } else if (u.protocol === 'file:') {
                canonicalUrl = 'file://' + path + query;
            } else {
                canonicalUrl = (u.protocol ? u.protocol.toLowerCase() + '//' : '') + cleanHost + path + query;
            }

            return { canonicalUrl, domain };
        } catch (_) {
            let clean = trimmed.replace(/#.*$/, '');
            if (clean.length > 8 && clean.endsWith('/')) {
                clean = clean.slice(0, -1);
            }
            const canonicalUrl = clean.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
            let domain = '';
            try {
                domain = canonicalUrl.split('/')[0].split('?')[0].split(':')[0].toLowerCase();
            } catch (_) {}
            return { canonicalUrl, domain };
        }
    }

    function normalizeHistoryUrl(rawUrl) {
        const parsed = parseCanonicalUrl(rawUrl);
        return parsed ? parsed.canonicalUrl : '';
    }

    function extractHostname(url) {
        const parsed = parseCanonicalUrl(url);
        return parsed ? parsed.domain : '';
    }

    /**
     * 过滤无效访问并执行同规范化 URL 重定向链去重，再按 UTC 天分桶汇总
     */
    function dedupeAndBucketVisits(visitLists, anchorTime = Date.now(), minVisitTime = 0) {
        const safeMinTime = Math.max(0, Number(minVisitTime) || 0);
        const visitById = new Map();
        const untrackedVisits = [];

        for (let l = 0; l < visitLists.length; l++) {
            const visits = visitLists[l];
            if (!Array.isArray(visits)) continue;
            for (let i = 0; i < visits.length; i++) {
                const v = visits[i];
                if (!v || v.transition === 'reload' || v.transition === 'auto_subframe') continue;
                const vt = Number(v.visitTime);
                if (!(vt > 0) || !Number.isFinite(vt)) continue;
                if (safeMinTime > 0 && vt < safeMinTime) continue;

                const rawVisitId = v.visitId;
                const visitId = (rawVisitId !== undefined && rawVisitId !== null && String(rawVisitId) !== '' && String(rawVisitId) !== '0')
                    ? String(rawVisitId)
                    : '';

                if (visitId) {
                    if (!visitById.has(visitId)) {
                        visitById.set(visitId, v);
                    }
                } else {
                    untrackedVisits.push(v);
                }
            }
        }

        const supersededVisitIds = new Set();
        for (const [visitId, v] of visitById.entries()) {
            const rawRefId = v.referringVisitId;
            const refId = (rawRefId !== undefined && rawRefId !== null && String(rawRefId) !== '' && String(rawRefId) !== '0')
                ? String(rawRefId)
                : '';
            if (!refId || refId === visitId) continue;

            const parent = visitById.get(refId);
            if (!parent) continue;

            const dt = Math.abs(Number(v.visitTime) - Number(parent.visitTime));
            if (dt < REDIRECT_DEDUP_WINDOW_MS) {
                supersededVisitIds.add(refId);
            }
        }

        const dayBuckets = new Map();
        let totalCount = 0;
        let maxTime = 0;

        const recordValidVisit = (v) => {
            const clampedTime = Math.min(Number(v.visitTime), anchorTime);
            if (!(clampedTime > 0) || !Number.isFinite(clampedTime)) return;
            const dayNum = Math.max(0, getDayNum(clampedTime));
            let tuple = dayBuckets.get(dayNum);
            if (!tuple) {
                tuple = [0, 0];
                dayBuckets.set(dayNum, tuple);
            }
            tuple[0] += 1;
            if (clampedTime > tuple[1]) {
                tuple[1] = clampedTime;
            }
            totalCount += 1;
            if (clampedTime > maxTime) {
                maxTime = clampedTime;
            }
        };

        for (const [visitId, v] of visitById.entries()) {
            if (supersededVisitIds.has(visitId)) continue;
            recordValidVisit(v);
        }
        for (let i = 0; i < untrackedVisits.length; i++) {
            recordValidVisit(untrackedVisits[i]);
        }

        return { dayBuckets, totalCount, maxTime };
    }

    async function collectBucketedVisitsForCanonical(rawUrls, anchorTime = Date.now(), minVisitTime = 0) {
        const uniqueUrls = Array.from(new Set(
            (Array.isArray(rawUrls) ? rawUrls : [rawUrls])
                .filter((u) => typeof u === 'string' && u.length > 0)
        ));
        if (uniqueUrls.length === 0) {
            return { dayBuckets: new Map(), totalCount: 0, maxTime: 0 };
        }
        const visitLists = await Promise.all(uniqueUrls.map((url) => historyGetVisits(url)));
        return dedupeAndBucketVisits(visitLists, anchorTime, minVisitTime);
    }

    function scheduleIdleUnload() {
        if (internalCache.idleUnloadTimer) {
            clearTimeout(internalCache.idleUnloadTimer);
            internalCache.idleUnloadTimer = null;
        }
        internalCache.idleUnloadTimer = setTimeout(() => {
            if (typeof document !== 'undefined') {
                const panel = document.getElementById('searchResultsPanel') || document.querySelector('.search-results-panel');
                if (panel && (panel.classList.contains('visible') || (panel.style && panel.style.display !== 'none' && panel.style.display !== ''))) {
                    scheduleIdleUnload();
                    return;
                }
            }
            releaseMemory();
        }, IDLE_UNLOAD_MS);
    }

    function touchMemory() {
        if (internalCache.urlMap instanceof Map) {
            scheduleIdleUnload();
        }
    }

    function dispatchStatsUpdatedEvent() {
        if (typeof window === 'undefined') return;
        try {
            const EventCtor = window.CustomEvent || (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
            if (typeof EventCtor === 'function' && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new EventCtor('canvas-history-stats-updated'));
            }
        } catch (_) {}
    }

    function extractBookmarkRawUrl(item) {
        if (!item) return '';
        return item.url || item.__url || (item.rawItem && (item.rawItem.url || item.rawItem.__url)) || '';
    }

    function extractBookmarkTitle(item) {
        if (!item) return '';
        return item.title || item.__title || (item.rawItem && (item.rawItem.title || item.rawItem.__title)) || '';
    }

    /**
     * 提取文件夹或节点下的所有叶子书签（显式栈，O(N) 极速展开）
     */
    function extractLeafBookmarks(node, maxLeaves = Infinity) {
        const leaves = [];
        if (!node) return leaves;

        const stack = [node];
        while (stack.length > 0 && leaves.length < maxLeaves) {
            const curr = stack.pop();
            if (!curr) continue;

            const url = extractBookmarkRawUrl(curr);
            if (url) {
                leaves.push({
                    id: curr.id,
                    title: extractBookmarkTitle(curr),
                    url
                });
            }

            const children = curr.children || (curr.rawItem && curr.rawItem.children);
            if (Array.isArray(children)) {
                for (let i = children.length - 1; i >= 0; i--) {
                    stack.push(children[i]);
                }
            }
        }
        return leaves;
    }

    function indexBookmarkList(list, targetSet, entriesByCanonical, rawUrlsByCanonical) {
        if (!Array.isArray(list)) return;
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const rawUrl = extractBookmarkRawUrl(item);
            if (!rawUrl) continue;
            const parsed = parseCanonicalUrl(rawUrl);
            if (!parsed || !parsed.canonicalUrl) continue;

            const canonicalUrl = parsed.canonicalUrl;
            targetSet.add(canonicalUrl);

            let rawSet = rawUrlsByCanonical.get(canonicalUrl);
            if (!rawSet) {
                rawSet = new Set();
                rawUrlsByCanonical.set(canonicalUrl, rawSet);
            }
            rawSet.add(rawUrl);

            if (!entriesByCanonical.has(canonicalUrl)) {
                entriesByCanonical.set(canonicalUrl, {
                    canonicalUrl,
                    parsed,
                    url: rawUrl,
                    title: extractBookmarkTitle(item)
                });
            }
        }
    }

    function isTempSectionsReady() {
        try {
            if (typeof isCanvasSearchStateReady === 'function') {
                return isCanvasSearchStateReady() === true;
            }
            if (typeof window !== 'undefined' && window.__bookmarkCanvasSearchStateReady === true) {
                return true;
            }
            const hasCanvasLifecycle = (typeof window !== 'undefined' && (window.CanvasModule?.CanvasState || window.SearchIndexDb))
                || typeof CanvasState !== 'undefined';
            if (!hasCanvasLifecycle && typeof registeredBookmarkProvider === 'function') {
                return true;
            }
        } catch (_) {}
        return false;
    }

    function appendTempSectionsToBookmarkIndex(targetSet, entriesByCanonical, rawUrlsByCanonical) {
        try {
            const activeState = (typeof getActiveCanvasState === 'function' ? getActiveCanvasState() : null)
                || (typeof window !== 'undefined' && window.CanvasModule?.CanvasState)
                || (typeof CanvasState !== 'undefined' ? CanvasState : null);
            const sections = Array.isArray(activeState?.tempSections) ? activeState.tempSections : [];
            for (let i = 0; i < sections.length; i++) {
                const sec = sections[i];
                if (!sec) continue;
                const items = Array.isArray(sec.items) ? sec.items : (Array.isArray(sec.children) ? sec.children : []);
                if (items.length > 0) {
                    const leaves = extractLeafBookmarks({ children: items });
                    indexBookmarkList(leaves, targetSet, entriesByCanonical, rawUrlsByCanonical);
                }
            }
        } catch (_) {}
    }

    /**
     * 从权威数据源解析实时全量书签白名单（优先实时 chrome.bookmarks.getTree + 临时栏目，回退 cachedCurrentTree）
     * 双源完整性判定：仅当永久书签树成功返回且临时栏目已完成 BCS 初始化时，isCompleteWhitelist 才为 true。
     */
    async function resolveLiveBookmarkData() {
        const targetSet = new Set();
        const entriesByCanonical = new Map();
        const rawUrlsByCanonical = new Map();
        let hasAuthoritativeTree = false;
        let hasPermanentTree = false;

        const fetchedTree = await fetchBookmarkTree();
        if (fetchedTree && fetchedTree[0]) {
            hasAuthoritativeTree = true;
            hasPermanentTree = true;
            indexBookmarkList(extractLeafBookmarks(fetchedTree[0]), targetSet, entriesByCanonical, rawUrlsByCanonical);
        } else {
            const envTree = (typeof cachedCurrentTree !== 'undefined' && Array.isArray(cachedCurrentTree))
                ? cachedCurrentTree
                : ((typeof window !== 'undefined' && Array.isArray(window.cachedCurrentTree)) ? window.cachedCurrentTree : null);

            if (envTree && envTree[0]) {
                hasAuthoritativeTree = true;
                hasPermanentTree = true;
                indexBookmarkList(extractLeafBookmarks(envTree[0]), targetSet, entriesByCanonical, rawUrlsByCanonical);
            } else if (typeof registeredBookmarkProvider === 'function') {
                const provided = registeredBookmarkProvider();
                if (Array.isArray(provided) && provided.length > 0) {
                    hasAuthoritativeTree = true;
                    indexBookmarkList(provided, targetSet, entriesByCanonical, rawUrlsByCanonical);
                }
            }
        }

        appendTempSectionsToBookmarkIndex(targetSet, entriesByCanonical, rawUrlsByCanonical);
        const tempReady = isTempSectionsReady();
        const isCompleteWhitelist = Boolean(hasPermanentTree && tempReady);

        return {
            targetSet,
            entriesByCanonical,
            rawUrlsByCanonical,
            hasAuthoritativeTree,
            hasPermanentTree,
            isCompleteWhitelist
        };
    }

    function registerBookmarkProvider(provider) {
        if (typeof provider === 'function') {
            registeredBookmarkProvider = provider;
        }
    }

    function createEmptyLedgerState() {
        return {
            archiveMap: new Map(),
            recentDayBuckets: new Map(),
            variantsMap: new Map(),
            missingSinceMap: new Map(),
            knownTargets: new Set(),
            urlMap: new Map(),
            lastSyncTime: 0,
            lastPurgedAt: 0,
            lastPersistedSyncTime: 0,
            lastKnownSavedAt: 0,
            syncedWithCompleteWhitelist: false,
            hasUnsavedDataChanges: false
        };
    }

    function addVariantsForCanonical(variantsMap, canonicalUrl, rawUrls) {
        if (!(variantsMap instanceof Map) || !canonicalUrl || !rawUrls) return false;
        let set = variantsMap.get(canonicalUrl);
        let added = false;
        const list = Array.isArray(rawUrls) ? rawUrls : (rawUrls instanceof Set ? Array.from(rawUrls) : [rawUrls]);
        for (let i = 0; i < list.length; i++) {
            const u = list[i];
            if (typeof u !== 'string' || !u) continue;
            if (!set) {
                set = new Set();
                variantsMap.set(canonicalUrl, set);
            }
            if (set.has(u)) continue;
            if (set.size >= MAX_VARIANTS_PER_CANONICAL) break;
            set.add(u);
            added = true;
        }
        return added;
    }

    function collectCandidateUrlsForCanonical(state, canonicalUrl, liveData = null, extraRawUrls = null) {
        const set = new Set();
        const addAll = (items) => {
            if (!items) return;
            for (const u of items) {
                if (typeof u === 'string' && u) set.add(u);
            }
        };
        if (liveData?.rawUrlsByCanonical instanceof Map) {
            addAll(liveData.rawUrlsByCanonical.get(canonicalUrl));
        }
        if (state?.variantsMap instanceof Map) {
            addAll(state.variantsMap.get(canonicalUrl));
        }
        if (extraRawUrls) {
            addAll(Array.isArray(extraRawUrls) || extraRawUrls instanceof Set ? extraRawUrls : [extraRawUrls]);
        }
        return Array.from(set);
    }

    function clearCanonicalRecentBuckets(recentDayBuckets, canonicalUrl, minDayNum = 0) {
        if (!(recentDayBuckets instanceof Map) || !canonicalUrl) return false;
        let removed = false;
        for (const [dayNum, dayMap] of recentDayBuckets.entries()) {
            if (dayNum < minDayNum) continue;
            if (dayMap.delete(canonicalUrl)) {
                removed = true;
                if (dayMap.size === 0) {
                    recentDayBuckets.delete(dayNum);
                }
            }
        }
        return removed;
    }

    function addBucketToDayMap(recentDayBuckets, dayNum, canonicalUrl, count, maxTime) {
        if (!(count > 0) || !canonicalUrl) return;
        let dayMap = recentDayBuckets.get(dayNum);
        if (!dayMap) {
            dayMap = new Map();
            recentDayBuckets.set(dayNum, dayMap);
        }
        const prev = dayMap.get(canonicalUrl);
        if (!prev) {
            dayMap.set(canonicalUrl, [count, maxTime]);
        } else {
            prev[0] += count;
            if (maxTime > prev[1]) prev[1] = maxTime;
        }
    }

    function addArchiveCount(archiveMap, canonicalUrl, count, maxTime, domain = '', title = '') {
        if (!(count > 0) || !canonicalUrl) return;
        let entry = archiveMap.get(canonicalUrl);
        if (!entry) {
            archiveMap.set(canonicalUrl, {
                visitCount: count,
                lastVisitTime: maxTime,
                domain: domain || extractHostname(canonicalUrl),
                title: typeof title === 'string' ? title : ''
            });
        } else {
            entry.visitCount += count;
            if (maxTime > entry.lastVisitTime) entry.lastVisitTime = maxTime;
            if (!entry.domain && domain) entry.domain = domain;
            if (!entry.title && title) entry.title = title;
        }
    }

    function writeBucketsForCanonical(state, canonicalUrl, dayBuckets, {
        minDayNum = 0,
        archiveCutoffDay = 0,
        allowArchiveWrite = false,
        domain = '',
        title = ''
    } = {}) {
        if (!(dayBuckets instanceof Map) || dayBuckets.size === 0) return false;
        let wrote = false;
        for (const [dayNum, tuple] of dayBuckets.entries()) {
            if (dayNum < minDayNum) continue;
            const count = Math.max(0, Math.floor(Number(tuple?.[0]) || 0));
            const maxTime = Math.max(0, Number(tuple?.[1]) || 0);
            if (count <= 0) continue;

            if (dayNum < archiveCutoffDay) {
                if (allowArchiveWrite) {
                    addArchiveCount(state.archiveMap, canonicalUrl, count, maxTime, domain, title);
                    wrote = true;
                }
            } else {
                addBucketToDayMap(state.recentDayBuckets, dayNum, canonicalUrl, count, maxTime);
                wrote = true;
            }
        }
        return wrote;
    }

    function rollupExpiredDayBuckets(state, archiveCutoffDay, liveData = null) {
        if (!(state.recentDayBuckets instanceof Map) || state.recentDayBuckets.size === 0) return false;
        let rolledUp = false;
        for (const [dayNum, dayMap] of Array.from(state.recentDayBuckets.entries())) {
            if (dayNum >= archiveCutoffDay) continue;
            for (const [canonicalUrl, tuple] of dayMap.entries()) {
                const count = Math.max(0, Math.floor(Number(tuple?.[0]) || 0));
                const maxTime = Math.max(0, Number(tuple?.[1]) || 0);
                if (count <= 0) continue;
                const liveEntry = liveData?.entriesByCanonical?.get(canonicalUrl);
                addArchiveCount(
                    state.archiveMap,
                    canonicalUrl,
                    count,
                    maxTime,
                    liveEntry?.parsed?.domain || '',
                    liveEntry?.title || ''
                );
            }
            state.recentDayBuckets.delete(dayNum);
            rolledUp = true;
        }
        return rolledUp;
    }

    function hasCanonicalInBucketRange(recentDayBuckets, canonicalUrl, minDayNum = 0, maxDayNum = Infinity) {
        if (!(recentDayBuckets instanceof Map) || !canonicalUrl) return false;
        for (const [dayNum, dayMap] of recentDayBuckets.entries()) {
            if (dayNum < minDayNum || dayNum > maxDayNum) continue;
            const tuple = dayMap.get(canonicalUrl);
            if (tuple && Number(tuple[0]) > 0) return true;
        }
        return false;
    }

    function getLedgerMaxLastVisitTime(state, canonicalUrl) {
        let maxTime = 0;
        const archived = state.archiveMap?.get(canonicalUrl);
        if (archived && archived.lastVisitTime > maxTime) {
            maxTime = archived.lastVisitTime;
        }
        if (state.recentDayBuckets instanceof Map) {
            for (const dayMap of state.recentDayBuckets.values()) {
                const tuple = dayMap.get(canonicalUrl);
                if (tuple && Number(tuple[1]) > maxTime) {
                    maxTime = Number(tuple[1]);
                }
            }
        }
        return maxTime;
    }

    function hasLedgerEntry(state, canonicalUrl) {
        if (!state || !canonicalUrl) return false;
        if (state.archiveMap instanceof Map && state.archiveMap.has(canonicalUrl)) return true;
        if (state.recentDayBuckets instanceof Map) {
            for (const dayMap of state.recentDayBuckets.values()) {
                if (dayMap.has(canonicalUrl)) return true;
            }
        }
        return false;
    }

    function collectAllLedgerCanonicals(state) {
        const all = new Set();
        if (state.archiveMap instanceof Map) {
            for (const key of state.archiveMap.keys()) all.add(key);
        }
        if (state.recentDayBuckets instanceof Map) {
            for (const dayMap of state.recentDayBuckets.values()) {
                for (const key of dayMap.keys()) all.add(key);
            }
        }
        if (state.variantsMap instanceof Map) {
            for (const key of state.variantsMap.keys()) all.add(key);
        }
        if (state.missingSinceMap instanceof Map) {
            for (const key of state.missingSinceMap.keys()) all.add(key);
        }
        return all;
    }

    function isCanonicalVisibleInProjection(state, canonicalUrl, liveData) {
        if (!canonicalUrl) return false;
        if (state.missingSinceMap?.has(canonicalUrl)) return false;
        if (!liveData) return true;
        if (liveData.isCompleteWhitelist) {
            return liveData.targetSet.has(canonicalUrl);
        }
        if (liveData.hasAuthoritativeTree) {
            return liveData.targetSet.has(canonicalUrl) || !state.missingSinceMap?.has(canonicalUrl);
        }
        return false;
    }

    function computeCanonicalTotals(state, canonicalUrl, liveData = null, titleHints = null) {
        let visitCount = 0;
        let lastVisitTime = 0;

        const archived = state.archiveMap?.get(canonicalUrl);
        if (archived) {
            visitCount += Math.max(0, Math.floor(Number(archived.visitCount) || 0));
            if (archived.lastVisitTime > lastVisitTime) {
                lastVisitTime = archived.lastVisitTime;
            }
        }

        if (state.recentDayBuckets instanceof Map) {
            for (const dayMap of state.recentDayBuckets.values()) {
                const tuple = dayMap.get(canonicalUrl);
                if (!tuple) continue;
                visitCount += Math.max(0, Math.floor(Number(tuple[0]) || 0));
                const vt = Number(tuple[1]) || 0;
                if (vt > lastVisitTime) lastVisitTime = vt;
            }
        }

        if (visitCount <= 0) return null;

        const liveEntry = liveData?.entriesByCanonical?.get(canonicalUrl);
        const domain = liveEntry?.parsed?.domain || archived?.domain || extractHostname(canonicalUrl);
        const title = liveEntry?.title || archived?.title || (titleHints?.get(canonicalUrl)) || '';
        return { visitCount, lastVisitTime, domain, title };
    }

    function recomputeProjectionForUrls(state, canonicalUrls, liveData = null, titleHints = null) {
        if (!(state.urlMap instanceof Map)) {
            state.urlMap = new Map();
        }
        for (const canonicalUrl of canonicalUrls) {
            if (!isCanonicalVisibleInProjection(state, canonicalUrl, liveData)) {
                state.urlMap.delete(canonicalUrl);
                continue;
            }
            const summary = computeCanonicalTotals(state, canonicalUrl, liveData, titleHints);
            if (summary && summary.visitCount > 0) {
                state.urlMap.set(canonicalUrl, summary);
            } else {
                state.urlMap.delete(canonicalUrl);
            }
        }
    }

    function rebuildAllUrlProjections(state, liveData = null, titleHints = null) {
        const nextUrlMap = new Map();
        const totalsByCanonical = new Map();

        if (state.archiveMap instanceof Map) {
            for (const [canonicalUrl, archived] of state.archiveMap.entries()) {
                if (!archived || !isCanonicalVisibleInProjection(state, canonicalUrl, liveData)) continue;
                const count = Math.max(0, Math.floor(Number(archived.visitCount) || 0));
                if (count <= 0) continue;
                totalsByCanonical.set(canonicalUrl, {
                    visitCount: count,
                    lastVisitTime: Math.max(0, Number(archived.lastVisitTime) || 0),
                    archived
                });
            }
        }

        if (state.recentDayBuckets instanceof Map) {
            for (const dayMap of state.recentDayBuckets.values()) {
                for (const [canonicalUrl, tuple] of dayMap.entries()) {
                    if (!isCanonicalVisibleInProjection(state, canonicalUrl, liveData)) continue;
                    const count = Math.max(0, Math.floor(Number(tuple?.[0]) || 0));
                    if (count <= 0) continue;
                    const vt = Math.max(0, Number(tuple?.[1]) || 0);
                    let agg = totalsByCanonical.get(canonicalUrl);
                    if (!agg) {
                        agg = {
                            visitCount: count,
                            lastVisitTime: vt,
                            archived: state.archiveMap?.get(canonicalUrl) || null
                        };
                        totalsByCanonical.set(canonicalUrl, agg);
                    } else {
                        agg.visitCount += count;
                        if (vt > agg.lastVisitTime) agg.lastVisitTime = vt;
                    }
                }
            }
        }

        for (const [canonicalUrl, agg] of totalsByCanonical.entries()) {
            const liveEntry = liveData?.entriesByCanonical?.get(canonicalUrl);
            const domain = liveEntry?.parsed?.domain || agg.archived?.domain || extractHostname(canonicalUrl);
            const title = liveEntry?.title || agg.archived?.title || (titleHints?.get(canonicalUrl)) || '';
            nextUrlMap.set(canonicalUrl, {
                visitCount: agg.visitCount,
                lastVisitTime: agg.lastVisitTime,
                domain,
                title
            });
        }

        state.urlMap = nextUrlMap;
        return nextUrlMap;
    }

    /**
     * 共享分批明细查询器（每批 100 条并发 getVisits，批间让出主线程防卡顿）
     */
    function syncVisitedVariantsAfterBucket(state, canonicalUrl, visitTotalCount, liveData = null, extraRaw = null) {
        if (!state || !canonicalUrl || !(state.variantsMap instanceof Map)) return;
        if (!hasLedgerEntry(state, canonicalUrl)) {
            state.variantsMap.delete(canonicalUrl);
            return;
        }
        if (liveData?.rawUrlsByCanonical instanceof Map) {
            addVariantsForCanonical(state.variantsMap, canonicalUrl, liveData.rawUrlsByCanonical.get(canonicalUrl));
        }
        if (visitTotalCount > 0 && extraRaw) {
            addVariantsForCanonical(state.variantsMap, canonicalUrl, extraRaw);
        }
    }

    async function queryAndApplyBucketedBatch(state, canonicalList, {
        anchorTime,
        minVisitTime = 0,
        minDayNum = 0,
        archiveCutoffDay = 0,
        allowArchiveWrite = false,
        clearMinDayNum = null,
        liveData = null,
        extraRawUrlsByCanonical = null,
        titleHints = null
    }) {
        if (!Array.isArray(canonicalList) || canonicalList.length === 0) return false;
        let changed = false;

        for (let start = 0; start < canonicalList.length; start += GET_VISITS_BATCH_SIZE) {
            const slice = canonicalList.slice(start, start + GET_VISITS_BATCH_SIZE);
            await Promise.all(slice.map(async (canonicalUrl) => {
                const extraRaw = extraRawUrlsByCanonical instanceof Map ? extraRawUrlsByCanonical.get(canonicalUrl) : null;
                const candidateUrls = collectCandidateUrlsForCanonical(state, canonicalUrl, liveData, extraRaw);

                if (clearMinDayNum !== null) {
                    if (clearCanonicalRecentBuckets(state.recentDayBuckets, canonicalUrl, clearMinDayNum)) {
                        changed = true;
                    }
                }

                if (candidateUrls.length === 0) {
                    if (!hasLedgerEntry(state, canonicalUrl)) {
                        state.variantsMap?.delete(canonicalUrl);
                    }
                    return;
                }
                const bucketed = await collectBucketedVisitsForCanonical(candidateUrls, anchorTime, minVisitTime);
                if (bucketed.totalCount > 0) {
                    const liveEntry = liveData?.entriesByCanonical?.get(canonicalUrl);
                    const wrote = writeBucketsForCanonical(state, canonicalUrl, bucketed.dayBuckets, {
                        minDayNum,
                        archiveCutoffDay,
                        allowArchiveWrite,
                        domain: liveEntry?.parsed?.domain || '',
                        title: liveEntry?.title || (titleHints?.get(canonicalUrl)) || ''
                    });
                    if (wrote) changed = true;
                }
                syncVisitedVariantsAfterBucket(state, canonicalUrl, bucketed.totalCount, liveData, extraRaw);
            }));

            if (start + GET_VISITS_BATCH_SIZE < canonicalList.length) {
                await yieldToMainThread();
            }
        }

        return changed;
    }

    async function seedCanonicalEntries(state, entries, {
        anchorTime,
        minVisitTime = 0,
        liveData = null,
        extraRawUrlsByCanonical = null,
        titleHints = null
    }) {
        if (!Array.isArray(entries) || entries.length === 0) return { changed: false, touched: [] };
        const archiveCutoffDay = getArchiveCutoffDay(anchorTime);
        const rebuildStartDay = getRebuildStartDay(anchorTime);
        let changed = false;
        const touched = [];

        for (let start = 0; start < entries.length; start += GET_VISITS_BATCH_SIZE) {
            const slice = entries.slice(start, start + GET_VISITS_BATCH_SIZE);
            await Promise.all(slice.map(async (item) => {
                const canonicalUrl = typeof item === 'string' ? item : item?.canonicalUrl;
                if (!canonicalUrl) return;
                const extraRaw = extraRawUrlsByCanonical instanceof Map ? extraRawUrlsByCanonical.get(canonicalUrl) : null;
                const candidateUrls = collectCandidateUrlsForCanonical(state, canonicalUrl, liveData, extraRaw);
                if (candidateUrls.length === 0) return;

                const bucketed = await collectBucketedVisitsForCanonical(candidateUrls, anchorTime, minVisitTime);
                const hasExistingArchive = state.archiveMap?.has(canonicalUrl)
                    || hasCanonicalInBucketRange(state.recentDayBuckets, canonicalUrl, 0, rebuildStartDay - 1);
                const seedMinDay = hasExistingArchive ? rebuildStartDay : 0;
                if (clearCanonicalRecentBuckets(state.recentDayBuckets, canonicalUrl, seedMinDay)) {
                    changed = true;
                }
                if (bucketed.totalCount > 0) {
                    const liveEntry = liveData?.entriesByCanonical?.get(canonicalUrl);
                    const entryObj = typeof item === 'object' ? item : null;
                    const domain = liveEntry?.parsed?.domain || entryObj?.parsed?.domain || extractHostname(canonicalUrl);
                    const title = liveEntry?.title || entryObj?.title || (titleHints?.get(canonicalUrl)) || '';
                    const wrote = writeBucketsForCanonical(state, canonicalUrl, bucketed.dayBuckets, {
                        minDayNum: seedMinDay,
                        archiveCutoffDay,
                        allowArchiveWrite: !hasExistingArchive,
                        domain,
                        title
                    });
                    if (wrote) changed = true;
                }
                syncVisitedVariantsAfterBucket(state, canonicalUrl, bucketed.totalCount, liveData, extraRaw);
                touched.push(canonicalUrl);
            }));

            if (start + GET_VISITS_BATCH_SIZE < entries.length) {
                await yieldToMainThread();
            }
        }

        return { changed, touched };
    }

    async function filterHistoryItemsToMatches(rawItems, targetSet) {
        const matchedCanonicals = new Set();
        const extraRawUrlsByCanonical = new Map();
        const titleHints = new Map();

        if (!Array.isArray(rawItems) || rawItems.length === 0 || !(targetSet instanceof Set) || targetSet.size === 0) {
            return { matchedCanonicals, extraRawUrlsByCanonical, titleHints };
        }

        // 大包反序列化后先让出一次主线程，避免 Mojo IPC 拆包与 JS 解析叠在同一帧
        if (rawItems.length >= 500) {
            await yieldToMainThread();
        }

        let deadline = getPerfNow() + LONG_TASK_BUDGET_MS;
        for (let i = 0; i < rawItems.length; i++) {
            const it = rawItems[i];
            if (it && it.url) {
                const parsed = parseCanonicalUrl(it.url);
                if (parsed && parsed.canonicalUrl && targetSet.has(parsed.canonicalUrl)) {
                    const canonicalUrl = parsed.canonicalUrl;
                    matchedCanonicals.add(canonicalUrl);
                    let rawSet = extraRawUrlsByCanonical.get(canonicalUrl);
                    if (!rawSet) {
                        rawSet = new Set();
                        extraRawUrlsByCanonical.set(canonicalUrl, rawSet);
                    }
                    rawSet.add(it.url);
                    if (typeof it.title === 'string' && it.title && !titleHints.has(canonicalUrl)) {
                        titleHints.set(canonicalUrl, it.title);
                    }
                }
            }
            if ((i + 1) % HISTORY_SCAN_YIELD_INTERVAL === 0 && getPerfNow() >= deadline) {
                await yieldToMainThread();
                deadline = getPerfNow() + LONG_TASK_BUDGET_MS;
            }
        }

        return { matchedCanonicals, extraRawUrlsByCanonical, titleHints };
    }

    async function scanHistoryMatches(targetSet, startTime, anchorTime) {
        if (!(targetSet instanceof Set) || targetSet.size === 0) {
            return { matchedCanonicals: new Set(), extraRawUrlsByCanonical: new Map(), titleHints: new Map() };
        }

        const clampedStart = Math.min(Math.max(0, Number(startTime) || 0), anchorTime);
        const rawItems = await historySearch({
            text: '',
            startTime: clampedStart,
            maxResults: 0
        });
        return filterHistoryItemsToMatches(rawItems, targetSet);
    }

    /**
     * 自适应双引擎扫描调度：小目标先 0.8ms 判空后直查 getVisits；大目标先做有限探针决定分批直查或全拉过滤
     */
    async function resolveAdaptiveHistoryScanPlan(state, targetCanonicals, scanStart, anchorTime, liveData = null) {
        const list = Array.isArray(targetCanonicals) ? targetCanonicals : Array.from(targetCanonicals || []);
        const targetSet = new Set();
        const distinctUrls = new Set();

        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const c = typeof item === 'string' ? item : item?.canonicalUrl;
            if (!c) continue;
            targetSet.add(c);
            const urls = collectCandidateUrlsForCanonical(state, c, liveData);
            for (let j = 0; j < urls.length; j++) {
                distinctUrls.add(urls[j]);
            }
        }

        const candidateUrlCount = distinctUrls.size;
        if (targetSet.size === 0 || candidateUrlCount === 0) {
            return {
                mode: 'empty',
                emptyHistory: true,
                targetSet,
                matchedCanonicals: new Set(),
                extraRawUrlsByCanonical: null,
                titleHints: new Map(),
                coveredAllTargets: true
            };
        }

        const clampedStart = Math.min(Math.max(0, Number(scanStart) || 0), anchorTime);

        if (candidateUrlCount <= SMALL_TARGET_DIRECT_URLS_MAX) {
            const probe = await historySearch({
                text: '',
                startTime: clampedStart,
                maxResults: 1
            });
            if (!Array.isArray(probe) || probe.length === 0) {
                return {
                    mode: 'empty',
                    emptyHistory: true,
                    targetSet,
                    matchedCanonicals: new Set(),
                    extraRawUrlsByCanonical: null,
                    titleHints: new Map(),
                    coveredAllTargets: true
                };
            }
            return {
                mode: 'direct-visits',
                emptyHistory: false,
                targetSet,
                matchedCanonicals: targetSet,
                extraRawUrlsByCanonical: null,
                titleHints: new Map(),
                coveredAllTargets: true
            };
        }

        const probe = await historySearch({
            text: '',
            startTime: clampedStart,
            maxResults: HISTORY_SIZE_PROBE_LIMIT
        });
        if (!Array.isArray(probe) || probe.length === 0) {
            return {
                mode: 'empty',
                emptyHistory: true,
                targetSet,
                matchedCanonicals: new Set(),
                extraRawUrlsByCanonical: null,
                titleHints: new Map(),
                coveredAllTargets: true
            };
        }

        if (probe.length < HISTORY_SIZE_PROBE_LIMIT) {
            const scan = await filterHistoryItemsToMatches(probe, targetSet);
            return {
                mode: 'filtered-matches',
                emptyHistory: false,
                targetSet,
                matchedCanonicals: scan.matchedCanonicals,
                extraRawUrlsByCanonical: scan.extraRawUrlsByCanonical,
                titleHints: scan.titleHints,
                coveredAllTargets: false
            };
        }

        if (candidateUrlCount <= DIRECT_GETVISITS_URL_CAP) {
            return {
                mode: 'direct-visits',
                emptyHistory: false,
                targetSet,
                matchedCanonicals: targetSet,
                extraRawUrlsByCanonical: null,
                titleHints: new Map(),
                coveredAllTargets: true
            };
        }

        const scan = await scanHistoryMatches(targetSet, clampedStart, anchorTime);
        return {
            mode: 'filtered-matches',
            emptyHistory: false,
            targetSet,
            matchedCanonicals: scan.matchedCanonicals,
            extraRawUrlsByCanonical: scan.extraRawUrlsByCanonical,
            titleHints: scan.titleHints,
            coveredAllTargets: false
        };
    }

    function collectRebuildTargetPlan(state, liveData) {
        const unionSet = new Set(liveData.targetSet);
        if (state.missingSinceMap instanceof Map) {
            for (const c of state.missingSinceMap.keys()) unionSet.add(c);
        }
        if (!liveData.isCompleteWhitelist && state.knownTargets instanceof Set) {
            for (const c of state.knownTargets) unionSet.add(c);
        }

        const queriableCanonicals = [];
        const queriableSet = new Set();
        const preserveBucketsCanonicals = new Set();
        const droppedUnknownTempCanonicals = [];

        for (const canonicalUrl of unionSet) {
            const urls = collectCandidateUrlsForCanonical(state, canonicalUrl, liveData);
            if (!liveData.isCompleteWhitelist && !liveData.targetSet.has(canonicalUrl) && urls.length === 0) {
                if (!hasLedgerEntry(state, canonicalUrl)) {
                    droppedUnknownTempCanonicals.push(canonicalUrl);
                } else {
                    preserveBucketsCanonicals.add(canonicalUrl);
                }
                continue;
            }
            if (urls.length === 0) {
                if (hasLedgerEntry(state, canonicalUrl)) {
                    preserveBucketsCanonicals.add(canonicalUrl);
                }
                continue;
            }
            queriableCanonicals.push(canonicalUrl);
            queriableSet.add(canonicalUrl);
        }

        return {
            queriableCanonicals,
            queriableSet,
            preserveBucketsCanonicals,
            droppedUnknownTempCanonicals
        };
    }

    function captureBucketRangeDigest(recentDayBuckets, minDayNum) {
        const digest = new Map();
        if (!(recentDayBuckets instanceof Map)) return digest;
        for (const [dayNum, dayMap] of recentDayBuckets.entries()) {
            if (dayNum < minDayNum) continue;
            const snap = new Map();
            for (const [k, tuple] of dayMap.entries()) {
                snap.set(k, [Number(tuple?.[0]) || 0, Math.round(Number(tuple?.[1]) || 0)]);
            }
            if (snap.size > 0) digest.set(dayNum, snap);
        }
        return digest;
    }

    function didBucketRangeDigestChange(beforeDigest, recentDayBuckets, minDayNum) {
        let afterDayCount = 0;
        if (recentDayBuckets instanceof Map) {
            for (const [dayNum, dayMap] of recentDayBuckets.entries()) {
                if (dayNum < minDayNum || !(dayMap instanceof Map) || dayMap.size === 0) continue;
                afterDayCount++;
                const beforeDay = beforeDigest.get(dayNum);
                if (!beforeDay || beforeDay.size !== dayMap.size) return true;
                for (const [k, tuple] of dayMap.entries()) {
                    const prev = beforeDay.get(k);
                    const c = Number(tuple?.[0]) || 0;
                    const t = Math.round(Number(tuple?.[1]) || 0);
                    if (!prev || prev[0] !== c || prev[1] !== t) return true;
                }
            }
        }
        return afterDayCount !== beforeDigest.size;
    }

    function buildSnapshotPayload(state, savedAtOverride = 0) {
        const archiveItems = [];
        if (state.archiveMap instanceof Map) {
            for (const [canonicalUrl, entry] of state.archiveMap.entries()) {
                if (!canonicalUrl || !entry) continue;
                const count = Math.max(0, Math.floor(Number(entry.visitCount) || 0));
                if (count <= 0) continue;
                archiveItems.push([
                    canonicalUrl,
                    count,
                    Math.max(0, Math.round(Number(entry.lastVisitTime) || 0)),
                    entry.domain || '',
                    typeof entry.title === 'string' ? entry.title.slice(0, 100) : ''
                ]);
            }
        }

        const dayBuckets = [];
        if (state.recentDayBuckets instanceof Map) {
            const sortedDays = Array.from(state.recentDayBuckets.keys()).sort((a, b) => a - b);
            for (let i = 0; i < sortedDays.length; i++) {
                const dayNum = sortedDays[i];
                const dayMap = state.recentDayBuckets.get(dayNum);
                if (!(dayMap instanceof Map) || dayMap.size === 0) continue;
                const rows = [];
                for (const [canonicalUrl, tuple] of dayMap.entries()) {
                    const count = Math.max(0, Math.floor(Number(tuple?.[0]) || 0));
                    if (!canonicalUrl || count <= 0) continue;
                    rows.push([
                        canonicalUrl,
                        count,
                        Math.max(0, Math.round(Number(tuple?.[1]) || 0))
                    ]);
                }
                if (rows.length > 0) {
                    dayBuckets.push([dayNum, rows]);
                }
            }
        }

        const variants = [];
        if (state.variantsMap instanceof Map) {
            for (const [canonicalUrl, rawSet] of state.variantsMap.entries()) {
                if (!canonicalUrl || !(rawSet instanceof Set) || rawSet.size === 0) continue;
                variants.push([canonicalUrl, Array.from(rawSet).slice(0, MAX_VARIANTS_PER_CANONICAL)]);
            }
        }

        const missingTargets = [];
        if (state.missingSinceMap instanceof Map) {
            for (const [canonicalUrl, missingSinceMs] of state.missingSinceMap.entries()) {
                const ts = Math.round(Number(missingSinceMs) || 0);
                if (canonicalUrl && ts > 0) {
                    missingTargets.push([canonicalUrl, ts]);
                }
            }
        }

        const knownTargets = state.knownTargets instanceof Set ? Array.from(state.knownTargets) : [];
        const syncTs = Math.max(0, Math.round(Number(state.lastSyncTime) || Date.now()));
        const lastPurgedAt = Math.max(0, Math.round(Number(state.lastPurgedAt) || 0));
        const savedAt = Math.max(Date.now(), Number(savedAtOverride) || 0);

        return {
            archiveItems,
            dayBuckets,
            variants,
            missingTargets,
            knownTargets,
            meta: {
                schemaVersion: SCHEMA_VERSION,
                lastSyncTime: syncTs,
                lastPurgedAt,
                savedAt,
                syncedWithCompleteWhitelist: Boolean(state.syncedWithCompleteWhitelist),
                archiveCount: archiveItems.length,
                bucketDaysCount: dayBuckets.length,
                knownTargetsCount: knownTargets.length
            }
        };
    }

    function isValidV4RawSnapshot(data) {
        return Boolean(
            data &&
            typeof data === 'object' &&
            data.meta &&
            typeof data.meta === 'object' &&
            Number(data.meta.schemaVersion) === SCHEMA_VERSION &&
            Array.isArray(data.archiveItems) &&
            Array.isArray(data.dayBuckets) &&
            Array.isArray(data.variants) &&
            Array.isArray(data.missingTargets) &&
            Array.isArray(data.knownTargets)
        );
    }

    function parseV4Snapshot(data) {
        if (!isValidV4RawSnapshot(data)) return null;

        const archiveMap = new Map();
        for (let i = 0; i < data.archiveItems.length; i++) {
            const row = data.archiveItems[i];
            if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0]) continue;
            const visitCount = Math.max(0, Math.floor(Number(row[1]) || 0));
            if (visitCount <= 0) continue;
            archiveMap.set(row[0], {
                visitCount,
                lastVisitTime: Math.max(0, Number(row[2]) || 0),
                domain: typeof row[3] === 'string' ? row[3] : '',
                title: typeof row[4] === 'string' ? row[4] : ''
            });
        }

        const recentDayBuckets = new Map();
        for (let i = 0; i < data.dayBuckets.length; i++) {
            const bucket = data.dayBuckets[i];
            if (!Array.isArray(bucket)) continue;
            const dayNum = Number(bucket[0]);
            const rows = bucket[1];
            if (!Number.isInteger(dayNum) || dayNum < 0 || !Array.isArray(rows)) continue;
            const dayMap = new Map();
            for (let j = 0; j < rows.length; j++) {
                const row = rows[j];
                if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0]) continue;
                const count = Math.max(0, Math.floor(Number(row[1]) || 0));
                if (count <= 0) continue;
                dayMap.set(row[0], [count, Math.max(0, Number(row[2]) || 0)]);
            }
            if (dayMap.size > 0) {
                recentDayBuckets.set(dayNum, dayMap);
            }
        }

        const variantsMap = new Map();
        for (let i = 0; i < data.variants.length; i++) {
            const row = data.variants[i];
            if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0] || !Array.isArray(row[1])) continue;
            addVariantsForCanonical(variantsMap, row[0], row[1]);
        }

        const missingSinceMap = new Map();
        for (let i = 0; i < data.missingTargets.length; i++) {
            const row = data.missingTargets[i];
            if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[0]) continue;
            const ts = Math.max(0, Number(row[1]) || 0);
            if (ts > 0) {
                missingSinceMap.set(row[0], ts);
            }
        }

        const knownTargets = new Set();
        for (let i = 0; i < data.knownTargets.length; i++) {
            const u = data.knownTargets[i];
            if (typeof u === 'string' && u) {
                knownTargets.add(u);
            }
        }

        const lastSyncTime = Math.max(0, Number(data.meta.lastSyncTime) || 0);
        const lastPurgedAt = Math.max(0, Number(data.meta.lastPurgedAt) || 0);
        const savedAt = Math.max(0, Number(data.meta.savedAt) || 0);

        return {
            archiveMap,
            recentDayBuckets,
            variantsMap,
            missingSinceMap,
            knownTargets,
            urlMap: null,
            lastSyncTime,
            lastPurgedAt,
            lastPersistedSyncTime: lastSyncTime,
            lastKnownSavedAt: savedAt,
            syncedWithCompleteWhitelist: Boolean(data.meta.syncedWithCompleteWhitelist),
            hasUnsavedDataChanges: false
        };
    }

    async function loadSnapshotFromStorage() {
        try {
            if (typeof window !== 'undefined' && typeof window.SearchIndexDb?.getBookmarkVisitStats === 'function') {
                const raw = await window.SearchIndexDb.getBookmarkVisitStats();
                return parseV4Snapshot(raw);
            }
        } catch (_) {}
        return null;
    }

    function mergeSeedAdditionsIntoPeerSnapshot(peerState, localState) {
        const anchorTime = Date.now();
        const archiveCutoffDay = getArchiveCutoffDay(anchorTime);
        const rebuildStartDay = getRebuildStartDay(anchorTime);
        const merged = {
            archiveMap: peerState.archiveMap,
            recentDayBuckets: peerState.recentDayBuckets,
            variantsMap: peerState.variantsMap,
            missingSinceMap: peerState.missingSinceMap,
            knownTargets: peerState.knownTargets,
            urlMap: peerState.urlMap,
            lastSyncTime: Math.max(peerState.lastSyncTime || 0, localState.lastSyncTime || 0),
            lastPurgedAt: Math.max(peerState.lastPurgedAt || 0, localState.lastPurgedAt || 0),
            lastPersistedSyncTime: peerState.lastPersistedSyncTime || 0,
            lastKnownSavedAt: peerState.lastKnownSavedAt || 0,
            syncedWithCompleteWhitelist: Boolean(peerState.syncedWithCompleteWhitelist),
            hasUnsavedDataChanges: Boolean(localState.hasUnsavedDataChanges)
        };

        if (merged.lastPurgedAt > (peerState.lastPurgedAt || 0)) {
            return localState;
        }

        if (localState.knownTargets instanceof Set) {
            for (const target of localState.knownTargets) {
                merged.knownTargets.add(target);
                merged.missingSinceMap.delete(target);
            }
        }
        if (localState.variantsMap instanceof Map) {
            for (const [canonicalUrl, rawSet] of localState.variantsMap.entries()) {
                addVariantsForCanonical(merged.variantsMap, canonicalUrl, rawSet);
            }
        }
        if (localState.archiveMap instanceof Map) {
            for (const [canonicalUrl, entry] of localState.archiveMap.entries()) {
                if (!merged.archiveMap.has(canonicalUrl) && entry && entry.visitCount > 0) {
                    merged.archiveMap.set(canonicalUrl, { ...entry });
                }
            }
        }
        if (localState.recentDayBuckets instanceof Map) {
            for (const [dayNum, dayMap] of localState.recentDayBuckets.entries()) {
                if (dayNum < archiveCutoffDay && dayNum < rebuildStartDay) continue;
                for (const [canonicalUrl, tuple] of dayMap.entries()) {
                    const count = Math.max(0, Math.floor(Number(tuple?.[0]) || 0));
                    const maxTime = Math.max(0, Number(tuple?.[1]) || 0);
                    if (count <= 0) continue;
                    const peerDayMap = merged.recentDayBuckets.get(dayNum);
                    const peerTuple = peerDayMap?.get(canonicalUrl);
                    if (!peerTuple || maxTime > (Number(peerTuple[1]) || 0)) {
                        if (!peerDayMap) {
                            const nextDayMap = new Map();
                            nextDayMap.set(canonicalUrl, [count, maxTime]);
                            merged.recentDayBuckets.set(dayNum, nextDayMap);
                        } else {
                            peerDayMap.set(canonicalUrl, [count, maxTime]);
                        }
                    }
                }
            }
        }
        return merged;
    }

    function commitReconciledState(state, nextSync) {
        internalCache.archiveMap = state.archiveMap;
        internalCache.recentDayBuckets = state.recentDayBuckets;
        internalCache.variantsMap = state.variantsMap;
        internalCache.missingSinceMap = state.missingSinceMap;
        internalCache.knownTargets = state.knownTargets;
        internalCache.urlMap = state.urlMap;
        internalCache.lastSyncTime = nextSync;
        internalCache.lastPurgedAt = Math.max(0, Number(state.lastPurgedAt) || 0);
        internalCache.staleByPeer = false;
        internalCache.hasUnsavedDataChanges = Boolean(state.hasUnsavedDataChanges);
        if (typeof state.syncedWithCompleteWhitelist === 'boolean') {
            internalCache.syncedWithCompleteWhitelist = state.syncedWithCompleteWhitelist;
        }
        if (typeof state.lastPersistedSyncTime === 'number' && state.lastPersistedSyncTime > (internalCache.lastPersistedSyncTime || 0)) {
            internalCache.lastPersistedSyncTime = state.lastPersistedSyncTime;
        }
        if (typeof state.lastKnownSavedAt === 'number' && state.lastKnownSavedAt > (internalCache.lastKnownSavedAt || 0)) {
            internalCache.lastKnownSavedAt = state.lastKnownSavedAt;
        }
    }

    function hasValidLedgerContainers(state) {
        return Boolean(
            state &&
            state.archiveMap instanceof Map &&
            state.recentDayBuckets instanceof Map &&
            state.variantsMap instanceof Map &&
            state.missingSinceMap instanceof Map &&
            state.knownTargets instanceof Set
        );
    }

    function persistSnapshotNow(stateToSave = internalCache, options = {}) {
        if (saveDebounceTimer) {
            clearTimeout(saveDebounceTimer);
            saveDebounceTimer = null;
        }
        if (!(stateToSave?.urlMap instanceof Map)) return Promise.resolve(false);
        if (typeof window === 'undefined' || typeof window.SearchIndexDb?.saveBookmarkVisitStats !== 'function') {
            return Promise.resolve(false);
        }

        const expectedSavedAt = Math.max(0, Number(options.expectedSavedAt ?? stateToSave.lastKnownSavedAt) || 0);
        const allowPeerRealign = options.allowPeerRealign !== false;
        const requireDataMutation = Boolean(options.requireDataMutation);

        persistWriteChain = persistWriteChain.then(async () => {
            if (typeof window === 'undefined' || typeof window.SearchIndexDb?.saveBookmarkVisitStats !== 'function') {
                return false;
            }

            let targetState = stateToSave;
            let latestRaw = null;
            if (typeof window.SearchIndexDb.getBookmarkVisitStats === 'function') {
                latestRaw = await window.SearchIndexDb.getBookmarkVisitStats();
            }
            if (!hasValidLedgerContainers(targetState)) {
                return false;
            }
            const latestSavedAt = Math.max(0, Number(latestRaw?.meta?.savedAt) || 0);

            if (latestSavedAt > expectedSavedAt) {
                if (requireDataMutation && !targetState.hasUnsavedDataChanges && !options.forceWrite) {
                    const peerState = parseV4Snapshot(latestRaw);
                    if (peerState) {
                        internalCache.staleByPeer = true;
                        internalCache.lastKnownSavedAt = latestSavedAt;
                    }
                    return false;
                }
                if (allowPeerRealign) {
                    const peerState = parseV4Snapshot(latestRaw);
                    if (peerState) {
                        if (typeof options.onPeerConflict === 'function') {
                            const realigned = await options.onPeerConflict(peerState);
                            if (realigned) {
                                targetState = realigned;
                            }
                        } else {
                            targetState = mergeSeedAdditionsIntoPeerSnapshot(peerState, targetState);
                            const liveData = await resolveLiveBookmarkData().catch(() => null);
                            rebuildAllUrlProjections(targetState, liveData);
                            if (targetState === internalCache || stateToSave === internalCache) {
                                commitReconciledState(targetState, targetState.lastSyncTime);
                                dispatchStatsUpdatedEvent();
                            }
                        }
                    }
                }
            }

            if (!hasValidLedgerContainers(targetState)) {
                return false;
            }

            const payload = buildSnapshotPayload(targetState, latestSavedAt + 1);
            const saved = await window.SearchIndexDb.saveBookmarkVisitStats(payload);
            if (!saved) return false;

            await storageLocalSet({ [STORAGE_KEY_SYNCED_AT]: payload.meta.lastSyncTime });

            const savedAt = payload.meta.savedAt;
            targetState.lastPersistedSyncTime = payload.meta.lastSyncTime;
            targetState.lastKnownSavedAt = savedAt;
            targetState.hasUnsavedDataChanges = false;
            if (targetState !== internalCache && internalCache.urlMap instanceof Map) {
                internalCache.lastPersistedSyncTime = payload.meta.lastSyncTime;
                internalCache.lastKnownSavedAt = savedAt;
                internalCache.hasUnsavedDataChanges = false;
            }
            if (savedAt > (internalCache.peerLatestSavedAt || 0)) {
                internalCache.peerLatestSavedAt = savedAt;
            }
            broadcastPeerNotice({
                type: 'stats-snapshot-saved',
                savedAt,
                lastSyncTime: payload.meta.lastSyncTime
            });
            return true;
        }).catch(() => false);

        return persistWriteChain;
    }

    function saveSnapshotToStorage(stateToSave = internalCache, options = {}) {
        if (options && options.immediate) {
            return persistSnapshotNow(stateToSave, options);
        }
        if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
        saveDebounceTimer = setTimeout(() => {
            saveDebounceTimer = null;
            persistSnapshotNow(internalCache, {
                expectedSavedAt: internalCache.lastKnownSavedAt,
                requireDataMutation: true
            }).catch(() => {});
        }, SAVE_DEBOUNCE_MS);
        return Promise.resolve();
    }

    function flushSavePending() {
        if (!saveDebounceTimer) return;
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = null;
        const detachedState = { ...internalCache };
        persistSnapshotNow(detachedState, {
            expectedSavedAt: detachedState.lastKnownSavedAt,
            requireDataMutation: true,
            allowPeerRealign: false
        }).catch(() => {});
    }

    function hasUnprocessedDeletionSignal(stored, lastSyncTime, state = internalCache) {
        if (!stored || typeof stored !== 'object') return false;
        const syncTs = Number(lastSyncTime) || 0;
        if ((Number(stored[STORAGE_KEY_PURGED_AT]) || 0) > syncTs) return true;
        if ((Number(stored[STORAGE_KEY_OVERFLOW_AT]) || 0) > syncTs) return true;
        const deletedUrls = stored[STORAGE_KEY_DELETED_URLS];
        if (Array.isArray(deletedUrls)) {
            for (let i = 0; i < deletedUrls.length; i++) {
                const item = deletedUrls[i];
                if (!Array.isArray(item) || (Number(item[1]) || 0) <= syncTs) continue;
                const canonicalUrl = normalizeHistoryUrl(item[0]);
                if (canonicalUrl && hasLedgerEntry(state, canonicalUrl)) return true;
            }
        }
        return false;
    }

    function cloneStateForStaging(source) {
        const archiveMap = new Map();
        if (source.archiveMap instanceof Map) {
            for (const [k, v] of source.archiveMap.entries()) {
                archiveMap.set(k, { ...v });
            }
        }
        const recentDayBuckets = new Map();
        if (source.recentDayBuckets instanceof Map) {
            for (const [dayNum, dayMap] of source.recentDayBuckets.entries()) {
                const clonedDayMap = new Map();
                for (const [k, tuple] of dayMap.entries()) {
                    clonedDayMap.set(k, [tuple[0], tuple[1]]);
                }
                recentDayBuckets.set(dayNum, clonedDayMap);
            }
        }
        const variantsMap = new Map();
        if (source.variantsMap instanceof Map) {
            for (const [k, set] of source.variantsMap.entries()) {
                variantsMap.set(k, new Set(set));
            }
        }
        const missingSinceMap = new Map(source.missingSinceMap instanceof Map ? source.missingSinceMap : undefined);
        const knownTargets = source.knownTargets instanceof Set ? new Set(source.knownTargets) : null;
        const urlMap = new Map();
        if (source.urlMap instanceof Map) {
            for (const [k, v] of source.urlMap.entries()) {
                urlMap.set(k, { ...v });
            }
        }
        return {
            archiveMap,
            recentDayBuckets,
            variantsMap,
            missingSinceMap,
            knownTargets,
            urlMap,
            lastSyncTime: source.lastSyncTime || 0,
            lastPurgedAt: source.lastPurgedAt || 0,
            lastPersistedSyncTime: source.lastPersistedSyncTime || 0,
            lastKnownSavedAt: source.lastKnownSavedAt || 0,
            syncedWithCompleteWhitelist: Boolean(source.syncedWithCompleteWhitelist),
            hasUnsavedDataChanges: Boolean(source.hasUnsavedDataChanges)
        };
    }

    async function runReconciliationPipeline(state, liveData, { anchorTime = Date.now(), skipStep3Seed = false } = {}) {
        const prevSyncTime = Number(state.lastSyncTime) || 0;
        const rebuildStartDay = getRebuildStartDay(anchorTime);
        const archiveCutoffDay = getArchiveCutoffDay(anchorTime);
        const expectedSavedAt = Number(state.lastKnownSavedAt) || 0;

        let dataChanged = false;
        let metaChanged = false;
        let forceImmediatePersist = false;
        const titleHints = new Map();

        // 第一步（铁律先执行）：先将 >= 95 天的老天桶滚动封存进 archiveMap，再进行任何对账或覆写
        if (rollupExpiredDayBuckets(state, archiveCutoffDay, liveData)) {
            dataChanged = true;
            metaChanged = true;
        }

        const stored = await storageLocalGet([
            STORAGE_KEY_PURGED_AT,
            STORAGE_KEY_OVERFLOW_AT,
            STORAGE_KEY_DELETED_URLS
        ]);

        const purgedAt = Math.max(0, Number(stored[STORAGE_KEY_PURGED_AT]) || 0);
        const overflowAt = Math.max(0, Number(stored[STORAGE_KEY_OVERFLOW_AT]) || 0);
        const deletedUrls = Array.isArray(stored[STORAGE_KEY_DELETED_URLS]) ? stored[STORAGE_KEY_DELETED_URLS] : [];

        let maxSeenDeletedTs = 0;
        for (let i = 0; i < deletedUrls.length; i++) {
            const ts = Array.isArray(deletedUrls[i]) ? (Number(deletedUrls[i][1]) || 0) : 0;
            if (ts > maxSeenDeletedTs) maxSeenDeletedTs = ts;
        }

        // 第二步：分级处理后台删除信号
        // 情况 A：清空全部历史 (allHistory: true -> purged_at)
        if (purgedAt > prevSyncTime) {
            state.archiveMap.clear();
            state.recentDayBuckets.clear();
            state.variantsMap.clear();
            state.missingSinceMap.clear();
            state.lastPurgedAt = purgedAt;
            state.knownTargets = new Set(liveData.targetSet);

            if (purgedAt < anchorTime && liveData.targetSet.size > 0) {
                const scan = await scanHistoryMatches(liveData.targetSet, purgedAt, anchorTime);
                for (const [k, t] of scan.titleHints.entries()) titleHints.set(k, t);
                if (scan.matchedCanonicals.size > 0) {
                    await queryAndApplyBucketedBatch(state, Array.from(scan.matchedCanonicals), {
                        anchorTime,
                        minVisitTime: purgedAt,
                        minDayNum: 0,
                        archiveCutoffDay,
                        allowArchiveWrite: true,
                        liveData,
                        extraRawUrlsByCanonical: scan.extraRawUrlsByCanonical,
                        titleHints
                    });
                }
            }

            state.syncedWithCompleteWhitelist = Boolean(liveData.isCompleteWhitelist);
            rebuildAllUrlProjections(state, liveData, titleHints);
            const nextSync = Math.max(anchorTime, purgedAt, overflowAt, maxSeenDeletedTs);
            state.hasUnsavedDataChanges = true;
            return {
                state,
                nextSync,
                dataChanged: true,
                metaChanged: true,
                forceImmediatePersist: true,
                expectedSavedAt
            };
        }

        const minVisitTime = Math.max(0, Number(state.lastPurgedAt) || 0);
        const isLongGapDelta = prevSyncTime > 0 && (anchorTime - prevSyncTime) >= (DELTA_DIRECT_REBUILD_DAYS * DAY_MS);
        let ranFull90dScan = false;
        let queriedInCaseB = null;

        // 情况 B：大批量删除溢出 > 500 条 (overflow_at) 或滞留 >= 21 天触发自适应近 89 天重建
        if (overflowAt > prevSyncTime || isLongGapDelta) {
            const rebuildPlan = collectRebuildTargetPlan(state, liveData);
            if (rebuildPlan.droppedUnknownTempCanonicals.length > 0 && state.knownTargets instanceof Set) {
                for (let i = 0; i < rebuildPlan.droppedUnknownTempCanonicals.length; i++) {
                    state.knownTargets.delete(rebuildPlan.droppedUnknownTempCanonicals[i]);
                }
                metaChanged = true;
            }

            const beforeDigest = overflowAt > prevSyncTime
                ? null
                : captureBucketRangeDigest(state.recentDayBuckets, rebuildStartDay);

            for (const [dayNum, dayMap] of Array.from(state.recentDayBuckets.entries())) {
                if (dayNum < rebuildStartDay) continue;
                if (liveData.isCompleteWhitelist && rebuildPlan.preserveBucketsCanonicals.size === 0) {
                    state.recentDayBuckets.delete(dayNum);
                } else {
                    for (const key of Array.from(dayMap.keys())) {
                        if (rebuildPlan.preserveBucketsCanonicals.has(key)) continue;
                        if (liveData.isCompleteWhitelist || rebuildPlan.queriableSet.has(key) || !state.knownTargets?.has(key)) {
                            dayMap.delete(key);
                        }
                    }
                    if (dayMap.size === 0) {
                        state.recentDayBuckets.delete(dayNum);
                    }
                }
            }

            queriedInCaseB = new Set();
            if (rebuildPlan.queriableCanonicals.length > 0) {
                const scanStart = Math.max(0, anchorTime - (DEFAULT_HISTORY_DAYS * DAY_MS), minVisitTime);
                const plan = await resolveAdaptiveHistoryScanPlan(
                    state,
                    rebuildPlan.queriableCanonicals,
                    scanStart,
                    anchorTime,
                    liveData
                );
                for (const [k, t] of plan.titleHints.entries()) titleHints.set(k, t);

                if (plan.emptyHistory) {
                    if (state.variantsMap instanceof Map) {
                        for (const canonicalUrl of rebuildPlan.queriableSet) {
                            if (!hasLedgerEntry(state, canonicalUrl)) {
                                state.variantsMap.delete(canonicalUrl);
                            }
                        }
                    }
                    queriedInCaseB = new Set(liveData.targetSet);
                } else if (plan.matchedCanonicals.size > 0) {
                    await queryAndApplyBucketedBatch(state, Array.from(plan.matchedCanonicals), {
                        anchorTime,
                        minVisitTime,
                        minDayNum: rebuildStartDay,
                        archiveCutoffDay,
                        allowArchiveWrite: false,
                        liveData,
                        extraRawUrlsByCanonical: plan.extraRawUrlsByCanonical,
                        titleHints
                    });
                    if (plan.mode === 'filtered-matches' && state.variantsMap instanceof Map) {
                        for (const canonicalUrl of rebuildPlan.queriableSet) {
                            if (!plan.matchedCanonicals.has(canonicalUrl) && !hasLedgerEntry(state, canonicalUrl)) {
                                state.variantsMap.delete(canonicalUrl);
                            }
                        }
                    }
                    queriedInCaseB = plan.coveredAllTargets
                        ? new Set(liveData.targetSet)
                        : plan.matchedCanonicals;
                } else {
                    queriedInCaseB = plan.coveredAllTargets ? new Set(liveData.targetSet) : new Set();
                }
            } else {
                queriedInCaseB = new Set(liveData.targetSet);
            }

            ranFull90dScan = true;
            if (overflowAt > prevSyncTime || didBucketRangeDigestChange(beforeDigest, state.recentDayBuckets, rebuildStartDay)) {
                dataChanged = true;
            }
            metaChanged = true;
            forceImmediatePersist = true;
        } else {
            // 情况 C：零星单条 / 小批量删除 (deleted_urls <= 500，前台只读不清空)
            const affectedCandidates = new Map();
            const protectCutoff = anchorTime - (OLD_LEDGER_PROTECT_DAYS * DAY_MS);

            for (let i = 0; i < deletedUrls.length; i++) {
                const item = deletedUrls[i];
                if (!Array.isArray(item) || typeof item[0] !== 'string' || !item[0]) continue;
                const rawUrl = item[0];
                const deletedAt = Number(item[1]) || 0;
                if (deletedAt <= prevSyncTime) continue;

                const parsed = parseCanonicalUrl(rawUrl);
                if (!parsed || !parsed.canonicalUrl) continue;
                const canonicalUrl = parsed.canonicalUrl;

                const isRelevantTarget = liveData.targetSet.has(canonicalUrl)
                    || state.missingSinceMap.has(canonicalUrl)
                    || (!liveData.isCompleteWhitelist && hasLedgerEntry(state, canonicalUrl));
                if (!isRelevantTarget) continue;

                const hasRecent = hasCanonicalInBucketRange(state.recentDayBuckets, canonicalUrl, rebuildStartDay, Infinity);
                const maxLastVt = getLedgerMaxLastVisitTime(state, canonicalUrl);
                if (!hasRecent && maxLastVt > 0 && maxLastVt < protectCutoff) {
                    continue;
                }
                if (!hasRecent && maxLastVt === 0) {
                    continue;
                }

                let extraSet = affectedCandidates.get(canonicalUrl);
                if (!extraSet) {
                    extraSet = new Set();
                    affectedCandidates.set(canonicalUrl, extraSet);
                }
                extraSet.add(rawUrl);
            }

            if (affectedCandidates.size > 0) {
                const changedDel = await queryAndApplyBucketedBatch(state, Array.from(affectedCandidates.keys()), {
                    anchorTime,
                    minVisitTime,
                    minDayNum: rebuildStartDay,
                    archiveCutoffDay,
                    allowArchiveWrite: false,
                    clearMinDayNum: rebuildStartDay,
                    liveData,
                    extraRawUrlsByCanonical: affectedCandidates,
                    titleHints
                });
                if (changedDel) {
                    dataChanged = true;
                    forceImmediatePersist = true;
                }
            }
        }

        // 第三步：白名单对齐、30 天软保留回收与新书签补种
        const prevKnown = state.knownTargets;
        if (liveData.isCompleteWhitelist) {
            for (const canonicalUrl of liveData.targetSet) {
                if (state.missingSinceMap.delete(canonicalUrl)) {
                    dataChanged = true;
                    metaChanged = true;
                }
            }

            const ledgerKeys = collectAllLedgerCanonicals(state);
            for (const canonicalUrl of ledgerKeys) {
                if (liveData.targetSet.has(canonicalUrl)) continue;
                const missingSince = state.missingSinceMap.get(canonicalUrl);
                if (!missingSince) {
                    state.missingSinceMap.set(canonicalUrl, anchorTime);
                    dataChanged = true;
                    metaChanged = true;
                } else if (anchorTime - missingSince >= UNBOOKMARKED_RETENTION_MS) {
                    state.archiveMap.delete(canonicalUrl);
                    clearCanonicalRecentBuckets(state.recentDayBuckets, canonicalUrl, 0);
                    state.variantsMap.delete(canonicalUrl);
                    state.missingSinceMap.delete(canonicalUrl);
                    dataChanged = true;
                    metaChanged = true;
                }
            }
        }

        const newlyAddedEntries = [];
        if (prevKnown instanceof Set) {
            for (const [canonicalUrl, entry] of liveData.entriesByCanonical.entries()) {
                if (!prevKnown.has(canonicalUrl)) {
                    newlyAddedEntries.push(entry);
                }
            }
        }

        if (liveData.isCompleteWhitelist) {
            if (!(prevKnown instanceof Set) || setsDiffer(prevKnown, liveData.targetSet)) {
                state.knownTargets = new Set(liveData.targetSet);
                metaChanged = true;
            }
        } else {
            if (!(prevKnown instanceof Set)) {
                state.knownTargets = new Set(liveData.targetSet);
                metaChanged = true;
            } else {
                for (let i = 0; i < newlyAddedEntries.length; i++) {
                    if (!prevKnown.has(newlyAddedEntries[i].canonicalUrl)) {
                        prevKnown.add(newlyAddedEntries[i].canonicalUrl);
                        metaChanged = true;
                    }
                }
            }
        }

        if (!skipStep3Seed && newlyAddedEntries.length > 0) {
            const unhitNewCanonicals = [];
            for (let i = 0; i < newlyAddedEntries.length; i++) {
                const c = newlyAddedEntries[i].canonicalUrl;
                if (ranFull90dScan && queriedInCaseB && queriedInCaseB.has(c)) continue;
                unhitNewCanonicals.push(c);
            }

            if (ranFull90dScan) {
                if (unhitNewCanonicals.length > 0 && unhitNewCanonicals.length <= NEW_BOOKMARK_SEED_THRESHOLD) {
                    const res = await seedCanonicalEntries(state, unhitNewCanonicals, {
                        anchorTime,
                        minVisitTime,
                        liveData,
                        titleHints
                    });
                    if (res.changed) dataChanged = true;
                }
            } else if (unhitNewCanonicals.length > NEW_BOOKMARK_SEED_THRESHOLD) {
                const scanStart = Math.max(0, anchorTime - (DEFAULT_HISTORY_DAYS * DAY_MS), minVisitTime);
                const plan = await resolveAdaptiveHistoryScanPlan(state, unhitNewCanonicals, scanStart, anchorTime, liveData);
                for (const [k, t] of plan.titleHints.entries()) titleHints.set(k, t);
                if (!plan.emptyHistory && plan.matchedCanonicals.size > 0) {
                    const res = await seedCanonicalEntries(state, Array.from(plan.matchedCanonicals), {
                        anchorTime,
                        minVisitTime,
                        liveData,
                        extraRawUrlsByCanonical: plan.extraRawUrlsByCanonical,
                        titleHints
                    });
                    if (res.changed) dataChanged = true;
                }
            } else if (unhitNewCanonicals.length > 0) {
                const res = await seedCanonicalEntries(state, unhitNewCanonicals, {
                    anchorTime,
                    minVisitTime,
                    liveData,
                    titleHints
                });
                if (res.changed) dataChanged = true;
            }
        }

        // 第四步：时间窗增量同步（情况 B 已全扫时跳过）
        if (!ranFull90dScan && liveData.targetSet.size > 0) {
            const queryStartTime = Math.max(0, prevSyncTime - DELTA_OVERLAP_MS, minVisitTime);
            const effectiveMinSyncDay = Math.max(getDayNum(queryStartTime), rebuildStartDay);
            const scan = await scanHistoryMatches(liveData.targetSet, queryStartTime, anchorTime);
            for (const [k, t] of scan.titleHints.entries()) titleHints.set(k, t);

            if (scan.matchedCanonicals.size > 0) {
                const touchedList = Array.from(scan.matchedCanonicals);
                for (let start = 0; start < touchedList.length; start += GET_VISITS_BATCH_SIZE) {
                    const slice = touchedList.slice(start, start + GET_VISITS_BATCH_SIZE);
                    await Promise.all(slice.map(async (canonicalUrl) => {
                        const extraRaw = scan.extraRawUrlsByCanonical.get(canonicalUrl);
                        const candidateUrls = collectCandidateUrlsForCanonical(state, canonicalUrl, liveData, extraRaw);

                        // 快照旧计数比对：仅在天桶实际发生变化时标记 dataChanged
                        const prevBucketsSnapshot = new Map();
                        for (const [dNum, dMap] of state.recentDayBuckets.entries()) {
                            if (dNum >= effectiveMinSyncDay && dMap.has(canonicalUrl)) {
                                const t = dMap.get(canonicalUrl);
                                prevBucketsSnapshot.set(dNum, [t[0], t[1]]);
                            }
                        }

                        clearCanonicalRecentBuckets(state.recentDayBuckets, canonicalUrl, effectiveMinSyncDay);
                        const bucketed = await collectBucketedVisitsForCanonical(candidateUrls, anchorTime, minVisitTime);
                        const liveEntry = liveData.entriesByCanonical.get(canonicalUrl);

                        if (bucketed.totalCount > 0) {
                            writeBucketsForCanonical(state, canonicalUrl, bucketed.dayBuckets, {
                                minDayNum: effectiveMinSyncDay,
                                archiveCutoffDay,
                                allowArchiveWrite: false,
                                domain: liveEntry?.parsed?.domain || '',
                                title: liveEntry?.title || (titleHints.get(canonicalUrl)) || ''
                            });
                        }
                        syncVisitedVariantsAfterBucket(state, canonicalUrl, bucketed.totalCount, liveData, extraRaw);

                        let bucketDiffers = false;
                        const newDaysCounted = new Set();
                        for (const [dNum, dMap] of state.recentDayBuckets.entries()) {
                            if (dNum < effectiveMinSyncDay || !dMap.has(canonicalUrl)) continue;
                            newDaysCounted.add(dNum);
                            const nextT = dMap.get(canonicalUrl);
                            const oldT = prevBucketsSnapshot.get(dNum);
                            if (!oldT || oldT[0] !== nextT[0] || Math.round(oldT[1]) !== Math.round(nextT[1])) {
                                bucketDiffers = true;
                                break;
                            }
                        }
                        if (!bucketDiffers && newDaysCounted.size !== prevBucketsSnapshot.size) {
                            bucketDiffers = true;
                        }
                        if (bucketDiffers) {
                            dataChanged = true;
                        }
                    }));
                    if (start + GET_VISITS_BATCH_SIZE < touchedList.length) {
                        await yieldToMainThread();
                    }
                }
            }
        }

        const nextCompleteWhitelist = Boolean(liveData.isCompleteWhitelist);
        if (!state.syncedWithCompleteWhitelist && nextCompleteWhitelist) {
            metaChanged = true;
        }
        state.syncedWithCompleteWhitelist = nextCompleteWhitelist;
        rebuildAllUrlProjections(state, liveData, titleHints);

        const nextSync = Math.max(anchorTime, overflowAt, maxSeenDeletedTs);
        if (dataChanged || metaChanged) {
            state.hasUnsavedDataChanges = true;
        }
        return {
            state,
            nextSync,
            dataChanged,
            metaChanged,
            forceImmediatePersist,
            expectedSavedAt
        };
    }

    async function reconcileLoadedState(liveData, stagedState = null) {
        if (!liveData?.hasAuthoritativeTree) {
            if (!(internalCache.urlMap instanceof Map)) {
                internalCache.urlMap = new Map();
            }
            return { changed: false };
        }

        const baseState = stagedState || cloneStateForStaging(internalCache);
        const result = await runReconciliationPipeline(baseState, liveData);

        commitReconciledState(result.state, result.nextSync);

        if (result.dataChanged || result.metaChanged || result.forceImmediatePersist) {
            await persistSnapshotNow(internalCache, {
                expectedSavedAt: result.expectedSavedAt,
                forceWrite: true,
                onPeerConflict: async (peerState) => {
                    const freshLive = await resolveLiveBookmarkData().catch(() => liveData);
                    const realigned = await runReconciliationPipeline(peerState, freshLive);
                    commitReconciledState(realigned.state, realigned.nextSync);
                    return internalCache;
                }
            });
        } else if (result.nextSync - (internalCache.lastPersistedSyncTime || 0) >= WATERMARK_PERSIST_INTERVAL_MS) {
            saveSnapshotToStorage(internalCache, { immediate: false });
        }

        if (result.dataChanged) {
            dispatchStatsUpdatedEvent();
        }
        return { changed: result.dataChanged };
    }

    async function performColdBuild(liveData, { force = false } = {}) {
        const anchorTime = Date.now();
        if (!liveData?.hasAuthoritativeTree) {
            internalCache.urlMap = new Map();
            return internalCache.urlMap;
        }

        const stored = await storageLocalGet([STORAGE_KEY_PURGED_AT, STORAGE_KEY_OVERFLOW_AT]);
        const purgedAt = Math.max(0, Number(stored[STORAGE_KEY_PURGED_AT]) || 0);
        const overflowAt = Math.max(0, Number(stored[STORAGE_KEY_OVERFLOW_AT]) || 0);
        const minSignalTs = Math.max(purgedAt, overflowAt);

        const state = createEmptyLedgerState();
        state.lastPurgedAt = purgedAt;
        state.knownTargets = new Set(liveData.targetSet);
        state.syncedWithCompleteWhitelist = Boolean(liveData.isCompleteWhitelist);
        state.hasUnsavedDataChanges = true;

        const titleHints = new Map();
        const archiveCutoffDay = getArchiveCutoffDay(anchorTime);

        if (liveData.targetSet.size > 0) {
            const scanStart = Math.max(0, anchorTime - (DEFAULT_HISTORY_DAYS * DAY_MS), purgedAt);
            const plan = await resolveAdaptiveHistoryScanPlan(
                state,
                Array.from(liveData.targetSet),
                scanStart,
                anchorTime,
                liveData
            );
            for (const [k, t] of plan.titleHints.entries()) titleHints.set(k, t);

            if (!plan.emptyHistory && plan.matchedCanonicals.size > 0) {
                await queryAndApplyBucketedBatch(state, Array.from(plan.matchedCanonicals), {
                    anchorTime,
                    minVisitTime: purgedAt,
                    minDayNum: 0,
                    archiveCutoffDay,
                    allowArchiveWrite: true,
                    liveData,
                    extraRawUrlsByCanonical: plan.extraRawUrlsByCanonical,
                    titleHints
                });
            }
        }

        rebuildAllUrlProjections(state, liveData, titleHints);
        const nextSync = Math.max(anchorTime, minSignalTs);
        commitReconciledState(state, nextSync);

        await persistSnapshotNow(internalCache, {
            expectedSavedAt: force ? Infinity : 0,
            forceWrite: true,
            allowPeerRealign: !force
        });
        dispatchStatsUpdatedEvent();
        return internalCache.urlMap;
    }

    function setsDiffer(a, b) {
        if (!(a instanceof Set) || !(b instanceof Set)) return true;
        if (a.size !== b.size) return true;
        for (const item of a) {
            if (!b.has(item)) return true;
        }
        return false;
    }

    function runWarmReconcile() {
        internalCache.loadingPromise = (async () => {
            try {
                const liveDataPromise = resolveLiveBookmarkData();
                let staged = null;
                if (internalCache.staleByPeer) {
                    const peerSnap = await loadSnapshotFromStorage();
                    if (peerSnap && (peerSnap.lastKnownSavedAt || 0) >= (internalCache.lastKnownSavedAt || 0)) {
                        staged = peerSnap;
                    }
                }
                const liveData = await liveDataPromise;
                await reconcileLoadedState(liveData, staged);
                touchMemory();
                return { urlMap: internalCache.urlMap || new Map() };
            } finally {
                internalCache.loadingPromise = null;
            }
        })();
        return internalCache.loadingPromise;
    }

    /**
     * 确保内存大库就绪（按需调用，序列化防并发重入）
     * 刷新后优先直接 1~2ms 还原 IndexedDB 已有投影，仅在超水位或未全量白名单时后台静默对齐，不阻断首帧。
     */
    async function ensureMemoryLoaded(options = {}) {
        touchMemory();

        if (internalCache.loadingPromise) {
            return internalCache.loadingPromise;
        }

        const force = Boolean(options && options.force);
        const awaitSync = Boolean(options && options.awaitSync);

        if (internalCache.urlMap instanceof Map && !force) {
            const now = Date.now();
            const whitelistStillIncomplete = !internalCache.syncedWithCompleteWhitelist && isTempSectionsReady();
            if (!internalCache.staleByPeer && !whitelistStillIncomplete &&
                now - (internalCache.lastSyncTime || 0) <= WATERMARK_INTERVAL_MS) {
                const stored = await storageLocalGet([
                    STORAGE_KEY_PURGED_AT,
                    STORAGE_KEY_OVERFLOW_AT,
                    STORAGE_KEY_DELETED_URLS
                ]);
                if ((internalCache.urlMap instanceof Map) &&
                    !hasUnprocessedDeletionSignal(stored, internalCache.lastSyncTime)) {
                    return { urlMap: internalCache.urlMap };
                }
            }

            if (internalCache.urlMap instanceof Map) {
                if (awaitSync) {
                    return runWarmReconcile();
                }
                // 热态已有旧数据：立即返回内存命中，增量同步后台异步追齐（不卡当前搜索渲染）
                runWarmReconcile().catch(() => {});
                return { urlMap: internalCache.urlMap };
            }
        }

        let needBackgroundReconcile = false;
        internalCache.loadingPromise = (async () => {
            try {
                if (!force) {
                    const [snapshot, stored] = await Promise.all([
                        loadSnapshotFromStorage(),
                        storageLocalGet([
                            STORAGE_KEY_PURGED_AT,
                            STORAGE_KEY_OVERFLOW_AT,
                            STORAGE_KEY_DELETED_URLS
                        ])
                    ]);
                    if (snapshot) {
                        const snapSyncTime = Number(snapshot.lastSyncTime) || 0;
                        const purgedAt = Math.max(0, Number(stored[STORAGE_KEY_PURGED_AT]) || 0);
                        const overflowAt = Math.max(0, Number(stored[STORAGE_KEY_OVERFLOW_AT]) || 0);
                        const hasContent = snapshot.knownTargets.size > 0 ||
                            snapshot.archiveMap.size > 0 ||
                            snapshot.recentDayBuckets.size > 0 ||
                            (snapSyncTime > 0 && snapshot.syncedWithCompleteWhitelist);
                        const cleanSignals = purgedAt <= snapSyncTime &&
                            overflowAt <= snapSyncTime &&
                            !hasUnprocessedDeletionSignal(stored, snapSyncTime, snapshot);

                        if (hasContent && cleanSignals) {
                            rebuildAllUrlProjections(snapshot, null);
                            commitReconciledState(snapshot, snapSyncTime);
                            touchMemory();
                            const whitelistStillIncomplete = !internalCache.syncedWithCompleteWhitelist && isTempSectionsReady();
                            const expiredWatermark = (Date.now() - snapSyncTime) > WATERMARK_INTERVAL_MS;
                            if (awaitSync && (expiredWatermark || whitelistStillIncomplete)) {
                                const liveData = await resolveLiveBookmarkData();
                                await reconcileLoadedState(liveData, cloneStateForStaging(internalCache));
                            } else if (expiredWatermark || whitelistStillIncomplete) {
                                needBackgroundReconcile = true;
                            }
                            return { urlMap: internalCache.urlMap || new Map() };
                        }

                        const liveData = await resolveLiveBookmarkData();
                        await reconcileLoadedState(liveData, snapshot);
                        touchMemory();
                        return { urlMap: internalCache.urlMap || new Map() };
                    }
                }

                const liveData = await resolveLiveBookmarkData();
                await performColdBuild(liveData, { force });
                touchMemory();
                return { urlMap: internalCache.urlMap || new Map() };
            } finally {
                internalCache.loadingPromise = null;
            }
        })();

        const result = await internalCache.loadingPromise;
        if (needBackgroundReconcile && !internalCache.loadingPromise) {
            runWarmReconcile().catch(() => {});
        }
        return result;
    }

    async function performIncrementalDeltaSync() {
        if (!(internalCache.urlMap instanceof Map)) {
            return ensureMemoryLoaded();
        }
        if (internalCache.loadingPromise) {
            return internalCache.loadingPromise;
        }
        return runWarmReconcile();
    }

    /**
     * 对实时新增书签异步补查 Chrome 既有访问，作为长期账本初始底数存入
     */
    async function seedNewBookmarks(bookmarks) {
        if (!Array.isArray(bookmarks) || bookmarks.length === 0 || !(internalCache.urlMap instanceof Map)) {
            return false;
        }

        if (internalCache.loadingPromise) {
            try {
                await internalCache.loadingPromise;
            } catch (_) {}
            if (!(internalCache.urlMap instanceof Map)) return false;
        }

        const entries = [];
        const rawUrlsByCanonical = new Map();
        const seen = new Set();
        let resurrected = false;

        for (let i = 0; i < bookmarks.length; i++) {
            const b = bookmarks[i];
            const rawUrl = extractBookmarkRawUrl(b);
            if (!rawUrl) continue;
            const parsed = parseCanonicalUrl(rawUrl);
            if (!parsed || !parsed.canonicalUrl) continue;

            const canonicalUrl = parsed.canonicalUrl;
            if (internalCache.knownTargets instanceof Set) {
                internalCache.knownTargets.add(canonicalUrl);
            }
            if (internalCache.missingSinceMap instanceof Map && internalCache.missingSinceMap.delete(canonicalUrl)) {
                resurrected = true;
            }

            let rawSet = rawUrlsByCanonical.get(canonicalUrl);
            if (!rawSet) {
                rawSet = new Set();
                rawUrlsByCanonical.set(canonicalUrl, rawSet);
            }
            rawSet.add(rawUrl);
            if (internalCache.urlMap.has(canonicalUrl) && internalCache.variantsMap instanceof Map) {
                addVariantsForCanonical(internalCache.variantsMap, canonicalUrl, rawUrl);
            }

            if (!internalCache.urlMap.has(canonicalUrl) && !seen.has(canonicalUrl)) {
                seen.add(canonicalUrl);
                entries.push({
                    canonicalUrl,
                    parsed,
                    url: rawUrl,
                    title: extractBookmarkTitle(b)
                });
            }
        }

        if (entries.length === 0 && !resurrected) return false;

        const anchorTime = Date.now();
        const minVisitTime = Math.max(0, Number(internalCache.lastPurgedAt) || 0);
        let changed = resurrected;
        const touchedCanonicals = new Set();
        const titleHints = new Map();

        for (let i = 0; i < entries.length; i++) {
            if (entries[i].title) {
                titleHints.set(entries[i].canonicalUrl, entries[i].title);
            }
        }

        if (entries.length > NEW_BOOKMARK_SEED_THRESHOLD) {
            const scanStart = Math.max(0, anchorTime - (DEFAULT_HISTORY_DAYS * DAY_MS), minVisitTime);
            const plan = await resolveAdaptiveHistoryScanPlan(
                internalCache,
                entries,
                scanStart,
                anchorTime,
                { rawUrlsByCanonical }
            );
            for (const [k, t] of plan.titleHints.entries()) {
                if (!titleHints.has(k)) titleHints.set(k, t);
            }
            if (!plan.emptyHistory && plan.matchedCanonicals.size > 0) {
                const seedInput = plan.mode === 'direct-visits'
                    ? entries
                    : Array.from(plan.matchedCanonicals);
                const res = await seedCanonicalEntries(internalCache, seedInput, {
                    anchorTime,
                    minVisitTime,
                    liveData: { rawUrlsByCanonical },
                    extraRawUrlsByCanonical: plan.extraRawUrlsByCanonical,
                    titleHints
                });
                if (res.changed) changed = true;
                for (let i = 0; i < res.touched.length; i++) touchedCanonicals.add(res.touched[i]);
            }
        } else if (entries.length > 0) {
            const res = await seedCanonicalEntries(internalCache, entries, {
                anchorTime,
                minVisitTime,
                liveData: { rawUrlsByCanonical },
                titleHints
            });
            if (res.changed) changed = true;
            for (let i = 0; i < res.touched.length; i++) touchedCanonicals.add(res.touched[i]);
        }

        if (changed) {
            for (let i = 0; i < entries.length; i++) {
                touchedCanonicals.add(entries[i].canonicalUrl);
            }
            recomputeProjectionForUrls(internalCache, touchedCanonicals, null, titleHints);
            internalCache.hasUnsavedDataChanges = true;
            saveSnapshotToStorage(internalCache, { immediate: false });
            dispatchStatsUpdatedEvent();
        }
        touchMemory();
        return changed;
    }

    /**
     * 兼容接口：仅在内存大库已就绪时安全补种真正未建档的新书签，避免对已知零访问书签反复扫描
     */
    function setBookmarkTargets(bookmarks) {
        if (!Array.isArray(bookmarks) || bookmarks.length === 0 || !(internalCache.urlMap instanceof Map)) {
            return;
        }
        const unknownOnly = [];
        for (let i = 0; i < bookmarks.length; i++) {
            const b = bookmarks[i];
            const rawUrl = extractBookmarkRawUrl(b);
            if (!rawUrl) continue;
            const canonicalUrl = normalizeHistoryUrl(rawUrl);
            if (!canonicalUrl) continue;
            const isKnown = internalCache.knownTargets instanceof Set && internalCache.knownTargets.has(canonicalUrl);
            const isMissing = internalCache.missingSinceMap instanceof Map && internalCache.missingSinceMap.has(canonicalUrl);
            if (!isKnown || isMissing) {
                unknownOnly.push(b);
            }
        }
        if (unknownOnly.length > 0) {
            seedNewBookmarks(unknownOnly).catch(() => {});
        }
    }

    function getDomainStats() {
        return { visitCount: 0, lastVisitTime: 0 };
    }

    /**
     * 释放内存引用（搜索面板关闭 10 分钟后 GC 彻底回收）
     */
    function releaseMemory() {
        if (internalCache.idleUnloadTimer) {
            clearTimeout(internalCache.idleUnloadTimer);
            internalCache.idleUnloadTimer = null;
        }
        flushSavePending();
        internalCache.archiveMap = null;
        internalCache.recentDayBuckets = null;
        internalCache.variantsMap = null;
        internalCache.missingSinceMap = null;
        internalCache.knownTargets = null;
        internalCache.urlMap = null;
        internalCache.loadingPromise = null;
        internalCache.lastSyncTime = 0;
        internalCache.lastPurgedAt = 0;
        internalCache.lastPersistedSyncTime = 0;
        internalCache.lastKnownSavedAt = 0;
        internalCache.peerLatestSavedAt = 0;
        internalCache.staleByPeer = false;
        internalCache.syncedWithCompleteWhitelist = false;
        internalCache.hasUnsavedDataChanges = false;
    }

    /**
     * 彻底清空缓存（包含删除 IndexedDB 存储）
     */
    function clearCache() {
        if (internalCache.idleUnloadTimer) {
            clearTimeout(internalCache.idleUnloadTimer);
            internalCache.idleUnloadTimer = null;
        }
        if (saveDebounceTimer) {
            clearTimeout(saveDebounceTimer);
            saveDebounceTimer = null;
        }
        internalCache.archiveMap = null;
        internalCache.recentDayBuckets = null;
        internalCache.variantsMap = null;
        internalCache.missingSinceMap = null;
        internalCache.knownTargets = null;
        internalCache.urlMap = null;
        internalCache.loadingPromise = null;
        internalCache.lastSyncTime = 0;
        internalCache.lastPurgedAt = 0;
        internalCache.lastPersistedSyncTime = 0;
        internalCache.lastKnownSavedAt = 0;
        internalCache.peerLatestSavedAt = 0;
        internalCache.staleByPeer = false;
        internalCache.syncedWithCompleteWhitelist = false;
        internalCache.hasUnsavedDataChanges = false;

        if (typeof window !== 'undefined' && typeof window.SearchIndexDb?.saveBookmarkVisitStats === 'function') {
            window.SearchIndexDb.saveBookmarkVisitStats(null).catch(() => {});
        }
        broadcastPeerNotice({ type: 'stats-snapshot-cleared' });
        dispatchStatsUpdatedEvent();
    }

    /**
     * 获取单个书签或文件夹的统计（O(1) 查表；热循环中不反复重置空闲定时器）
     */
    function getBookmarkStatsFromIndex(bookmark, index = null) {
        const map = (index && index.urlMap instanceof Map) ? index.urlMap : (index instanceof Map ? index : internalCache.urlMap);
        if (!bookmark || !(map instanceof Map)) {
            return { visitCount: 0, lastVisitTime: 0 };
        }

        const nodeType = bookmark.nodeType || (bookmark.rawItem && bookmark.rawItem.nodeType);
        const url = extractBookmarkRawUrl(bookmark);

        if (nodeType === 'folder' || !url) {
            const leaves = extractLeafBookmarks(bookmark.rawItem || bookmark);
            if (leaves.length > 0) {
                const folderStats = computeFolderAggregatedStats(leaves, { urlMap: map });
                return {
                    visitCount: folderStats.totalVisits || 0,
                    lastVisitTime: folderStats.lastVisitTime || (folderStats.topBookmark ? folderStats.topBookmark.lastVisitTime : 0),
                    folderStats
                };
            }
            return { visitCount: 0, lastVisitTime: 0 };
        }

        const canonicalUrl = normalizeHistoryUrl(url);
        if (canonicalUrl && map.has(canonicalUrl)) {
            return map.get(canonicalUrl);
        }

        return { visitCount: 0, lastVisitTime: 0 };
    }

    /**
     * 计算文件夹的聚合访问统计（按 canonicalUrl 去重累加，防止重复书签虚高总访问量）
     */
    function computeFolderAggregatedStats(childBookmarks, index = null) {
        if (!Array.isArray(childBookmarks) || childBookmarks.length === 0) {
            return { totalVisits: 0, lastVisitTime: 0, bookmarkCount: 0, topBookmark: null };
        }

        const map = (index && index.urlMap instanceof Map) ? index.urlMap : (index instanceof Map ? index : internalCache.urlMap);
        if (!(map instanceof Map)) {
            return { totalVisits: 0, lastVisitTime: 0, bookmarkCount: childBookmarks.length, topBookmark: null };
        }

        let totalVisits = 0;
        let topBookmark = null;
        let maxVisits = 0;
        let maxTopTime = 0;
        let validBookmarkCount = 0;
        let maxLastVisit = 0;
        const seenCanonical = new Set();

        for (let i = 0; i < childBookmarks.length; i++) {
            const bm = childBookmarks[i];
            const rawUrl = extractBookmarkRawUrl(bm);
            if (!rawUrl) continue;
            validBookmarkCount++;

            const canonicalUrl = normalizeHistoryUrl(rawUrl);
            const stats = canonicalUrl ? map.get(canonicalUrl) : null;
            const visits = stats ? (stats.visitCount || 0) : 0;
            const time = stats ? (stats.lastVisitTime || 0) : 0;

            if (!canonicalUrl || !seenCanonical.has(canonicalUrl)) {
                if (canonicalUrl) seenCanonical.add(canonicalUrl);
                totalVisits += visits;
            }
            if (time > maxLastVisit) maxLastVisit = time;

            if (visits > maxVisits || (visits > 0 && visits === maxVisits && time > maxTopTime)) {
                maxVisits = visits;
                maxTopTime = time;
                topBookmark = {
                    title: extractBookmarkTitle(bm) || rawUrl || '',
                    visitCount: visits,
                    url: rawUrl,
                    lastVisitTime: time
                };
            }
        }

        return {
            totalVisits,
            lastVisitTime: maxLastVisit,
            bookmarkCount: validBookmarkCount,
            topBookmark: maxVisits > 0 ? topBookmark : null
        };
    }

    function extractOldLedgerBasesFromRawSnapshot(rawSnapshot, canonicalSet, rebuildStartDay) {
        const resultMap = new Map();
        if (!isValidV4RawSnapshot(rawSnapshot) || !(canonicalSet instanceof Set) || canonicalSet.size === 0) {
            return resultMap;
        }

        const ensureEntry = (canonicalUrl) => {
            let entry = resultMap.get(canonicalUrl);
            if (!entry) {
                entry = { baseCount: 0, baseLastVisitTime: 0, knownVariants: [] };
                resultMap.set(canonicalUrl, entry);
            }
            return entry;
        };

        const archiveItems = rawSnapshot.archiveItems;
        for (let i = 0; i < archiveItems.length; i++) {
            const row = archiveItems[i];
            if (Array.isArray(row) && typeof row[0] === 'string' && canonicalSet.has(row[0])) {
                const entry = ensureEntry(row[0]);
                const count = Math.max(0, Math.floor(Number(row[1]) || 0));
                const vt = Math.max(0, Number(row[2]) || 0);
                entry.baseCount += count;
                if (vt > entry.baseLastVisitTime) entry.baseLastVisitTime = vt;
            }
        }

        const dayBuckets = rawSnapshot.dayBuckets;
        for (let i = 0; i < dayBuckets.length; i++) {
            const bucket = dayBuckets[i];
            if (!Array.isArray(bucket)) continue;
            const dayNum = Number(bucket[0]);
            if (!Number.isInteger(dayNum) || dayNum >= rebuildStartDay) continue;
            const rows = bucket[1];
            if (!Array.isArray(rows)) continue;
            for (let j = 0; j < rows.length; j++) {
                const row = rows[j];
                if (Array.isArray(row) && typeof row[0] === 'string' && canonicalSet.has(row[0])) {
                    const entry = ensureEntry(row[0]);
                    const count = Math.max(0, Math.floor(Number(row[1]) || 0));
                    const vt = Math.max(0, Number(row[2]) || 0);
                    entry.baseCount += count;
                    if (vt > entry.baseLastVisitTime) entry.baseLastVisitTime = vt;
                }
            }
        }

        const variants = rawSnapshot.variants;
        for (let i = 0; i < variants.length; i++) {
            const row = variants[i];
            if (Array.isArray(row) && typeof row[0] === 'string' && canonicalSet.has(row[0]) && Array.isArray(row[1])) {
                const entry = ensureEntry(row[0]);
                for (let j = 0; j < row[1].length && entry.knownVariants.length < MAX_VARIANTS_PER_CANONICAL; j++) {
                    if (typeof row[1][j] === 'string' && row[1][j]) {
                        entry.knownVariants.push(row[1][j]);
                    }
                }
            }
        }

        return resultMap;
    }

    function extractOldLedgerBaseFromRawSnapshot(rawSnapshot, canonicalUrl, rebuildStartDay) {
        if (!canonicalUrl) {
            return { baseCount: 0, baseLastVisitTime: 0, knownVariants: [] };
        }
        const map = extractOldLedgerBasesFromRawSnapshot(rawSnapshot, new Set([canonicalUrl]), rebuildStartDay);
        return map.get(canonicalUrl) || { baseCount: 0, baseLastVisitTime: 0, knownVariants: [] };
    }

    function extractOldLedgerBaseFromWarmMemory(canonicalUrl, rebuildStartDay) {
        let baseCount = 0;
        let baseLastVisitTime = 0;
        const knownVariants = [];

        if (!canonicalUrl) return { baseCount, baseLastVisitTime, knownVariants };

        const archived = internalCache.archiveMap?.get(canonicalUrl);
        if (archived) {
            baseCount += Math.max(0, Math.floor(Number(archived.visitCount) || 0));
            if (archived.lastVisitTime > baseLastVisitTime) {
                baseLastVisitTime = archived.lastVisitTime;
            }
        }

        if (internalCache.recentDayBuckets instanceof Map) {
            for (const [dayNum, dayMap] of internalCache.recentDayBuckets.entries()) {
                if (dayNum >= rebuildStartDay) continue;
                const tuple = dayMap.get(canonicalUrl);
                if (!tuple) continue;
                baseCount += Math.max(0, Math.floor(Number(tuple[0]) || 0));
                const vt = Number(tuple[1]) || 0;
                if (vt > baseLastVisitTime) baseLastVisitTime = vt;
            }
        }

        const varSet = internalCache.variantsMap?.get(canonicalUrl);
        if (varSet instanceof Set) {
            for (const u of varSet) {
                if (typeof u === 'string' && u) knownVariants.push(u);
            }
        }

        return { baseCount, baseLastVisitTime, knownVariants };
    }

    function mergeBucketedVisitsWithBase(bucketed, baseCount, baseLastVisitTime, rebuildStartDay) {
        if (baseCount > 0) {
            let recentCount = 0;
            let recentMaxTime = 0;
            for (const [dayNum, tuple] of bucketed.dayBuckets.entries()) {
                if (dayNum < rebuildStartDay) continue;
                recentCount += Math.max(0, Math.floor(Number(tuple?.[0]) || 0));
                const vt = Number(tuple?.[1]) || 0;
                if (vt > recentMaxTime) recentMaxTime = vt;
            }
            return {
                visitCount: baseCount + recentCount,
                lastVisitTime: Math.max(baseLastVisitTime, recentMaxTime)
            };
        }

        return {
            visitCount: bucketed.totalCount,
            lastVisitTime: bucketed.maxTime
        };
    }

    /**
     * 单 URL 统计查询：绝不调用 ensureMemoryLoaded() 或 history.search 全量扫描。
     * 按「老账底数 (< rebuildStartDay) + 近端实时 getVisits (>= rebuildStartDay)」精确合算，
     * 并校验 canvas_history_purged_at 防止清库后冷态右键残余旧账。
     */
    async function getSingleUrlHistoryStats(targetUrl, targetTitle = '') {
        if (!targetUrl || typeof targetUrl !== 'string') {
            return { visitCount: 0, lastVisitTime: 0 };
        }

        const anchorTime = Date.now();
        const rebuildStartDay = getRebuildStartDay(anchorTime);
        const parsed = parseCanonicalUrl(targetUrl);
        const canonicalUrl = parsed ? parsed.canonicalUrl : '';

        const canUseWarmMemory = (internalCache.urlMap instanceof Map) && !internalCache.staleByPeer;
        if (canUseWarmMemory) {
            touchMemory();
        }

        const rawSnapshotPromise = (!canUseWarmMemory && typeof window !== 'undefined' && typeof window.SearchIndexDb?.getBookmarkVisitStats === 'function')
            ? window.SearchIndexDb.getBookmarkVisitStats().catch(() => null)
            : Promise.resolve(null);

        const [primaryVisits, stored, rawSnapshot] = await Promise.all([
            historyGetVisits(targetUrl),
            storageLocalGet([STORAGE_KEY_PURGED_AT]),
            rawSnapshotPromise
        ]);

        const purgedAt = Math.max(0, Number(stored[STORAGE_KEY_PURGED_AT]) || 0);
        let baseCount = 0;
        let baseLastVisitTime = 0;
        let knownVariants = [];
        let effectivePurgedAt = purgedAt;

        if (canUseWarmMemory) {
            const memSyncTime = Number(internalCache.lastSyncTime) || 0;
            const memPurged = purgedAt > memSyncTime;
            effectivePurgedAt = memPurged ? purgedAt : Math.max(purgedAt, Number(internalCache.lastPurgedAt) || 0);
            if (!memPurged && canonicalUrl) {
                const memBase = extractOldLedgerBaseFromWarmMemory(canonicalUrl, rebuildStartDay);
                baseCount = memBase.baseCount;
                baseLastVisitTime = memBase.baseLastVisitTime;
                knownVariants = memBase.knownVariants;
            }
        } else if (isValidV4RawSnapshot(rawSnapshot)) {
            const snapSyncTime = Number(rawSnapshot.meta?.lastSyncTime) || 0;
            const snapPurged = purgedAt > snapSyncTime;
            effectivePurgedAt = snapPurged ? purgedAt : Math.max(purgedAt, Number(rawSnapshot.meta?.lastPurgedAt) || 0);
            if (!snapPurged && canonicalUrl) {
                const snapBase = extractOldLedgerBaseFromRawSnapshot(rawSnapshot, canonicalUrl, rebuildStartDay);
                baseCount = snapBase.baseCount;
                baseLastVisitTime = snapBase.baseLastVisitTime;
                knownVariants = snapBase.knownVariants;
            }
        }

        const extraUrls = [];
        for (let i = 0; i < knownVariants.length; i++) {
            const vUrl = knownVariants[i];
            if (vUrl && vUrl !== targetUrl && !extraUrls.includes(vUrl)) {
                extraUrls.push(vUrl);
            }
        }

        const extraVisitLists = extraUrls.length > 0
            ? await Promise.all(extraUrls.map((u) => historyGetVisits(u)))
            : [];

        const bucketed = dedupeAndBucketVisits([primaryVisits, ...extraVisitLists], anchorTime, effectivePurgedAt);
        return mergeBucketedVisitsWithBase(bucketed, baseCount, baseLastVisitTime, rebuildStartDay);
    }

    /**
     * 文件夹聚合统计查询：热索引未过水位且无删除信号时 O(1) 读内存；
     * 否则仅针对该文件夹去重后的书签 URL 队列直查 getVisits 并叠加既有老账底数，
     * 绝不因右键一个文件夹而唤醒/重建全库 3000+ 书签索引。
     */
    async function getFolderHistoryStats(childBookmarks) {
        if (!Array.isArray(childBookmarks) || childBookmarks.length === 0) {
            return { totalVisits: 0, lastVisitTime: 0, bookmarkCount: 0, topBookmark: null };
        }

        const targetCanonicals = new Set();
        const rawUrlsByCanonical = new Map();
        for (let i = 0; i < childBookmarks.length; i++) {
            const rawUrl = extractBookmarkRawUrl(childBookmarks[i]);
            if (!rawUrl) continue;
            const parsed = parseCanonicalUrl(rawUrl);
            if (!parsed || !parsed.canonicalUrl) continue;
            const canonicalUrl = parsed.canonicalUrl;
            targetCanonicals.add(canonicalUrl);
            let rawSet = rawUrlsByCanonical.get(canonicalUrl);
            if (!rawSet) {
                rawSet = new Set();
                rawUrlsByCanonical.set(canonicalUrl, rawSet);
            }
            rawSet.add(rawUrl);
        }

        if (targetCanonicals.size === 0) {
            return computeFolderAggregatedStats(childBookmarks, new Map());
        }

        const anchorTime = Date.now();
        const rebuildStartDay = getRebuildStartDay(anchorTime);
        const canUseWarmMemory = (internalCache.urlMap instanceof Map) && !internalCache.staleByPeer;
        if (canUseWarmMemory) {
            touchMemory();
        }

        if (canUseWarmMemory) {
            const whitelistStillIncomplete = !internalCache.syncedWithCompleteWhitelist && isTempSectionsReady();
            if (!whitelistStillIncomplete && (anchorTime - (internalCache.lastSyncTime || 0) <= WATERMARK_INTERVAL_MS)) {
                const stored = await storageLocalGet([
                    STORAGE_KEY_PURGED_AT,
                    STORAGE_KEY_OVERFLOW_AT,
                    STORAGE_KEY_DELETED_URLS
                ]);
                if ((internalCache.urlMap instanceof Map) &&
                    !hasUnprocessedDeletionSignal(stored, internalCache.lastSyncTime)) {
                    return computeFolderAggregatedStats(childBookmarks, internalCache.urlMap);
                }
            }
            const warmResult = await ensureMemoryLoaded({ awaitSync: true });
            return computeFolderAggregatedStats(childBookmarks, (warmResult && warmResult.urlMap) || internalCache.urlMap);
        }

        let stored = null;

        const rawSnapshotPromise = (!canUseWarmMemory && typeof window !== 'undefined' && typeof window.SearchIndexDb?.getBookmarkVisitStats === 'function')
            ? window.SearchIndexDb.getBookmarkVisitStats().catch(() => null)
            : Promise.resolve(null);

        const [resolvedStorage, rawSnapshot] = await Promise.all([
            stored ? Promise.resolve(stored) : storageLocalGet([STORAGE_KEY_PURGED_AT]),
            rawSnapshotPromise
        ]);

        const purgedAt = Math.max(0, Number(resolvedStorage[STORAGE_KEY_PURGED_AT]) || 0);
        let effectivePurgedAt = purgedAt;
        let useLedgerBase = false;
        let rawBaseMap = null;

        if (canUseWarmMemory) {
            const memSyncTime = Number(internalCache.lastSyncTime) || 0;
            const memPurged = purgedAt > memSyncTime;
            effectivePurgedAt = memPurged ? purgedAt : Math.max(purgedAt, Number(internalCache.lastPurgedAt) || 0);
            useLedgerBase = !memPurged;
        } else if (isValidV4RawSnapshot(rawSnapshot)) {
            const snapSyncTime = Number(rawSnapshot.meta?.lastSyncTime) || 0;
            const snapPurged = purgedAt > snapSyncTime;
            effectivePurgedAt = snapPurged ? purgedAt : Math.max(purgedAt, Number(rawSnapshot.meta?.lastPurgedAt) || 0);
            if (!snapPurged) {
                useLedgerBase = true;
                rawBaseMap = extractOldLedgerBasesFromRawSnapshot(rawSnapshot, targetCanonicals, rebuildStartDay);
            }
        }

        const statsMap = new Map();
        const canonicalList = Array.from(targetCanonicals);

        for (let start = 0; start < canonicalList.length; start += GET_VISITS_BATCH_SIZE) {
            const slice = canonicalList.slice(start, start + GET_VISITS_BATCH_SIZE);
            await Promise.all(slice.map(async (canonicalUrl) => {
                const base = useLedgerBase
                    ? (canUseWarmMemory
                        ? extractOldLedgerBaseFromWarmMemory(canonicalUrl, rebuildStartDay)
                        : (rawBaseMap?.get(canonicalUrl) || { baseCount: 0, baseLastVisitTime: 0, knownVariants: [] }))
                    : { baseCount: 0, baseLastVisitTime: 0, knownVariants: [] };

                const candidateSet = new Set(rawUrlsByCanonical.get(canonicalUrl));
                for (let j = 0; j < base.knownVariants.length; j++) {
                    if (base.knownVariants[j]) candidateSet.add(base.knownVariants[j]);
                }
                const candidateUrls = Array.from(candidateSet);
                const bucketed = await collectBucketedVisitsForCanonical(candidateUrls, anchorTime, effectivePurgedAt);
                statsMap.set(
                    canonicalUrl,
                    mergeBucketedVisitsWithBase(bucketed, base.baseCount, base.baseLastVisitTime, rebuildStartDay)
                );
            }));

            if (start + GET_VISITS_BATCH_SIZE < canonicalList.length) {
                await yieldToMainThread();
            }
        }

        return computeFolderAggregatedStats(childBookmarks, { urlMap: statsMap });
    }

    const HistoryStatsService = {
        normalizeHistoryUrl,
        getProtoAgnosticUrl: normalizeHistoryUrl,
        extractHostname,
        extractLeafBookmarks,
        setBookmarkTargets,
        registerBookmarkProvider,
        seedNewBookmarks,
        ensureMemoryLoaded,
        ensureHistoryStatsIndex: ensureMemoryLoaded,
        getBookmarkStatsFromIndex,
        getSingleUrlHistoryStats,
        getFolderHistoryStats,
        computeFolderAggregatedStats,
        getDomainStats,
        performIncrementalDeltaSync,
        isCacheReady: () => !!(internalCache.urlMap instanceof Map),
        touchMemory,
        releaseMemory,
        clearCache
    };

    root.HistoryStatsService = HistoryStatsService;

})(typeof window !== 'undefined' ? window : globalThis);
