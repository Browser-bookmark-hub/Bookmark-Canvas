/**
 * Bookmark-Canvas: 浏览历史点击与访问统计服务 (HistoryStatsService)
 * 
 * 极简设计原则（基于书签白名单与时间戳水位线增量）：
 * 1. 严格按需触发：页面加载 0 开销，仅在用户点击/聚焦搜索框或右键信息面板时激活。
 * 2. 严格书签反向白名单：以书签为唯一靶心，非书签网页直接丢弃，无白名单时绝对终止（防穿透）。
 * 3. 单源永久存储：以 IndexedDB (SearchIndexDb) 为唯一持久化，冷启动 < 1ms 直接还原。
 * 4. 水位线增量同步 (Watermark Delta Sync)：以上次同步时间戳（lastSyncTime）为基准，只检索该时间戳以来的最新访问进行填补更新。
 * 5. 多 URL 变体求和模型：书签内部按原始 URL 变体分别记录，增量直接覆盖变体，总数实时求和（彻底解决热度卡死 P4）。
 * 6. 域名热度动态汇总：域名统计不单独存储，由书签数据实时汇总，天然支持主域名与子域名层级，根除重复累加（P1/P9）。
 * 7. 删除对账与版本持久化：已处理版本号存入快照元数据，开箱即用，避免每次重新拉取 5 万条（P2）。
 * 8. 跳转书签与新书签补查：冷启动对零命中书签用原网址 getVisits 补查，触发时补查新书签（P8/P11）。
 * 9. 精确单书签查询：右键单书签使用原网址精确查询，限定近 90 天，绝不拿无关记录凑数（P6）。
 * 10. 标题匹配护栏：单页应用通用标题多 URL 防护，原网址已有记录不叠加，杜绝误收非书签网页（P7）。
 */

