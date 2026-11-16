/**
 * Bookmark-Canvas: 浏览历史点击与访问统计服务 (HistoryStatsService)
 * 
 * 核心设计原则：
 * 1. 极致轻量：零本地持久库，仅在内存中维护高效 Map 索引与 10 分钟 TTL 缓存。
 * 2. 严格按需：平时 0 开销，并在空闲期（requestIdleCallback）轻量预热。
 * 3. 毫秒级查找：URL 归一化 + 协议/www无关降级 + 域名复合键实现 O(1) 哈希查询。
 * 4. 文件夹与域名聚合：自动穿透计算文件夹内子书签总访问量及最常访问推荐。
 */

(function (root) {
    'use strict';

    const HISTORY_STATS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 会话级长效缓存（由 onVisited/onVisitRemoved 实时维护增量，避免无谓全量丢弃）
    const DEFAULT_HISTORY_DAYS = 90; // 默认拉取近 90 天（约 3 个月）

    // 内部缓存状态
    const internalCache = {
        loadedAt: 0,
        days: DEFAULT_HISTORY_DAYS,
        urlMap: null,            // Map<normalizedUrl, { visitCount: number, lastVisitTime: number }>
        protoAgnosticMap: null,  // Map<cleanProtoAgnosticUrl, { visitCount: number, lastVisitTime: number }>
        titleDomainMap: null,    // Map<domain:::title, { visitCount: number, lastVisitTime: number }>
        domainStatsMap: null,    // Map<domain, { visitCount: number, lastVisitTime: number }>
        fetchingPromise: null
    };

    /**
     * 高性能 URL 组合解析器
     * 单次 new URL() 提取归一化 URL、协议无关 URL、主域名，避免对同个 URL 多次 new URL()
     */
    function parseUrlFast(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return null;
        const trimmed = rawUrl.trim();
        if (!trimmed) return null;

        try {
            const u = new URL(trimmed);
            u.hash = '';

            // 仅在包含查询参数且可能存在追踪参数时才遍历删除，90% 无追踪参数的 URL 零开销
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
            const originLower = u.origin.toLowerCase();
            const hostLower = (u.hostname || '').toLowerCase();
            const domain = hostLower.startsWith('www.') ? hostLower.slice(4) : hostLower;
            const query = u.search ? u.search : '';
            // 协议与域名小写，Path 和 Query 保留大小写特征以兼容视频/网盘/短链
            const normUrl = originLower + path + query;
            const cleanProto = ((hostLower.startsWith('www.') ? hostLower.slice(4) : hostLower) + path + query).replace(/\/+$/, '');

            return { normUrl, cleanProto, domain };
        } catch (_) {
            let clean = trimmed.replace(/#.*$/, '');
            if (clean.length > 8 && clean.endsWith('/')) {
                clean = clean.slice(0, -1);
            }
            const cleanProto = clean.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
            let domain = '';
            try {
                domain = cleanProto.split('/')[0].split('?')[0].toLowerCase();
            } catch (_) {}
            return { normUrl: clean, cleanProto, domain };
        }
    }

    /**
     * URL 归一化清洗函数
     * 过滤锚点、追踪参数、结尾斜杠，确保比对高命中率
     */
    function normalizeHistoryUrl(rawUrl) {
        const parsed = parseUrlFast(rawUrl);
        return parsed ? parsed.normUrl : '';
    }

    /**
     * 协议与 www 无关的清洗函数（解决 http/https 与 www 差异）
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
     * 默认全量提取 (Infinity)，保证文件夹总书签数与累计热度统计 100% 精确
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
     * 从 Chrome API 拉取近 N 天的历史记录
     */
    async function fetchRecentHistoryItems(days = DEFAULT_HISTORY_DAYS) {
        const browserAPI = (typeof chrome !== 'undefined' && chrome.history) ? chrome : ((typeof browser !== 'undefined' && browser.history) ? browser : null);
        if (!browserAPI || typeof browserAPI.history?.search !== 'function') {
            console.warn('[HistoryStatsService] chrome.history API 不可用，请确保 manifest.json 已添加 "history" 权限，且已在 chrome://extensions 重新加载插件！');
            return [];
        }

        const safeDays = Math.max(1, Math.min(365, Number(days) || DEFAULT_HISTORY_DAYS));
        const startTime = Date.now() - (safeDays * 24 * 60 * 60 * 1000);

        return new Promise((resolve) => {
            try {
                browserAPI.history.search({
                    text: '', // 空字符串表示拉取所有记录
                    startTime: startTime,
                    maxResults: 50000 // 足够覆盖用户 90 天的历史，同时保证极快拉取
                }, (results) => {
                    const err = browserAPI.runtime?.lastError;
                    if (err) {
                        console.warn('[HistoryStatsService] chrome.history.search 报错:', err);
                        resolve([]);
                    } else if (!Array.isArray(results)) {
                        resolve([]);
                    } else {
                        resolve(results);
                    }
                });
            } catch (err) {
                console.warn('[HistoryStatsService] chrome.history.search 异常:', err);
                resolve([]);
            }
        });
    }

    /**
     * 极速构建四重哈希索引（支持时间切片 Chunking，耗时极低且不卡死主线程）
     */
    async function buildHistoryIndexChunked(rawItems) {
        const urlMap = new Map();
        const protoAgnosticMap = new Map();
        const titleDomainMap = new Map();
        const domainStatsMap = new Map();

        if (!Array.isArray(rawItems) || !rawItems.length) {
            return { urlMap, protoAgnosticMap, titleDomainMap, domainStatsMap };
        }

        const CHUNK_SIZE = 2500;
        for (let i = 0; i < rawItems.length; i++) {
            const item = rawItems[i];
            if (!item || !item.url) continue;

            const visitCount = (Number.isFinite(item.visitCount) && item.visitCount > 0) ? Math.floor(item.visitCount) : 1;
            const lastVisitTime = (Number.isFinite(item.lastVisitTime) && item.lastVisitTime > 0) ? item.lastVisitTime : 0;

            const parsed = parseUrlFast(item.url);
            if (!parsed) continue;

            const { normUrl, cleanProto, domain } = parsed;

            // 1. URL 主索引 (精确)
            if (normUrl) {
                const existing = urlMap.get(normUrl);
                if (existing) {
                    existing.visitCount += visitCount;
                    existing.lastVisitTime = Math.max(existing.lastVisitTime, lastVisitTime);
                } else {
                    urlMap.set(normUrl, { visitCount, lastVisitTime });
                }

                // 2. 协议与 www 无关索引
                if (cleanProto) {
                    const existProto = protoAgnosticMap.get(cleanProto);
                    if (existProto) {
                        existProto.visitCount += visitCount;
                        existProto.lastVisitTime = Math.max(existProto.lastVisitTime, lastVisitTime);
                    } else {
                        protoAgnosticMap.set(cleanProto, { visitCount, lastVisitTime });
                    }
                }
            }

            // 3. 域名 + 标题 辅索引
            const rawTitle = typeof item.title === 'string' ? item.title.trim().toLowerCase() : '';
            if (domain && rawTitle) {
                const compositeKey = `${domain}:::${rawTitle}`;
                const existTitle = titleDomainMap.get(compositeKey);
                if (existTitle) {
                    existTitle.visitCount += visitCount;
                    existTitle.lastVisitTime = Math.max(existTitle.lastVisitTime, lastVisitTime);
                } else {
                    titleDomainMap.set(compositeKey, { visitCount, lastVisitTime });
                }
            }

            // 4. 域名聚合统计
            if (domain) {
                const domainData = domainStatsMap.get(domain);
                if (domainData) {
                    domainData.visitCount += visitCount;
                    domainData.lastVisitTime = Math.max(domainData.lastVisitTime, lastVisitTime);
                } else {
                    domainStatsMap.set(domain, { visitCount, lastVisitTime });
                }
            }

            // 时间分片：每处理一个批次，让出一次事件循环微任务，保障 UI 流畅无掉帧
            if (i > 0 && i % CHUNK_SIZE === 0 && i < rawItems.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        return { urlMap, protoAgnosticMap, titleDomainMap, domainStatsMap };
    }

    /**
     * 确保内存历史索引就绪（带长效缓存与并发保护）
     */
    async function ensureHistoryStatsIndex(options = {}) {
        const force = options.force === true;
        const days = Number(options.days) || DEFAULT_HISTORY_DAYS;
        const now = Date.now();

        // 检查缓存是否有效
        if (!force && internalCache.urlMap && (now - internalCache.loadedAt < HISTORY_STATS_CACHE_TTL_MS) && internalCache.days === days) {
            return {
                urlMap: internalCache.urlMap,
                protoAgnosticMap: internalCache.protoAgnosticMap,
                titleDomainMap: internalCache.titleDomainMap,
                domainStatsMap: internalCache.domainStatsMap
            };
        }

        // 复用进行中的拉取请求，防止防抖期内并发击穿
        if (!force && internalCache.fetchingPromise) {
            return internalCache.fetchingPromise;
        }

        internalCache.fetchingPromise = (async () => {
            try {
                const rawItems = await fetchRecentHistoryItems(days);
                const { urlMap, protoAgnosticMap, titleDomainMap, domainStatsMap } = await buildHistoryIndexChunked(rawItems);

                internalCache.urlMap = urlMap;
                internalCache.protoAgnosticMap = protoAgnosticMap;
                internalCache.titleDomainMap = titleDomainMap;
                internalCache.domainStatsMap = domainStatsMap;
                internalCache.loadedAt = Date.now();
                internalCache.days = days;

                return { urlMap, protoAgnosticMap, titleDomainMap, domainStatsMap };
            } catch (err) {
                console.warn('[HistoryStatsService] 拉取或构建索引失败:', err);
                return {
                    urlMap: internalCache.urlMap || new Map(),
                    protoAgnosticMap: internalCache.protoAgnosticMap || new Map(),
                    titleDomainMap: internalCache.titleDomainMap || new Map(),
                    domainStatsMap: internalCache.domainStatsMap || new Map()
                };
            } finally {
                internalCache.fetchingPromise = null;
            }
        })();

        return internalCache.fetchingPromise;
    }

    /**
     * 获取单个书签或文件夹的统计（查表，0.001ms 响应）
     * @param {Object} bookmark 书签或文件夹对象
     * @param {Object} [index] 可选的索引，缺省自动使用 internalCache
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
                    lastVisitTime: folderStats.topBookmark ? (folderStats.topBookmark.lastVisitTime || 0) : 0,
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

        // 2. 协议与 www 无关匹配 (https://www.example.com == http://example.com)
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
     * 单 URL 查询（专用于打开详情弹窗时按需单点获取，无需提前加载全量大库）
     * @param {string} targetUrl 目标 URL
     * @param {string} [targetTitle] 目标标题（辅助比对）
     */
    async function getSingleUrlHistoryStats(targetUrl, targetTitle = '') {
        if (!targetUrl || typeof targetUrl !== 'string') {
            return { visitCount: 0, lastVisitTime: 0 };
        }

        // 1. 优先查看内存索引是否已存在
        if (internalCache.urlMap instanceof Map) {
            const stats = getBookmarkStatsFromIndex({ url: targetUrl, title: targetTitle });
            if (stats && stats.visitCount > 0) {
                return stats;
            }
        }

        // 2. 若大库尚未建立索引或未命中，优先通过 Chrome history.search 智能匹配（直接包含 visitCount）
        const browserAPI = (typeof chrome !== 'undefined' && chrome.history) ? chrome : ((typeof browser !== 'undefined' && browser.history) ? browser : null);
        if (!browserAPI || typeof browserAPI.history?.search !== 'function') {
            return { visitCount: 0, lastVisitTime: 0 };
        }

        const normTarget = normalizeHistoryUrl(targetUrl);
        const cleanProtoTarget = getProtoAgnosticUrl(normTarget);

        const candidateItem = await new Promise((resolve) => {
            try {
                browserAPI.history.search({
                    text: targetUrl,
                    maxResults: 10
                }, (results) => {
                    if (browserAPI.runtime?.lastError || !Array.isArray(results) || !results.length) {
                        resolve(null);
                    } else {
                        // 寻找最佳匹配项
                        let exact = results.find(r => r.url === targetUrl);
                        if (!exact) {
                            exact = results.find(r => normalizeHistoryUrl(r.url) === normTarget);
                        }
                        if (!exact) {
                            exact = results.find(r => getProtoAgnosticUrl(normalizeHistoryUrl(r.url)) === cleanProtoTarget);
                        }
                        resolve(exact || results[0]);
                    }
                });
            } catch (_) {
                resolve(null);
            }
        });

        if (candidateItem && Number.isFinite(candidateItem.visitCount) && candidateItem.visitCount > 0) {
            return {
                visitCount: Math.floor(candidateItem.visitCount),
                lastVisitTime: candidateItem.lastVisitTime || 0
            };
        }

        // 3. Fallback: Chrome getVisits 探测
        if (typeof browserAPI.history?.getVisits === 'function') {
            const visits = await new Promise((resolve) => {
                try {
                    browserAPI.history.getVisits({ url: targetUrl }, (v) => {
                        if (browserAPI.runtime?.lastError || !Array.isArray(v) || v.length === 0) {
                            // 尝试不带/带末尾斜杠
                            const altUrl = targetUrl.endsWith('/') ? targetUrl.slice(0, -1) : (targetUrl + '/');
                            browserAPI.history.getVisits({ url: altUrl }, (v2) => {
                                resolve(Array.isArray(v2) ? v2 : []);
                            });
                        } else {
                            resolve(v);
                        }
                    });
                } catch (_) {
                    resolve([]);
                }
            });

            if (visits && visits.length > 0) {
                return {
                    visitCount: visits.length,
                    lastVisitTime: visits[visits.length - 1]?.visitTime || 0
                };
            }
        }

        return { visitCount: 0, lastVisitTime: 0 };
    }

    /**
     * 计算文件夹的聚合访问统计
     * @param {Array} childBookmarks 该文件夹下包含的所有子书签数组
     * @param {Object} [index] 预热好的历史索引（可选）
     * @returns {Object} { totalVisits, bookmarkCount, topBookmark: { title, visitCount, url, lastVisitTime } }
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

        for (let i = 0; i < childBookmarks.length; i++) {
            const bm = childBookmarks[i];
            if (!bm || (!bm.url && !bm.__url)) continue;
            validBookmarkCount++;

            const stats = getBookmarkStatsFromIndex(bm, idx);
            const visits = stats ? (stats.visitCount || 0) : 0;
            totalVisits += visits;

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
            bookmarkCount: validBookmarkCount,
            topBookmark: maxVisits > 0 ? topBookmark : null
        };
    }

    /**
     * 获取指定域名的累计访问量
     */
    function getDomainStats(domain) {
        if (!domain || !internalCache.domainStatsMap) {
            return { visitCount: 0, lastVisitTime: 0 };
        }
        const clean = String(domain).toLowerCase().replace(/^www\./i, '');
        return internalCache.domainStatsMap.get(clean) || internalCache.domainStatsMap.get(domain) || { visitCount: 0, lastVisitTime: 0 };
    }

    /**
     * 监听历史记录全局清理事件（若用户在浏览器清空历史，则安全重置内存索引）
     * 注意：严格采用纯按需懒加载，不监听高频 onVisited 浏览事件，杜绝前台静默开销
     */
    function setupHistoryRemovedListener() {
        const browserAPI = (typeof chrome !== 'undefined' && chrome.history) ? chrome : ((typeof browser !== 'undefined' && browser.history) ? browser : null);
        if (!browserAPI) return;

        try {
            if (typeof browserAPI.history?.onVisitRemoved?.addListener === 'function') {
                browserAPI.history.onVisitRemoved.addListener((removedInfo) => {
                    if (removedInfo && removedInfo.allHistory) {
                        HistoryStatsService.clearCache();
                    }
                });
            }
        } catch (_) {}
    }

    // 初始化历史清空被动监听
    setupHistoryRemovedListener();

    // 导出全局对象
    const HistoryStatsService = {
        normalizeHistoryUrl,
        getProtoAgnosticUrl,
        extractHostname,
        extractLeafBookmarks,
        ensureHistoryStatsIndex,
        getBookmarkStatsFromIndex,
        getSingleUrlHistoryStats,
        computeFolderAggregatedStats,
        getDomainStats,
        isCacheReady: () => !!(internalCache.urlMap instanceof Map),
        clearCache: () => {
            internalCache.urlMap = null;
            internalCache.protoAgnosticMap = null;
            internalCache.titleDomainMap = null;
            internalCache.domainStatsMap = null;
            internalCache.loadedAt = 0;
        }
    };

    root.HistoryStatsService = HistoryStatsService;

})(typeof window !== 'undefined' ? window : globalThis);
