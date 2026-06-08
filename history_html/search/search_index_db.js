(function () {
    'use strict';

    const DB_NAME = 'bookmark_canvas_search';
    const DB_VERSION = 2;
    const STORE_META = 'meta';
    const STORE_SHARDS = 'shards';
    const STORE_RECORDS = 'records';
    const STORE_COORDINATES = 'coordinates';
    const SNAPSHOT_META_KEY = 'snapshot';
    const DIRTY_META_KEY = 'dirty_state';
    const RECORD_STORAGE_FORMAT = 'records-v1';
    const INDEX_MODE = 'mode';
    const INDEX_OWNER = 'ownerKey';
    const SHARD_KEYS = {
        bookmark: 'bookmark',
        card: 'card',
        description: 'description',
        coordinates: 'coordinates'
    };

    const LEGACY_STORAGE_KEYS = [
        'canvas_search_index_bookmark',
        'canvas_search_index_card',
        'canvas_search_index_description',
        'canvas_search_index_coordinates',
        'canvas_search_index_signature'
    ];

    let idbApiPromise = null;
    let dbPromise = null;

    function getIdbApi() {
        if (globalThis.BookmarkCanvasIdb && typeof globalThis.BookmarkCanvasIdb.openDB === 'function') {
            return Promise.resolve(globalThis.BookmarkCanvasIdb);
        }
        if (idbApiPromise) return idbApiPromise;

        idbApiPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timed out waiting for idb bridge'));
            }, 5000);

            globalThis.addEventListener('bookmark-canvas-idb-ready', () => {
                clearTimeout(timeout);
                if (globalThis.BookmarkCanvasIdb && typeof globalThis.BookmarkCanvasIdb.openDB === 'function') {
                    resolve(globalThis.BookmarkCanvasIdb);
                } else {
                    reject(new Error('idb bridge loaded without openDB'));
                }
            }, { once: true });
        });

        idbApiPromise.catch(() => {
            idbApiPromise = null;
        });

        return idbApiPromise;
    }

    async function openSearchDb() {
        if (dbPromise) return dbPromise;

        const idb = await getIdbApi();
        dbPromise = idb.openDB(DB_NAME, DB_VERSION, {
            upgrade(db, oldVersion, newVersion, tx) {
                if (!db.objectStoreNames.contains(STORE_META)) {
                    db.createObjectStore(STORE_META);
                }
                if (!db.objectStoreNames.contains(STORE_SHARDS)) {
                    db.createObjectStore(STORE_SHARDS);
                }
                if (!db.objectStoreNames.contains(STORE_RECORDS)) {
                    const recordStore = db.createObjectStore(STORE_RECORDS, { keyPath: 'key' });
                    recordStore.createIndex(INDEX_MODE, INDEX_MODE, { unique: false });
                    recordStore.createIndex(INDEX_OWNER, INDEX_OWNER, { unique: false });
                } else {
                    const recordStore = tx ? tx.objectStore(STORE_RECORDS) : null;
                    if (recordStore && !recordStore.indexNames.contains(INDEX_MODE)) {
                        recordStore.createIndex(INDEX_MODE, INDEX_MODE, { unique: false });
                    }
                    if (recordStore && !recordStore.indexNames.contains(INDEX_OWNER)) {
                        recordStore.createIndex(INDEX_OWNER, INDEX_OWNER, { unique: false });
                    }
                }
                if (!db.objectStoreNames.contains(STORE_COORDINATES)) {
                    const coordStore = db.createObjectStore(STORE_COORDINATES, { keyPath: 'id' });
                    coordStore.createIndex(INDEX_OWNER, INDEX_OWNER, { unique: false });
                } else {
                    const coordStore = tx ? tx.objectStore(STORE_COORDINATES) : null;
                    if (coordStore && !coordStore.indexNames.contains(INDEX_OWNER)) {
                        coordStore.createIndex(INDEX_OWNER, INDEX_OWNER, { unique: false });
                    }
                }
            }
        });

        dbPromise.catch(() => {
            dbPromise = null;
        });

        return dbPromise;
    }

    function normalizeSignature(signature) {
        return String(signature || '');
    }

    function normalizeRevision(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }

    function normalizeDirtyKeys(keys) {
        return Array.from(new Set((Array.isArray(keys) ? keys : [])
            .map(key => String(key || '').trim())
            .filter(Boolean)));
    }

    function normalizeDirtyKeyVersions(rawVersions, keys, revision) {
        const versions = {};
        if (rawVersions && typeof rawVersions === 'object') {
            for (const [key, value] of Object.entries(rawVersions)) {
                const normalizedKey = String(key || '').trim();
                if (!normalizedKey) continue;
                versions[normalizedKey] = normalizeRevision(value) || revision || 1;
            }
        }
        normalizeDirtyKeys(keys).forEach(key => {
            if (!versions[key]) {
                versions[key] = revision || 1;
            }
        });
        return versions;
    }

    function normalizeDirtyState(rawState) {
        const safeState = rawState && typeof rawState === 'object' ? rawState : {};
        const rawRevision = normalizeRevision(safeState.revision);
        const dirtyKeys = normalizeDirtyKeys([
            ...(Array.isArray(safeState.dirtyKeys) ? safeState.dirtyKeys : []),
            ...Object.keys(safeState.dirtyKeyVersions || {})
        ]);
        const dirtyKeyVersions = normalizeDirtyKeyVersions(safeState.dirtyKeyVersions, dirtyKeys, rawRevision);
        const normalizedKeys = normalizeDirtyKeys(Object.keys(dirtyKeyVersions));
        const maxKeyRevision = normalizedKeys.reduce((max, key) => {
            return Math.max(max, normalizeRevision(dirtyKeyVersions[key]));
        }, 0);
        const needsFullUpdate = safeState.needsFullUpdate === true;
        const rawFullRevision = normalizeRevision(safeState.fullRevision);
        const revision = Math.max(rawRevision, maxKeyRevision, rawFullRevision);
        const dirty = safeState.dirty === true || needsFullUpdate || normalizedKeys.length > 0;
        const fullRevision = needsFullUpdate
            ? (rawFullRevision || revision || 1)
            : 0;

        return {
            dirty,
            needsFullUpdate,
            dirtyKeys: normalizedKeys,
            dirtyKeyVersions,
            revision,
            fullRevision,
            updatedAt: normalizeRevision(safeState.updatedAt)
        };
    }

    function serializeDirtyState(state) {
        const normalized = normalizeDirtyState(state);
        return {
            dirty: normalized.dirty,
            needsFullUpdate: normalized.needsFullUpdate,
            dirtyKeys: normalized.dirtyKeys,
            dirtyKeyVersions: normalized.dirtyKeyVersions,
            revision: normalized.revision,
            fullRevision: normalized.fullRevision,
            updatedAt: normalized.updatedAt || Date.now()
        };
    }

    function isDirtyStateClean(state) {
        const normalized = normalizeDirtyState(state);
        return normalized.dirty !== true &&
            normalized.needsFullUpdate !== true &&
            normalized.dirtyKeys.length === 0;
    }

    function isFreshMeta(meta, signature) {
        return !!(
            meta &&
            meta.complete === true &&
            normalizeSignature(meta.signature) === normalizeSignature(signature)
        );
    }

    function isCompleteMeta(meta) {
        return !!(
            meta &&
            meta.complete === true &&
            normalizeSignature(meta.signature)
        );
    }

    function isRecordMeta(meta) {
        return isCompleteMeta(meta) && meta.storageFormat === RECORD_STORAGE_FORMAT;
    }

    async function getMeta() {
        const db = await openSearchDb();
        return db.get(STORE_META, SNAPSHOT_META_KEY);
    }

    async function getDirtyState() {
        const db = await openSearchDb();
        return normalizeDirtyState(await db.get(STORE_META, DIRTY_META_KEY));
    }

    async function getMetaWithDirtyState() {
        const db = await openSearchDb();
        const tx = db.transaction(STORE_META, 'readonly');
        const metaStore = tx.objectStore(STORE_META);
        const [meta, dirtyState] = await Promise.all([
            metaStore.get(SNAPSHOT_META_KEY),
            metaStore.get(DIRTY_META_KEY)
        ]);
        await tx.done;
        return { db, meta, dirtyState };
    }

    async function markDirtyState(options = {}) {
        const db = await openSearchDb();
        const tx = db.transaction(STORE_META, 'readwrite');
        const metaStore = tx.objectStore(STORE_META);
        const current = normalizeDirtyState(await metaStore.get(DIRTY_META_KEY));
        const revision = current.revision + 1;
        const dirtyKeyVersions = Object.assign({}, current.dirtyKeyVersions);
        const keys = normalizeDirtyKeys(options.keys);

        keys.forEach(key => {
            dirtyKeyVersions[key] = revision;
        });

        const needsFullUpdate = current.needsFullUpdate || options.full === true;
        const fullRevision = options.full === true
            ? revision
            : (needsFullUpdate ? current.fullRevision : 0);
        const next = serializeDirtyState({
            dirty: needsFullUpdate || keys.length > 0 || Object.keys(dirtyKeyVersions).length > 0,
            needsFullUpdate,
            dirtyKeys: Object.keys(dirtyKeyVersions),
            dirtyKeyVersions,
            revision,
            fullRevision,
            updatedAt: Date.now()
        });

        await metaStore.put(next, DIRTY_META_KEY);
        await tx.done;
        return normalizeDirtyState(next);
    }

    async function clearProcessedDirtyState(processed = {}) {
        const db = await openSearchDb();
        const tx = db.transaction(STORE_META, 'readwrite');
        const metaStore = tx.objectStore(STORE_META);
        const current = normalizeDirtyState(await metaStore.get(DIRTY_META_KEY));
        const dirtyKeyVersions = Object.assign({}, current.dirtyKeyVersions);
        const processedKeys = normalizeDirtyKeys(processed.keys);
        const processedKeyVersions = processed.keyVersions && typeof processed.keyVersions === 'object'
            ? processed.keyVersions
            : {};
        if (processedKeys.length === 0 && processed.full !== true) {
            await tx.done;
            return current;
        }

        processedKeys.forEach(key => {
            const processedRevision = normalizeRevision(processedKeyVersions[key]);
            if (!processedRevision) return;
            const currentRevision = normalizeRevision(dirtyKeyVersions[key]);
            if (!currentRevision || currentRevision <= processedRevision) {
                delete dirtyKeyVersions[key];
            }
        });

        const processedFullRevision = normalizeRevision(processed.fullRevision);
        const canClearFull = processed.full === true &&
            current.needsFullUpdate &&
            processedFullRevision &&
            (!current.fullRevision || current.fullRevision <= processedFullRevision);
        const needsFullUpdate = canClearFull ? false : current.needsFullUpdate;
        const revision = current.revision + 1;
        const remainingKeys = Object.keys(dirtyKeyVersions);
        const next = serializeDirtyState({
            dirty: needsFullUpdate || remainingKeys.length > 0,
            needsFullUpdate,
            dirtyKeys: remainingKeys,
            dirtyKeyVersions,
            revision,
            fullRevision: needsFullUpdate ? current.fullRevision : 0,
            updatedAt: Date.now()
        });

        await metaStore.put(next, DIRTY_META_KEY);
        await tx.done;
        return normalizeDirtyState(next);
    }

    async function hasFreshIndex(signature) {
        const { meta, dirtyState } = await getMetaWithDirtyState();
        return isFreshMeta(meta, signature) && isDirtyStateClean(dirtyState);
    }

    function normalizeMode(mode) {
        if (mode === 'bookmark' || mode === 'tag') return 'bookmark';
        if (mode === 'description') return 'description';
        return 'structure';
    }

    function modeToShardKey(mode) {
        if (mode === 'bookmark' || mode === 'tag') return SHARD_KEYS.bookmark;
        if (mode === 'description') return SHARD_KEYS.description;
        return SHARD_KEYS.card;
    }

    function normalizeOwnerKey(ownerKey) {
        const key = String(ownerKey || '').trim();
        if (key === 'cachedCurrentTree') return 'bcs:perm:main';
        return key || 'bcs:canvas';
    }

    function inferOwnerKeyFromItem(item) {
        if (!item || typeof item !== 'object') return 'bcs:canvas';
        if (item.ownerKey) return normalizeOwnerKey(item.ownerKey);
        if (item.type === 'bookmark-item') {
            if (item.source === 'temporary' && item.sectionId) {
                return `bcs:section:${String(item.sectionId)}`;
            }
            if (item.source === 'permanent') {
                return 'bcs:perm:main';
            }
        }
        if (item.type === 'temp-section' && item.id) {
            return `bcs:section:${String(item.id)}`;
        }
        if (item.type === 'permanent-section') {
            if (item.copyId) return `bcs:perm:copy-${String(item.copyId)}`;
            return 'bcs:perm:main';
        }
        if (item.copyId) return `bcs:perm:copy-${String(item.copyId)}`;
        if (item.sectionId) return `bcs:section:${String(item.sectionId)}`;
        return 'bcs:canvas';
    }

    function buildRecordKey(mode, ownerKey, order, item) {
        const itemId = item && item.id !== undefined && item.id !== null ? String(item.id) : '';
        const source = item && item.source ? String(item.source) : '';
        const sectionId = item && item.sectionId ? String(item.sectionId) : '';
        const copyId = item && item.copyId ? String(item.copyId) : '';
        const paddedOrder = String(order).padStart(10, '0');
        return `${mode}:${paddedOrder}:${ownerKey}:${source}:${sectionId}:${copyId}:${itemId}`;
    }

    function unwrapRecordInput(entry, fallbackOrder) {
        if (entry && typeof entry === 'object' && entry.__searchIndexRecordItem) {
            const order = typeof entry.__searchIndexRecordOrder === 'number'
                ? entry.__searchIndexRecordOrder
                : fallbackOrder;
            return { item: entry.__searchIndexRecordItem, order };
        }
        return { item: entry, order: fallbackOrder };
    }

    function createRecordsForList(list, mode) {
        const safeList = Array.isArray(list) ? list : [];
        const normalizedMode = normalizeMode(mode);
        const records = [];
        safeList.forEach((entry, fallbackOrder) => {
            const { item, order } = unwrapRecordInput(entry, fallbackOrder);
            if (!item || typeof item !== 'object') return;
            const ownerKey = inferOwnerKeyFromItem(item);
            records.push({
                key: buildRecordKey(normalizedMode, ownerKey, order, item),
                mode: normalizedMode,
                ownerKey,
                order,
                item
            });
        });
        return records;
    }

    function createRecordsFromSnapshot(snapshot) {
        return [
            ...createRecordsForList(snapshot.bookmarkIndex, 'bookmark'),
            ...createRecordsForList(snapshot.cardIndex, 'structure'),
            ...createRecordsForList(snapshot.descriptionIndex, 'description')
        ];
    }

    function createCoordinateRecords(coordinates) {
        const safeCoordinates = coordinates && typeof coordinates === 'object' ? coordinates : {};
        const records = [];
        for (const [id, coord] of Object.entries(safeCoordinates)) {
            if (!id || !coord || typeof coord !== 'object') continue;
            const ownerKey = normalizeOwnerKey(coord.ownerKey || coord.__ownerKey || '');
            records.push(Object.assign({}, coord, {
                id: String(id),
                ownerKey
            }));
        }
        return records;
    }

    function recordsToList(records) {
        return (Array.isArray(records) ? records : [])
            .filter(record => record && record.item && typeof record.item === 'object')
            .sort((a, b) => {
                const ao = typeof a.order === 'number' ? a.order : 0;
                const bo = typeof b.order === 'number' ? b.order : 0;
                if (ao !== bo) return ao - bo;
                return String(a.key || '').localeCompare(String(b.key || ''));
            })
            .map(record => record.item);
    }

    function coordinateRecordsToObject(records) {
        const coordinates = {};
        (Array.isArray(records) ? records : []).forEach(record => {
            if (!record || !record.id) return;
            const coord = Object.assign({}, record);
            delete coord.id;
            delete coord.ownerKey;
            coordinates[String(record.id)] = coord;
        });
        return coordinates;
    }

    async function deleteByOwnerKey(store, ownerKey) {
        const key = normalizeOwnerKey(ownerKey);
        const keys = await store.index(INDEX_OWNER).getAllKeys(key);
        await Promise.all(keys.map(recordKey => store.delete(recordKey)));
    }

    async function countRecordStores(recordStore, coordStore) {
        const [bookmark, card, description, coordinates] = await Promise.all([
            recordStore.index(INDEX_MODE).count('bookmark'),
            recordStore.index(INDEX_MODE).count('structure'),
            recordStore.index(INDEX_MODE).count('description'),
            coordStore.count()
        ]);
        return { bookmark, card, description, coordinates };
    }

    async function saveSnapshot(snapshot) {
        const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
        const signature = normalizeSignature(safeSnapshot.signature);
        if (!signature) {
            throw new Error('Cannot save search index without signature');
        }

        const bookmarkIndex = Array.isArray(safeSnapshot.bookmarkIndex) ? safeSnapshot.bookmarkIndex : [];
        const cardIndex = Array.isArray(safeSnapshot.cardIndex) ? safeSnapshot.cardIndex : [];
        const descriptionIndex = Array.isArray(safeSnapshot.descriptionIndex) ? safeSnapshot.descriptionIndex : [];
        const coordinates = safeSnapshot.coordinates && typeof safeSnapshot.coordinates === 'object'
            ? safeSnapshot.coordinates
            : {};

        const records = createRecordsFromSnapshot({
            bookmarkIndex,
            cardIndex,
            descriptionIndex
        });
        const coordinateRecords = createCoordinateRecords(coordinates);

        const db = await openSearchDb();
        const tx = db.transaction([STORE_META, STORE_SHARDS, STORE_RECORDS, STORE_COORDINATES], 'readwrite');
        const metaStore = tx.objectStore(STORE_META);
        const shardStore = tx.objectStore(STORE_SHARDS);
        const recordStore = tx.objectStore(STORE_RECORDS);
        const coordStore = tx.objectStore(STORE_COORDINATES);

        const meta = {
            signature,
            complete: true,
            schemaVersion: DB_VERSION,
            storageFormat: RECORD_STORAGE_FORMAT,
            builtAt: Date.now(),
            counts: {
                bookmark: bookmarkIndex.length,
                card: cardIndex.length,
                description: descriptionIndex.length,
                coordinates: coordinateRecords.length
            }
        };

        const writes = [
            shardStore.clear(),
            recordStore.clear(),
            coordStore.clear(),
            metaStore.put(meta, SNAPSHOT_META_KEY),
            ...records.map(record => recordStore.put(record)),
            ...coordinateRecords.map(record => coordStore.put(record))
        ];
        await Promise.all(writes);
        await tx.done;

        return meta;
    }

    async function saveIncrementalSnapshot(snapshot) {
        const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
        const signature = normalizeSignature(safeSnapshot.signature);
        if (!signature) {
            throw new Error('Cannot save incremental search index without signature');
        }

        const ownerKeys = Array.from(new Set((Array.isArray(safeSnapshot.ownerKeys) ? safeSnapshot.ownerKeys : [])
            .map(normalizeOwnerKey)
            .filter(Boolean)));
        if (ownerKeys.length === 0) {
            return { applied: false, reason: 'empty-owner-keys' };
        }

        const db = await openSearchDb();
        const existingMeta = await db.get(STORE_META, SNAPSHOT_META_KEY);
        if (!isRecordMeta(existingMeta)) {
            return { applied: false, reason: 'record-storage-not-ready' };
        }

        const baseSignature = normalizeSignature(safeSnapshot.baseSignature);
        if (baseSignature && normalizeSignature(existingMeta.signature) !== baseSignature) {
            return { applied: false, reason: 'base-signature-mismatch' };
        }

        const records = createRecordsFromSnapshot(safeSnapshot)
            .filter(record => ownerKeys.includes(record.ownerKey));
        const coordinateRecords = createCoordinateRecords(safeSnapshot.coordinates)
            .filter(record => ownerKeys.includes(record.ownerKey));

        const tx = db.transaction([STORE_META, STORE_RECORDS, STORE_COORDINATES], 'readwrite');
        const metaStore = tx.objectStore(STORE_META);
        const recordStore = tx.objectStore(STORE_RECORDS);
        const coordStore = tx.objectStore(STORE_COORDINATES);

        await Promise.all([
            ...ownerKeys.map(ownerKey => deleteByOwnerKey(recordStore, ownerKey)),
            ...ownerKeys.map(ownerKey => deleteByOwnerKey(coordStore, ownerKey))
        ]);

        await Promise.all([
            ...records.map(record => recordStore.put(record)),
            ...coordinateRecords.map(record => coordStore.put(record))
        ]);

        const counts = await countRecordStores(recordStore, coordStore);
        const meta = Object.assign({}, existingMeta, {
            signature,
            complete: true,
            schemaVersion: DB_VERSION,
            storageFormat: RECORD_STORAGE_FORMAT,
            builtAt: existingMeta.builtAt || Date.now(),
            updatedAt: Date.now(),
            lastPatchOwnerKeys: ownerKeys,
            counts
        });

        await metaStore.put(meta, SNAPSHOT_META_KEY);
        await tx.done;

        return meta;
    }

    async function loadCoordinatesForOwners(db, ownerKeys) {
        const keys = Array.from(new Set((Array.isArray(ownerKeys) ? ownerKeys : [])
            .map(normalizeOwnerKey)
            .filter(Boolean)));
        if (keys.length === 0) return {};

        const tx = db.transaction(STORE_COORDINATES, 'readonly');
        const ownerIndex = tx.store.index(INDEX_OWNER);
        const lists = await Promise.all(keys.map(ownerKey => ownerIndex.getAll(ownerKey)));
        await tx.done;
        return coordinateRecordsToObject(lists.flat());
    }

    async function loadRecordModeSnapshot(db, meta, mode) {
        const normalizedMode = normalizeMode(mode);
        const records = await db.getAllFromIndex(STORE_RECORDS, INDEX_MODE, normalizedMode);
        const list = recordsToList(records);
        const ownerKeys = records.map(record => record && record.ownerKey).filter(Boolean);
        const coordinates = await loadCoordinatesForOwners(db, ownerKeys);

        return {
            signature: meta.signature,
            mode,
            list,
            coordinates,
            meta
        };
    }

    async function loadLegacyModeSnapshot(db, meta, mode) {
        const shardKey = modeToShardKey(mode);
        const [list, coordinates] = await Promise.all([
            db.get(STORE_SHARDS, shardKey),
            db.get(STORE_SHARDS, SHARD_KEYS.coordinates)
        ]);

        if (!Array.isArray(list) || !coordinates || typeof coordinates !== 'object') {
            return null;
        }

        return {
            signature: meta.signature,
            mode,
            list,
            coordinates,
            meta
        };
    }

    async function loadModeSnapshot(mode, signature) {
        const { db, meta, dirtyState } = await getMetaWithDirtyState();
        if (!isFreshMeta(meta, signature) || !isDirtyStateClean(dirtyState)) return null;

        if (isRecordMeta(meta)) {
            return loadRecordModeSnapshot(db, meta, mode);
        }
        return loadLegacyModeSnapshot(db, meta, mode);
    }

    async function loadRecordAllSnapshot(db, meta) {
        const [bookmarkRecords, cardRecords, descriptionRecords, coordinateRecords] = await Promise.all([
            db.getAllFromIndex(STORE_RECORDS, INDEX_MODE, 'bookmark'),
            db.getAllFromIndex(STORE_RECORDS, INDEX_MODE, 'structure'),
            db.getAllFromIndex(STORE_RECORDS, INDEX_MODE, 'description'),
            db.getAll(STORE_COORDINATES)
        ]);

        return {
            signature: meta.signature,
            bookmark: recordsToList(bookmarkRecords),
            card: recordsToList(cardRecords),
            description: recordsToList(descriptionRecords),
            coordinates: coordinateRecordsToObject(coordinateRecords),
            meta
        };
    }

    async function loadLegacyAllSnapshot(db, meta) {
        const [bookmark, card, description, coordinates] = await Promise.all([
            db.get(STORE_SHARDS, SHARD_KEYS.bookmark),
            db.get(STORE_SHARDS, SHARD_KEYS.card),
            db.get(STORE_SHARDS, SHARD_KEYS.description),
            db.get(STORE_SHARDS, SHARD_KEYS.coordinates)
        ]);

        if (!Array.isArray(bookmark) || !Array.isArray(card) || !Array.isArray(description) ||
            !coordinates || typeof coordinates !== 'object') {
            return null;
        }

        return {
            signature: meta.signature,
            bookmark,
            card,
            description,
            coordinates,
            meta
        };
    }

    async function loadAllSnapshot(signature, options = {}) {
        const { db, meta, dirtyState } = await getMetaWithDirtyState();
        const allowStale = !!(options && options.allowStale === true);
        if (allowStale) {
            if (!isCompleteMeta(meta)) return null;
        } else {
            if (!isFreshMeta(meta, signature) || !isDirtyStateClean(dirtyState)) return null;
        }

        if (isRecordMeta(meta)) {
            return loadRecordAllSnapshot(db, meta);
        }
        return loadLegacyAllSnapshot(db, meta);
    }

    async function loadLatestSnapshot() {
        return loadAllSnapshot('', { allowStale: true });
    }

    async function clearLegacyChromeStorageIndex() {
        if (!globalThis.chrome || !chrome.storage || !chrome.storage.local) return;
        try {
            await chrome.storage.local.remove(LEGACY_STORAGE_KEYS);
        } catch (err) {
            console.warn('[SearchIndexDb] Failed to remove legacy chrome.storage search index:', err);
        }
    }

    globalThis.SearchIndexDb = {
        clearLegacyChromeStorageIndex,
        clearProcessedDirtyState,
        getDirtyState,
        getMeta,
        hasFreshIndex,
        loadAllSnapshot,
        loadLatestSnapshot,
        loadModeSnapshot,
        markDirtyState,
        saveIncrementalSnapshot,
        saveSnapshot
    };
}());