(function (root) {
    'use strict';

    const DEFAULT_HISTORY_DAYS = 90; // 首次拉取近 90 天（约 3 个月）
    const MAX_INDEX_ITEMS = 10000;    // 经反向过滤后通常仅数百条书签记录
    const WATERMARK_CHECK_INTERVAL_MS = 30 * 1000; // 水位线检查间隔：30秒（平滑轻量，杜绝频繁调用）

    // 单页应用常见通用页面标题（护栏白名单：这些标题绝不用于跨 URL 模糊匹配，防止 P7 离谱乱配）
    const GENERIC_SPA_TITLES = new Set([
        // 英文通用标题
        'home', 'index', 'login', 'signin', 'sign in', 'signup', 'sign up', 'register',
        'dashboard', 'loading', '404', 'not found', 'error', 'untitled', 'notion', 'github',
        'overview', 'welcome', 'app', 'portal', 'account', 'profile', 'search', 'settings',
        'workspace', 'console', 'help', 'about', 'document', 'documents', 'docs',
        // 中文通用页面标题
        '首页', '主页', '登录', '登陆', '注册', '控制台', '仪表盘', '工作台', '未命名',
        '加载中', '未找到', '错误', '搜索', '个人中心', '我的', '设置', '系统设置',
        '概览', '欢迎', '账号', '详情', '帮助', '帮助中心', '关于'
    ]);

    let registeredBookmarkProvider = null;

    /**
     * 安全分发统计更新事件
     */
    function dispatchStatsUpdatedEvent() {
        if (typeof window === 'undefined') return;
        try {
            const EventCtor = window.CustomEvent || (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
            if (typeof EventCtor === 'function' && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new EventCtor('canvas-history-stats-updated'));
            }
        } catch (_) {}
    }

    /**
     * 注册画布书签获取提供者函数
     */
    function registerBookmarkProvider(provider) {
        if (typeof provider === 'function') {
            registeredBookmarkProvider = provider;
        }
    }

    // 内部缓存状态
    const internalCache = {
        loadedAt: 0,
        lastSyncTime: 0,
        lastAppliedVersion: 0,
        urlMap: null,            // Map<normalizedUrl, { visitCount: number, lastVisitTime: number, domain: string, title: string, hasExactMatch?: boolean, variants: Map<rawUrl, { visitCount: number, lastVisitTime: number }> }>
        protoAgnosticMap: null,  // Map<cleanProtoAgnosticUrl, { visitCount: number, lastVisitTime: number }>
        titleDomainMap: null,    // Map<domain:::title, { visitCount: number, lastVisitTime: number }>
        domainAggregatesCache: null, // Map<domain, { visitCount: number, lastVisitTime: number }>
        redirectBookmarkUrls: null, // Set<string> 确认有访问的跳转类书签原始 URL 名单
        zeroVisitNormUrls: null,    // Set<string> 确认为 0 访问的书签规范化 URL 集合（杜绝每次水位线增量重复轮询）
        targetInfo: null,        // { targetUrlSet, targetCleanProtoMap, targetDomainSet, targetTitleDomainMap, rawUrlToNormUrlMap, normUrlToRawUrlsMap, allBookmarkRawUrls, hasTargets }
        fetchingPromise: null
    };

    /**
     * 清理域名聚合缓存
     */
    function invalidateDomainAggregatesCache() {
        internalCache.domainAggregatesCache = null;
    }

    /**
     * 构建域名访问统计聚合缓存（从 urlMap 动态生成，支持主域名与子域名层级）
     */
    function buildDomainAggregatesCache() {
        const cache = new Map();
        if (!(internalCache.urlMap instanceof Map)) return cache;

        for (const data of internalCache.urlMap.values()) {
            if (!data || !data.domain || !data.visitCount) continue;
            const visits = data.visitCount || 0;
            const lastTime = data.lastVisitTime || 0;
            const itemDomain = data.domain.toLowerCase().replace(/^www\./i, '');

            // 拆解域名层级，例如 a.b.example.com -> a.b.example.com, b.example.com, example.com
            const parts = itemDomain.split('.');
            for (let i = 0; i < parts.length - 1; i++) {
                const sub = parts.slice(i).join('.');
                if (!sub) continue;
                const existing = cache.get(sub);
                if (existing) {
                    existing.visitCount += visits;
                    if (lastTime > existing.lastVisitTime) existing.lastVisitTime = lastTime;
                } else {
                    cache.set(sub, { visitCount: visits, lastVisitTime: lastTime });
                }
            }
        }
        return cache;
    }

    /**
     * 从给定的书签列表提取靶向哈希白名单
     */
    function extractTargetBookmarkSets(bookmarks) {
        const targetUrlSet = new Set();
        const targetCleanProtoMap = new Map();
        const targetDomainSet = new Set();
        const targetTitleDomainMap = new Map();
        const rawUrlToNormUrlMap = new Map();
        const normUrlToRawUrlsMap = new Map();
        const allBookmarkRawUrls = [];

        if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
            return {
                targetUrlSet,
                targetCleanProtoMap,
                targetDomainSet,
                targetTitleDomainMap,
                rawUrlToNormUrlMap,
                normUrlToRawUrlsMap,
                allBookmarkRawUrls,
                hasTargets: false
            };
        }

        // 检测同一 domain:::cleanTitle 是否对应多个不同书签 URL（单页应用护栏）
        const titleDomainCount = new Map();

        for (let i = 0; i < bookmarks.length; i++) {
            const bm = bookmarks[i];
            if (!bm) continue;
            const rawUrl = bm.url || bm.__url || (bm.rawItem && (bm.rawItem.url || bm.rawItem.__url));
            if (!rawUrl || typeof rawUrl !== 'string') continue;

            allBookmarkRawUrls.push(rawUrl);

            const parsed = parseUrlFast(rawUrl);
            if (!parsed) continue;

            const { normUrl, cleanProto, domain } = parsed;
            if (normUrl) {
                targetUrlSet.add(normUrl);
                rawUrlToNormUrlMap.set(rawUrl, normUrl);
                if (!normUrlToRawUrlsMap.has(normUrl)) {
                    normUrlToRawUrlsMap.set(normUrl, new Set());
                }
                normUrlToRawUrlsMap.get(normUrl).add(rawUrl);
            }
            if (cleanProto && normUrl) targetCleanProtoMap.set(cleanProto, normUrl);
            if (domain) targetDomainSet.add(domain);

            const title = bm.title || bm.__title || (bm.rawItem && (bm.rawItem.title || bm.rawItem.__title)) || '';
            const cleanTitle = typeof title === 'string' ? title.trim().toLowerCase() : '';
            if (domain && cleanTitle && cleanTitle.length >= 3 && !GENERIC_SPA_TITLES.has(cleanTitle)) {
                const key = `${domain}:::${cleanTitle}`;
                titleDomainCount.set(key, (titleDomainCount.get(key) || 0) + 1);
                if (!targetTitleDomainMap.has(key)) {
                    targetTitleDomainMap.set(key, normUrl);
                }
            }
        }

        // 护栏：若同一个 domain:::title 对应多个不同书签，放弃该标题匹配（避免混淆）
        for (const [key, count] of titleDomainCount.entries()) {
            if (count > 1) {
                targetTitleDomainMap.delete(key);
            }
        }

        return {
            targetUrlSet,
            targetCleanProtoMap,
            targetDomainSet,
            targetTitleDomainMap,
            rawUrlToNormUrlMap,
            normUrlToRawUrlsMap,
            allBookmarkRawUrls,
            hasTargets: targetUrlSet.size > 0
        };
    }

    /**
     * 设置/更新书签靶心名单
     */
    function setBookmarkTargets(bookmarks) {
        if (Array.isArray(bookmarks) && bookmarks.length > 0) {
            internalCache.targetInfo = extractTargetBookmarkSets(bookmarks);
            if (internalCache.zeroVisitNormUrls) {
                internalCache.zeroVisitNormUrls.clear();
            }
        }
    }

    /**
     * 安全提取靶心书签列表
     * 优先采用全局已注册的书签提供者（保证全库完整靶心），其次回退至局部传入
     */
    function getTargetBookmarksSafe(options = {}) {
        if (typeof registeredBookmarkProvider === 'function') {
            try {
                const bms = registeredBookmarkProvider();
                if (Array.isArray(bms) && bms.length > 0) return bms;
            } catch (_) {}
        }
        if (Array.isArray(options.bookmarks) && options.bookmarks.length > 0) {
            return options.bookmarks;
        }
        return null;
    }

    /**
     * 从 IndexedDB 恢复持久化书签访问统计（同时恢复上次已对账消费的版本号与跳转名单）
     */
    async function loadIndexFromPersistentStorage() {
        try {
            if (typeof window !== 'undefined' && window.SearchIndexDb && typeof window.SearchIndexDb.getBookmarkVisitStats === 'function') {
                const data = await window.SearchIndexDb.getBookmarkVisitStats();
                if (data && Array.isArray(data.compactItems) && data.compactItems.length > 0) {
                    return data;
                }
            }
        } catch (_) {}
        return null;
    }

    /**
     * 防抖持久化到 IndexedDB（SearchIndexDb STORE_META）
     * 彻底移除 domainStats 字段（改为实时计算，防止 P1 恢复快照重复累加）
     * 同时将 lastAppliedVersion 持久化在 meta 中，彻底解决每次刷新重拉 5 万条历史（P2）
     */
    let persistentSaveTimer = null;
    function saveIndexToPersistentStorage(urlMap, lastSyncTime) {
        if (persistentSaveTimer) clearTimeout(persistentSaveTimer);
        persistentSaveTimer = setTimeout(async () => {
            persistentSaveTimer = null;
            if (!(urlMap instanceof Map)) return;

            const compactItems = [];
            for (const [normUrl, data] of urlMap.entries()) {
                if (!normUrl || !data) continue;
                // 保存每个书签的变体详情列表（若存在）
                const variantsList = (data.variants instanceof Map && data.variants.size > 0)
                    ? Array.from(data.variants.entries()).map(([vUrl, vData]) => [
                        vUrl,
                        Math.floor(vData.visitCount || 1),
                        Math.round(vData.lastVisitTime || 0)
                    ])
                    : null;

                compactItems.push([
                    normUrl,
                    typeof data.title === 'string' ? data.title.slice(0, 100) : '',
                    Math.floor(data.visitCount || 1),
                    Math.round(data.lastVisitTime || 0),
                    variantsList
                ]);
                if (compactItems.length >= MAX_INDEX_ITEMS) break;
            }

            const meta = {
                lastSyncTime: lastSyncTime || Date.now(),
                totalCount: compactItems.length,
                savedAt: Date.now(),
                lastAppliedVersion: internalCache.lastAppliedVersion || 0,
                redirectUrls: Array.from(internalCache.redirectBookmarkUrls || [])
            };

            try {
                if (typeof window !== 'undefined' && window.SearchIndexDb && typeof window.SearchIndexDb.saveBookmarkVisitStats === 'function') {
                    // domainStats 置 null，永不单独持久化
                    await window.SearchIndexDb.saveBookmarkVisitStats({ compactItems, domainStats: null, meta });
                }
            } catch (err) {
                console.warn('[HistoryStatsService] 写入 IndexedDB 失败:', err);
            }
        }, 500);
    }

    /**
     * 高性能 URL 组合解析器
     * 单次 new URL() 提取归一化 URL、协议无关 URL、主域名
     * 严格保留端口号（localhost:3000）与非 http 协议（file://）
     */
    function parseUrlFast(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return null;
        const trimmed = rawUrl.trim();
        if (!trimmed) return null;

        try {
            const u = new URL(trimmed);
            u.hash = '';

            // 仅在包含查询参数且可能存在追踪参数时才遍历删除
            if (u.search && (u.search.includes('utm_') || u.search.includes('spm') || u.search.includes('fbclid') || u.search.includes('gclid') || u.search.includes('_ga') || u.search.includes('from=') || u.search.includes('ref='))) {
                const trackingParams = [
                    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
                    'spm', 'from', 'ref', 'feature', 'fbclid', 'gclid', '_ga'
                ];
                for (let i = 0; i < trackingParams.length; i++) {
                    u.searchParams.delete(trackingParams[i]);
                }
            }

            let path = u.pathname;
            if (path.length > 1 && path.endsWith('/')) {
                path = path.slice(0, -1);
            }

            const hostnameLower = (u.hostname || '').toLowerCase();
            const hostLower = (u.host || hostnameLower).toLowerCase(); // 严格保留端口号（如 localhost:3000）
            const domain = hostnameLower.startsWith('www.') ? hostnameLower.slice(4) : hostnameLower;
            const cleanHost = hostLower.startsWith('www.') ? hostLower.slice(4) : hostLower;
            const query = u.search ? u.search : '';

            let normUrl = '';
            if (u.origin && u.origin !== 'null') {
                normUrl = u.origin.toLowerCase() + path + query;
            } else if (u.protocol === 'file:') {
                normUrl = 'file://' + path + query;
            } else {
                normUrl = (u.protocol ? u.protocol.toLowerCase() + '//' : '') + cleanHost + path + query;
            }

            const cleanProto = (cleanHost + path + query).replace(/\/+$/, '');

            return { normUrl, cleanProto, domain };
        } catch (_) {
            let clean = trimmed.replace(/#.*$/, '');
            if (clean.length > 8 && clean.endsWith('/')) {
                clean = clean.slice(0, -1);
            }
            const cleanProto = clean.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
            let domain = '';
            try {
                domain = cleanProto.split('/')[0].split('?')[0].split(':')[0].toLowerCase();
            } catch (_) {}
            return { normUrl: clean, cleanProto, domain };
        }
    }

    /**
     * URL 归一化清洗函数
     */
    function normalizeHistoryUrl(rawUrl) {
        const parsed = parseUrlFast(rawUrl);
        return parsed ? parsed.normUrl : '';
    }

    /**
     * 协议与 www 无关的清洗函数
     */
    function getProtoAgnosticUrl(normUrl) {
        if (!normUrl || typeof normUrl !== 'string') return '';
        return normUrl
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./i, '')
            .replace(/\/+$/, '');
    }

    /**
     * 提取主域名/主机名（去除 www.）
     */
    function extractHostname(url) {
        const parsed = parseUrlFast(url);
        return parsed ? parsed.domain : '';
    }

    /**
     * 提取文件夹或节点下的所有叶子书签（使用显式栈循环，杜绝函数调用栈溢出）
     */
    function extractLeafBookmarks(node, maxLeaves = Infinity) {
        const leaves = [];
        if (!node) return leaves;

        const stack = [node];
        while (stack.length > 0 && leaves.length < maxLeaves) {
            const curr = stack.pop();
            if (!curr) continue;

            const url = curr.url || curr.__url || (curr.rawItem && (curr.rawItem.url || curr.rawItem.__url));
            if (url) {
                leaves.push({
                    id: curr.id,
                    title: curr.title || curr.__title || (curr.rawItem && (curr.rawItem.title || curr.rawItem.__title)) || '',
                    url: url
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

    /**
     * 从 Chrome API 拉取近 N 天的历史记录（仅在 IndexedDB 全空冷启动时调用一次）
     */
    async function fetchRecentHistoryItems(days = DEFAULT_HISTORY_DAYS) {
        const browserAPI = (typeof chrome !== 'undefined' && chrome.history) ? chrome : ((typeof browser !== 'undefined' && browser.history) ? browser : null);
        if (!browserAPI || typeof browserAPI.history?.search !== 'function') {
            return [];
        }

        const safeDays = Math.max(1, Math.min(365, Number(days) || DEFAULT_HISTORY_DAYS));
        const startTime = Date.now() - (safeDays * 24 * 60 * 60 * 1000);

        return new Promise((resolve) => {
            try {
                browserAPI.history.search({
                    text: '',
                    startTime: startTime,
                    maxResults: 50000
                }, (results) => {
                    if (browserAPI.runtime?.lastError || !Array.isArray(results)) {
                        resolve([]);
                    } else {
                        resolve(results);
                    }
                });
            } catch (err) {
                resolve([]);
            }
        });
    }

    /**
     * 构建哈希索引（严格书签白名单反向过滤，时间切片 Chunking）
     * 支持变体多 URL 聚合，带单页应用通用标题护栏
     */
    async function buildHistoryIndexChunked(rawItems, targetInfo = null) {
        const urlMap = new Map();
        const protoAgnosticMap = new Map();
        const titleDomainMap = new Map();

        if (!Array.isArray(rawItems) || !rawItems.length) {
            return { urlMap, protoAgnosticMap, titleDomainMap };
        }

        const targets = targetInfo || internalCache.targetInfo;
        const hasTargets = !!(targets && targets.hasTargets);

        // 核心安全闸门：无有效书签白名单时绝对终止构建，防止穿透
        if (!hasTargets) {
            console.warn('[HistoryStatsService] 无有效书签白名单，跳过历史反向过滤构建（防穿透）');
            return { urlMap, protoAgnosticMap, titleDomainMap };
        }

        const targetUrls = targets.targetUrlSet;
        const targetCleanProtos = targets.targetCleanProtoMap;
        const targetTitleDomainMap = targets.targetTitleDomainMap;
        const CHUNK_SIZE = 2500;

        for (let i = 0; i < rawItems.length; i++) {
            const item = rawItems[i];
            if (!item) continue;
            const isTuple = Array.isArray(item);
            const url = isTuple ? item[0] : item.url;
            if (!url) continue;

            const parsed = parseUrlFast(url);
            if (!parsed) continue;

            const { normUrl, cleanProto, domain } = parsed;

            const rawTitle = isTuple
                ? (typeof item[1] === 'string' ? item[1].trim().toLowerCase() : '')
                : (typeof item.title === 'string' ? item.title.trim().toLowerCase() : '');

            let isBookmarkHit = false;
            let canonicalNormUrl = normUrl;
            let isExactOrProtoHit = false;

            if (normUrl && targetUrls.has(normUrl)) {
                isBookmarkHit = true;
                isExactOrProtoHit = true;
            } else if (cleanProto && targetCleanProtos.has(cleanProto)) {
                isBookmarkHit = true;
                isExactOrProtoHit = true;
                canonicalNormUrl = targetCleanProtos.get(cleanProto);
            } else if (domain && rawTitle && targetTitleDomainMap && targetTitleDomainMap.has(`${domain}:::${rawTitle}`)) {
                canonicalNormUrl = targetTitleDomainMap.get(`${domain}:::${rawTitle}`);
                // 护栏机制（保留约 80% 的模糊命中抓跳转，堵住离谱错配）：
                // 1. 若书签尚未建档，直接命中并建档（抓短链/302/JS 跳转落地页）；
                // 2. 若书签已存在但此前仅由标题匹配记录，继续吸收同标题的变体；
                // 3. 若书签已有原生精确 URL 匹配（hasExactMatch === true）：
                //    - 若原 URL 只有极少访问（如跳转源只有 1 次）且此落地页访问显著更高，允许以较大值吸收；
                //    - 否则不再盲目叠加，防止单次点击重复计算。
                const currentEntry = urlMap.get(canonicalNormUrl);
                if (!currentEntry || !currentEntry.hasExactMatch) {
                    isBookmarkHit = true;
                } else if (currentEntry && currentEntry.hasExactMatch) {
                    const itemVisits = isTuple ? (item[2] || 1) : (item.visitCount || 1);
                    if (itemVisits > (currentEntry.visitCount || 0)) {
                        isBookmarkHit = true;
                    }
                }
            }

            // 核心纯反向白名单：不是书签直接丢弃
            if (!isBookmarkHit || !canonicalNormUrl) {
                continue;
            }

            const visitCount = isTuple
                ? (Number.isFinite(item[2]) && item[2] > 0 ? Math.floor(item[2]) : 1)
                : (Number.isFinite(item.visitCount) && item.visitCount > 0 ? Math.floor(item.visitCount) : 1);
            const lastVisitTime = isTuple
                ? (Number.isFinite(item[3]) && item[3] > 0 ? item[3] : 0)
                : (Number.isFinite(item.lastVisitTime) && item.lastVisitTime > 0 ? item.lastVisitTime : 0);

            // 从快照恢复时可能附带的变体列表 (tuple[4])
            const savedVariants = isTuple && Array.isArray(item[4]) ? item[4] : null;

            let existing = urlMap.get(canonicalNormUrl);
            if (!existing) {
                existing = {
                    visitCount: 0,
                    lastVisitTime: 0,
                    title: rawTitle,
                    domain,
                    hasExactMatch: isExactOrProtoHit,
                    variants: new Map() // Map<url, { visitCount, lastVisitTime }>
                };
                urlMap.set(canonicalNormUrl, existing);
            } else if (isExactOrProtoHit) {
                existing.hasExactMatch = true;
            }

            if (savedVariants) {
                for (let k = 0; k < savedVariants.length; k++) {
                    const v = savedVariants[k];
                    if (Array.isArray(v) && v[0]) {
                        existing.variants.set(v[0], { visitCount: v[1] || 1, lastVisitTime: v[2] || 0 });
                    }
                }
            } else {
                const vEntry = existing.variants.get(url) || { visitCount: 0, lastVisitTime: 0 };
                vEntry.visitCount = Math.max(vEntry.visitCount, visitCount);
                vEntry.lastVisitTime = Math.max(vEntry.lastVisitTime, lastVisitTime);
                existing.variants.set(url, vEntry);
            }

            // 重新汇总该书签的所有变体总访问量
            let totalVisits = 0;
            let maxTime = 0;
            for (const vData of existing.variants.values()) {
                totalVisits += (vData.visitCount || 0);
                if (vData.lastVisitTime > maxTime) maxTime = vData.lastVisitTime;
            }
            existing.visitCount = Math.max(totalVisits, existing.visitCount || 0);
            existing.lastVisitTime = Math.max(maxTime, existing.lastVisitTime || 0);
            if (!existing.title && rawTitle) existing.title = rawTitle;

            if (cleanProto) {
                const existProto = protoAgnosticMap.get(cleanProto);
                if (existProto) {
                    existProto.visitCount = existing.visitCount;
                    existProto.lastVisitTime = Math.max(existProto.lastVisitTime, existing.lastVisitTime);
                } else {
                    protoAgnosticMap.set(cleanProto, { visitCount: existing.visitCount, lastVisitTime: existing.lastVisitTime });
                }
            }

            if (domain && rawTitle) {
                const compositeKey = `${domain}:::${rawTitle}`;
                const existTitle = titleDomainMap.get(compositeKey);
                if (existTitle) {
                    existTitle.visitCount = existing.visitCount;
                    existTitle.lastVisitTime = Math.max(existTitle.lastVisitTime, existing.lastVisitTime);
                } else {
                    titleDomainMap.set(compositeKey, { visitCount: existing.visitCount, lastVisitTime: existing.lastVisitTime });
                }
            }

            if (i > 0 && i % CHUNK_SIZE === 0 && i < rawItems.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        return { urlMap, protoAgnosticMap, titleDomainMap };
    }

    /**
     * 对全量冷启动时零命中的书签用原网址执行 getVisits 补查
     * 解决 302、短链、JS 跳转在 history.search 中没有原始 URL 记录的问题（P8）
     */
    async function supplementZeroHitBookmarks(urlMap, protoAgnosticMap, targetInfo) {
        const browserAPI = (typeof chrome !== 'undefined' && chrome.history) ? chrome : ((typeof browser !== 'undefined' && browser.history) ? browser : null);
        if (!browserAPI || typeof browserAPI.history?.getVisits !== 'function' || !targetInfo) return;

        const allRawUrls = targetInfo.allBookmarkRawUrls || [];
        const ninetyDaysAgo = Date.now() - (DEFAULT_HISTORY_DAYS * 24 * 60 * 60 * 1000);
        const zeroHitUrls = [];

        for (let i = 0; i < allRawUrls.length; i++) {
            const rawUrl = allRawUrls[i];
            const parsed = parseUrlFast(rawUrl);
            const normUrl = parsed ? parsed.normUrl : rawUrl;
            if (!urlMap.has(normUrl) || (urlMap.get(normUrl)?.visitCount || 0) === 0) {
                zeroHitUrls.push({ rawUrl, normUrl, domain: parsed ? parsed.domain : '', cleanProto: parsed ? parsed.cleanProto : '' });
            }
        }

        if (zeroHitUrls.length === 0) return;

        // 分批并行补查（每批 50 个），让出微任务杜绝长任务
        const BATCH_SIZE = 50;
        for (let i = 0; i < zeroHitUrls.length; i += BATCH_SIZE) {
            const batch = zeroHitUrls.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async ({ rawUrl, normUrl, domain, cleanProto }) => {
                try {
                    const visits = await new Promise((resolve) => {
                        browserAPI.history.getVisits({ url: rawUrl }, (items) => {
                            if (browserAPI.runtime?.lastError || !Array.isArray(items)) resolve([]);
                            else resolve(items);
                        });
                    });
                    const validVisits = visits.filter(v => v && v.visitTime >= ninetyDaysAgo);
                    if (validVisits.length > 0) {
                        let maxTime = 0;
                        for (let j = 0; j < validVisits.length; j++) {
                            if (validVisits[j].visitTime > maxTime) maxTime = validVisits[j].visitTime;
                        }
                        const vEntry = { visitCount: validVisits.length, lastVisitTime: maxTime };
                        const existing = urlMap.get(normUrl) || {
                            visitCount: 0,
                            lastVisitTime: 0,
                            title: '',
                            domain,
                            variants: new Map()
                        };
                        existing.variants.set(rawUrl, vEntry);
                        existing.visitCount = validVisits.length;
                        existing.lastVisitTime = maxTime;
                        urlMap.set(normUrl, existing);

                        if (cleanProto) {
                            protoAgnosticMap.set(cleanProto, { visitCount: existing.visitCount, lastVisitTime: maxTime });
                        }

                        // 记入跳转书签名单
                        if (!internalCache.redirectBookmarkUrls) {
                            internalCache.redirectBookmarkUrls = new Set();
                        }
                        internalCache.redirectBookmarkUrls.add(rawUrl);
                    }
                } catch (_) {}
            }));
            await new Promise(r => setTimeout(r, 0));
        }
    }

    /**
     * 水位线增量同步 (Watermark Delta Sync)
     * 以上次同步时间戳为基线，仅索取增量时间段流水，并对各变体精准覆盖求和
     */
    let isWatermarkSyncing = false;
    async function performWatermarkSync(lastSyncTime) {
        if (isWatermarkSyncing) return;
        const browserAPI = (typeof chrome !== 'undefined' && chrome.history) ? chrome : ((typeof browser !== 'undefined' && browser.history) ? browser : null);
        if (!browserAPI || typeof browserAPI.history?.search !== 'function') return;

        const targets = internalCache.targetInfo;
        if (!targets || !targets.hasTargets) return;

        isWatermarkSyncing = true;
        const now = Date.now();
        // 留 5 秒安全重叠时间差，防边界时钟微差
        const startTime = Math.max(0, (lastSyncTime || now) - 5000);

        try {
            const deltaItems = await new Promise((resolve) => {
                browserAPI.history.search({
                    text: '',
                    startTime: startTime,
                    endTime: now,
                    maxResults: 50000
                }, (results) => {
                    if (browserAPI.runtime?.lastError || !Array.isArray(results)) {
                        resolve([]);
                    } else {
                        resolve(results);
                    }
                });
            });

            let hasChanges = false;
            const targetUrls = targets.targetUrlSet;
            const targetCleanProtos = targets.targetCleanProtoMap;

            if (Array.isArray(deltaItems) && deltaItems.length > 0) {
                for (let i = 0; i < deltaItems.length; i++) {
                    const item = deltaItems[i];
                    if (!item || !item.url) continue;

                    const parsed = parseUrlFast(item.url);
                    if (!parsed) continue;

                    const { normUrl, cleanProto, domain } = parsed;

                    let canonicalNormUrl = null;
                    if (normUrl && targetUrls.has(normUrl)) {
                        canonicalNormUrl = normUrl;
                    } else if (cleanProto && targetCleanProtos.has(cleanProto)) {
                        canonicalNormUrl = targetCleanProtos.get(cleanProto);
                    } else if (domain && item.title && targets.targetTitleDomainMap) {
                        const rawTitle = typeof item.title === 'string' ? item.title.trim().toLowerCase() : '';
                        if (rawTitle && targets.targetTitleDomainMap.has(`${domain}:::${rawTitle}`)) {
                            canonicalNormUrl = targets.targetTitleDomainMap.get(`${domain}:::${rawTitle}`);
                        }
                    }

                    if (!canonicalNormUrl) continue;

                    const visitCount = (Number.isFinite(item.visitCount) && item.visitCount > 0) ? Math.floor(item.visitCount) : 1;
                    const lastVisitTime = (Number.isFinite(item.lastVisitTime) && item.lastVisitTime > 0) ? item.lastVisitTime : 0;

                    let existing = internalCache.urlMap.get(canonicalNormUrl);
                    if (!existing) {
                        existing = {
                            visitCount: 0,
                            lastVisitTime: 0,
                            domain,
                            title: typeof item.title === 'string' ? item.title.trim() : '',
                            variants: new Map()
                        };
                        internalCache.urlMap.set(canonicalNormUrl, existing);
                    }

                    // 覆盖该变体 URL 的当前最新总访问量（Chrome 返回的 item.visitCount 即为该具体 URL 的当前总访问量）
                    const vEntry = existing.variants.get(item.url) || { visitCount: 0, lastVisitTime: 0 };
                    if (vEntry.visitCount !== visitCount || lastVisitTime > vEntry.lastVisitTime) {
                        vEntry.visitCount = visitCount;
                        vEntry.lastVisitTime = Math.max(vEntry.lastVisitTime, lastVisitTime);
                        existing.variants.set(item.url, vEntry);

                        // 重新求和各变体
                        let totalVisits = 0;
                        let maxTime = 0;
                        for (const vData of existing.variants.values()) {
                            totalVisits += (vData.visitCount || 0);
                            if (vData.lastVisitTime > maxTime) maxTime = vData.lastVisitTime;
                        }
                        existing.visitCount = totalVisits;
                        existing.lastVisitTime = Math.max(maxTime, existing.lastVisitTime);
                        hasChanges = true;
                    }

                    if (cleanProto && internalCache.protoAgnosticMap) {
                        internalCache.protoAgnosticMap.set(cleanProto, {
                            visitCount: existing.visitCount,
                            lastVisitTime: existing.lastVisitTime
                        });
                    }
                }
            }

            // 增量核对跳转书签名单
            if (internalCache.redirectBookmarkUrls && internalCache.redirectBookmarkUrls.size > 0 && typeof browserAPI.history?.getVisits === 'function') {
                const ninetyDaysAgo = Date.now() - (DEFAULT_HISTORY_DAYS * 24 * 60 * 60 * 1000);
                for (const rUrl of internalCache.redirectBookmarkUrls) {
                    try {
                        const visits = await new Promise((res) => {
                            browserAPI.history.getVisits({ url: rUrl }, (items) => res(items || []));
                        });
                        const validVisits = visits.filter(v => v && v.visitTime >= ninetyDaysAgo);
                        const parsed = parseUrlFast(rUrl);
                        const norm = parsed ? parsed.normUrl : rUrl;
                        const existing = internalCache.urlMap.get(norm);
                        if (existing) {
                            let maxTime = 0;
                            for (let j = 0; j < validVisits.length; j++) {
                                if (validVisits[j].visitTime > maxTime) maxTime = validVisits[j].visitTime;
                            }
                            if (existing.visitCount !== validVisits.length || (maxTime > 0 && maxTime > existing.lastVisitTime)) {
                                existing.visitCount = validVisits.length;
                                if (maxTime > 0) existing.lastVisitTime = Math.max(existing.lastVisitTime, maxTime);
                                if (!existing.variants) existing.variants = new Map();
                                existing.variants.set(rUrl, { visitCount: validVisits.length, lastVisitTime: maxTime || existing.lastVisitTime || 0 });
                                if (parsed && parsed.cleanProto && internalCache.protoAgnosticMap) {
                                    internalCache.protoAgnosticMap.set(parsed.cleanProto, { visitCount: existing.visitCount, lastVisitTime: existing.lastVisitTime });
                                }
                                hasChanges = true;
                            }
                        }
                    } catch (_) {}
                }
            }

            // 新收藏书签补查：检查是否有当前在书签名单里但从未被缓存过的网址（P11）
            // 引入 zeroVisitNormUrls 记忆集合，彻底消灭未访问书签每 30 秒重复串行 IPC 轮询
            if (targets.allBookmarkRawUrls && targets.allBookmarkRawUrls.length > 0 && typeof browserAPI.history?.getVisits === 'function') {
                if (!internalCache.zeroVisitNormUrls) {
                    internalCache.zeroVisitNormUrls = new Set();
                }
                const missingUrls = [];
                for (let k = 0; k < targets.allBookmarkRawUrls.length; k++) {
                    const bUrl = targets.allBookmarkRawUrls[k];
                    const parsed = parseUrlFast(bUrl);
                    const norm = parsed ? parsed.normUrl : bUrl;
                    if (!internalCache.urlMap.has(norm) && !internalCache.zeroVisitNormUrls.has(norm)) {
                        missingUrls.push({ rawUrl: bUrl, normUrl: norm, domain: parsed ? parsed.domain : '', cleanProto: parsed ? parsed.cleanProto : '' });
                    }
                }
                if (missingUrls.length > 0) {
                    const ninetyDaysAgo = Date.now() - (DEFAULT_HISTORY_DAYS * 24 * 60 * 60 * 1000);
                    const BATCH_SIZE = 25;
                    for (let m = 0; m < missingUrls.length; m += BATCH_SIZE) {
                        const batch = missingUrls.slice(m, m + BATCH_SIZE);
                        await Promise.all(batch.map(async ({ rawUrl, normUrl, domain, cleanProto }) => {
                            try {
                                const visits = await new Promise((res) => {
                                    browserAPI.history.getVisits({ url: rawUrl }, (items) => res(items || []));
                                });
                                const validVisits = visits.filter(v => v && v.visitTime >= ninetyDaysAgo);
                                if (validVisits.length > 0) {
                                    let maxTime = 0;
                                    for (let j = 0; j < validVisits.length; j++) {
                                        if (validVisits[j].visitTime > maxTime) maxTime = validVisits[j].visitTime;
                                    }
                                    const item = {
                                        visitCount: validVisits.length,
                                        lastVisitTime: maxTime,
                                        title: '',
                                        domain,
                                        hasExactMatch: true,
                                        variants: new Map([[rawUrl, { visitCount: validVisits.length, lastVisitTime: maxTime }]])
                                    };
                                    internalCache.urlMap.set(normUrl, item);
                                    if (cleanProto && internalCache.protoAgnosticMap) {
                                        internalCache.protoAgnosticMap.set(cleanProto, { visitCount: item.visitCount, lastVisitTime: maxTime });
                                    }
                                    hasChanges = true;
                                } else {
                                    internalCache.zeroVisitNormUrls.add(normUrl);
                                }
                            } catch (_) {
                                internalCache.zeroVisitNormUrls.add(normUrl);
                            }
                        }));
                    }
                }
            }

            internalCache.lastSyncTime = now;

            if (hasChanges) {
                invalidateDomainAggregatesCache();
                saveIndexToPersistentStorage(internalCache.urlMap, now);
                dispatchStatsUpdatedEvent();
            }
        } catch (err) {
            console.warn('[HistoryStatsService] 水位线增量同步异常:', err);
        } finally {
            isWatermarkSyncing = false;
        }
    }

    /**
     * 单点极速同步单个书签的历史访问统计（按书签原网址精确查询，限定 90 天，杜绝误删清零 P5）
     */
    async function syncSingleBookmarkStats(rawBookmarkUrl) {
        const browserAPI = (typeof chrome !== 'undefined' && chrome.history) ? chrome : ((typeof browser !== 'undefined' && browser.history) ? browser : null);
        if (!browserAPI || typeof browserAPI.history?.getVisits !== 'function' || !rawBookmarkUrl) return;

        const queryUrl = String(rawBookmarkUrl).trim();
        const ninetyDaysAgo = Date.now() - (DEFAULT_HISTORY_DAYS * 24 * 60 * 60 * 1000);

        try {
            const visits = await new Promise((resolve) => {
                browserAPI.history.getVisits({ url: queryUrl }, (items) => {
                    if (browserAPI.runtime?.lastError || !Array.isArray(items)) resolve([]);
                    else resolve(items);
                });
            });

            const parsed = parseUrlFast(queryUrl);
            const normUrl = parsed ? parsed.normUrl : queryUrl;
            const validVisits = visits.filter(v => v && v.visitTime >= ninetyDaysAgo);

            if (validVisits.length > 0) {
                let lastVisitTime = 0;
                for (let i = 0; i < validVisits.length; i++) {
                    if (validVisits[i].visitTime > lastVisitTime) {
                        lastVisitTime = validVisits[i].visitTime;
                    }
                }
                if (internalCache.urlMap instanceof Map && normUrl) {
                    let existing = internalCache.urlMap.get(normUrl);
                    if (!existing) {
                        existing = {
                            visitCount: 0,
                            lastVisitTime: 0,
                            domain: parsed ? parsed.domain : extractHostname(queryUrl),
                            title: '',
                            variants: new Map()
                        };
                        internalCache.urlMap.set(normUrl, existing);
                    }
                    existing.variants.set(queryUrl, { visitCount: validVisits.length, lastVisitTime });
                    let totalVisits = 0;
                    let maxTime = 0;
                    for (const vData of existing.variants.values()) {
                        totalVisits += (vData.visitCount || 0);
                        if (vData.lastVisitTime > maxTime) maxTime = vData.lastVisitTime;
                    }
                    existing.visitCount = totalVisits;
                    existing.lastVisitTime = maxTime;

                    if (parsed && parsed.cleanProto && internalCache.protoAgnosticMap instanceof Map) {
                        internalCache.protoAgnosticMap.set(parsed.cleanProto, { visitCount: existing.visitCount, lastVisitTime: maxTime });
                    }
                }
            } else {
                if (internalCache.urlMap instanceof Map && normUrl) {
                    const existing = internalCache.urlMap.get(normUrl);
                    if (existing && existing.variants instanceof Map) {
                        existing.variants.delete(queryUrl);
                        if (existing.variants.size === 0) {
                            internalCache.urlMap.delete(normUrl);
                            if (parsed && parsed.cleanProto && internalCache.protoAgnosticMap instanceof Map) {
                                internalCache.protoAgnosticMap.delete(parsed.cleanProto);
                            }
                        } else {
                            let totalVisits = 0;
                            let maxTime = 0;
                            for (const vData of existing.variants.values()) {
                                totalVisits += (vData.visitCount || 0);
                                if (vData.lastVisitTime > maxTime) maxTime = vData.lastVisitTime;
                            }
                            existing.visitCount = totalVisits;
                            existing.lastVisitTime = maxTime;
                        }
                    } else {
                        internalCache.urlMap.delete(normUrl);
                        if (parsed && parsed.cleanProto && internalCache.protoAgnosticMap instanceof Map) {
                            internalCache.protoAgnosticMap.delete(parsed.cleanProto);
                        }
                    }
                }
            }
            invalidateDomainAggregatesCache();
        } catch (_) {}
    }

    /**
     * 检查并应用后台记录的历史记录脏标记
     * 使用书签原网址修补（杜绝 P5），持久化已对账版本号（杜绝 P2）
     */
    async function checkAndApplyHistoryDirtyState() {
        const browserAPI = (typeof chrome !== 'undefined' && chrome.storage?.local) ? chrome : ((typeof browser !== 'undefined' && browser.storage?.local) ? browser : null);
        if (!browserAPI) return { shouldForceRebuild: false };

        try {
            const data = await new Promise((resolve) => {
                browserAPI.storage.local.get([
                    'canvasHistoryStatsDirty',
                    'canvasHistoryStatsVersion',
                    'canvasHistoryStatsRemovedAll',
                    'canvasHistoryStatsPrunedAt',
                    'canvasHistoryStatsRemovedUrls'
                ], (res) => resolve(res || {}));
            });

            if (data && (data.canvasHistoryStatsDirty || data.canvasHistoryStatsVersion)) {
                const currentVersion = Number(data.canvasHistoryStatsVersion) || (data.canvasHistoryStatsDirty ? 1 : 0);
                if (currentVersion && currentVersion <= internalCache.lastAppliedVersion) {
                    return { shouldForceRebuild: false };
                }

                let shouldForceRebuild = false;
                if (data.canvasHistoryStatsRemovedAll) {
                    HistoryStatsService.clearCache();
                    internalCache.lastAppliedVersion = currentVersion;
                } else if (Array.isArray(data.canvasHistoryStatsRemovedUrls) && data.canvasHistoryStatsRemovedUrls.length > 0) {
                    const targets = internalCache.targetInfo;
                    const removedUrls = data.canvasHistoryStatsRemovedUrls;
                    const hitBookmarkRawUrls = new Set();

                    if (targets && targets.hasTargets) {
                        for (let i = 0; i < removedUrls.length; i++) {
                            const u = removedUrls[i];
                            const parsed = parseUrlFast(u);
                            if (!parsed) continue;

                            let canon = null;
                            if (parsed.normUrl && targets.targetUrlSet.has(parsed.normUrl)) {
                                canon = parsed.normUrl;
                            } else if (parsed.cleanProto && targets.targetCleanProtoMap.has(parsed.cleanProto)) {
                                canon = targets.targetCleanProtoMap.get(parsed.cleanProto);
                            }

                            if (canon && targets.normUrlToRawUrlsMap?.has(canon)) {
                                for (const raw of targets.normUrlToRawUrlsMap.get(canon)) {
                                    hitBookmarkRawUrls.add(raw);
                                }
                            } else if (targets.rawUrlToNormUrlMap?.has(u)) {
                                hitBookmarkRawUrls.add(u);
                            }
                        }
                    }

                    if (hitBookmarkRawUrls.size === 0) {
                        // 删的都是普通网页（非书签），直接 0ms 忽略，绝不重拉 10 万条历史
                        internalCache.lastAppliedVersion = currentVersion;
                        shouldForceRebuild = false;
                        saveIndexToPersistentStorage(internalCache.urlMap, internalCache.lastSyncTime);
                    } else if (hitBookmarkRawUrls.size <= 50) {
                        // 命中书签数量 <= 50 条：使用书签原网址精确修补！
                        for (const rawUrl of hitBookmarkRawUrls) {
                            await syncSingleBookmarkStats(rawUrl);
                        }
                        internalCache.lastAppliedVersion = currentVersion;
                        saveIndexToPersistentStorage(internalCache.urlMap, Date.now());
                        shouldForceRebuild = false;
                        dispatchStatsUpdatedEvent();
                    } else {
                        shouldForceRebuild = true;
                    }
                } else if (data.canvasHistoryStatsPrunedAt) {
                    shouldForceRebuild = true;
                }
                return { shouldForceRebuild, pendingVersion: shouldForceRebuild ? currentVersion : 0 };
            }
        } catch (_) {}
        return { shouldForceRebuild: false };
    }

    /**
     * 微秒级健康自检：若本地有历史缓存但系统历史数据库完全被清空，则立即清空本地缓存
     */
    async function checkHistoryEmptySanity() {
        const browserAPI = (typeof chrome !== 'undefined' && chrome.history) ? chrome : ((typeof browser !== 'undefined' && browser.history) ? browser : null);
        if (!browserAPI || typeof browserAPI.history?.search !== 'function') return;

        try {
            if (internalCache.urlMap && internalCache.urlMap.size > 0) {
                const sample = await new Promise((resolve) => {
                    browserAPI.history.search({ text: '', startTime: 0, maxResults: 1 }, (items) => {
                        if (browserAPI.runtime?.lastError) {
                            resolve(null);
                        } else {
                            resolve(items || []);
                        }
                    });
                });
                if (Array.isArray(sample) && sample.length === 0) {
                    HistoryStatsService.clearCache();
                }
            }
        } catch (_) {}
    }

    /**
     * 确保内存历史索引就绪（纯按需触发，带水位线增量与并发保护）
     */
    async function ensureHistoryStatsIndex(options = {}) {
        let force = options.force === true;
        const forceSync = options.forceSync === true;
        const days = Number(options.days) || DEFAULT_HISTORY_DAYS;
        const now = Date.now();

        // 尝试提取书签白名单：若未就绪且宿主有异步载入接口，先尝试等待载入
        if (!internalCache.targetInfo || !internalCache.targetInfo.hasTargets || options.overrideTargets === true) {
            let targetBookmarks = getTargetBookmarksSafe(options);
            if (!targetBookmarks && typeof window !== 'undefined' && typeof window.ensureCanvasSearchIndexForModeLoaded === 'function') {
                try {
                    await window.ensureCanvasSearchIndexForModeLoaded('bookmark');
                    targetBookmarks = getTargetBookmarksSafe(options);
                } catch (_) {}
            }
            if (targetBookmarks) {
                internalCache.targetInfo = extractTargetBookmarkSets(targetBookmarks);
            }
        }

        // 核心安全防线：若书签白名单尚未就绪，拒绝构建（杜绝无白名单穿透）
        if (!internalCache.targetInfo || !internalCache.targetInfo.hasTargets) {
            return {
                urlMap: internalCache.urlMap || new Map(),
                protoAgnosticMap: internalCache.protoAgnosticMap || new Map(),
                titleDomainMap: internalCache.titleDomainMap || new Map()
            };
        }

        // 0. 消费后台记录的历史记录清除/脏标记
        const dirtyState = await checkAndApplyHistoryDirtyState();
        if (dirtyState && dirtyState.shouldForceRebuild) {
            force = true;
        }

        // 1. 内存已有数据：自检后检查是否需要根据水位线补齐增量
        if (!force && internalCache.urlMap instanceof Map) {
            await checkHistoryEmptySanity();
            if (internalCache.urlMap instanceof Map) {
                // 水位线检查：若超过30秒或指定强制同步，静默增量拉取微切片（耗时 < 1ms）
                if ((forceSync || (now - (internalCache.lastSyncTime || 0) > WATERMARK_CHECK_INTERVAL_MS)) && !isWatermarkSyncing) {
                    performWatermarkSync(internalCache.lastSyncTime).catch(() => {});
                }
                return {
                    urlMap: internalCache.urlMap,
                    protoAgnosticMap: internalCache.protoAgnosticMap,
                    titleDomainMap: internalCache.titleDomainMap
                };
            }
        }

        // 2. 复用进行中的拉取/构建请求，防止并发击穿
        if (!force && internalCache.fetchingPromise) {
            return internalCache.fetchingPromise;
        }

        internalCache.fetchingPromise = (async () => {
            try {
                // 3. 优先从 IndexedDB 永久存储极速恢复（<1ms）
                if (!force) {
                    const savedData = await loadIndexFromPersistentStorage();
                    const isExpired = savedData && savedData.meta && (now - Number(savedData.meta.lastSyncTime || 0)) > (DEFAULT_HISTORY_DAYS * 24 * 60 * 60 * 1000);
                    if (savedData && !isExpired && Array.isArray(savedData.compactItems) && savedData.compactItems.length > 0) {
                        // 恢复上次已处理版本号，杜绝反复判定为脏并全量重拉（P2）
                        internalCache.lastAppliedVersion = Number(savedData.meta?.lastAppliedVersion) || 0;
                        internalCache.redirectBookmarkUrls = new Set(Array.isArray(savedData.meta?.redirectUrls) ? savedData.meta.redirectUrls : []);

                        let itemsToBuild = savedData.compactItems;
                        const { urlMap, protoAgnosticMap, titleDomainMap } = await buildHistoryIndexChunked(
                            itemsToBuild,
                            internalCache.targetInfo
                        );
                        internalCache.urlMap = urlMap;
                        internalCache.protoAgnosticMap = protoAgnosticMap;
                        internalCache.titleDomainMap = titleDomainMap;
                        internalCache.loadedAt = Date.now();
                        internalCache.lastSyncTime = savedData.meta?.lastSyncTime || Date.now();
                        invalidateDomainAggregatesCache();

                        // 兜底自检：若浏览器实际历史已被清空，立即清空本地缓存
                        await checkHistoryEmptySanity();
                        if (!internalCache.urlMap) {
                            return {
                                urlMap: new Map(),
                                protoAgnosticMap: new Map(),
                                titleDomainMap: new Map()
                            };
                        }

                        // 若已持久化的水位线距离当前时间超过间隔，立刻按水位线补齐增量
                        if (Date.now() - internalCache.lastSyncTime > WATERMARK_CHECK_INTERVAL_MS) {
                            performWatermarkSync(internalCache.lastSyncTime).catch(() => {});
                        }

                        dispatchStatsUpdatedEvent();

                        return { urlMap, protoAgnosticMap, titleDomainMap };
                    }
                }

                // 4. 首次使用（冷启动）：向 Chrome API 全量拉取 90 天历史并反向过滤
                const rawItems = await fetchRecentHistoryItems(days);
                const { urlMap, protoAgnosticMap, titleDomainMap } = await buildHistoryIndexChunked(rawItems, internalCache.targetInfo);

                // 对零命中的书签用原网址执行 getVisits 补查（解决短链/302/JS跳转 P8）
                await supplementZeroHitBookmarks(urlMap, protoAgnosticMap, internalCache.targetInfo);

                internalCache.urlMap = urlMap;
                internalCache.protoAgnosticMap = protoAgnosticMap;
                internalCache.titleDomainMap = titleDomainMap;
                internalCache.loadedAt = Date.now();
                internalCache.lastSyncTime = Date.now();
                invalidateDomainAggregatesCache();

                if (dirtyState && dirtyState.pendingVersion) {
                    internalCache.lastAppliedVersion = dirtyState.pendingVersion;
                }

                // 持久化到 IndexedDB（体积仅约 50KB）
                saveIndexToPersistentStorage(urlMap, internalCache.lastSyncTime);

                dispatchStatsUpdatedEvent();

                return { urlMap, protoAgnosticMap, titleDomainMap };
            } catch (err) {
                console.warn('[HistoryStatsService] 构建历史索引异常:', err);
                return {
                    urlMap: internalCache.urlMap || new Map(),
                    protoAgnosticMap: internalCache.protoAgnosticMap || new Map(),
                    titleDomainMap: internalCache.titleDomainMap || new Map()
                };
            } finally {
                internalCache.fetchingPromise = null;
            }
        })();

        return internalCache.fetchingPromise;
    }

    /**
     * 获取单个书签或文件夹的统计（查表，0.001ms 响应）
     */
    function getBookmarkStatsFromIndex(bookmark, index = null) {
        const idx = index || internalCache;
        if (!bookmark || !idx || !(idx.urlMap instanceof Map)) {
            return { visitCount: 0, lastVisitTime: 0 };
        }

        const nodeType = bookmark.nodeType || (bookmark.rawItem && bookmark.rawItem.nodeType);
        const url = bookmark.url || bookmark.__url || (bookmark.rawItem && (bookmark.rawItem.url || bookmark.rawItem.__url)) || '';

        // 如果是文件夹或无 URL 节点，穿透聚合其子书签
        if (nodeType === 'folder' || !url) {
            const leaves = extractLeafBookmarks(bookmark.rawItem || bookmark);
            if (leaves.length > 0) {
                const folderStats = computeFolderAggregatedStats(leaves, idx);
                return {
                    visitCount: folderStats.totalVisits || 0,
                    lastVisitTime: folderStats.lastVisitTime || (folderStats.topBookmark ? (folderStats.topBookmark.lastVisitTime || 0) : 0),
                    folderStats
                };
            }
            return { visitCount: 0, lastVisitTime: 0 };
        }

        // 1. URL 主索引精确匹配
        const normUrl = normalizeHistoryUrl(url);
        if (normUrl && idx.urlMap.has(normUrl)) {
            return idx.urlMap.get(normUrl);
        }

        // 2. 协议与 www 无关匹配
        const cleanProto = getProtoAgnosticUrl(normUrl);
        if (cleanProto && idx.protoAgnosticMap instanceof Map && idx.protoAgnosticMap.has(cleanProto)) {
            return idx.protoAgnosticMap.get(cleanProto);
        }

        // 3. 域名 + 标题 辅索引匹配
        const title = bookmark.title || bookmark.__title || (bookmark.rawItem && (bookmark.rawItem.title || bookmark.rawItem.__title)) || '';
        const cleanTitle = typeof title === 'string' ? title.trim().toLowerCase() : '';
        const domain = extractHostname(url);
        if (domain && cleanTitle && idx.titleDomainMap instanceof Map) {
            const key = `${domain}:::${cleanTitle}`;
            if (idx.titleDomainMap.has(key)) {
                return idx.titleDomainMap.get(key);
            }
        }

        return { visitCount: 0, lastVisitTime: 0 };
    }

    /**
     * 单 URL 精确查询（专用于打开右键详情弹窗时按需单点获取，无需加载全量大库）
     * 优先直接按原网址调用 Chrome getVisits（耗时 <0.1ms），获取秒级最新的真实访问量，并回刷内存
     */
    async function getSingleUrlHistoryStats(targetUrl, targetTitle = '') {
        if (!targetUrl || typeof targetUrl !== 'string') {
            return { visitCount: 0, lastVisitTime: 0 };
        }

        const browserAPI = (typeof chrome !== 'undefined' && chrome.history) ? chrome : ((typeof browser !== 'undefined' && browser.history) ? browser : null);
        const ninetyDaysAgo = Date.now() - (DEFAULT_HISTORY_DAYS * 24 * 60 * 60 * 1000);

        // 1. 优先直接调 Chrome getVisits 精确查询原网址（单条极速耗时 <0.1ms，获取秒级最新权威数据）
        if (browserAPI && typeof browserAPI.history?.getVisits === 'function') {
            try {
                const visits = await new Promise((resolve) => {
                    browserAPI.history.getVisits({ url: targetUrl }, (items) => {
                        if (browserAPI.runtime?.lastError || !Array.isArray(items)) {
                            resolve(null);
                        } else {
                            resolve(items);
                        }
                    });
                });

                if (Array.isArray(visits) && visits.length > 0) {
                    const validVisits = visits.filter(v => v && v.visitTime >= ninetyDaysAgo);
                    if (validVisits.length > 0) {
                        let maxTime = 0;
                        for (let i = 0; i < validVisits.length; i++) {
                            if (validVisits[i].visitTime > maxTime) maxTime = validVisits[i].visitTime;
                        }
                        const result = {
                            visitCount: validVisits.length,
                            lastVisitTime: maxTime
                        };

                        // 同步刷新进内存缓存，保持内存数据时刻最新
                        if (internalCache.urlMap instanceof Map) {
                            const parsed = parseUrlFast(targetUrl);
                            const norm = parsed ? parsed.normUrl : targetUrl;
                            if (norm) {
                                let existing = internalCache.urlMap.get(norm);
                                if (!existing && validVisits.length > 0) {
                                    existing = {
                                        visitCount: validVisits.length,
                                        lastVisitTime: maxTime,
                                        domain: parsed ? parsed.domain : extractHostname(targetUrl),
                                        title: targetTitle,
                                        variants: new Map([[targetUrl, { visitCount: validVisits.length, lastVisitTime: maxTime }]])
                                    };
                                    internalCache.urlMap.set(norm, existing);
                                    invalidateDomainAggregatesCache();
                                } else if (existing) {
                                    existing.variants.set(targetUrl, { visitCount: validVisits.length, lastVisitTime: maxTime });
                                    let totalVisits = 0;
                                    let mTime = 0;
                                    for (const vData of existing.variants.values()) {
                                        totalVisits += (vData.visitCount || 0);
                                        if (vData.lastVisitTime > mTime) mTime = vData.lastVisitTime;
                                    }
                                    existing.visitCount = totalVisits;
                                    existing.lastVisitTime = mTime;
                                    invalidateDomainAggregatesCache();
                                }
                            }
                        }

                        return result;
                    }
                }
            } catch (_) {}
        }

        // 2. 若直接原网址未命中，平滑回退至内存快照与变体聚合（例如书签包含追踪参数变体或跳转落地页）
        if (internalCache.urlMap instanceof Map) {
            const stats = getBookmarkStatsFromIndex({ url: targetUrl, title: targetTitle });
            if (stats && stats.visitCount > 0) {
                return stats;
            }
        }

        return { visitCount: 0, lastVisitTime: 0 };
    }

    /**
     * 计算文件夹的聚合访问统计
     */
    function computeFolderAggregatedStats(childBookmarks, index = null) {
        if (!Array.isArray(childBookmarks) || childBookmarks.length === 0) {
            return { totalVisits: 0, bookmarkCount: 0, topBookmark: null };
        }

        const idx = index || internalCache;
        let totalVisits = 0;
        let topBookmark = null;
        let maxVisits = 0;
        let validBookmarkCount = 0;
        let maxLastVisit = 0;

        for (let i = 0; i < childBookmarks.length; i++) {
            const bm = childBookmarks[i];
            if (!bm || (!bm.url && !bm.__url)) continue;
            validBookmarkCount++;

            const stats = getBookmarkStatsFromIndex(bm, idx);
            const visits = stats ? (stats.visitCount || 0) : 0;
            totalVisits += visits;
            if (stats && stats.lastVisitTime > maxLastVisit) {
                maxLastVisit = stats.lastVisitTime;
            }

            if (visits > maxVisits) {
                maxVisits = visits;
                topBookmark = {
                    title: bm.title || bm.__title || bm.url || '',
                    visitCount: visits,
                    url: bm.url || bm.__url || '',
                    lastVisitTime: stats ? (stats.lastVisitTime || 0) : 0
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

    /**
     * 获取指定域名的累计访问量（动态从书签统计汇总，天然支持主域名与子域名，解决 P1/P9）
     */
    function getDomainStats(domain) {
        if (!domain || !(internalCache.urlMap instanceof Map)) {
            return { visitCount: 0, lastVisitTime: 0 };
        }
        const clean = String(domain).toLowerCase().replace(/^www\./i, '');
        if (!internalCache.domainAggregatesCache) {
            internalCache.domainAggregatesCache = buildDomainAggregatesCache();
        }
        return internalCache.domainAggregatesCache.get(clean) || { visitCount: 0, lastVisitTime: 0 };
    }

    /**
     * 监听后台分发的历史记录变更通知（基于单调递增版本号与 Storage 驱动）
     */
    function setupStorageSyncListener() {
        const browserAPI = (typeof chrome !== 'undefined' && chrome.storage?.local) ? chrome : ((typeof browser !== 'undefined' && browser.storage?.local) ? browser : null);
        if (!browserAPI) return;

        try {
            if (typeof browserAPI.storage?.onChanged?.addListener === 'function') {
                browserAPI.storage.onChanged.addListener((changes, areaName) => {
                    if (areaName === 'local' && (changes.canvasHistoryStatsVersion || changes.canvasHistoryStatsDirty)) {
                        checkAndApplyHistoryDirtyState().then((res) => {
                            if (res && res.shouldForceRebuild) {
                                ensureHistoryStatsIndex({ force: true }).catch(() => {});
                            }
                        }).catch(() => {});
                    }
                });
            }
        } catch (_) {}

        // 当用户从其他应用切回当前标签页或侧边栏时，按需轻量检查（静默懒更新）
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', () => {
                if (internalCache.urlMap instanceof Map) {
                    checkAndApplyHistoryDirtyState().catch(() => {});
                }
            });
        }
    }

    setupStorageSyncListener();

    // 导出全局对象
    const HistoryStatsService = {
        normalizeHistoryUrl,
        getProtoAgnosticUrl,
        extractHostname,
        extractLeafBookmarks,
        setBookmarkTargets,
        registerBookmarkProvider,
        ensureHistoryStatsIndex,
        getBookmarkStatsFromIndex,
        getSingleUrlHistoryStats,
        syncSingleBookmarkStats: async (targetUrl, targetTitle = '') => {
            if (!targetUrl || typeof targetUrl !== 'string') return { visitCount: 0, lastVisitTime: 0 };
            const stats = await getSingleUrlHistoryStats(targetUrl, targetTitle);
            if (stats && stats.visitCount > 0 && internalCache.urlMap instanceof Map) {
                const parsed = parseUrlFast(targetUrl);
                const norm = parsed ? parsed.normUrl : targetUrl;
                if (norm) {
                    let existing = internalCache.urlMap.get(norm);
                    if (!existing) {
                        existing = {
                            visitCount: stats.visitCount,
                            lastVisitTime: stats.lastVisitTime,
                            domain: parsed ? parsed.domain : extractHostname(targetUrl),
                            title: targetTitle,
                            variants: new Map([[targetUrl, { visitCount: stats.visitCount, lastVisitTime: stats.lastVisitTime }]])
                        };
                        internalCache.urlMap.set(norm, existing);
                    } else {
                        existing.variants.set(targetUrl, { visitCount: stats.visitCount, lastVisitTime: stats.lastVisitTime });
                        let totalVisits = 0;
                        let maxTime = 0;
                        for (const vData of existing.variants.values()) {
                            totalVisits += (vData.visitCount || 0);
                            if (vData.lastVisitTime > maxTime) maxTime = vData.lastVisitTime;
                        }
                        existing.visitCount = totalVisits;
                        existing.lastVisitTime = maxTime;
                    }
                    invalidateDomainAggregatesCache();
                    saveIndexToPersistentStorage(internalCache.urlMap, Date.now());
                }
            }
            return stats;
        },
        computeFolderAggregatedStats,
        getDomainStats,
        performIncrementalDeltaSync: () => performWatermarkSync(internalCache.lastSyncTime),
        isCacheReady: () => !!(internalCache.urlMap instanceof Map),
        clearCache: () => {
            if (persistentSaveTimer) {
                clearTimeout(persistentSaveTimer);
                persistentSaveTimer = null;
            }
            internalCache.urlMap = null;
            internalCache.protoAgnosticMap = null;
            internalCache.titleDomainMap = null;
            internalCache.domainAggregatesCache = null;
            internalCache.redirectBookmarkUrls = null;
            if (internalCache.zeroVisitNormUrls) {
                internalCache.zeroVisitNormUrls.clear();
            }
            internalCache.loadedAt = 0;
            internalCache.lastSyncTime = 0;

            if (typeof window !== 'undefined' && window.SearchIndexDb && typeof window.SearchIndexDb.saveBookmarkVisitStats === 'function') {
                window.SearchIndexDb.saveBookmarkVisitStats(null).catch?.(() => {});
            }
            dispatchStatsUpdatedEvent();
        }
    };

    root.HistoryStatsService = HistoryStatsService;

})(typeof window !== 'undefined' ? window : globalThis);
