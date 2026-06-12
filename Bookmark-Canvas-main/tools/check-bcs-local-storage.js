(function installBcsLocalStorageChecker(global) {
    'use strict';

    const STORAGE_KEYS = Object.freeze({
        TEMP_SNAPSHOT: 'bcs:temp-state-snapshot',
        META: 'bcs:meta',
        CANVAS: 'bcs:canvas',
        SECTION_PREFIX: 'bcs:section:',
        PERM_MAIN: 'bcs:perm:main',
        PERM_COPY_PREFIX: 'bcs:perm:copy-',
        SIGNAL: 'bcs:signal'
    });

    const CURRENT_SECTION_FORMAT = 'bookmark-canvas-section';
    const CURRENT_BCS_META_SCHEMA_VERSION = 5;
    const LEGACY_IDENTITY_PATTERN = /(?:\bsourceID\b|\bsourceId\b|\bsource_id\b|source-id|data-source-id|\boriginalId\b|bcs:perm:source)/i;

    function isRecord(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function isStorageGetApi(api) {
        return !!(api && typeof api.get === 'function');
    }

    function safeParseJson(text) {
        if (typeof text !== 'string') return null;
        const trimmed = text.trim();
        if (!trimmed) return null;
        if (trimmed[0] !== '{' && trimmed[0] !== '[') return null;
        try {
            return JSON.parse(trimmed);
        } catch (_) {
            return null;
        }
    }

    function normalizeLocalStorageValue(value) {
        const parsed = safeParseJson(value);
        return parsed !== null ? parsed : value;
    }

    function readStorageArea(api) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const done = (result, error) => {
                if (settled) return;
                settled = true;
                if (error) {
                    reject(error);
                    return;
                }
                resolve(result && typeof result === 'object' ? result : {});
            };

            try {
                const maybePromise = api.get(null, (result) => {
                    const lastError = global.chrome && global.chrome.runtime
                        ? global.chrome.runtime.lastError
                        : null;
                    if (lastError) {
                        done(null, new Error(lastError.message || String(lastError)));
                        return;
                    }
                    done(result || {});
                });
                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.then((result) => done(result || {})).catch((error) => done(null, error));
                }
            } catch (callbackError) {
                try {
                    const maybePromise = api.get(null);
                    if (maybePromise && typeof maybePromise.then === 'function') {
                        maybePromise.then((result) => done(result || {})).catch((error) => done(null, error));
                        return;
                    }
                } catch (_) { }
                done(null, callbackError);
            }
        });
    }

    async function readAllLocalStorage() {
        const chromeArea = global.chrome && global.chrome.storage ? global.chrome.storage.local : null;
        if (isStorageGetApi(chromeArea)) {
            return {
                source: 'chrome.storage.local',
                storage: await readStorageArea(chromeArea)
            };
        }

        const browserArea = global.browser && global.browser.storage ? global.browser.storage.local : null;
        if (isStorageGetApi(browserArea)) {
            return {
                source: 'browser.storage.local',
                storage: await readStorageArea(browserArea)
            };
        }

        if (global.localStorage && typeof global.localStorage.length === 'number') {
            const storage = {};
            for (let i = 0; i < global.localStorage.length; i += 1) {
                const key = global.localStorage.key(i);
                if (!key) continue;
                storage[key] = normalizeLocalStorageValue(global.localStorage.getItem(key));
            }
            return {
                source: 'localStorage',
                storage
            };
        }

        throw new Error('No chrome.storage.local, browser.storage.local, or localStorage is available in this context.');
    }

    function createReport(source, storage) {
        return {
            ok: false,
            generatedAt: new Date().toISOString(),
            source,
            summary: {
                storageKeys: Object.keys(storage || {}).length,
                bcsKeys: 0,
                permanentFolders: 0,
                permanentBookmarks: 0,
                permanentNodes: 0,
                permanentIdentityMapEntries: 0,
                permanentCopies: 0,
                tempSections: 0,
                tempItems: 0,
                canvasNodes: 0,
                canvasEdges: 0,
                blankNodes: 0,
                groupNodes: 0,
                sourceIdentityHits: 0
            },
            sourceIdentityHits: [],
            errors: [],
            warnings: [],
            info: [],
            storageKeys: Object.keys(storage || {}).sort()
        };
    }

    function pushIssue(report, severity, category, message, detail) {
        const issue = { severity, category, message };
        if (detail !== undefined) issue.detail = detail;
        if (severity === 'error') {
            report.errors.push(issue);
        } else if (severity === 'warning') {
            report.warnings.push(issue);
        } else {
            report.info.push(issue);
        }
        return issue;
    }

    function passInfo(report, category, message, detail) {
        return pushIssue(report, 'info', category, message, detail);
    }

    function warn(report, category, message, detail) {
        return pushIssue(report, 'warning', category, message, detail);
    }

    function fail(report, category, message, detail) {
        return pushIssue(report, 'error', category, message, detail);
    }

    function readContentPayload(rawValue) {
        if (!isRecord(rawValue)) return null;
        return rawValue;
    }

    function cloneJsonValue(value) {
        if (value === undefined) return undefined;
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    function isBcsStorageKey(key) {
        return key === 'bcs' || String(key || '').startsWith('bcs:');
    }

    function buildStorageSnapshot(source, storage, options) {
        const includeNonBcs = !!(options && options.includeNonBcs);
        const keys = Object.keys(storage || {})
            .filter((key) => includeNonBcs || isBcsStorageKey(key))
            .sort();
        const snapshotStorage = {};
        keys.forEach((key) => {
            snapshotStorage[key] = cloneJsonValue(storage[key]);
        });
        return {
            generatedAt: new Date().toISOString(),
            source,
            mode: 'raw-local-storage',
            keys,
            storage: snapshotStorage
        };
    }

    function getCanvasProtocolBridge() {
        const bridge = global && global.CanvasProtocolBridge ? global.CanvasProtocolBridge : null;
        return bridge && typeof bridge.buildExportSandbox === 'function' && typeof bridge.processExportSandboxForExport === 'function'
            ? bridge
            : null;
    }

    async function buildPermanentExportStyleSnapshot(options) {
        const bridge = getCanvasProtocolBridge();
        if (!bridge) return null;
        const sandbox = await bridge.buildExportSandbox({
            reason: 'bcs-local-storage-check'
        });
        if (!isRecord(sandbox)) return null;

        bridge.processExportSandboxForExport(sandbox);

        const storage = {};
        const keys = [];
        if (isRecord(sandbox.permMain)) {
            storage[STORAGE_KEYS.PERM_MAIN] = cloneJsonValue(sandbox.permMain);
            keys.push(STORAGE_KEYS.PERM_MAIN);
        }
        const copies = isRecord(sandbox.permCopies) ? sandbox.permCopies : {};
        Object.keys(copies).sort().forEach((key) => {
            storage[key] = cloneJsonValue(copies[key]);
            keys.push(key);
        });

        return {
            generatedAt: new Date().toISOString(),
            source: 'canvas-export-sandbox',
            mode: 'export-sandbox-processed',
            keys,
            storage
        };
    }

    function isPermanentStorageKey(key) {
        const text = String(key || '');
        return text === STORAGE_KEYS.PERM_MAIN
            || text.startsWith(STORAGE_KEYS.PERM_COPY_PREFIX);
    }

    function buildPermanentStorageSnapshot(source, storage) {
        const keys = Object.keys(storage || {})
            .filter(isPermanentStorageKey)
            .sort();
        const snapshotStorage = {};
        keys.forEach((key) => {
            snapshotStorage[key] = cloneJsonValue(storage[key]);
        });
        return {
            generatedAt: new Date().toISOString(),
            source,
            mode: 'raw-local-storage',
            keys,
            storage: snapshotStorage
        };
    }

    function readCanvasPayload(rawValue, report) {
        let payload = rawValue;
        if (typeof payload === 'string') {
            const parsed = safeParseJson(payload);
            if (!parsed) {
                fail(report, 'canvas', '`bcs:canvas` is not valid JSON text.');
                return null;
            }
            payload = parsed;
        }

        if (!isRecord(payload)) {
            fail(report, 'canvas', '`bcs:canvas` is missing or not an object.');
            return null;
        }

        if (!Array.isArray(payload.nodes)) {
            fail(report, 'canvas', '`bcs:canvas.nodes` must be an array.');
            payload.nodes = [];
        }
        if (!Array.isArray(payload.edges)) {
            fail(report, 'canvas', '`bcs:canvas.edges` must be an array.');
            payload.edges = [];
        }
        return payload;
    }

    function pathForChild(parent, key) {
        const safeKey = /^[A-Za-z_$][\w$]*$/.test(String(key)) ? `.${key}` : `[${JSON.stringify(String(key))}]`;
        return parent ? `${parent}${safeKey}` : String(key);
    }

    function scanSourceIdentity(report, value, path, options) {
        const maxHits = options && Number(options.maxHits) > 0 ? Number(options.maxHits) : 200;
        if (report.sourceIdentityHits.length >= maxHits) return;

        if (Array.isArray(value)) {
            value.forEach((item, index) => scanSourceIdentity(report, item, `${path}[${index}]`, options));
            return;
        }

        if (isRecord(value)) {
            Object.keys(value).forEach((key) => {
                if (report.sourceIdentityHits.length >= maxHits) return;
                const childPath = pathForChild(path, key);
                if (LEGACY_IDENTITY_PATTERN.test(key)) {
                    const hit = { kind: 'key', path: childPath, key };
                    report.sourceIdentityHits.push(hit);
                    fail(report, 'source-identity', 'Legacy source identity key is present in local storage.', hit);
                }
                scanSourceIdentity(report, value[key], childPath, options);
            });
            return;
        }

        if (typeof value === 'string' && LEGACY_IDENTITY_PATTERN.test(value)) {
            const hit = {
                kind: 'string',
                path,
                value: value.length > 240 ? `${value.slice(0, 240)}...` : value
            };
            report.sourceIdentityHits.push(hit);
            warn(report, 'source-identity', 'Legacy source identity text is present in a string value.', hit);
        }
    }

    function collectSourceIdentityHits(report, storage) {
        Object.keys(storage).forEach((key) => {
            if (LEGACY_IDENTITY_PATTERN.test(key)) {
                const hit = { kind: 'storage-key', path: key, key };
                report.sourceIdentityHits.push(hit);
                fail(report, 'source-identity', 'Legacy source identity storage key is present.', hit);
            }
            scanSourceIdentity(report, storage[key], key, { maxHits: 200 });
        });
        report.summary.sourceIdentityHits = report.sourceIdentityHits.length;
        if (!report.sourceIdentityHits.length) {
            passInfo(report, 'source-identity', 'No sourceID/sourceId/source-id/source_id/data-source-id/originalId fields were found in BCS local storage.');
        }
    }

    function countPermanentTree(report, node, path, depth) {
        if (!isRecord(node)) {
            fail(report, 'permanent', 'Permanent tree contains a non-object node.', { path });
            return;
        }

        const title = String(node.title || node.name || '').trim();
        const url = String(node.url || '').trim();
        const children = Array.isArray(node.children) ? node.children : [];
        const isBookmark = !!url;

        report.summary.permanentNodes += 1;
        if (isBookmark) report.summary.permanentBookmarks += 1;
        else {
            report.summary.permanentFolders += 1;
            if (!Array.isArray(node.children)) warn(report, 'permanent', 'Permanent folder node has no children array.', { path, title });
        }

        if (depth > 0 && !String(node.id || '').trim()) {
            warn(report, 'permanent', 'Permanent visible node has no Chrome id in local BCS storage.', { path, title });
        }

        children.forEach((child, index) => countPermanentTree(report, child, `${path}.children[${index}]`, depth + 1));
    }

    function collectPermanentTreeNodeIds(node, outSet) {
        if (!isRecord(node) || !(outSet instanceof Set)) return;
        const id = String(node.id || '').trim();
        if (id) outSet.add(id);
        const children = Array.isArray(node.children) ? node.children : [];
        children.forEach((child) => collectPermanentTreeNodeIds(child, outSet));
    }

    function checkPermanentIdentityMap(report, main) {
        const keys = Object.keys(main || {});
        const idxDescription = keys.indexOf('descriptionMd');
        const idxIdentityMap = keys.indexOf('identityMap');
        const idxTree = keys.indexOf('tree');

        if (idxIdentityMap < 0) {
            fail(report, 'permanent', '`bcs:perm:main.identityMap` is missing.');
            return;
        }
        if (idxDescription >= 0 && idxIdentityMap < idxDescription) {
            fail(report, 'permanent', '`identityMap` must appear after `descriptionMd` in `bcs:perm:main`.', {
                keyOrder: keys
            });
        }
        if (idxTree >= 0 && idxIdentityMap > idxTree) {
            fail(report, 'permanent', '`identityMap` must appear before `tree` in `bcs:perm:main`.', {
                keyOrder: keys
            });
        }

        if (!Array.isArray(main.identityMap)) {
            fail(report, 'permanent', '`bcs:perm:main.identityMap` must be an array.');
            return;
        }

        report.summary.permanentIdentityMapEntries = main.identityMap.length;
        const mapByChromeId = new Map();
        const mapBySyncId = new Map();

        main.identityMap.forEach((entry, index) => {
            if (!isRecord(entry)) {
                fail(report, 'permanent', 'identityMap entry must be an object.', { index });
                return;
            }
            const id = String(entry.id || '').trim();
            const syncId = String(entry.syncId || '').trim();
            if (!id || !syncId) {
                fail(report, 'permanent', 'identityMap entry must contain both `id` and `syncId`.', {
                    index,
                    entry
                });
                return;
            }
            if (mapByChromeId.has(id)) {
                fail(report, 'permanent', 'Duplicate chrome id in identityMap.', {
                    id,
                    firstIndex: mapByChromeId.get(id),
                    index
                });
            } else {
                mapByChromeId.set(id, index);
            }
            if (mapBySyncId.has(syncId)) {
                fail(report, 'permanent', 'Duplicate syncId in identityMap.', {
                    syncId,
                    firstIndex: mapBySyncId.get(syncId),
                    index
                });
            } else {
                mapBySyncId.set(syncId, index);
            }
        });

        const treeNodeIds = new Set();
        if (isRecord(main.tree)) {
            collectPermanentTreeNodeIds(main.tree, treeNodeIds);
        }

        const missingInMap = [];
        treeNodeIds.forEach((id) => {
            if (!mapByChromeId.has(id)) missingInMap.push(id);
        });
        const staleInMap = [];
        mapByChromeId.forEach((_idx, id) => {
            if (!treeNodeIds.has(id)) staleInMap.push(id);
        });

        if (missingInMap.length) {
            fail(report, 'permanent', 'Permanent tree contains nodes missing in identityMap.', {
                count: missingInMap.length,
                sample: missingInMap.slice(0, 20)
            });
        }
        if (staleInMap.length) {
            fail(report, 'permanent', 'identityMap contains chrome ids missing from permanent tree.', {
                count: staleInMap.length,
                sample: staleInMap.slice(0, 20)
            });
        }

        passInfo(report, 'permanent', 'Permanent identityMap contract scan completed.', {
            entries: main.identityMap.length,
            treeNodeIds: treeNodeIds.size,
            missingInMap: missingInMap.length,
            staleInMap: staleInMap.length
        });
    }

    function countTempItems(items) {
        if (!Array.isArray(items)) return 0;
        let total = 0;
        items.forEach((item) => {
            if (!isRecord(item)) return;
            total += 1;
            total += countTempItems(item.children);
        });
        return total;
    }

    function checkBcsMeta(report, storage) {
        const bcsKeys = Object.keys(storage).filter((key) => key === 'bcs' || key.startsWith('bcs:'));
        report.summary.bcsKeys = bcsKeys.length;

        if (!bcsKeys.length) {
            fail(report, 'meta', 'No BCS local storage keys were found.');
            return;
        }

        const meta = storage[STORAGE_KEYS.META];
        if (!isRecord(meta)) {
            fail(report, 'meta', '`bcs:meta` is missing or invalid.');
            return;
        }

        const schemaVersion = Number(meta.schemaVersion) || 0;
        if (schemaVersion < CURRENT_BCS_META_SCHEMA_VERSION) {
            warn(report, 'meta', '`bcs:meta.schemaVersion` is older than the current expected schema.', {
                actual: schemaVersion,
                expectedAtLeast: CURRENT_BCS_META_SCHEMA_VERSION
            });
        } else {
            passInfo(report, 'meta', '`bcs:meta` exists and has a current schema version.', { schemaVersion });
        }
    }

    function checkPermanentMain(report, storage) {
        const rawMain = storage[STORAGE_KEYS.PERM_MAIN];
        const main = readContentPayload(rawMain);
        report.permanentMain = {
            contentKey: STORAGE_KEYS.PERM_MAIN,
            rawContent: cloneJsonValue(rawMain),
            content: cloneJsonValue(main)
        };
        if (!main) {
            fail(report, 'permanent', '`bcs:perm:main` is missing or invalid.');
            return null;
        }

        if (main.format !== CURRENT_SECTION_FORMAT) {
            fail(report, 'permanent', '`bcs:perm:main.format` is not the current section format.', {
                actual: main.format,
                expected: CURRENT_SECTION_FORMAT
            });
        }
        if (main.sectionType !== 'permanent') {
            fail(report, 'permanent', '`bcs:perm:main.sectionType` must be `permanent`.', { actual: main.sectionType });
        }
        if (main.fileRole !== 'primary') {
            fail(report, 'permanent', '`bcs:perm:main.fileRole` must be `primary`.', { actual: main.fileRole });
        }
        if (!isRecord(main.tree)) {
            fail(report, 'permanent', '`bcs:perm:main.tree` is missing or invalid.');
        } else {
            countPermanentTree(report, main.tree, `${STORAGE_KEYS.PERM_MAIN}.tree`, 0);
            passInfo(report, 'permanent', 'Permanent main tree is readable from BCS local storage.', {
                nodes: report.summary.permanentNodes,
                folders: report.summary.permanentFolders,
                bookmarks: report.summary.permanentBookmarks
            });
        }

        checkPermanentIdentityMap(report, main);

        return main;
    }

    function checkPermanentCopies(report, storage, canvasNodeById) {
        const copyKeys = Object.keys(storage)
            .filter((key) => key.startsWith(STORAGE_KEYS.PERM_COPY_PREFIX))
            .sort();

        copyKeys.forEach((key) => {
            const copyId = key.slice(STORAGE_KEYS.PERM_COPY_PREFIX.length);
            const payload = readContentPayload(storage[key]);
            if (!payload) {
                fail(report, 'permanent-copy', 'Permanent copy payload is invalid.', { key, copyId });
                return;
            }
            report.summary.permanentCopies += 1;
            if (payload.fileRole !== 'copy-anchor') {
                fail(report, 'permanent-copy', 'Permanent copy payload must be a copy-anchor.', { key, copyId, fileRole: payload.fileRole });
            }
            if (payload.anchorOnly !== true) {
                fail(report, 'permanent-copy', 'Permanent copy payload must be anchorOnly.', { key, copyId, anchorOnly: payload.anchorOnly });
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'tree')) {
                fail(report, 'permanent-copy', 'Permanent copy anchor must not store an independent tree.', { key, copyId });
            }
            if (payload.copyId && String(payload.copyId) !== copyId) {
                warn(report, 'permanent-copy', 'Permanent copy payload copyId differs from storage key suffix.', {
                    key,
                    copyId,
                    payloadCopyId: payload.copyId
                });
            }

            const canvasId = `permanent-section-copy-${copyId}`;
            if (canvasNodeById && !canvasNodeById.has(canvasId)) {
                warn(report, 'permanent-copy', 'Permanent copy has no matching canvas node anchor.', { copyId, expectedCanvasNodeId: canvasId });
            }
        });
    }

    function checkCanvas(report, storage) {
        const canvas = readCanvasPayload(storage[STORAGE_KEYS.CANVAS], report);
        if (!canvas) return { canvas: null, nodeById: new Map(), sectionFileNodeIds: new Set() };

        report.summary.canvasNodes = canvas.nodes.length;
        report.summary.canvasEdges = canvas.edges.length;

        const nodeById = new Map();
        canvas.nodes.forEach((node, index) => {
            if (!isRecord(node)) {
                fail(report, 'canvas', 'Canvas node must be an object.', { index });
                return;
            }
            const id = String(node.id || '').trim();
            if (!id) {
                fail(report, 'canvas', 'Canvas node has no id.', { index, node });
                return;
            }
            if (nodeById.has(id)) fail(report, 'canvas', 'Canvas node id is duplicated.', { id });
            nodeById.set(id, node);
            if (node.type === 'text') report.summary.blankNodes += 1;
            if (node.type === 'group') report.summary.groupNodes += 1;
        });

        const mainNode = nodeById.get('permanent-section');
        if (!mainNode) {
            fail(report, 'canvas', 'Canvas file is missing the main permanent section node.', { expectedNodeId: 'permanent-section' });
        } else if (mainNode.type !== 'file') {
            fail(report, 'canvas', 'Main permanent section canvas node must be a file node.', { node: mainNode });
        } else if (!String(mainNode.file || '').trim()) {
            warn(report, 'canvas', 'Main permanent section canvas node has no file path.', { nodeId: 'permanent-section' });
        }

        canvas.edges.forEach((edge, index) => {
            if (!isRecord(edge)) {
                fail(report, 'canvas', 'Canvas edge must be an object.', { index });
                return;
            }
            const fromNode = String(edge.fromNode || '').trim();
            const toNode = String(edge.toNode || '').trim();
            if (!fromNode || !toNode) {
                fail(report, 'canvas', 'Canvas edge is missing fromNode or toNode.', { index, edge });
                return;
            }
            if (!nodeById.has(fromNode) || !nodeById.has(toNode)) {
                fail(report, 'canvas', 'Canvas edge references a missing node.', { index, fromNode, toNode });
            }
        });

        passInfo(report, 'canvas', 'Canvas file is readable from BCS local storage.', {
            nodes: report.summary.canvasNodes,
            edges: report.summary.canvasEdges,
            blankNodes: report.summary.blankNodes,
            groupNodes: report.summary.groupNodes
        });

        return {
            canvas,
            nodeById,
            sectionFileNodeIds: new Set(
                canvas.nodes
                    .filter((node) => isRecord(node) && node.type === 'file' && String(node.id || '').startsWith('temp-section-'))
                    .map((node) => String(node.id))
            )
        };
    }

    function checkTempSections(report, storage, canvasInfo) {
        const sectionKeys = Object.keys(storage)
            .filter((key) => key.startsWith(STORAGE_KEYS.SECTION_PREFIX))
            .sort();
        const sectionIds = new Set();

        sectionKeys.forEach((key) => {
            const id = key.slice(STORAGE_KEYS.SECTION_PREFIX.length);
            const raw = storage[key];
            const payload = readContentPayload(raw);
            sectionIds.add(id);
            report.summary.tempSections += 1;

            if (!payload) {
                fail(report, 'temporary', 'Temporary section payload is invalid.', { key, id });
                return;
            }
            if (payload.format !== CURRENT_SECTION_FORMAT) {
                fail(report, 'temporary', 'Temporary section payload has an unexpected format.', {
                    key,
                    id,
                    actual: payload.format,
                    expected: CURRENT_SECTION_FORMAT
                });
            }
            if (payload.sectionType !== 'temporary') {
                fail(report, 'temporary', 'Temporary section payload must have sectionType `temporary`.', { key, id, actual: payload.sectionType });
            }
            if (payload.id && String(payload.id) !== id) {
                warn(report, 'temporary', 'Temporary section payload id differs from storage key suffix.', { key, id, payloadId: payload.id });
            }
            if (!Array.isArray(payload.items)) {
                fail(report, 'temporary', 'Temporary section payload items must be an array.', { key, id });
            } else {
                report.summary.tempItems += countTempItems(payload.items);
            }

            if (canvasInfo && canvasInfo.nodeById && !canvasInfo.nodeById.has(id)) {
                warn(report, 'temporary', 'Temporary section has no matching canvas file node.', { id, key });
            }
        });

        if (canvasInfo && canvasInfo.sectionFileNodeIds) {
            canvasInfo.sectionFileNodeIds.forEach((id) => {
                if (!sectionIds.has(id)) {
                    fail(report, 'temporary', 'Canvas references a temporary section that has no `bcs:section:*` payload.', {
                        id,
                        expectedStorageKey: `${STORAGE_KEYS.SECTION_PREFIX}${id}`
                    });
                }
            });
        }

        passInfo(report, 'temporary', 'Temporary section storage scan completed.', {
            sections: report.summary.tempSections,
            items: report.summary.tempItems
        });
    }

    function checkLegacySnapshot(report, storage) {
        if (Object.prototype.hasOwnProperty.call(storage, STORAGE_KEYS.TEMP_SNAPSHOT)) {
            warn(report, 'legacy', 'Legacy combined temp snapshot key is present; current BCS runtime should primarily use split keys.', {
                key: STORAGE_KEYS.TEMP_SNAPSHOT
            });
        }
    }

    function finalizeReport(report) {
        report.ok = report.errors.length === 0;
        return report;
    }

    function printReport(report) {
        const label = report.ok ? 'PASS' : 'FAIL';
        const log = report.ok ? console.info : console.error;
        log.call(console, `[BCS Local Storage Check] ${label}`, report.summary);
        if (report.errors.length) console.error('[BCS Local Storage Check] Errors', report.errors);
        if (report.warnings.length) console.warn('[BCS Local Storage Check] Warnings', report.warnings);
        console.info('[BCS Local Storage Check] Full report saved to window.__bcsLocalStorageReport', report);
        console.info('[BCS Local Storage Check] BCS storage snapshot saved to window.__bcsLocalStorageExport', report.bcsLocalStorageExport);
        console.info('[BCS Local Storage Check] Permanent storage snapshot saved to window.__bcsPermanentStorageExport', {
            mode: report && report.permanentStorageExport ? report.permanentStorageExport.mode : '',
            keys: report && report.permanentStorageExport && Array.isArray(report.permanentStorageExport.keys)
                ? report.permanentStorageExport.keys.length
                : 0
        });
        console.info('[BCS Local Storage Check] Raw permanent storage snapshot saved to window.__bcsPermanentStorageExportRaw', {
            mode: report && report.permanentStorageExportRaw ? report.permanentStorageExportRaw.mode : '',
            keys: report && report.permanentStorageExportRaw && Array.isArray(report.permanentStorageExportRaw.keys)
                ? report.permanentStorageExportRaw.keys.length
                : 0
        });
    }

    function shouldAutoDownloadSnapshot() {
        return global.__BCS_LOCAL_STORAGE_CHECK_NO_AUTO_DOWNLOAD__ !== true;
    }

    function autoDownloadReportSnapshot(report) {
        if (!shouldAutoDownloadSnapshot()) return;
        if (!report) return;
        try {
            const businessFileCount = downloadObsidianStyleBusinessFiles(report);
            if (businessFileCount > 0) {
                console.info('[BCS Local Storage Check] Obsidian-style business file downloads started.', {
                    files: businessFileCount
                });
                return;
            }
            if (!report.bcsLocalStorageExport) return;
            downloadJsonPayload(defaultSnapshotFilename('bcs-local-storage'), report.bcsLocalStorageExport);
            console.info('[BCS Local Storage Check] BCS local storage JSON fallback download started.');
        } catch (error) {
            warn(report, 'export', 'Automatic JSON download failed.', {
                message: error && error.message ? error.message : String(error)
            });
        }
    }

    async function exportBcsLocalStorageSnapshot(options) {
        const loaded = await readAllLocalStorage();
        return buildStorageSnapshot(loaded.source, loaded.storage || {}, options || {});
    }

    async function exportBcsPermanentStorageSnapshot(options = {}) {
        const useExportSandboxShape = !!(options && options.useExportSandboxShape === true);
        if (useExportSandboxShape) {
            try {
                const exportStyle = await buildPermanentExportStyleSnapshot();
                if (exportStyle) return exportStyle;
            } catch (_) { }
        }
        const loaded = await readAllLocalStorage();
        return buildPermanentStorageSnapshot(loaded.source, loaded.storage || {});
    }

    function downloadJsonPayload(filename, payload) {
        if (!global.document || typeof global.Blob !== 'function' || !global.URL || typeof global.URL.createObjectURL !== 'function') {
            throw new Error('JSON download is unavailable in this context.');
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = global.URL.createObjectURL(blob);
        const anchor = global.document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.style.display = 'none';
        global.document.body.appendChild(anchor);
        anchor.click();
        global.document.body.removeChild(anchor);
        global.URL.revokeObjectURL(url);
    }

    function sanitizeDownloadName(value, fallback) {
        const text = String(value || '').trim()
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
            .replace(/\s+/g, ' ')
            .trim();
        return text || fallback;
    }

    function downloadTextPayload(filename, text, mimeType) {
        if (!global.document || typeof global.Blob !== 'function' || !global.URL || typeof global.URL.createObjectURL !== 'function') {
            throw new Error('Text download is unavailable in this context.');
        }
        const blob = new Blob([String(text == null ? '' : text)], { type: mimeType || 'text/plain;charset=utf-8' });
        const url = global.URL.createObjectURL(blob);
        const anchor = global.document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.style.display = 'none';
        global.document.body.appendChild(anchor);
        anchor.click();
        global.document.body.removeChild(anchor);
        global.URL.revokeObjectURL(url);
    }

    function readDownloadPayload(rawValue) {
        if (typeof rawValue === 'string') {
            return safeParseJson(rawValue) || rawValue;
        }
        return readContentPayload(rawValue) || rawValue;
    }

    function downloadObsidianStyleBusinessFiles(report) {
        const storage = report && report.bcsLocalStorageExport && report.bcsLocalStorageExport.storage
            ? report.bcsLocalStorageExport.storage
            : {};
        const permanentStorage = report && report.permanentStorageExportRaw && report.permanentStorageExportRaw.storage
            ? report.permanentStorageExportRaw.storage
            : report && report.permanentStorageExport && report.permanentStorageExport.storage
                ? report.permanentStorageExport.storage
            : storage;
        let count = 0;

        const rawCanvas = storage[STORAGE_KEYS.CANVAS];
        if (rawCanvas) {
            const canvasStr = typeof rawCanvas === 'string' ? rawCanvas : JSON.stringify(rawCanvas);
            downloadTextPayload('书签画布.canvas', canvasStr, 'application/json;charset=utf-8');
            count += 1;
        }

        const permanentMain = readContentPayload(permanentStorage[STORAGE_KEYS.PERM_MAIN])
            || (report.permanentMain && report.permanentMain.content
                ? report.permanentMain.content
                : readContentPayload(storage[STORAGE_KEYS.PERM_MAIN]));
        if (permanentMain) {
            downloadJsonPayload('A书签树（永久栏目）.json', permanentMain);
            count += 1;
        }

        Object.keys(permanentStorage)
            .filter((key) => key.startsWith(STORAGE_KEYS.PERM_COPY_PREFIX))
            .sort()
            .forEach((key, index) => {
                const payload = readContentPayload(permanentStorage[key]);
                if (!payload) return;
                const slot = sanitizeDownloadName(payload.slot || String.fromCharCode(66 + index), String.fromCharCode(66 + index));
                downloadJsonPayload(`${slot}书签树（永久栏目副本）.json`, payload);
                count += 1;
            });

        Object.keys(storage)
            .filter((key) => key.startsWith(STORAGE_KEYS.SECTION_PREFIX))
            .sort()
            .forEach((key, index) => {
                const payload = readContentPayload(storage[key]);
                if (!payload) return;
                const label = sanitizeDownloadName(payload.label || `A-${index + 1}`, `A-${index + 1}`);
                const title = sanitizeDownloadName(String(payload.title || label).replace(/:/g, '_'), label);
                const kind = String(payload.tempKind || '').trim().toLowerCase() === 'special' ? '特殊临时栏目' : '常规链式';
                downloadJsonPayload(`${kind} - ${label} ${title}.json`, payload);
                count += 1;
            });

        return count;
    }

    function defaultSnapshotFilename(prefix) {
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
        return `${prefix}-${stamp}.json`;
    }

    async function downloadBcsLocalStorageSnapshot(options) {
        const snapshot = await exportBcsLocalStorageSnapshot(options || {});
        const filename = options && typeof options.filename === 'string' && options.filename.trim()
            ? options.filename.trim()
            : defaultSnapshotFilename('bcs-local-storage');
        downloadJsonPayload(filename, snapshot);
        return snapshot;
    }

    async function downloadBcsPermanentStorageSnapshot(options) {
        const snapshot = await exportBcsPermanentStorageSnapshot(options || {});
        const filename = options && typeof options.filename === 'string' && options.filename.trim()
            ? options.filename.trim()
            : defaultSnapshotFilename('bcs-permanent-storage');
        downloadJsonPayload(filename, snapshot);
        return snapshot;
    }

    async function checkBcsLocalStorage() {
        const loaded = await readAllLocalStorage();
        const storage = loaded.storage || {};
        const report = createReport(loaded.source, storage);
        report.bcsLocalStorageExport = buildStorageSnapshot(loaded.source, storage, {});
        report.permanentStorageExportRaw = buildPermanentStorageSnapshot(loaded.source, storage);
        report.permanentStorageExport = report.permanentStorageExportRaw;
        try {
            const exportStyle = await buildPermanentExportStyleSnapshot();
            if (exportStyle) {
                report.permanentStorageExport = exportStyle;
                passInfo(report, 'export', 'Permanent storage export uses export sandbox pipeline.', {
                    mode: exportStyle.mode,
                    source: exportStyle.source,
                    keys: exportStyle.keys
                });
            } else {
                warn(report, 'export', 'Permanent storage export falls back to raw local storage snapshot (export bridge unavailable).', {
                    mode: report.permanentStorageExportRaw.mode
                });
            }
        } catch (error) {
            warn(report, 'export', 'Permanent storage export sandbox processing failed; fallback to raw snapshot.', {
                message: error && error.message ? error.message : String(error),
                mode: report.permanentStorageExportRaw.mode
            });
        }

        checkBcsMeta(report, storage);
        const canvasInfo = checkCanvas(report, storage);
        checkPermanentMain(report, storage);
        checkPermanentCopies(report, storage, canvasInfo.nodeById);
        checkTempSections(report, storage, canvasInfo);
        checkLegacySnapshot(report, storage);
        collectSourceIdentityHits(report, storage);

        finalizeReport(report);
        global.__bcsLocalStorageReport = report;
        global.__bcsLocalStorageExport = report.bcsLocalStorageExport;
        global.__bcsPermanentStorageExport = report.permanentStorageExport;
        global.__bcsPermanentStorageExportRaw = report.permanentStorageExportRaw;
        printReport(report);
        autoDownloadReportSnapshot(report);
        return report;
    }

    global.checkBcsLocalStorage = checkBcsLocalStorage;
    global.exportBcsLocalStorageSnapshot = exportBcsLocalStorageSnapshot;
    global.exportBcsPermanentStorageSnapshot = exportBcsPermanentStorageSnapshot;
    global.downloadBcsLocalStorageSnapshot = downloadBcsLocalStorageSnapshot;
    global.downloadBcsPermanentStorageSnapshot = downloadBcsPermanentStorageSnapshot;

    if (global.__BCS_LOCAL_STORAGE_CHECK_NO_AUTO_RUN__ !== true) {
        checkBcsLocalStorage().catch((error) => {
            const report = {
                ok: false,
                generatedAt: new Date().toISOString(),
                source: '',
                summary: {},
                sourceIdentityHits: [],
                errors: [{
                    severity: 'error',
                    category: 'runtime',
                    message: error && error.message ? error.message : String(error)
                }],
                warnings: [],
                info: []
            };
            global.__bcsLocalStorageReport = report;
            console.error('[BCS Local Storage Check] FAIL', report.errors[0]);
        });
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
