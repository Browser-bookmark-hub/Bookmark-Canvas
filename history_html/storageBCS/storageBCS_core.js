/*
 * Bookmark-Canvas storageBCS core
 *
 * Source: history_html/bookmark_canvas_module.js
 * Extracted range: lines 28965-39089 at the time this folder was created.
 *
 * This file is loaded by history.html before feature layers and holds the shared
 * BCS storage, canvas protocol, JSON compatibility, and markdown/html conversion
 * helpers used by import/export, AI, and sync flows. It still expects the
 * original Bookmark-Canvas runtime globals when executed.
 *
 * Shared-core protocol
 * --------------------
 * Treat this file as the common data/protocol layer for three feature families:
 * manual import/export, future AI operations, and sync. Keep UI flows, dialogs,
 * downloads, file pickers, and feature-specific orchestration outside this file.
 *
 * Code belongs here when it is reusable data infrastructure:
 * - BCS storage reads/writes, signatures, canonicalization, and state snapshots.
 * - Canvas temp-state normalization, protocol views, and runtime reconstruction.
 * - Permanent-section BCS content, Chrome bookmark tree snapshots, root metadata,
 *   copy anchors, and incremental bookmark-event application.
 * - JSON compatibility formats and compact metadata comments shared by import,
 *   export, AI, and sync.
 * - Markdown/HTML compatibility for descriptions, temp sections, permanent
 *   sections, blank markdown cards, and native text cards.
 *
 * Code should stay in feature files when it is specific to one flow:
 * - Import/export dialogs, previews, file inputs, download actions, and mode
 *   selection UI.
 * - Presentation-only export modes.
 * - Import placement and toolbar button wiring.
 *
 * When adding new operations (create/update/delete/replace/apply), prefer adding
 * a small reusable primitive here and expose it through a stable facade such as
 * CanvasProtocolBridge / a future storageBCS facade. Feature layers should call the
 * facade instead of reaching into private __* helpers directly.
 */

// Shared Canvas data core
// =============================================================================

// Import/export dialogs and manual entry points moved to import-export-transfer-feature.js

const TEMP_SECTION_STORAGE_KEY = 'bcs:temp-state-snapshot';
const BCS_META_KEY = 'bcs:meta';
const BCS_CANVAS_KEY = 'bcs:canvas';
const BCS_SECTION_PREFIX = 'bcs:section:';
const BCS_PERM_MAIN_KEY = 'bcs:perm:main';
const BCS_PERM_COPY_PREFIX = 'bcs:perm:copy-';
const BCS_SIGNAL_KEY = 'bcs:signal';
const BCS_META_SCHEMA_VERSION = 5;
const PERMANENT_SECTION_COPIES_STORAGE_KEY = 'bcs:perm:copies';
const PERMANENT_MAIN_TIP_STORAGE_KEY = 'bcs:perm:tip-main';
const PERMANENT_COPY_TIP_STORAGE_PREFIX = 'bcs:perm:tip-copy-';
const PERMANENT_ROOT_META_STORAGE_KEY = 'bcs:perm:root-meta';
const BCS_BACKUP_SLOT_KEY = 'bcs:backup:slot';
const BCS_IMPORT_THRESHOLD_KEY = 'canvas-import-threshold-v1';
const BCS_IMPORT_THRESHOLD_DEFAULT = 300;
const BCS_LEGACY_TEMP_MIGRATION_DONE_KEY = 'bcs:legacy-temp-migrated-v1';

// =============================================================================
// ID Generators (sync-stable identifiers)
// =============================================================================
// Three identifier families share one algorithm: `<prefix>_<YYYYMMDD>_hash_<token7>`.
// - syncId_*   binds a Chrome bookmark to a cross-device stable identifier in identityMap.
// - tempId_*   identifies a temp-section item (book / folder) regardless of section.
// - tempSecId_* identifies a temp section itself; the "A-1-1" label is computed separately.
// Tokens use a 5-byte CSPRNG draw rendered to base36, truncated to 7 characters. Per-process
// dedup sets guard against the (astronomically rare) collision during a single page session.

const __BCS_ID_TOKEN_LENGTH = 7;
const __bcsIssuedSyncIds = new Set();
const __bcsIssuedTempIds = new Set();
const __bcsIssuedTempSectionIds = new Set();

function __formatTodayYYYYMMDD() {
    const d = new Date();
    const yyyy = String(d.getFullYear()).padStart(4, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

function __makeBcsIdToken(length = __BCS_ID_TOKEN_LENGTH) {
    const cryptoApi = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
    let token = '';
    while (token.length < length) {
        let chunk = '';
        if (cryptoApi) {
            const bytes = new Uint8Array(8);
            cryptoApi.getRandomValues(bytes);
            for (let i = 0; i < bytes.length; i++) {
                chunk += bytes[i].toString(36);
            }
        } else {
            chunk += Math.random().toString(36).slice(2);
            chunk += Date.now().toString(36);
        }
        token += chunk.replace(/[^a-z0-9]/g, '');
    }
    return token.slice(0, length);
}

function __mintBcsId(prefix, issuedSet) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const id = `${prefix}_${__formatTodayYYYYMMDD()}_hash_${__makeBcsIdToken()}`;
        if (!issuedSet.has(id)) {
            issuedSet.add(id);
            return id;
        }
    }
    const fallback = `${prefix}_${__formatTodayYYYYMMDD()}_hash_${__makeBcsIdToken(10)}`;
    issuedSet.add(fallback);
    return fallback;
}

function __generateSyncId() {
    return __mintBcsId('syncId', __bcsIssuedSyncIds);
}

function __generateTempId() {
    return __mintBcsId('tempId', __bcsIssuedTempIds);
}

function __generateTempSectionId() {
    return __mintBcsId('tempSecId', __bcsIssuedTempSectionIds);
}

function __isHashedSyncId(value) {
    return typeof value === 'string' && /^syncId_\d{8}_hash_[a-z0-9]{5,}$/.test(value);
}

function __isHashedTempItemId(value) {
    return typeof value === 'string' && /^tempId_\d{8}_hash_[a-z0-9]{5,}$/.test(value);
}

function __isHashedTempSectionId(value) {
    return typeof value === 'string' && /^tempSecId_\d{8}_hash_[a-z0-9]{5,}$/.test(value);
}

function __isLegacyTempSectionId(value) {
    return typeof value === 'string' && /^temp-section-\d+$/.test(value);
}

function __isLegacyTempItemId(value) {
    return typeof value === 'string' && /^temp-temp-section-\d+-\d+$/.test(value);
}

function __rememberExistingBcsId(value) {
    if (typeof value !== 'string') return;
    if (__isHashedSyncId(value)) __bcsIssuedSyncIds.add(value);
    else if (__isHashedTempItemId(value)) __bcsIssuedTempIds.add(value);
    else if (__isHashedTempSectionId(value)) __bcsIssuedTempSectionIds.add(value);
}

function __normalizeCanvasTempStatePayloadForImport(stateInput, options = {}) {
    const parsedState = typeof stateInput === 'string'
        ? __safeParseCanvasStorageJson(stateInput)
        : stateInput;
    if (!parsedState || typeof parsedState !== 'object') return null;

    const hasPayload = (
        Array.isArray(parsedState.sections)
        || Array.isArray(parsedState.tempSections)
        || Array.isArray(parsedState.mdNodes)
        || Array.isArray(parsedState.cards)
        || Array.isArray(parsedState.edges)
    );
    if (!hasPayload) return null;

    const sections = Array.isArray(parsedState.sections)
        ? parsedState.sections
        : (Array.isArray(parsedState.tempSections) ? parsedState.tempSections : []);
    const mdNodes = Array.isArray(parsedState.mdNodes)
        ? parsedState.mdNodes
        : (Array.isArray(parsedState.cards) ? parsedState.cards : []);
    const edges = Array.isArray(parsedState.edges) ? parsedState.edges : [];
    const preserveRaw = !!(options && options.preserveRaw === true);

    if (preserveRaw) {
        return __normalizeCanvasTempStateForRuntime({
            ...parsedState,
            sections,
            tempSectionCounter: Number(parsedState.tempSectionCounter) || sections.length || 0,
            tempItemCounter: Number(parsedState.tempItemCounter) || 0,
            colorCursor: Number(parsedState.colorCursor) || 0,
            tempSectionLastColor: parsedState.tempSectionLastColor || getTempSectionDefaultColor(),
            tempSectionPrevColor: parsedState.tempSectionPrevColor || null,
            mdNodes,
            mdNodeCounter: Number(parsedState.mdNodeCounter) || mdNodes.length || 0,
            edges,
            edgeCounter: Number(parsedState.edgeCounter) || edges.length || 0,
            timestamp: Number(parsedState.timestamp) || Date.now()
        }, {
            preserveRaw: true
        });
    }

    return __buildCanvasTempStateProtocolView({
        ...parsedState,
        sections,
        tempSectionCounter: Number(parsedState.tempSectionCounter) || sections.length || 0,
        tempItemCounter: Number(parsedState.tempItemCounter) || 0,
        colorCursor: Number(parsedState.colorCursor) || 0,
        tempSectionLastColor: parsedState.tempSectionLastColor || getTempSectionDefaultColor(),
        tempSectionPrevColor: parsedState.tempSectionPrevColor || null,
        mdNodes,
        mdNodeCounter: Number(parsedState.mdNodeCounter) || mdNodes.length || 0,
        edges,
        edgeCounter: Number(parsedState.edgeCounter) || edges.length || 0,
        timestamp: Number(parsedState.timestamp) || Date.now()
    }, options);
}

function __summarizeCanvasTempStateForCanonicalAudit(stateInput) {
    const normalized = __normalizeCanvasTempStatePayloadForImport(stateInput);
    if (!normalized) {
        return {
            sections: 0,
            mdNodes: 0,
            edges: 0,
            tempItems: 0
        };
    }

    const countItems = (itemsInput) => {
        const stack = Array.isArray(itemsInput) ? itemsInput.slice() : [];
        let count = 0;
        while (stack.length) {
            const item = stack.pop();
            if (!item || typeof item !== 'object') continue;
            count += 1;
            if (Array.isArray(item.children) && item.children.length) {
                stack.push(...item.children);
            }
        }
        return count;
    };

    const sections = Array.isArray(normalized.sections) ? normalized.sections : [];
    let tempItems = 0;
    sections.forEach((section) => {
        tempItems += countItems(section && section.items);
    });

    return {
        sections: sections.length,
        mdNodes: Array.isArray(normalized.mdNodes) ? normalized.mdNodes.length : 0,
        edges: Array.isArray(normalized.edges) ? normalized.edges.length : 0,
        tempItems
    };
}

function __buildCanvasStateBackupViewFromProtocolState(stateInput) {
    const state = stateInput && typeof stateInput === 'object' ? stateInput : null;
    if (!state) {
        return {
            tempSections: [],
            mdNodes: [],
            edges: [],
            tempSectionCounter: 0,
            tempItemCounter: 0,
            colorCursor: 0,
            tempSectionLastColor: getTempSectionDefaultColor(),
            tempSectionPrevColor: null,
            mdNodeCounter: 0,
            edgeCounter: 0,
            timestamp: Date.now()
        };
    }

    return {
        tempSections: Array.isArray(state.sections) ? state.sections : [],
        mdNodes: Array.isArray(state.mdNodes) ? state.mdNodes : [],
        edges: Array.isArray(state.edges) ? state.edges : [],
        tempSectionCounter: Number(state.tempSectionCounter) || 0,
        tempItemCounter: Number(state.tempItemCounter) || 0,
        colorCursor: Number(state.colorCursor) || 0,
        tempSectionLastColor: state.tempSectionLastColor || getTempSectionDefaultColor(),
        tempSectionPrevColor: state.tempSectionPrevColor || null,
        mdNodeCounter: Number(state.mdNodeCounter) || 0,
        edgeCounter: Number(state.edgeCounter) || 0,
        timestamp: Number(state.timestamp) || Date.now()
    };
}

function __buildCanonicalImportContract(input = {}, options = {}) {
    const payload = (input && typeof input === 'object') ? input : {};
    const primaryInput = (payload.primaryState && typeof payload.primaryState === 'object') ? payload.primaryState : {};
    const storageInput = (payload.storage && typeof payload.storage === 'object') ? payload.storage : {};
    const source = String(
        (options && typeof options.source === 'string' && options.source.trim())
            ? options.source
            : (payload.source || 'unknown')
    ).trim() || 'unknown';

    const preserveRaw = !!(options && options.preserveRaw === true);
    const tempCandidates = [
        { value: primaryInput.canvasState, source: 'primary.canvasState' },
        { value: storageInput[TEMP_SECTION_STORAGE_KEY], source: `storage.${TEMP_SECTION_STORAGE_KEY}` },
        { value: payload.tempState, source: 'input.tempState' }
    ];

    let resolvedTempState = null;
    let resolvedTempSource = 'none';
    for (let i = 0; i < tempCandidates.length; i++) {
        const candidate = tempCandidates[i];
        const normalized = __normalizeCanvasTempStatePayloadForImport(candidate.value, {
            preserveRaw
        });
        if (!normalized) continue;
        resolvedTempState = normalized;
        resolvedTempSource = candidate.source;
        break;
    }
    if (!resolvedTempState) return null;

    const canonicalPersistedState = __buildPersistedCanvasState(resolvedTempState, {
        preserveRaw
    });
    const canonicalTempState = __normalizeCanvasTempStatePayloadForImport(canonicalPersistedState, {
        preserveRaw
    }) || resolvedTempState;

    const canonicalStorage = __cloneCanvasProtocolJson(storageInput) || {};
    canonicalStorage[TEMP_SECTION_STORAGE_KEY] = __cloneCanvasProtocolJson(canonicalTempState);

    const canonicalPrimaryState = __cloneCanvasProtocolJson(primaryInput) || {};
    canonicalPrimaryState.canvasState = __buildCanvasStateBackupViewFromProtocolState(canonicalTempState);

    const normalizedPermanentTreeSnapshot = __normalizePermanentTreeSnapshotForProtocol(canonicalPrimaryState.permanentTreeSnapshot);
    if (normalizedPermanentTreeSnapshot && normalizedPermanentTreeSnapshot.length) {
        canonicalPrimaryState.permanentTreeSnapshot = normalizedPermanentTreeSnapshot;
    } else {
        delete canonicalPrimaryState.permanentTreeSnapshot;
    }

    return {
        version: 1,
        schema: 'bookmark-canvas.import-contract.v1',
        source,
        resolvedTempSource,
        tempState: canonicalTempState,
        storage: canonicalStorage,
        primaryState: canonicalPrimaryState
    };
}

function __buildImportPayloadFromCanonicalImportContract(contractInput, options = {}) {
    const contract = (contractInput && typeof contractInput === 'object') ? contractInput : null;
    if (!contract || !contract.tempState) return null;
    const includeSource = !!(options && options.includeSource);
    const payload = {
        tempState: __cloneCanvasProtocolJson(contract.tempState),
        storage: __cloneCanvasProtocolJson(contract.storage) || {},
        primaryState: __cloneCanvasProtocolJson(contract.primaryState) || {}
    };
    payload.storage[TEMP_SECTION_STORAGE_KEY] = __cloneCanvasProtocolJson(payload.tempState);
    if (includeSource) {
        payload.source = String(contract.resolvedTempSource || 'none');
    }
    return payload;
}

function __resolveCanonicalTempStateForShadowAudit(tempStateInput, storageInput, primaryStateInput) {
    const canonical = __buildCanonicalImportContract({
        tempState: tempStateInput,
        storage: storageInput,
        primaryState: primaryStateInput,
        source: 'shadow-audit'
    }, {
        source: 'shadow-audit'
    });
    if (canonical && canonical.tempState) {
        return {
            tempState: canonical.tempState,
            source: String(canonical.resolvedTempSource || 'none')
        };
    }

    return {
        tempState: null,
        source: 'none'
    };
}

function __buildCanonicalImportShadowPayload(tempStateInput, storageInput, primaryStateInput) {
    const canonical = __buildCanonicalImportContract({
        tempState: tempStateInput,
        storage: storageInput,
        primaryState: primaryStateInput,
        source: 'shadow-audit'
    }, {
        source: 'shadow-audit'
    });
    if (!canonical || !canonical.tempState) return null;
    return __buildImportPayloadFromCanonicalImportContract(canonical, { includeSource: true });
}

function __normalizeCanonicalImportAuditContext(channelInput, contextInput) {
    const context = (contextInput && typeof contextInput === 'object') ? contextInput : {};
    const normalizedChannel = String(channelInput || context.channel || 'unknown').trim() || 'unknown';
    const normalizedSource = String(context.source || '').trim() || 'unknown';
    const normalizedTrigger = String(context.trigger || '').trim() || 'manual-import';
    return {
        version: 1,
        channel: normalizedChannel,
        source: normalizedSource,
        trigger: normalizedTrigger
    };
}

function __normalizeCanonicalImportAuditSink(input) {
    const raw = (input && typeof input === 'object') ? input : {};
    const rawByChannel = (raw.byChannel && typeof raw.byChannel === 'object') ? raw.byChannel : {};
    const rawMismatchByType = (raw.mismatchByType && typeof raw.mismatchByType === 'object') ? raw.mismatchByType : {};
    return {
        version: 1,
        total: Math.max(0, Number(raw.total) || 0),
        mismatch: Math.max(0, Number(raw.mismatch) || 0),
        byChannel: {
            manualImport: Math.max(0, Number(rawByChannel.manualImport) || 0),
            unknown: Math.max(0, Number(rawByChannel.unknown) || 0)
        },
        mismatchByType: {
            sigChanged: Math.max(0, Number(rawMismatchByType.sigChanged) || 0),
            countChanged: Math.max(0, Number(rawMismatchByType.countChanged) || 0),
            permanentTreeChanged: Math.max(0, Number(rawMismatchByType.permanentTreeChanged) || 0),
            inputHomogeneous: Math.max(0, Number(rawMismatchByType.inputHomogeneous) || 0)
        },
        last: raw.last || null,
        recent: Array.isArray(raw.recent) ? raw.recent.slice() : [],
        updatedAt: Math.max(0, Number(raw.updatedAt) || 0)
    };
}

const CANVAS_CANONICAL_IMPORT_AUDIT_DEBUG_STORAGE_KEY = 'canvasCanonicalImportShadowAuditDebug';
function __isCanonicalImportShadowAuditEnabled() {
    try {
        if (typeof window === 'undefined') return false;
        if (window.__CANVAS_CANONICAL_IMPORT_SHADOW_AUDIT_DEBUG__ === true) return true;
        if (window.__canvasCanonicalImportShadowAuditDebug === true) return true;

        const raw = localStorage.getItem(CANVAS_CANONICAL_IMPORT_AUDIT_DEBUG_STORAGE_KEY);
        if (raw == null) return false;
        const normalized = String(raw).trim().toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'on';
    } catch (_) {
        return false;
    }
}

function __runCanonicalImportShadowAudit(channel, tempStateInput, storageInput, primaryStateInput, contextInput = null) {
    if (!__isCanonicalImportShadowAuditEnabled()) return null;
    const startedAt = Date.now();
    const auditContext = __normalizeCanonicalImportAuditContext(channel, contextInput);
    const legacyTempState = __normalizeCanvasTempStatePayloadForImport(tempStateInput);
    const canonicalPayload = __buildCanonicalImportShadowPayload(tempStateInput, storageInput, primaryStateInput);
    if (!legacyTempState || !canonicalPayload || !canonicalPayload.tempState) return null;

    const legacySignature = __buildCanvasTempStateSignature(legacyTempState);
    const canonicalSignature = __buildCanvasTempStateSignature(canonicalPayload.tempState);
    const legacySummary = __summarizeCanvasTempStateForCanonicalAudit(legacyTempState);
    const canonicalSummary = __summarizeCanvasTempStateForCanonicalAudit(canonicalPayload.tempState);
    const legacyHasPermanentTree = !!(
        primaryStateInput
        && typeof primaryStateInput === 'object'
        && Array.isArray(primaryStateInput.permanentTreeSnapshot)
        && primaryStateInput.permanentTreeSnapshot.length
    );
    const canonicalHasPermanentTree = !!(
        canonicalPayload.primaryState
        && Array.isArray(canonicalPayload.primaryState.permanentTreeSnapshot)
        && canonicalPayload.primaryState.permanentTreeSnapshot.length
    );
    const canonicalSource = String(canonicalPayload.source || 'none');
    const inputHomogeneous = canonicalSource === 'input.tempState'
        || canonicalSource === 'tempStateInput'
        || canonicalSource === 'none';
    const same = legacySignature === canonicalSignature;
    const sigChanged = legacySignature !== canonicalSignature;
    const sectionDelta = Number(canonicalSummary.sections) - Number(legacySummary.sections);
    const mdDelta = Number(canonicalSummary.mdNodes) - Number(legacySummary.mdNodes);
    const edgeDelta = Number(canonicalSummary.edges) - Number(legacySummary.edges);
    const tempItemDelta = Number(canonicalSummary.tempItems) - Number(legacySummary.tempItems);
    const permanentTreeChanged = legacyHasPermanentTree !== canonicalHasPermanentTree;
    const countChanged = !!(sectionDelta || mdDelta || edgeDelta || tempItemDelta || permanentTreeChanged);
    const record = {
        version: 1,
        ts: Date.now(),
        channel: auditContext.channel,
        source: auditContext.source,
        trigger: auditContext.trigger,
        legacy: {
            sig: legacySignature,
            sections: Number(legacySummary.sections) || 0,
            mdNodes: Number(legacySummary.mdNodes) || 0,
            edges: Number(legacySummary.edges) || 0,
            tempItems: Number(legacySummary.tempItems) || 0,
            hasPermanentTree: legacyHasPermanentTree
        },
        canonical: {
            sig: canonicalSignature,
            sections: Number(canonicalSummary.sections) || 0,
            mdNodes: Number(canonicalSummary.mdNodes) || 0,
            edges: Number(canonicalSummary.edges) || 0,
            tempItems: Number(canonicalSummary.tempItems) || 0,
            hasPermanentTree: canonicalHasPermanentTree,
            source: canonicalSource
        },
        diff: {
            same,
            sigChanged,
            countChanged,
            sectionDelta,
            mdDelta,
            edgeDelta,
            tempItemDelta,
            permanentTreeChanged,
            inputHomogeneous
        },
        costMs: Math.max(0, Date.now() - startedAt)
    };

    if (typeof window !== 'undefined') {
        const sink = __normalizeCanonicalImportAuditSink(window.__canvasCanonicalImportAudit);
        sink.total += 1;
        if (auditContext.channel === 'manual-import') {
            sink.byChannel.manualImport += 1;
        } else {
            sink.byChannel.unknown += 1;
        }
        if (!same) {
            sink.mismatch += 1;
            if (sigChanged) sink.mismatchByType.sigChanged += 1;
            if (countChanged) sink.mismatchByType.countChanged += 1;
            if (permanentTreeChanged) sink.mismatchByType.permanentTreeChanged += 1;
        }
        if (inputHomogeneous) {
            sink.mismatchByType.inputHomogeneous += 1;
        }
        sink.last = record;
        sink.recent.push(record);
        if (sink.recent.length > 50) sink.recent.splice(0, sink.recent.length - 50);
        sink.updatedAt = Date.now();
        window.__canvasCanonicalImportAudit = sink;
    }

    if (!same) {
        console.warn('[Canvas Canonical] import shadow mismatch:', record);
    } else {
        console.log('[Canvas Canonical] import shadow OK:', record.channel, record.source, record.trigger);
    }
    return record;
}

// Manual import/export file handling moved to import-export-transfer-feature.js

// =============================================================================
// Canvas 导入/导出（zip 包：.canvas + .md + 本体json）
// =============================================================================

function __getLang() {
    const lang = (typeof currentLang === 'string' && currentLang) ? currentLang : 'zh_CN';
    const lower = String(lang).toLowerCase();
    const isEn = lower === 'en' || lower.startsWith('en_') || lower.startsWith('en-') || lower.startsWith('en');
    return { lang, isEn };
}

function __frontmatter(meta) {
    const obj = (meta && typeof meta === 'object') ? meta : {};
    const lines = ['---'];
    Object.keys(obj).forEach((key) => {
        const value = obj[key];
        if (value === undefined || value === null) return;
        if (!key || /[^a-zA-Z0-9_.-]/.test(key)) return;

        if (typeof value === 'number' && isFinite(value)) {
            lines.push(`${key}: ${value}`);
            return;
        }
        if (typeof value === 'boolean') {
            lines.push(`${key}: ${value ? 'true' : 'false'}`);
            return;
        }

        const text = String(value).replace(/\r?\n/g, ' ').trim();
        lines.push(`${key}: ${JSON.stringify(text)}`);
    });
    lines.push('---');
    lines.push('');
    return lines.join('\n');
}

function __renderDescriptionMarkdownToHtml(rawDesc) {
    const desc = String(rawDesc || '').trim();
    if (!desc) return '';
    if (typeof marked !== 'undefined') {
        try {
            return marked.parse(desc);
        } catch (_) { }
    }
    return desc.split('\n').map((line) => `<p>${__escapeHtml(line)}</p>`).join('');
}

const __CANVAS_SECTION_JSON_FORMAT = 'bookmark-canvas-section';
const __CANVAS_SECTION_JSON_SCHEMA_VERSION = 1;
const __CANVAS_COMPACT_TAG_DESCRIPTION = '1';
const __CANVAS_COMPACT_TAG_FOLD_STATE = '2';
const __CANVAS_COMPACT_TAG_ROOT_META = '3';
const __CANVAS_COMPACT_TAG_NATIVE_TEXT_META = '4';
const __CANVAS_COMPACT_TAG_EXPORT_FORMAT = '9';

function __normalizeCanvasObsidianExportFormat(value, fallback = 'json') {
    const format = String(value || '').trim().toLowerCase();
    if (format === 'json') return 'json';
    const normalizedFallback = String(fallback || '').trim().toLowerCase();
    if (normalizedFallback === 'json') return 'json';
    return normalizedFallback ? 'json' : '';
}

function __escapeCanvasRegexLiteral(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function __encodeCanvasCompactPayload(rawValue) {
    const text = String(rawValue == null ? '' : rawValue);
    if (!text) return '';
    try {
        if (typeof TextEncoder !== 'undefined' && typeof btoa === 'function') {
            const bytes = new TextEncoder().encode(text);
            let binary = '';
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
            }
            return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        }
    } catch (_) { }
    try {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(text, 'utf8')
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/g, '');
        }
    } catch (_) { }
    return '';
}

function __decodeCanvasCompactPayload(encodedValue) {
    let encoded = String(encodedValue || '').trim();
    if (!encoded) return '';
    encoded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (encoded.length % 4 !== 0) {
        encoded += '=';
    }
    try {
        if (typeof atob === 'function' && typeof TextDecoder !== 'undefined') {
            const binary = atob(encoded);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return new TextDecoder('utf-8').decode(bytes);
        }
    } catch (_) { }
    try {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(encoded, 'base64').toString('utf8');
        }
    } catch (_) { }
    return '';
}

function __buildCanvasCompactComment(tag, rawPayload) {
    const normalizedTag = String(tag || '').trim();
    if (!normalizedTag) return '';
    const encodedPayload = __encodeCanvasCompactPayload(rawPayload);
    if (!encodedPayload) return '';
    return `<!--bc:${normalizedTag}:${encodedPayload}-->`;
}

function __extractCanvasCompactComment(bodyText, tag) {
    const body = String(bodyText || '').replace(/\r\n?/g, '\n');
    const normalizedTag = String(tag || '').trim();
    if (!normalizedTag) {
        return { body, payload: '', found: false };
    }
    const pattern = new RegExp(`<!--\\s*bc:${__escapeCanvasRegexLiteral(normalizedTag)}:([A-Za-z0-9_-]+)\\s*-->`, 'i');
    const match = body.match(pattern);
    if (!match) {
        return { body, payload: '', found: false };
    }

    const payload = __decodeCanvasCompactPayload(match[1]);
    const index = Number(match.index) || 0;
    const before = body.slice(0, index).replace(/[\t ]*\n?$/, '\n');
    const after = body.slice(index + match[0].length).replace(/^\n?/, '');
    const merged = `${before}${after}`.replace(/\n{3,}/g, '\n\n').trim();
    return {
        body: merged,
        payload,
        found: true
    };
}

function __buildCanvasExportFormatCompactComment(exportFormatInput = '') {
    const format = __normalizeCanvasObsidianExportFormat(exportFormatInput, '');
    if (!format) return '';
    return __buildCanvasCompactComment(__CANVAS_COMPACT_TAG_EXPORT_FORMAT, format);
}

function __extractCanvasExportFormatCompactComment(bodyText) {
    const extracted = __extractCanvasCompactComment(bodyText, __CANVAS_COMPACT_TAG_EXPORT_FORMAT);
    return {
        body: extracted.body,
        exportFormat: __normalizeCanvasObsidianExportFormat(extracted.payload, '')
    };
}

function __parseCanvasProtocolDateValue(value) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
        return numericValue;
    }
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return 0;
}

function __formatCanvasProtocolDateValue(value) {
    const ts = __parseCanvasProtocolDateValue(value);
    if (!ts) return '';
    try {
        return new Date(ts).toISOString();
    } catch (_) {
        return '';
    }
}

function __normalizeCanvasSectionJsonProtocolObject(rawProtocol) {
    const source = __cloneCanvasProtocolJson(rawProtocol);
    if (!source || typeof source !== 'object') return null;

    const sectionType = String(source.sectionType || '').trim().toLowerCase();
    if (sectionType !== 'permanent' && sectionType !== 'temporary') return null;

    const format = String(source.format || __CANVAS_SECTION_JSON_FORMAT).trim() || __CANVAS_SECTION_JSON_FORMAT;
    const schemaVersionRaw = Number(source.schemaVersion);
    const hasSchemaVersion = Number.isFinite(schemaVersionRaw) && schemaVersionRaw > 0;

    if (sectionType === 'permanent') {
        const tree = source.tree;
        const hasTree = !!(tree && typeof tree === 'object');
        const inheritFrom = __normalizeCanvasMarkdownPath(source.inheritFrom || '');
        const selfPath = __normalizeCanvasMarkdownPath(source.selfPath || '');
        if (!hasTree && !inheritFrom) return null;
        const normalized = Object.assign({}, source, {
            format,
            schemaVersion: hasSchemaVersion ? schemaVersionRaw : __CANVAS_SECTION_JSON_SCHEMA_VERSION,
            sectionType
        });
        if (hasTree) {
            normalized.tree = tree;
        } else {
            delete normalized.tree;
        }
        if (inheritFrom) {
            normalized.inheritFrom = inheritFrom;
        } else {
            delete normalized.inheritFrom;
        }
        if (selfPath) {
            normalized.selfPath = selfPath;
        } else {
            delete normalized.selfPath;
        }
        return normalized;
    }

    const items = Array.isArray(source.items) ? source.items : null;
    if (!items) return null;

    return Object.assign({}, source, {
        format,
        schemaVersion: 2,
        sectionType,
        items
    });
}

function __buildCanvasSectionJsonCodeBlock(protocolInput) {
    const normalized = __normalizeCanvasSectionJsonProtocolObject(protocolInput);
    if (!normalized) return '';
    return JSON.stringify(normalized, null, 2);
}

function __extractCanvasSectionJsonCodeBlock(bodyText) {
    const body = String(bodyText || '').replace(/\r\n?/g, '\n');
    const parseProtocol = (jsonText) => {
        try {
            return __normalizeCanvasSectionJsonProtocolObject(JSON.parse(String(jsonText || '').trim()));
        } catch (_) {
            return null;
        }
    };

    const trimmed = body.trim();
    if (!trimmed || !/^[\[{]/.test(trimmed)) {
        return { jsonProtocol: null };
    }
    return { jsonProtocol: parseProtocol(trimmed) };
}

function __resolveCanvasSectionJsonDescriptionMarkdown(protocolInput) {
    const protocol = __normalizeCanvasSectionJsonProtocolObject(protocolInput);
    if (!protocol) return '';
    return String(protocol.descriptionMd == null ? '' : protocol.descriptionMd);
}

function __normalizeBookmarkFolderType(folderType) {
    const raw = String(folderType || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    if (!raw) return '';
    if (raw === 'bookmarks-bar' || raw === 'bookmark-bar' || raw === 'favorites-bar') return 'bookmarks-bar';
    if (raw === 'other' || raw === 'other-bookmarks' || raw === 'other-bookmark' || raw === 'other-favorites' || raw === 'other-favorite') return 'other';
    if (raw === 'mobile' || raw === 'mobile-bookmarks' || raw === 'mobile-bookmark' || raw === 'mobile-favorites' || raw === 'mobile-favorite' || raw === 'synced') return 'mobile';
    if (raw === 'managed' || raw === 'managed-bookmarks' || raw === 'managed-bookmark') return 'managed';
    return raw;
}

function __normalizeBookmarkRootSyncing(value) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return null;
    if (text === 'true' || text === '1') return true;
    if (text === 'false' || text === '0') return false;
    return null;
}

function __canPersistBookmarkRootSyncing(folderType) {
    const normalized = __normalizeBookmarkFolderType(folderType);
    return normalized === 'bookmarks-bar'
        || normalized === 'other'
        || normalized === 'mobile'
        || normalized === 'managed';
}

function __folderTypeToPermanentRootKey(folderType) {
    const normalized = __normalizeBookmarkFolderType(folderType);
    if (!normalized) return '';
    if (normalized === 'bookmarks-bar') return 'bookmark_bar';
    if (normalized === 'other') return 'other';
    if (normalized === 'mobile') return 'mobile';
    if (normalized === 'managed') return 'managed';
    return `custom:${normalized}`;
}

function __permanentRootKeyToFolderType(rootKey) {
    const key = String(rootKey || '').trim().toLowerCase();
    if (!key) return '';
    if (key === 'bookmark_bar') return 'bookmarks-bar';
    if (key === 'other') return 'other';
    if (key === 'mobile') return 'mobile';
    if (key === 'managed') return 'managed';
    if (key.startsWith('custom:')) return key.slice('custom:'.length);
    return '';
}

function __normalizePermanentRootTitleKey(title) {
    const text = String(title || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!text) return '';
    if (text === 'bookmark bar' || text === 'bookmarks bar' || text === 'favorites bar' || text === '书签栏' || text === '收藏夹栏') return 'bookmark_bar';
    if (text === 'other bookmarks' || text === 'other bookmark' || text === 'other favorites' || text === 'other favorite' || text === '其他书签' || text === '其他收藏夹') return 'other';
    if (text === 'mobile bookmarks' || text === 'mobile bookmark' || text === 'mobile favorites' || text === 'mobile favorite' || text === '移动设备书签' || text === '移动收藏夹' || text === '手机收藏夹' || text === '手机书签') return 'mobile';
    if (text === 'managed bookmarks' || text === 'managed bookmark') return 'managed';
    return `custom:${text}`;
}

function __getPermanentRootMatchKey(node) {
    if (!node || typeof node !== 'object') return '';
    const folderTypeKey = __folderTypeToPermanentRootKey(node.folderType || node.folder_type || '');
    if (folderTypeKey) return folderTypeKey;
    const nodeId = String(node.id || '').trim();
    if (nodeId === '1') return 'bookmark_bar';
    if (nodeId === '2') return 'other';
    if (nodeId === '3') return 'mobile';
    return __normalizePermanentRootTitleKey(node.title || node.name || '');
}

function __getDefaultPermanentRootSectionTitle(folderType) {
    const { isEn } = __getLang();
    const normalized = __normalizeBookmarkFolderType(folderType);
    if (normalized === 'bookmarks-bar') return isEn ? 'Bookmarks Bar' : '书签栏';
    if (normalized === 'other') return isEn ? 'Other Bookmarks' : '其他书签';
    if (normalized === 'mobile') return isEn ? 'Mobile Bookmarks' : '移动设备书签';
    if (normalized === 'managed') return isEn ? 'Managed Bookmarks' : '受管理书签';
    return isEn ? 'Bookmarks' : '书签';
}

function __resolvePermanentRootSectionTitle(node) {
    const explicitTitle = String(node && (node.title || node.name) || '').trim();
    if (explicitTitle) return explicitTitle;
    const folderType = node && (node.folderType || node.folder_type)
        ? (node.folderType || node.folder_type)
        : __permanentRootKeyToFolderType(__getPermanentRootMatchKey(node));
    return __getDefaultPermanentRootSectionTitle(folderType);
}

function __normalizePermanentRootMeta(rawMeta) {
    const source = rawMeta && typeof rawMeta === 'object' ? rawMeta : {};
    const rawRoots = source.standardRoots && typeof source.standardRoots === 'object' ? source.standardRoots : {};
    const rawDescriptors = Array.isArray(source.rootDescriptors) ? source.rootDescriptors : [];
    const normalizedRoots = {};
    const normalizedDescriptors = [];

    Object.keys(rawRoots).forEach((rawKey) => {
        const entry = rawRoots[rawKey];
        if (!entry || typeof entry !== 'object') return;
        const folderType = __normalizeBookmarkFolderType(entry.folderType || __permanentRootKeyToFolderType(rawKey));
        const rootKey = __folderTypeToPermanentRootKey(folderType) || __normalizePermanentRootTitleKey(entry.sectionTitle || rawKey);
        if (!rootKey) return;
        const normalizedEntry = {
            present: entry.present !== false,
            sectionTitle: String(entry.sectionTitle || '').trim() || __getDefaultPermanentRootSectionTitle(folderType || __permanentRootKeyToFolderType(rootKey)),
            folderType: folderType || __permanentRootKeyToFolderType(rootKey)
        };
        const syncing = __canPersistBookmarkRootSyncing(normalizedEntry.folderType)
            ? __normalizeBookmarkRootSyncing(entry.syncing)
            : null;
        if (syncing !== null) {
            normalizedEntry.syncing = syncing;
        }
        normalizedRoots[rootKey] = normalizedEntry;
    });

    rawDescriptors.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const sectionTitle = String(entry.sectionTitle || entry.title || '').trim();
        const folderType = __normalizeBookmarkFolderType(entry.folderType || '');
        const rootKey = __folderTypeToPermanentRootKey(folderType) || __normalizePermanentRootTitleKey(sectionTitle);
        if (!sectionTitle && !folderType && !rootKey) return;

        const normalizedDescriptor = {
            sectionTitle: sectionTitle || __getDefaultPermanentRootSectionTitle(folderType || __permanentRootKeyToFolderType(rootKey)),
            folderType: folderType || __permanentRootKeyToFolderType(rootKey)
        };
        const syncing = __canPersistBookmarkRootSyncing(normalizedDescriptor.folderType)
            ? __normalizeBookmarkRootSyncing(entry.syncing)
            : null;
        if (syncing !== null) {
            normalizedDescriptor.syncing = syncing;
        }
        normalizedDescriptors.push(normalizedDescriptor);

        if (!rootKey) return;
        const existingRoot = normalizedRoots[rootKey];
        if (existingRoot && existingRoot.present !== false) return;
        const derivedRoot = {
            present: true,
            sectionTitle: normalizedDescriptor.sectionTitle,
            folderType: normalizedDescriptor.folderType
        };
        if (syncing !== null) {
            derivedRoot.syncing = syncing;
        }
        normalizedRoots[rootKey] = derivedRoot;
    });

    const hasSyncing = normalizedDescriptors.some((entry) => typeof entry.syncing === 'boolean')
        || Object.keys(normalizedRoots).some((rootKey) => typeof normalizedRoots[rootKey].syncing === 'boolean');
    const normalizedMeta = {
        schemaVersion: Number(source.schemaVersion) || (hasSyncing ? 2 : 1),
        standardRoots: normalizedRoots
    };
    if (normalizedDescriptors.length) {
        normalizedMeta.rootDescriptors = normalizedDescriptors;
    }
    return normalizedMeta;
}

function __buildPermanentRootMeta(bookmarkTree) {
    const root = Array.isArray(bookmarkTree) ? bookmarkTree[0] : null;
    const roots = root && Array.isArray(root.children) ? root.children : [];
    const standardRoots = {
        bookmark_bar: { present: false, sectionTitle: __getDefaultPermanentRootSectionTitle('bookmarks-bar'), folderType: 'bookmarks-bar' },
        other: { present: false, sectionTitle: __getDefaultPermanentRootSectionTitle('other'), folderType: 'other' },
        mobile: { present: false, sectionTitle: __getDefaultPermanentRootSectionTitle('mobile'), folderType: 'mobile' }
    };
    const rootDescriptors = [];

    roots.forEach((node) => {
        const rootKey = __getPermanentRootMatchKey(node);
        const folderType = __normalizeBookmarkFolderType(node.folderType || node.folder_type || __permanentRootKeyToFolderType(rootKey));
        const syncing = __canPersistBookmarkRootSyncing(folderType)
            ? __normalizeBookmarkRootSyncing(node && node.syncing)
            : null;
        const descriptor = {
            sectionTitle: __resolvePermanentRootSectionTitle(node),
            folderType: folderType || __permanentRootKeyToFolderType(rootKey)
        };
        if (syncing !== null) {
            descriptor.syncing = syncing;
        }
        if (descriptor.sectionTitle || descriptor.folderType) {
            rootDescriptors.push(descriptor);
        }

        if (!rootKey || !Object.prototype.hasOwnProperty.call(standardRoots, rootKey)) return;
        if (standardRoots[rootKey].present) return;
        const standardRoot = {
            present: true,
            sectionTitle: __resolvePermanentRootSectionTitle(node),
            folderType: folderType || __permanentRootKeyToFolderType(rootKey)
        };
        if (syncing !== null) {
            standardRoot.syncing = syncing;
        }
        standardRoots[rootKey] = standardRoot;
    });

    return __normalizePermanentRootMeta({
        schemaVersion: 2,
        standardRoots,
        rootDescriptors
    });
}

function __buildCanvasRootMetaCommentBlock(rootMeta) {
    const normalized = __normalizePermanentRootMeta(rootMeta);
    const roots = normalized && normalized.standardRoots && typeof normalized.standardRoots === 'object'
        ? normalized.standardRoots
        : {};
    if (!Object.keys(roots).length) return '';
    return __buildCanvasCompactComment(__CANVAS_COMPACT_TAG_ROOT_META, JSON.stringify(normalized));
}

function __cloneRawChromeBookmarkTreeSnapshot(rawTree) {
    const source = Array.isArray(rawTree)
        ? rawTree
        : ((rawTree && typeof rawTree === 'object' && Array.isArray(rawTree.children)) ? [rawTree] : null);
    if (!source || !source.length) return null;

    let snapshot = null;
    try {
        snapshot = JSON.parse(JSON.stringify(source));
    } catch (_) {
        return null;
    }
    return (Array.isArray(snapshot) && snapshot.length) ? snapshot : null;
}

function __getCanvasBookmarksApiForPermanentStorage() {
    try {
        if (typeof browserAPI !== 'undefined' && browserAPI && browserAPI.bookmarks) return browserAPI.bookmarks;
    } catch (_) { }
    try {
        if (typeof chrome !== 'undefined' && chrome && chrome.bookmarks) return chrome.bookmarks;
    } catch (_) { }
    try {
        if (typeof browser !== 'undefined' && browser && browser.bookmarks) return browser.bookmarks;
    } catch (_) { }
    return null;
}

function __getPermanentChromeTreeForStorage() {
    const api = __getCanvasBookmarksApiForPermanentStorage();
    if (!api || typeof api.getTree !== 'function') {
        return Promise.resolve(null);
    }
    return new Promise((resolve) => {
        try {
            const maybePromise = api.getTree((tree) => {
                resolve(Array.isArray(tree) ? tree : null);
            });
            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.then((tree) => resolve(Array.isArray(tree) ? tree : null)).catch(() => resolve(null));
            }
        } catch (_) {
            resolve(null);
        }
    });
}

function __readPermanentContentPayload(rawInput) {
    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) return null;
    if (rawInput.sectionType && String(rawInput.sectionType) !== 'permanent') return null;
    return __cloneCanvasProtocolJson(rawInput) || null;
}

function __coercePermanentTreeRootInput(treeInput) {
    if (Array.isArray(treeInput) && treeInput.length) {
        return treeInput[0] && typeof treeInput[0] === 'object' ? treeInput[0] : null;
    }
    if (treeInput && typeof treeInput === 'object' && Array.isArray(treeInput.children)) return treeInput;
    return null;
}

function __normalizePermanentTreeSnapshotForLocalStorage(rawTree, options = {}) {
    const rootInput = __coercePermanentTreeRootInput(rawTree);
    if (!rootInput) return null;

    const normalizeNode = (nodeInput, context = {}) => {
        if (!nodeInput || typeof nodeInput !== 'object') return null;
        const rawUrl = String(nodeInput.url || '').trim();
        const isBookmark = !!rawUrl;
        const rawTitle = String(nodeInput.title || nodeInput.name || rawUrl || (isBookmark ? 'Untitled Bookmark' : 'Folder')).trim();
        const chromeId = String(nodeInput.id || '').trim();
        const parentId = String(nodeInput.parentId || '').trim();
        const output = {};
        if (chromeId) output.id = chromeId;
        if (parentId) output.parentId = parentId;
        if (typeof nodeInput.index === 'number' && Number.isFinite(nodeInput.index)) output.index = nodeInput.index;
        output.title = rawTitle || (isBookmark ? rawUrl : 'Folder');

        if (isBookmark) {
            output.url = rawUrl;
            return output;
        }

        if (context && context.isRootChild) {
            const inferredRootKey = __getPermanentRootMatchKey(nodeInput);
            const folderType = __normalizeBookmarkFolderType(
                nodeInput.folderType
                || nodeInput.folder_type
                || __permanentRootKeyToFolderType(inferredRootKey)
            );
            const syncing = __canPersistBookmarkRootSyncing(folderType)
                ? __normalizeBookmarkRootSyncing(nodeInput.syncing)
                : null;
            if (folderType) output.folderType = folderType;
            if (syncing !== null) output.syncing = syncing;
            else if (__canPersistBookmarkRootSyncing(folderType)) output.syncing = false;
        }

        output.children = (Array.isArray(nodeInput.children) ? nodeInput.children : [])
            .map((child, index) => normalizeNode(child, {
                pathKey: `${context.pathKey || 'node'}/${index}`,
                isRootChild: false
            }))
            .filter(Boolean);
        return output;
    };

    const rootChromeId = String(rootInput.id || '').trim();
    const normalizedRoot = {
        ...(rootChromeId ? { id: rootChromeId } : {}),
        title: String(rootInput.title || rootInput.name || '').trim(),
        children: (Array.isArray(rootInput.children) ? rootInput.children : [])
            .map((child, index) => normalizeNode(child, {
                pathKey: `root/${index}`,
                isRootChild: true
            }))
            .filter(Boolean)
    };

    return [normalizedRoot];
}

function __stripPermanentLocalIdsFromTreeNode(nodeInput, context = {}) {
    if (!nodeInput || typeof nodeInput !== 'object') return null;
    const rawUrl = String(nodeInput.url || '').trim();
    const isBookmark = !!rawUrl;
    const title = String(nodeInput.title || nodeInput.name || rawUrl || (isBookmark ? 'Untitled Bookmark' : 'Folder')).trim()
        || (isBookmark ? rawUrl : 'Folder');
    const output = { title };
    if (isBookmark) {
        output.url = rawUrl;
        return output;
    }
    output.children = (Array.isArray(nodeInput.children) ? nodeInput.children : [])
        .map((child) => __stripPermanentLocalIdsFromTreeNode(child))
        .filter(Boolean);
    if (context && context.isRootChild) {
        const folderType = __normalizeBookmarkFolderType(nodeInput.folderType || nodeInput.folder_type || '');
        const syncing = __canPersistBookmarkRootSyncing(folderType)
            ? __normalizeBookmarkRootSyncing(nodeInput.syncing)
            : null;
        if (folderType) output.folderType = folderType;
        if (syncing !== null) output.syncing = syncing;
    }
    return output;
}

function __stripPermanentLocalIdsFromTree(treeInput) {
    const root = __coercePermanentTreeRootInput(treeInput);
    if (!root) return null;
    return {
        title: String(root.title || root.name || '').trim(),
        children: (Array.isArray(root.children) ? root.children : [])
            .map((child) => __stripPermanentLocalIdsFromTreeNode(child, { isRootChild: true }))
            .filter(Boolean)
    };
}

// Build an exportable permanent tree from a sandbox tree whose id/parentId already
// hold syncIds (after __applySyncIdReplacementInSandbox). This is the syncId-preserving
// counterpart to __stripPermanentLocalIdsFromTree: we keep id/parentId and only drop
// Chrome-local fields (`index`, transient sort metadata). folderType/syncing are kept.
function __buildPermanentSyncTreeNode(nodeInput, context = {}) {
    if (!nodeInput || typeof nodeInput !== 'object') return null;
    const rawUrl = String(nodeInput.url || '').trim();
    const isBookmark = !!rawUrl;
    const title = String(nodeInput.title || nodeInput.name || rawUrl || (isBookmark ? 'Untitled Bookmark' : 'Folder')).trim()
        || (isBookmark ? rawUrl : 'Folder');
    const id = String(nodeInput.id || '').trim();
    const parentId = String(nodeInput.parentId || '').trim();
    const output = { title };
    if (id) output.id = id;
    if (parentId) output.parentId = parentId;
    if (isBookmark) {
        output.url = rawUrl;
        return output;
    }
    output.children = (Array.isArray(nodeInput.children) ? nodeInput.children : [])
        .map((child) => __buildPermanentSyncTreeNode(child))
        .filter(Boolean);
    if (context && context.isRootChild) {
        const folderType = __normalizeBookmarkFolderType(nodeInput.folderType || nodeInput.folder_type || '');
        const syncing = __canPersistBookmarkRootSyncing(folderType)
            ? __normalizeBookmarkRootSyncing(nodeInput.syncing)
            : null;
        if (folderType) output.folderType = folderType;
        if (syncing !== null) output.syncing = syncing;
    }
    return output;
}

function __buildPermanentSyncTreeFromSandboxTree(treeInput) {
    const root = __coercePermanentTreeRootInput(treeInput);
    if (!root) return null;
    const rootId = String(root.id || '').trim();
    const rootParentId = String(root.parentId || '').trim();
    const output = {
        title: String(root.title || root.name || '').trim(),
        children: (Array.isArray(root.children) ? root.children : [])
            .map((child) => __buildPermanentSyncTreeNode(child, { isRootChild: true }))
            .filter(Boolean)
    };
    if (rootId) output.id = rootId;
    if (rootParentId) output.parentId = rootParentId;
    return output;
}

function __buildPermanentPrimaryContentPayloadFromTree(treeInput, descriptionOverride = null, options = {}) {
    const { isEn } = __getLang();
    const normalizedTree = __normalizePermanentTreeSnapshotForLocalStorage(treeInput);
    const root = normalizedTree && normalizedTree[0] ? normalizedTree[0] : { id: '0', title: '', children: [] };
    const payload = {
        format: __CANVAS_SECTION_JSON_FORMAT,
        schemaVersion: 2,
        sectionType: 'permanent',
        slot: 'A',
        title: __getPermanentSectionDisplayTitle(isEn),
        descriptionMd: __resolvePermanentSectionDescriptionMarkdown(null, descriptionOverride, {
            preserveRawSource: true
        }),
        fileRole: 'primary',
        fileNote: isEn
            ? 'Primary permanent file: canonical bookmark tree source.'
            : '永久栏目主文件：书签树的规范真相源。',
        tree: root
    };
    return payload;
}

function __buildPermanentCopyAnchorContentPayload(copyIdInput, options = {}) {
    const { isEn } = __getLang();
    const copyId = String(copyIdInput || '').trim();
    const shell = __resolvePermanentViewShell(copyId || null, options && options.sourceInput ? options.sourceInput : null);
    const displayIndex = __normalizePositiveInt(shell && shell.displayIndex)
        || __normalizePositiveInt(options && options.displayIndex)
        || 1;
    const slot = toAlphaLabel(displayIndex + 1) || 'B';
    const inheritFrom = __normalizeCanvasMarkdownPath(options && options.inheritFrom || '')
        || __buildPermanentSectionMarkdownRelativePath(1, isEn, __getBcsExportFormatCached());
    return {
        format: __CANVAS_SECTION_JSON_FORMAT,
        schemaVersion: 2,
        sectionType: 'permanent',
        slot,
        title: __getPermanentSectionDisplayTitle(isEn),
        fileRole: 'copy-anchor',
        anchorOnly: true,
        fileNote: isEn
            ? 'Permanent copy anchor file: tree content is inherited from primary file; this file keeps per-copy description and canvas anchor.'
            : '永久栏目副本锚点文件：树内容继承自主文件；此文件仅保留副本说明与画布锚点。',
        inheritFrom,
        copyId,
        descriptionMd: __resolvePermanentSectionDescriptionMarkdown(copyId, null, {
            preserveRawSource: true,
            sourceData: options && options.sourceData && typeof options.sourceData === 'object' ? options.sourceData : null,
            allowLiveFallback: true
        }),
        viewState: {
            scrollState: shell && shell.scrollState ? shell.scrollState : __collectPermanentViewScrollState(copyId),
            foldState: shell && shell.foldState ? shell.foldState : __collectPermanentViewFoldState(copyId),
            cardState: shell && shell.cardState ? shell.cardState : {}
        }
    };
}

// doc 最终修复计划 §3.5: sandbox 路径与 live fallback 路径必须显式区分。
// sandbox 已经把 tree.id/parentId 替换为 syncId；live 路径还是 chromeId，需要现场转换。
// 若无法转换（缺失 identityMap 项），返回 null，让上层中止导出而不是导出 Chrome 本地 id。
function __buildPermanentMainSyncPayload(contentInput, options = {}) {
    const content = __readPermanentContentPayload(contentInput);
    if (!content || content.fileRole === 'copy-anchor' || content.anchorOnly === true) return null;
    const tree = content.tree && typeof content.tree === 'object' ? content.tree : null;
    if (!tree) return null;
    const identityMap = Array.isArray(content.identityMap) ? content.identityMap : [];
    const idsAlreadySyncIds = !!(options && options.idsAlreadySyncIds === true);

    let exportTree = null;
    if (idsAlreadySyncIds) {
        exportTree = __buildPermanentSyncTreeFromSandboxTree(tree);
    } else {
        // Live fallback: identityMap is still { id: chromeId, syncId }. Build a byChromeId
        // index, then deep-clone the tree replacing id/parentId with syncId. If any chromeId
        // lacks a mapping, abort by returning null.
        const byChromeId = new Map();
        for (const entry of identityMap) {
            if (!entry || typeof entry !== 'object') continue;
            const id = String(entry.id || '').trim();
            const syncId = String(entry.syncId || '').trim();
            if (id && syncId) byChromeId.set(id, syncId);
        }
        const clonedTree = __cloneCanvasProtocolJson(tree);
        let conversionOk = true;
        const convert = (node) => {
            if (!node || typeof node !== 'object') return;
            if (Object.prototype.hasOwnProperty.call(node, 'index')) delete node.index;
            const chromeId = String(node.id || '').trim();
            if (chromeId) {
                const mapped = byChromeId.get(chromeId);
                if (mapped) {
                    node.id = mapped;
                } else {
                    conversionOk = false;
                }
            }
            const parentChromeId = String(node.parentId || '').trim();
            if (parentChromeId) {
                const parentMapped = byChromeId.get(parentChromeId);
                if (parentMapped) {
                    node.parentId = parentMapped;
                }
                // Missing parentId mapping is tolerated only at the synthetic root level.
            }
            if (Array.isArray(node.children)) node.children.forEach(convert);
        };
        convert(clonedTree);
        if (!conversionOk) {
            try { console.warn('[BCS export] live fallback found chromeId without syncId mapping; aborting payload build.'); } catch (_) {}
            return null;
        }
        exportTree = __buildPermanentSyncTreeFromSandboxTree(clonedTree);
    }

    // identityMap on the exported payload should keep only entries that actually carry extras:
    // { syncId, ...extras }. For sandbox path, callers will have already pruned. For live
    // fallback, prune here with the same rule.
    let exportIdentityMap = identityMap;
    if (!idsAlreadySyncIds) {
        const pruned = [];
        for (const entry of identityMap) {
            if (!entry || typeof entry !== 'object') continue;
            const syncId = String(entry.syncId || '').trim();
            if (!syncId) continue;
            const out = {};
            for (const key of Object.keys(entry)) {
                if (key === 'id' || key === 'syncId') continue;
                out[key] = entry[key];
            }
            if (!Object.keys(out).length) continue;
            out.syncId = syncId;
            pruned.push(out);
        }
        exportIdentityMap = pruned;
    }

    const payload = {
        format: content.format || __CANVAS_SECTION_JSON_FORMAT,
        schemaVersion: Math.max(3, Number(content.schemaVersion) || 3),
        sectionType: 'permanent',
        slot: String(content.slot || 'A'),
        title: String(content.title || __getPermanentSectionDisplayTitle(__getLang().isEn)),
        descriptionMd: String(content.descriptionMd == null ? '' : content.descriptionMd),
        fileRole: 'primary',
        fileNote: String(content.fileNote || ''),
        ...(Array.isArray(exportIdentityMap) && exportIdentityMap.length
            ? { identityMap: exportIdentityMap }
            : {}),
        tree: exportTree
    };
    if (!payload.fileNote) {
        payload.fileNote = __getLang().isEn
            ? 'Primary permanent file: canonical bookmark tree source.'
            : '永久栏目主文件：书签树的规范真相源。';
    }
    return payload;
}

// =============================================================================
// identityMap: chromeId <-> syncId binding for permanent BCS.
// =============================================================================
// Entry shape: { id: <chromeBookmarkId>, syncId: <stable-cross-device-id>, ...extras }
// `id` and `syncId` form the "minimum cell" — both must be present, and deleting one
// implicitly deletes the cell. Extras (`tags`, etc.) are introduced by section 3 of the
// design. The identityMap field lives in `bcs:perm:main` between `descriptionMd` and
// `tree` (the doc requires that exact ordering). Internally we expose a non-enumerable
// lookup index `content.__identityMapIndex__` for O(1) chromeId/syncId lookups.

function __normalizeIdentityMapEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const id = String(entry.id || '').trim();
    const syncId = String(entry.syncId || '').trim();
    if (!id || !syncId) return null;
    const out = { id, syncId };
    if (Array.isArray(entry.tags) && entry.tags.length) {
        out.tags = entry.tags
            .map((t) => (t && typeof t === 'object') ? { color: String(t.color || '').trim(), text: String(t.text || '').trim() } : null)
            .filter((t) => t && t.color);
        if (!out.tags.length) delete out.tags;
    }
    return out;
}

function __normalizeIdentityMapArray(rawList) {
    if (!Array.isArray(rawList)) return [];
    const seenChromeIds = new Set();
    const seenSyncIds = new Set();
    const result = [];
    for (const entry of rawList) {
        const normalized = __normalizeIdentityMapEntry(entry);
        if (!normalized) continue;
        if (seenChromeIds.has(normalized.id) || seenSyncIds.has(normalized.syncId)) continue;
        seenChromeIds.add(normalized.id);
        seenSyncIds.add(normalized.syncId);
        __rememberExistingBcsId(normalized.syncId);
        result.push(normalized);
    }
    return result;
}

function __collectChromeIdsFromTree(treeRoot) {
    const ids = new Set();
    if (!treeRoot || typeof treeRoot !== 'object') return ids;
    const stack = [treeRoot];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        const id = String(node.id || '').trim();
        if (id) ids.add(id);
        const children = Array.isArray(node.children) ? node.children : [];
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
    return ids;
}

function __bootstrapIdentityMapFromTree(treeRoot) {
    const chromeIds = __collectChromeIdsFromTree(treeRoot);
    const out = [];
    chromeIds.forEach((chromeId) => {
        out.push({ id: chromeId, syncId: __generateSyncId() });
    });
    return out;
}

function __getIdentityMapIndex(content) {
    if (!content || typeof content !== 'object') return { byChromeId: new Map(), bySyncId: new Map() };
    if (content.__identityMapIndex__) return content.__identityMapIndex__;
    const byChromeId = new Map();
    const bySyncId = new Map();
    const list = Array.isArray(content.identityMap) ? content.identityMap : [];
    for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        const id = String(entry.id || '').trim();
        const syncId = String(entry.syncId || '').trim();
        if (!id || !syncId) continue;
        byChromeId.set(id, entry);
        bySyncId.set(syncId, entry);
    }
    try {
        Object.defineProperty(content, '__identityMapIndex__', {
            value: { byChromeId, bySyncId },
            enumerable: false,
            configurable: true,
            writable: true
        });
    } catch (_) { content.__identityMapIndex__ = { byChromeId, bySyncId }; }
    return content.__identityMapIndex__;
}

function __invalidateIdentityMapIndex(content) {
    if (content && typeof content === 'object' && content.__identityMapIndex__) {
        try { delete content.__identityMapIndex__; } catch (_) { content.__identityMapIndex__ = null; }
    }
}

function __verifyAndHealIdentityMap(content) {
    if (!content || typeof content !== 'object' || !content.tree) return { added: 0, removed: 0, regenerated: 0 };
    const list = Array.isArray(content.identityMap) ? __normalizeIdentityMapArray(content.identityMap) : [];
    const chromeIds = __collectChromeIdsFromTree(content.tree);
    const byChromeId = new Map();
    const bySyncId = new Map();
    let regenerated = 0;
    for (const entry of list) {
        if (!chromeIds.has(entry.id)) continue;
        if (bySyncId.has(entry.syncId)) {
            const fresh = __generateSyncId();
            const replacement = { ...entry, syncId: fresh };
            byChromeId.set(replacement.id, replacement);
            bySyncId.set(replacement.syncId, replacement);
            regenerated += 1;
            continue;
        }
        byChromeId.set(entry.id, entry);
        bySyncId.set(entry.syncId, entry);
    }
    let added = 0;
    chromeIds.forEach((chromeId) => {
        if (byChromeId.has(chromeId)) return;
        const entry = { id: chromeId, syncId: __generateSyncId() };
        byChromeId.set(chromeId, entry);
        bySyncId.set(entry.syncId, entry);
        added += 1;
    });
    const removed = Math.max(0, list.length - (byChromeId.size - added));
    content.identityMap = Array.from(byChromeId.values());
    __invalidateIdentityMapIndex(content);
    return { added, removed, regenerated };
}

// =============================================================================
// Tag CRUD (doc §3):
//   - Permanent nodes: tags live on identityMap entries, keyed by chromeId.
//   - Temporary items: tags live inline on item.tags (mutations handled in
//     bookmark_canvas_module via the toggleTempItemTag helper which calls
//     normalizeTagArray below for normalization).
// Permanent mutations go through the regular BCS read/write so the bulk-mute
// and identityMap-heal contracts are preserved.
// =============================================================================

function __makeTagKey(color, text) {
    return `${String(color || '').trim().toLowerCase()}::${String(text || '').trim()}`;
}

function __normalizeTagInput(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const color = String(raw.color || '').trim();
    if (!color) return null;
    const text = String(raw.text || '').trim();
    return { color, text };
}

function __normalizeTagArrayInput(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const t of raw) {
        const norm = __normalizeTagInput(t);
        if (!norm) continue;
        const key = __makeTagKey(norm.color, norm.text);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(norm);
    }
    return out;
}

function __getPermanentNodeTagsFromContent(content, chromeId) {
    if (!content || !chromeId) return [];
    const { byChromeId } = __getIdentityMapIndex(content);
    const entry = byChromeId.get(String(chromeId));
    if (!entry || !Array.isArray(entry.tags)) return [];
    return entry.tags.map((t) => ({ color: t.color, text: t.text || '' }));
}

function __setPermanentNodeTagsInContent(content, chromeId, tagsInput) {
    if (!content || !chromeId) return false;
    const tags = __normalizeTagArrayInput(tagsInput);
    const { byChromeId } = __getIdentityMapIndex(content);
    const entry = byChromeId.get(String(chromeId));
    if (!entry) return false;
    if (tags.length) {
        entry.tags = tags;
    } else if (Object.prototype.hasOwnProperty.call(entry, 'tags')) {
        delete entry.tags;
    }
    return true;
}

function __togglePermanentNodeTagInContent(content, chromeId, tagInput) {
    const norm = __normalizeTagInput(tagInput);
    if (!norm) return null;
    const existing = __getPermanentNodeTagsFromContent(content, chromeId);
    const key = __makeTagKey(norm.color, norm.text);
    const idx = existing.findIndex((t) => __makeTagKey(t.color, t.text) === key);
    let nextTags;
    let action;
    if (idx >= 0) {
        nextTags = existing.slice();
        nextTags.splice(idx, 1);
        action = 'removed';
    } else {
        nextTags = existing.concat([norm]);
        action = 'added';
    }
    const ok = __setPermanentNodeTagsInContent(content, chromeId, nextTags);
    return ok ? { action, tags: nextTags } : null;
}

async function __readPermanentNodeTags(chromeId) {
    const content = await __readPermanentMainContentFromBcs({ skipIdentityMapHeal: true });
    if (!content) return [];
    return __getPermanentNodeTagsFromContent(content, chromeId);
}

async function __writePermanentNodeTags(chromeId, tagsInput, options = {}) {
    const content = await __readPermanentMainContentFromBcs();
    if (!content) return null;
    if (!__setPermanentNodeTagsInContent(content, chromeId, tagsInput)) return null;
    return await __writePermanentMainContentToBcs(content, {
        immediate: !(options && options.immediate === false),
        skipIdentityMapHeal: true
    });
}

async function __togglePermanentNodeTag(chromeId, tagInput, options = {}) {
    const content = await __readPermanentMainContentFromBcs();
    if (!content) return null;
    const result = __togglePermanentNodeTagInContent(content, chromeId, tagInput);
    if (!result) return null;
    await __writePermanentMainContentToBcs(content, {
        immediate: !(options && options.immediate === false),
        skipIdentityMapHeal: true
    });
    return result;
}

async function __writePermanentNodeTagsBulk(updates, options = {}) {
    if (!Array.isArray(updates) || !updates.length) return null;
    const content = await __readPermanentMainContentFromBcs();
    if (!content) return null;
    let changed = 0;
    for (const u of updates) {
        if (!u || !u.chromeId) continue;
        if (__setPermanentNodeTagsInContent(content, u.chromeId, u.tags)) changed += 1;
    }
    if (!changed) return null;
    await __writePermanentMainContentToBcs(content, {
        immediate: !(options && options.immediate === false),
        skipIdentityMapHeal: true
    });
    return { changed };
}

function __collectTagsFromIdentityMap(content) {
    const map = new Map();
    if (!content || !Array.isArray(content.identityMap)) return map;
    for (const entry of content.identityMap) {
        if (!entry || !Array.isArray(entry.tags)) continue;
        for (const t of entry.tags) {
            const norm = __normalizeTagInput(t);
            if (!norm) continue;
            const key = __makeTagKey(norm.color, norm.text);
            const prev = map.get(key);
            if (prev) {
                prev.count += 1;
            } else {
                map.set(key, { color: norm.color, text: norm.text, count: 1 });
            }
        }
    }
    return map;
}

function __collectTagsFromTempState(stateInput) {
    const map = new Map();
    if (!stateInput || !Array.isArray(stateInput.sections)) return map;
    const walk = (items) => {
        if (!Array.isArray(items)) return;
        for (const it of items) {
            if (!it) continue;
            if (Array.isArray(it.tags)) {
                for (const t of it.tags) {
                    const norm = __normalizeTagInput(t);
                    if (!norm) continue;
                    const key = __makeTagKey(norm.color, norm.text);
                    const prev = map.get(key);
                    if (prev) {
                        prev.count += 1;
                    } else {
                        map.set(key, { color: norm.color, text: norm.text, count: 1 });
                    }
                }
            }
            if (Array.isArray(it.children) && it.children.length) walk(it.children);
        }
    };
    for (const section of stateInput.sections) {
        if (section && Array.isArray(section.items)) walk(section.items);
    }
    return map;
}

async function __collectAllUsedTags() {
    const content = await __readPermanentMainContentFromBcs({ skipIdentityMapHeal: true });
    let tempState = null;
    try { tempState = await __loadCanvasTempStateFromBcs(); } catch (_) {}
    const merged = new Map();
    const mergeFrom = (src) => {
        src.forEach((val, key) => {
            const prev = merged.get(key);
            if (prev) {
                prev.count += val.count;
            } else {
                merged.set(key, { color: val.color, text: val.text, count: val.count });
            }
        });
    };
    if (content) mergeFrom(__collectTagsFromIdentityMap(content));
    if (tempState) mergeFrom(__collectTagsFromTempState(tempState));
    return Array.from(merged.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;

        // 3) Fallback: A-Z / 1-9 text alphabetical comparison
        const textA = String(a.text || '').trim();
        const textB = String(b.text || '').trim();
        if (textA || textB) {
            if (textA && !textB) return -1;
            if (!textA && textB) return 1;
            const textDelta = textA.localeCompare(textB, undefined, { numeric: true, sensitivity: 'base' });
            if (textDelta !== 0) return textDelta;
        }

        // 4) Fallback: Color name comparison alphabetically
        return String(a.color || '').localeCompare(String(b.color || ''));
    });
}

// doc 第三轮修复 §2.3: 把校验函数从 import-export-transfer-feature.js 迁到协议核心层。
// doc 第三轮修复 §2.2: 通过 options.ignoredChromeIds 跳过非可写 / 非标准的 Chrome 固定根
//                       (典型如 managed root, chromeId='4')，企业策略环境下校验不再误杀。
//
// 入参:
//   treeRoot         — 写入前最新的 chrome 书签树根（chrome.bookmarks.getTree()[0]）
//   identityMap      — 即将写回 BCS 的 [{ id: chromeId, syncId, ...extras }]
//   expectedSyncIds  — 来源于导入包的合法 syncId 集合 (Set / Array / Iterable)
//   options.ignoredChromeIds — 不要求出现在 identityMap 中的 chromeId 集合 (Set / Array)
//
// 返回:
//   { ok: boolean, errors: string[], mapByChromeId: Map<string,string> }
function __validateImportedIdentityMapAgainstTree(treeRoot, identityMap, expectedSyncIds, options = {}) {
    const errors = [];
    if (!treeRoot || typeof treeRoot !== 'object') {
        return { ok: false, errors: ['tree root missing'], mapByChromeId: new Map() };
    }
    if (!Array.isArray(identityMap)) {
        return { ok: false, errors: ['identityMap is not an array'], mapByChromeId: new Map() };
    }
    const expected = expectedSyncIds instanceof Set
        ? expectedSyncIds
        : new Set(expectedSyncIds && typeof expectedSyncIds[Symbol.iterator] === 'function'
            ? Array.from(expectedSyncIds)
            : []);
    const ignoredChromeIds = options && options.ignoredChromeIds instanceof Set
        ? options.ignoredChromeIds
        : new Set(options && Array.isArray(options.ignoredChromeIds) ? options.ignoredChromeIds : []);

    const treeChromeIds = new Set();
    const stack = [treeRoot];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        const id = String(node.id || '').trim();
        if (id) treeChromeIds.add(id);
        if (Array.isArray(node.children)) {
            for (const child of node.children) stack.push(child);
        }
    }

    const seenChromeIds = new Set();
    const seenSyncIds = new Set();
    const mapByChromeId = new Map();
    for (const entry of identityMap) {
        if (!entry || typeof entry !== 'object') continue;
        const id = String(entry.id || '').trim();
        const syncId = String(entry.syncId || '').trim();
        if (!id) { errors.push('identityMap entry missing chromeId'); continue; }
        if (!syncId) { errors.push(`identityMap entry for chromeId=${id} missing syncId`); continue; }
        if (seenChromeIds.has(id)) errors.push(`duplicate chromeId in identityMap: ${id}`);
        if (seenSyncIds.has(syncId)) errors.push(`duplicate syncId in identityMap: ${syncId}`);
        seenChromeIds.add(id);
        seenSyncIds.add(syncId);
        mapByChromeId.set(id, syncId);
        if (expected.size && !expected.has(syncId)) {
            errors.push(`syncId not in expected set (re-generated?): ${syncId}`);
        }
    }
    treeChromeIds.forEach((id) => {
        if (ignoredChromeIds.has(id)) return;
        if (!mapByChromeId.has(id)) errors.push(`tree chromeId not in identityMap: ${id}`);
    });
    return { ok: errors.length === 0, errors, mapByChromeId };
}

// doc 第三轮修复 §2.2: 默认从 fresh tree 中收集"应当跳过"的 chromeId。
// 当前规则: 顶层 children 中 folderType === 'managed' 的节点（含其后代）整体跳过。
// 日后若需要扩展（例如其它 read-only 根），在这里追加判定即可。
function __collectIgnoredChromeIdsFromFreshTree(treeRoot) {
    const ignored = new Set();
    if (!treeRoot || typeof treeRoot !== 'object') return ignored;
    const topChildren = Array.isArray(treeRoot.children) ? treeRoot.children : [];
    for (const top of topChildren) {
        if (!top || typeof top !== 'object') continue;
        const ft = __normalizeBookmarkFolderType(top.folderType || top.folder_type || '');
        if (ft !== 'managed') continue;
        const stack = [top];
        while (stack.length) {
            const node = stack.pop();
            if (!node || typeof node !== 'object') continue;
            const id = String(node.id || '').trim();
            if (id) ignored.add(id);
            if (Array.isArray(node.children)) {
                for (const child of node.children) stack.push(child);
            }
        }
    }
    return ignored;
}

function __rebuildIdentityMapPreservingExisting(prevContent, nextTreeRoot) {
    const prevList = (prevContent && Array.isArray(prevContent.identityMap)) ? prevContent.identityMap : [];
    const prevByChromeId = new Map();
    for (const entry of prevList) {
        if (!entry || typeof entry !== 'object') continue;
        const id = String(entry.id || '').trim();
        const syncId = String(entry.syncId || '').trim();
        if (id && syncId) prevByChromeId.set(id, entry);
    }
    const chromeIds = __collectChromeIdsFromTree(nextTreeRoot);
    const out = [];
    chromeIds.forEach((chromeId) => {
        const prior = prevByChromeId.get(chromeId);
        if (prior) {
            out.push({ ...prior });
        } else {
            out.push({ id: chromeId, syncId: __generateSyncId() });
        }
    });
    return out;
}

function __applyIdentityMapDeltaFromBookmarkEvents(content, events) {
    if (!content || typeof content !== 'object' || !Array.isArray(events) || !events.length) return content;
    if (!Array.isArray(content.identityMap)) content.identityMap = [];
    const list = content.identityMap;
    const idx = __getIdentityMapIndex(content);

    for (const ev of events) {
        if (!ev || typeof ev !== 'object') continue;
        const type = ev.type || ev.event || '';
        if (type === 'created') {
            const newId = String(ev.id || (ev.bookmark && ev.bookmark.id) || '').trim();
            if (!newId || idx.byChromeId.has(newId)) continue;
            const entry = { id: newId, syncId: __generateSyncId() };
            list.push(entry);
            idx.byChromeId.set(entry.id, entry);
            idx.bySyncId.set(entry.syncId, entry);
        } else if (type === 'removed') {
            const targetId = String(ev.id || '').trim();
            if (!targetId) continue;
            const descendants = new Set([targetId]);
            const removeInfo = ev.removeInfo || ev.info;
            const removedNode = removeInfo && removeInfo.node;
            if (removedNode && Array.isArray(removedNode.children)) {
                const stack = [...removedNode.children];
                while (stack.length) {
                    const child = stack.pop();
                    if (!child || typeof child !== 'object') continue;
                    if (child.id) descendants.add(String(child.id));
                    if (Array.isArray(child.children)) stack.push(...child.children);
                }
            }
            for (let i = list.length - 1; i >= 0; i--) {
                if (descendants.has(list[i].id)) {
                    const removed = list.splice(i, 1)[0];
                    if (removed) {
                        idx.byChromeId.delete(removed.id);
                        idx.bySyncId.delete(removed.syncId);
                    }
                }
            }
        }
        // 'moved' and 'changed' do not affect identityMap: syncId is bound to chromeId, not to position/title.
    }
    __invalidateIdentityMapIndex(content);
    return content;
}


async function __readPermanentMainContentFromBcs(options = {}) {
    const storage = await __bcsStorageGet([BCS_PERM_MAIN_KEY]);
    const raw = storage ? storage[BCS_PERM_MAIN_KEY] : null;
    const content = __readPermanentContentPayload(raw);
    if (!content || !content.tree || typeof content.tree !== 'object') {
        return null;
    }

    const normalizedTree = __normalizePermanentTreeSnapshotForLocalStorage(content.tree);
    if (!normalizedTree) return null;
    content.tree = normalizedTree[0];
    if (!content.format) content.format = __CANVAS_SECTION_JSON_FORMAT;
    if (!content.schemaVersion) content.schemaVersion = 2;
    if (Number(content.schemaVersion) < 3) content.schemaVersion = 3;
    if (!content.sectionType) content.sectionType = 'permanent';
    if (!content.slot) content.slot = 'A';
    if (!content.title) content.title = __getPermanentSectionDisplayTitle(__getLang().isEn);
    if (!content.fileRole) content.fileRole = 'primary';
    if (!content.fileNote) {
        content.fileNote = __getLang().isEn
            ? 'Primary permanent file: canonical bookmark tree source.'
            : '永久栏目主文件：书签树的规范真相源。';
    }
    if (!Object.prototype.hasOwnProperty.call(content, 'descriptionMd')) {
        content.descriptionMd = __resolvePermanentSectionDescriptionMarkdown(null, null, {
            preserveRawSource: true
        });
    }
    if (!Array.isArray(content.identityMap)) {
        content.identityMap = __bootstrapIdentityMapFromTree(content.tree);
    } else {
        content.identityMap = __normalizeIdentityMapArray(content.identityMap);
    }
    if (!(options && options.skipIdentityMapHeal === true)) {
        __verifyAndHealIdentityMap(content);
    }

    return content;
}

async function __writePermanentMainContentToBcs(contentInput, options = {}) {
    const content = __readPermanentContentPayload(contentInput);
    if (!content || !content.tree || typeof content.tree !== 'object') return null;
    const normalizedTree = __normalizePermanentTreeSnapshotForLocalStorage(content.tree);
    if (!normalizedTree) return null;
    const treeRoot = normalizedTree[0];
    let identityMap = Array.isArray(content.identityMap)
        ? __normalizeIdentityMapArray(content.identityMap)
        : null;
    if (!identityMap || !identityMap.length) {
        identityMap = __bootstrapIdentityMapFromTree(treeRoot);
    }
    // Field order is contractual per the spec: descriptionMd → identityMap → fileRole/Note → tree.
    const nextContent = {
        format: content.format || __CANVAS_SECTION_JSON_FORMAT,
        schemaVersion: 3,
        sectionType: 'permanent',
        slot: String(content.slot || 'A'),
        title: String(content.title || __getPermanentSectionDisplayTitle(__getLang().isEn)),
        descriptionMd: String(content.descriptionMd == null ? '' : content.descriptionMd),
        identityMap,
        fileRole: 'primary',
        fileNote: String(content.fileNote || (__getLang().isEn
            ? 'Primary permanent file: canonical bookmark tree source.'
            : '永久栏目主文件：书签树的规范真相源。')),
        tree: treeRoot
    };
    // The import flow already finalized the identityMap with syncIds sourced exclusively
    // from the import package; we MUST NOT let __verifyAndHealIdentityMap mint fresh syncIds
    // for unmatched chromeIds in that case (doc commit2298735 fix plan §2.3 step 4).
    if (!(options && options.skipIdentityMapHeal === true)) {
        __verifyAndHealIdentityMap(nextContent);
    }
    // Keep write paths deterministic for callers that immediately read-and-render
    // (e.g. overwrite import). Fire-and-forget can race the next render with stale BCS.
    await __bcsStorageSet({
        [BCS_PERM_MAIN_KEY]: nextContent
    }, { immediate: options && options.immediate !== false });
    return {
        content: nextContent
    };
}

async function __migratePermanentMainContentFromChromeTree(options = {}) {
    const chromeTree = options && options.chromeTree
        ? options.chromeTree
        : await __getPermanentChromeTreeForStorage();
    if (!chromeTree) return null;

    const content = __buildPermanentPrimaryContentPayloadFromTree(chromeTree);
    if (!content || !content.tree) return null;
    return __writePermanentMainContentToBcs(content, {
        immediate: true
    });
}

async function __ensurePermanentMainContentInBcs(options = {}) {
    const existing = await __readPermanentMainContentFromBcs();
    if (existing && !(options && options.forceMigrateFromChrome === true)) return existing;

    const migrated = await __migratePermanentMainContentFromChromeTree();
    return migrated && migrated.content ? migrated.content : null;
}


async function __readPermanentTreeSnapshotFromBcs() {
    const content = await __ensurePermanentMainContentInBcs();
    if (!content || !content.tree) return null;
    const tree = __cloneCanvasProtocolJson([content.tree]);
    return Array.isArray(tree) ? tree : null;
}


async function __writePermanentTreeSnapshotAfterChromeApply(localTreeInput, options = {}) {
    const localNormalized = __normalizePermanentTreeSnapshotForLocalStorage(localTreeInput);
    if (!localNormalized) return null;
    const baseContent = __readPermanentContentPayload(options && options.baseContent);
    const previous = baseContent || await __ensurePermanentMainContentInBcs();
    const content = {
        ...(previous && typeof previous === 'object' ? previous : {}),
        tree: localNormalized[0]
    };
    return __writePermanentMainContentToBcs(content, {
        immediate: true,
        skipIdentityMapHeal: !!(options && options.skipIdentityMapHeal === true)
    });
}

function __findPermanentNodeEntryById(rootInput, nodeIdInput) {
    const nodeId = String(nodeIdInput || '').trim();
    if (!rootInput || typeof rootInput !== 'object' || !nodeId) return null;
    const stack = [{ node: rootInput, parent: null, index: -1 }];
    while (stack.length) {
        const entry = stack.pop();
        const node = entry && entry.node;
        if (!node || typeof node !== 'object') continue;
        if (String(node.id || '').trim() === nodeId) return entry;
        const children = Array.isArray(node.children) ? node.children : [];
        for (let i = children.length - 1; i >= 0; i -= 1) {
            stack.push({ node: children[i], parent: node, index: i });
        }
    }
    return null;
}

function __refreshPermanentLocalChildMeta(parentNode) {
    if (!parentNode || typeof parentNode !== 'object' || !Array.isArray(parentNode.children)) return;
    const parentId = String(parentNode.id || '').trim();
    parentNode.children.forEach((child, index) => {
        if (!child || typeof child !== 'object') return;
        if (parentId) child.parentId = parentId;
        child.index = index;
    });
}

function __normalizePermanentLocalMutationNode(nodeInput) {
    const source = nodeInput && typeof nodeInput === 'object' ? nodeInput : {};
    const rawUrl = String(source.url || '').trim();
    const isBookmark = !!rawUrl;
    const title = String(source.title || source.name || rawUrl || (isBookmark ? 'Untitled Bookmark' : 'Folder')).trim()
        || (isBookmark ? rawUrl : 'Folder');
    const node = {
        ...(source.id ? { id: String(source.id) } : {}),
        title
    };
    if (isBookmark) {
        node.url = rawUrl;
        return node;
    }
    node.children = (Array.isArray(source.children) ? source.children : [])
        .map((child) => __normalizePermanentLocalMutationNode(child))
        .filter(Boolean);
    return node;
}

async function __mutatePermanentMainContentInBcs(mutator, options = {}) {
    const previous = await __ensurePermanentMainContentInBcs();
    if (!previous || !previous.tree) {
        throw new Error('[Permanent JSON] main content is unavailable.');
    }
    const previousContent = __cloneCanvasProtocolJson(previous);
    const nextContent = __cloneCanvasProtocolJson(previous);
    if (!nextContent || !nextContent.tree) {
        throw new Error('[Permanent JSON] failed to clone main content.');
    }
    const mutation = typeof mutator === 'function' ? mutator(nextContent.tree, nextContent) : null;
    if (mutation === false) {
        return { content: nextContent, previousContent, changed: false };
    }
    const writeResult = await __writePermanentMainContentToBcs(nextContent, {
        immediate: true
    });
    return {
        ...(mutation && typeof mutation === 'object' ? mutation : {}),
        content: writeResult && writeResult.content ? writeResult.content : nextContent,
        previousContent,
        changed: true
    };
}

async function __restorePermanentMainContentSnapshot(contentInput, options = {}) {
    const content = __readPermanentContentPayload(contentInput);
    if (!content || !content.tree) return null;
    return __writePermanentMainContentToBcs(content, {
        immediate: true
    });
}

async function __preparePermanentCreateNodeInBcs(createInfoInput, options = {}) {
    const createInfo = createInfoInput && typeof createInfoInput === 'object' ? createInfoInput : {};
    const parentId = String(createInfo.parentId || '').trim();
    if (!parentId) throw new Error('[Permanent JSON] create parentId is required.');
    const pendingId = String(options && options.pendingId || `pending:${Date.now()}`).trim();
    const node = __normalizePermanentLocalMutationNode({
        id: pendingId,
        title: createInfo.title,
        url: createInfo.url,
        children: Array.isArray(createInfo.children) ? createInfo.children : []
    });

    return __mutatePermanentMainContentInBcs((root) => {
        const parentEntry = __findPermanentNodeEntryById(root, parentId);
        const parent = parentEntry && parentEntry.node;
        if (!parent) throw new Error('[Permanent JSON] create parent is missing.');
        if (!Array.isArray(parent.children)) parent.children = [];
        const rawIndex = Number(createInfo.index);
        const insertIndex = Number.isFinite(rawIndex)
            ? Math.max(0, Math.min(parent.children.length, Math.floor(rawIndex)))
            : parent.children.length;
        node.parentId = parentId;
        node.index = insertIndex;
        parent.children.splice(insertIndex, 0, node);
        __refreshPermanentLocalChildMeta(parent);
        return { pendingId };
    });
}

async function __commitPermanentCreatedNodeInBcs(pendingIdInput, createdNodeInput) {
    const pendingId = String(pendingIdInput || '').trim();
    const created = createdNodeInput && typeof createdNodeInput === 'object' ? createdNodeInput : {};
    const chromeId = String(created.id || '').trim();
    if (!pendingId || !chromeId) return null;
    return __mutatePermanentMainContentInBcs((root) => {
        const entry = __findPermanentNodeEntryById(root, pendingId);
        const existingEntry = entry ? null : __findPermanentNodeEntryById(root, chromeId);
        const node = entry && entry.node ? entry.node : (existingEntry && existingEntry.node);
        if (!node) throw new Error('[Permanent JSON] pending created node is missing.');
        if (String(node.id || '') !== chromeId) node.id = chromeId;
        if (created.parentId) node.parentId = String(created.parentId);
        if (typeof created.index === 'number' && Number.isFinite(created.index)) node.index = created.index;
        if (typeof created.title === 'string') node.title = created.title;
        if (typeof created.url === 'string') node.url = created.url;
        const parent = entry && entry.parent ? entry.parent : (existingEntry && existingEntry.parent);
        if (parent) __refreshPermanentLocalChildMeta(parent);
        return { chromeId };
    });
}

async function __updatePermanentNodeInBcs(nodeIdInput, updatesInput, options = {}) {
    const nodeId = String(nodeIdInput || '').trim();
    const updates = updatesInput && typeof updatesInput === 'object' ? updatesInput : {};
    if (!nodeId) throw new Error('[Permanent JSON] update nodeId is required.');
    return __mutatePermanentMainContentInBcs((root) => {
        const entry = __findPermanentNodeEntryById(root, nodeId);
        const node = entry && entry.node;
        if (!node) throw new Error('[Permanent JSON] update node is missing.');
        if (typeof updates.title === 'string') node.title = updates.title;
        if (Object.prototype.hasOwnProperty.call(updates, 'url')) {
            const url = String(updates.url || '').trim();
            if (url) node.url = url;
            else delete node.url;
        }
        return { nodeId };
    }, options);
}

async function __removePermanentNodeFromBcs(nodeIdInput, options = {}) {
    const nodeId = String(nodeIdInput || '').trim();
    if (!nodeId) throw new Error('[Permanent JSON] remove nodeId is required.');
    return __mutatePermanentMainContentInBcs((root) => {
        const entry = __findPermanentNodeEntryById(root, nodeId);
        if (!entry || !entry.parent || !Array.isArray(entry.parent.children) || entry.index < 0) {
            throw new Error('[Permanent JSON] remove node is missing or is root.');
        }
        entry.parent.children.splice(entry.index, 1);
        __refreshPermanentLocalChildMeta(entry.parent);
        return { nodeId };
    }, options);
}

async function __movePermanentNodeInBcs(nodeIdInput, targetInput, options = {}) {
    const nodeId = String(nodeIdInput || '').trim();
    const target = targetInput && typeof targetInput === 'object' ? targetInput : {};
    const parentId = String(target.parentId || '').trim();
    if (!nodeId || !parentId) throw new Error('[Permanent JSON] move nodeId and parentId are required.');
    return __mutatePermanentMainContentInBcs((root) => {
        const sourceEntry = __findPermanentNodeEntryById(root, nodeId);
        if (!sourceEntry || !sourceEntry.parent || !Array.isArray(sourceEntry.parent.children) || sourceEntry.index < 0) {
            throw new Error('[Permanent JSON] move source is missing or is root.');
        }
        const [node] = sourceEntry.parent.children.splice(sourceEntry.index, 1);
        __refreshPermanentLocalChildMeta(sourceEntry.parent);
        const parentEntry = __findPermanentNodeEntryById(root, parentId);
        const parent = parentEntry && parentEntry.node;
        if (!parent) {
            sourceEntry.parent.children.splice(sourceEntry.index, 0, node);
            __refreshPermanentLocalChildMeta(sourceEntry.parent);
            throw new Error('[Permanent JSON] move parent is missing.');
        }
        if (!Array.isArray(parent.children)) parent.children = [];
        const rawIndex = Number(target.index);
        const insertIndex = Number.isFinite(rawIndex)
            ? Math.max(0, Math.min(parent.children.length, Math.floor(rawIndex)))
            : parent.children.length;
        node.parentId = parentId;
        node.index = insertIndex;
        parent.children.splice(insertIndex, 0, node);
        __refreshPermanentLocalChildMeta(parent);
        return { nodeId, parentId, index: insertIndex };
    }, options);
}

function __coercePermanentBookmarkEventIndex(value, fallback = null) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return fallback;
    return Math.max(0, Math.floor(raw));
}

function __buildPermanentBookmarkEventTitle(nodeInput) {
    const node = nodeInput && typeof nodeInput === 'object' ? nodeInput : {};
    const rawUrl = String(node.url || '').trim();
    return String(node.title || node.name || rawUrl || (rawUrl ? 'Untitled Bookmark' : 'Folder')).trim()
        || (rawUrl ? rawUrl : 'Folder');
}

function __findPermanentPendingCreatedNodeEntry(root, parentIdInput, indexInput, titleInput, urlInput) {
    const parentId = String(parentIdInput || '').trim();
    const parentEntry = __findPermanentNodeEntryById(root, parentId);
    const parent = parentEntry && parentEntry.node;
    if (!parent || !Array.isArray(parent.children)) return null;
    const title = String(titleInput || '').trim();
    const url = String(urlInput || '').trim();
    const matches = [];
    parent.children.forEach((child, index) => {
        if (!child || typeof child !== 'object') return;
        const childId = String(child.id || '').trim();
        if (!childId.startsWith('pending:')) return;
        if (String(child.title || '').trim() !== title) return;
        if (String(child.url || '').trim() !== url) return;
        matches.push({ node: child, parent, index });
    });
    if (!matches.length) return null;
    const targetIndex = __coercePermanentBookmarkEventIndex(indexInput, null);
    if (targetIndex !== null) {
        const indexedMatch = matches.find((entry) => entry.index === targetIndex);
        if (indexedMatch) return indexedMatch;
    }
    return matches.length === 1 ? matches[0] : null;
}

function __movePermanentBcsNodeEntry(root, sourceEntry, parentIdInput, indexInput) {
    const parentId = String(parentIdInput || '').trim();
    const node = sourceEntry && sourceEntry.node;
    const sourceParent = sourceEntry && sourceEntry.parent;
    if (!root || !node || !sourceParent || !Array.isArray(sourceParent.children) || sourceEntry.index < 0) {
        throw new Error('[Permanent JSON] event move source is missing or is root.');
    }
    if (!parentId) throw new Error('[Permanent JSON] event move parentId is required.');
    const parentEntry = __findPermanentNodeEntryById(root, parentId);
    const targetParent = parentEntry && parentEntry.node;
    if (!targetParent) throw new Error('[Permanent JSON] event move parent is missing.');

    sourceParent.children.splice(sourceEntry.index, 1);
    __refreshPermanentLocalChildMeta(sourceParent);
    if (!Array.isArray(targetParent.children)) targetParent.children = [];

    const insertIndexFallback = targetParent.children.length;
    const insertIndex = Math.max(0, Math.min(
        __coercePermanentBookmarkEventIndex(indexInput, insertIndexFallback),
        targetParent.children.length
    ));
    node.parentId = parentId;
    node.index = insertIndex;
    targetParent.children.splice(insertIndex, 0, node);
    __refreshPermanentLocalChildMeta(targetParent);
    return true;
}

function __applyPermanentCreatedBookmarkEventToBcsRoot(root, event, resolvedChromeIds) {
    const bookmark = event && event.bookmark && typeof event.bookmark === 'object' ? event.bookmark : {};
    const chromeId = String((event && event.id) || bookmark.id || '').trim();
    const parentId = String(bookmark.parentId || '').trim();
    if (!chromeId || !parentId) throw new Error('[Permanent JSON] created event id and parentId are required.');

    const title = __buildPermanentBookmarkEventTitle(bookmark);
    const rawUrl = String(bookmark.url || '').trim();
    let existingEntry = __findPermanentNodeEntryById(root, chromeId);
    let pendingEntry = null;
    if (!existingEntry) {
        pendingEntry = __findPermanentPendingCreatedNodeEntry(root, parentId, bookmark.index, title, rawUrl);
    }
    const targetIndex = __coercePermanentBookmarkEventIndex(bookmark.index, null);
    let changed = false;

    if (!existingEntry && pendingEntry && pendingEntry.node) {
        const pendingId = String(pendingEntry.node.id || '').trim();
        if (pendingId && pendingId !== chromeId && pendingId.startsWith('pending:')) {
            pendingEntry.node.id = chromeId;
            changed = true;
            existingEntry = pendingEntry;
        }
    }

    if (existingEntry && existingEntry.node) {
        const node = existingEntry.node;
        if (node.title !== title) {
            node.title = title;
            changed = true;
        }
        if (rawUrl) {
            if (node.url !== rawUrl) {
                node.url = rawUrl;
                changed = true;
            }
            if (Array.isArray(node.children)) {
                delete node.children;
                changed = true;
            }
        } else {
            if (node.url) {
                delete node.url;
                changed = true;
            }
            if (!Array.isArray(node.children)) {
                node.children = [];
                changed = true;
            }
        }
        const currentParentId = existingEntry.parent && existingEntry.parent.id ? String(existingEntry.parent.id) : '';
        if (!existingEntry.parent || currentParentId !== parentId || (targetIndex !== null && existingEntry.index !== targetIndex)) {
            changed = __movePermanentBcsNodeEntry(root, existingEntry, parentId, targetIndex) || changed;
        } else if (existingEntry.parent) {
            __refreshPermanentLocalChildMeta(existingEntry.parent);
        }
        if (resolvedChromeIds && typeof resolvedChromeIds.add === 'function') resolvedChromeIds.add(chromeId);
        return changed;
    }

    const parentEntry = __findPermanentNodeEntryById(root, parentId);
    const parent = parentEntry && parentEntry.node;
    if (!parent) throw new Error('[Permanent JSON] created event parent is missing.');
    if (!Array.isArray(parent.children)) parent.children = [];
    const node = __normalizePermanentLocalMutationNode({
        id: chromeId,
        title,
        url: rawUrl,
        children: Array.isArray(bookmark.children) ? bookmark.children : []
    });
    node.parentId = parentId;
    const children = parent.children.filter((child) => String(child && child.id || '') !== chromeId);
    const insertIndex = Math.max(0, Math.min(
        targetIndex === null ? children.length : targetIndex,
        children.length
    ));
    node.index = insertIndex;
    children.splice(insertIndex, 0, node);
    parent.children = children;
    __refreshPermanentLocalChildMeta(parent);
    if (resolvedChromeIds && typeof resolvedChromeIds.add === 'function') resolvedChromeIds.add(chromeId);
    return true;
}

function __applyPermanentRemovedBookmarkEventToBcsRoot(root, event) {
    const nodeId = String(event && event.id || '').trim();
    if (!nodeId) throw new Error('[Permanent JSON] removed event id is required.');
    const entry = __findPermanentNodeEntryById(root, nodeId);
    if (!entry) return false;
    if (!entry.parent || !Array.isArray(entry.parent.children) || entry.index < 0) {
        throw new Error('[Permanent JSON] removed event node is missing or is root.');
    }
    entry.parent.children.splice(entry.index, 1);
    __refreshPermanentLocalChildMeta(entry.parent);
    return true;
}

function __applyPermanentMovedBookmarkEventToBcsRoot(root, event) {
    const nodeId = String(event && event.id || '').trim();
    const moveInfo = event && event.moveInfo && typeof event.moveInfo === 'object' ? event.moveInfo : {};
    const parentId = String(moveInfo.parentId || '').trim();
    if (!nodeId || !parentId) throw new Error('[Permanent JSON] moved event id and parentId are required.');
    const entry = __findPermanentNodeEntryById(root, nodeId);
    if (!entry || !entry.node) throw new Error('[Permanent JSON] moved event source is missing.');
    if (!entry.parent || entry.index < 0) throw new Error('[Permanent JSON] moved event source is root.');
    const targetIndex = __coercePermanentBookmarkEventIndex(moveInfo.index, null);
    if (targetIndex === null) throw new Error('[Permanent JSON] moved event index is required.');
    const currentParentId = String(entry.parent.id || '');
    if (currentParentId === parentId && entry.index === targetIndex) {
        __refreshPermanentLocalChildMeta(entry.parent);
        return false;
    }
    return __movePermanentBcsNodeEntry(root, entry, parentId, targetIndex);
}

function __applyPermanentChangedBookmarkEventToBcsRoot(root, event) {
    const nodeId = String(event && event.id || '').trim();
    const changeInfo = event && event.changeInfo && typeof event.changeInfo === 'object' ? event.changeInfo : {};
    if (!nodeId) throw new Error('[Permanent JSON] changed event id is required.');
    const entry = __findPermanentNodeEntryById(root, nodeId);
    const node = entry && entry.node;
    if (!node) throw new Error('[Permanent JSON] changed event node is missing.');
    let changed = false;
    if (typeof changeInfo.title === 'string' && node.title !== changeInfo.title) {
        node.title = changeInfo.title;
        changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(changeInfo, 'url')) {
        const url = String(changeInfo.url || '').trim();
        if (url) {
            if (node.url !== url) {
                node.url = url;
                changed = true;
            }
        } else if (node.url) {
            delete node.url;
            changed = true;
        }
    }
    return changed;
}

async function __applyPermanentBookmarkEventsToBcs(eventsInput, options = {}) {
    const events = (Array.isArray(eventsInput) ? eventsInput : [eventsInput])
        .filter((event) => event && typeof event === 'object' && event.type);
    if (!events.length) return { changed: false, applied: 0, noops: 0 };

    const resolvedChromeIds = new Set();
    let appliedCount = 0;
    let noopCount = 0;
    const suppressIdentityMapDelta = !!(options && options.suppressIdentityMapDelta === true);
    const result = await __mutatePermanentMainContentInBcs((root, content) => {
        let changed = false;
        appliedCount = 0;
        noopCount = 0;
        for (const event of events) {
            let eventChanged = false;
            if (event.type === 'created') {
                eventChanged = __applyPermanentCreatedBookmarkEventToBcsRoot(root, event, resolvedChromeIds);
            } else if (event.type === 'removed') {
                eventChanged = __applyPermanentRemovedBookmarkEventToBcsRoot(root, event);
            } else if (event.type === 'moved') {
                eventChanged = __applyPermanentMovedBookmarkEventToBcsRoot(root, event);
            } else if (event.type === 'changed') {
                eventChanged = __applyPermanentChangedBookmarkEventToBcsRoot(root, event);
            } else {
                throw new Error(`[Permanent JSON] unsupported bookmark event type: ${String(event.type)}`);
            }
            appliedCount += 1;
            if (eventChanged) changed = true;
            else noopCount += 1;
        }
        if (!suppressIdentityMapDelta && content && typeof content === 'object') {
            __applyIdentityMapDeltaFromBookmarkEvents(content, events);
        }
        if (!changed) return false;
        return {
            applied: appliedCount,
            noops: noopCount,
            reason: String(options && options.reason || '')
        };
    });

    return {
        ...(result && typeof result === 'object' ? result : {}),
        applied: appliedCount,
        noops: noopCount
    };
}

async function __syncPermanentMainTreeFromChromeBookmarks(options = {}) {
    const chromeTree = await __getPermanentChromeTreeForStorage();
    if (!chromeTree) return null;
    const previous = await __ensurePermanentMainContentInBcs();
    const normalizedTree = __normalizePermanentTreeSnapshotForLocalStorage(chromeTree);
    if (!normalizedTree) return null;
    const rebuiltIdentityMap = __rebuildIdentityMapPreservingExisting(previous, normalizedTree[0]);
    const content = {
        ...(previous && typeof previous === 'object' ? previous : __buildPermanentPrimaryContentPayloadFromTree(normalizedTree)),
        tree: normalizedTree[0],
        identityMap: rebuiltIdentityMap
    };
    return __writePermanentMainContentToBcs(content, {
        immediate: true
    });
}

function __clearPermanentTreeRenderCachesAfterStorageUpdate() {
    try {
        if (typeof cachedTreeData !== 'undefined') cachedTreeData = null;
        if (typeof lastTreeFingerprint !== 'undefined') lastTreeFingerprint = null;
        if (typeof lastTreeSnapshotVersion !== 'undefined') lastTreeSnapshotVersion = null;
        if (typeof cachedCurrentTreeIndex !== 'undefined') cachedCurrentTreeIndex = null;
        if (typeof cachedRenderTreeIndex !== 'undefined') cachedRenderTreeIndex = null;
        if (typeof window !== 'undefined') window.__canvasRenderTreeIndex = null;
    } catch (_) { }
}

function __buildPermanentTreeProtocolNode(nodeInput, options = {}) {
    if (!nodeInput || typeof nodeInput !== 'object') return null;

    const rawUrl = String(nodeInput.url || '').trim();
    if (rawUrl) {
        return {
            title: String(nodeInput.title || nodeInput.name || rawUrl).trim() || rawUrl,
            url: rawUrl
        };
    }

    const node = {
        title: String(nodeInput.title || nodeInput.name || 'Folder').trim() || 'Folder',
        children: (Array.isArray(nodeInput.children) ? nodeInput.children : [])
            .map((child) => __buildPermanentTreeProtocolNode(child, {}))
            .filter(Boolean)
    };

    if (options && options.isRootChild) {
        const folderType = __normalizeBookmarkFolderType(nodeInput.folderType || nodeInput.folder_type || '');
        const syncing = __canPersistBookmarkRootSyncing(folderType)
            ? __normalizeBookmarkRootSyncing(nodeInput.syncing)
            : null;
        if (folderType) node.folderType = folderType;
        if (syncing !== null) node.syncing = syncing;
    }

    return node;
}

function __normalizePermanentTreeSnapshotForProtocol(rawTree, options = {}) {
    void options;
    const source = Array.isArray(rawTree)
        ? rawTree
        : ((rawTree && typeof rawTree === 'object' && Array.isArray(rawTree.children)) ? [rawTree] : null);
    if (!source || !source.length) return null;

    const sourceRoot = source[0] && typeof source[0] === 'object' ? source[0] : { title: '', children: [] };
    const rootChildren = Array.isArray(sourceRoot.children) ? sourceRoot.children : [];
    const normalizedRoot = {
        title: String(sourceRoot.title || sourceRoot.name || '').trim(),
        children: rootChildren
            .map((child) => __buildPermanentTreeProtocolNode(child, { isRootChild: true }))
            .filter(Boolean)
    };

    return [normalizedRoot];
}

function __readPermanentRootMetaStorageValue() {
    try {
        const raw = localStorage.getItem(PERMANENT_ROOT_META_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return __normalizePermanentRootMeta(parsed);
    } catch (_) {
        return null;
    }
}

function __persistPermanentRootMetaStorageValue(rootMeta) {
    const normalized = __normalizePermanentRootMeta(rootMeta);
    if (!normalized) return null;
    try { saveSharedState(PERMANENT_ROOT_META_STORAGE_KEY, normalized); } catch (_) { }
    return normalized;
}

function __persistPermanentRootMetaFromTreeSnapshot(treeInput) {
    const normalizedTree = __normalizePermanentTreeSnapshotForProtocol(treeInput);
    if (!normalizedTree) return null;
    const rootMeta = __buildPermanentRootMeta(normalizedTree);
    return __persistPermanentRootMetaStorageValue(rootMeta);
}

function __applyPermanentRootMetaToTreeSnapshot(treeInput, rootMetaInput) {
    const normalizedTree = __normalizePermanentTreeSnapshotForProtocol(treeInput);
    if (!normalizedTree) return null;
    const normalizedRootMeta = __normalizePermanentRootMeta(rootMetaInput);
    if (!normalizedRootMeta) return normalizedTree;

    const root = Array.isArray(normalizedTree) ? normalizedTree[0] : null;
    const rootChildren = root && Array.isArray(root.children) ? root.children : [];
    if (!root || !rootChildren.length) return normalizedTree;

    const standardRoots = normalizedRootMeta && normalizedRootMeta.standardRoots && typeof normalizedRootMeta.standardRoots === 'object'
        ? normalizedRootMeta.standardRoots
        : {};
    const descriptorBuckets = new Map();
    const descriptors = Array.isArray(normalizedRootMeta && normalizedRootMeta.rootDescriptors)
        ? normalizedRootMeta.rootDescriptors
        : [];

    descriptors.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const titleKey = __normalizePermanentRootTitleKey(entry.sectionTitle || '');
        if (!titleKey) return;
        if (!descriptorBuckets.has(titleKey)) descriptorBuckets.set(titleKey, []);
        descriptorBuckets.get(titleKey).push(entry);
    });

    const takeDescriptorByNode = (node) => {
        const titleKey = __normalizePermanentRootTitleKey(__resolvePermanentRootSectionTitle(node));
        if (!titleKey || !descriptorBuckets.has(titleKey)) return null;
        const bucket = descriptorBuckets.get(titleKey);
        while (bucket.length) {
            const next = bucket.shift();
            if (next && typeof next === 'object') return next;
        }
        return null;
    };

    root.children = rootChildren.map((nodeInput) => {
        if (!nodeInput || typeof nodeInput !== 'object') return nodeInput;
        const node = Object.assign({}, nodeInput);
        const rootKey = __getPermanentRootMatchKey(node);
        const standardEntry = (rootKey && standardRoots[rootKey] && standardRoots[rootKey].present !== false)
            ? standardRoots[rootKey]
            : null;
        const descriptorEntry = takeDescriptorByNode(node);
        const metaEntry = standardEntry || descriptorEntry;

        const folderType = __normalizeBookmarkFolderType(
            node.folderType
            || node.folder_type
            || (metaEntry && metaEntry.folderType)
            || __permanentRootKeyToFolderType(rootKey)
        );
        if (folderType) {
            node.folderType = folderType;
        } else if (Object.prototype.hasOwnProperty.call(node, 'folderType')) {
            delete node.folderType;
        }
        if (Object.prototype.hasOwnProperty.call(node, 'folder_type')) {
            delete node.folder_type;
        }

        let syncing = __canPersistBookmarkRootSyncing(folderType)
            ? __normalizeBookmarkRootSyncing(node.syncing)
            : null;
        if (syncing === null && __canPersistBookmarkRootSyncing(folderType)) {
            syncing = __normalizeBookmarkRootSyncing(metaEntry && metaEntry.syncing);
        }
        if (syncing !== null) {
            node.syncing = syncing;
        } else if (Object.prototype.hasOwnProperty.call(node, 'syncing')) {
            delete node.syncing;
        }

        const title = String(node.title || node.name || '').trim();
        if (!title) {
            node.title = __resolvePermanentRootSectionTitle(node);
        }
        return node;
    });

    return __normalizePermanentTreeSnapshotForProtocol(normalizedTree) || normalizedTree;
}

function __buildPermanentTreeSnapshotForJsonProtocol(rawTree, options = {}) {
    const normalizedTree = __normalizePermanentTreeSnapshotForProtocol(rawTree, options);
    if (!normalizedTree) return null;
    if (!(options && options.persistRootMeta === false)) {
        try { __persistPermanentRootMetaFromTreeSnapshot(normalizedTree); } catch (_) { }
    }
    return normalizedTree;
}

function __extractCanvasRootMetaCommentBlock(bodyText) {
    const compactExtracted = __extractCanvasCompactComment(bodyText, __CANVAS_COMPACT_TAG_ROOT_META);
    if (compactExtracted.found) {
        let rootMeta = null;
        try {
            rootMeta = __normalizePermanentRootMeta(JSON.parse(String(compactExtracted.payload || '').trim() || '{}'));
        } catch (_) {
            rootMeta = null;
        }
        return {
            body: compactExtracted.body,
            rootMeta
        };
    }

    return {
        body: String(bodyText || '').replace(/\r\n?/g, '\n'),
        rootMeta: null
    };
}

function __buildCanvasDescriptionCommentBlock(markdownText) {
    const text = String(markdownText == null ? '' : markdownText);
    if (!text.trim()) return '';
    return __buildCanvasCompactComment(__CANVAS_COMPACT_TAG_DESCRIPTION, text);
}

function __extractCanvasDescriptionCommentBlock(bodyText) {
    const compactExtracted = __extractCanvasCompactComment(bodyText, __CANVAS_COMPACT_TAG_DESCRIPTION);
    if (compactExtracted.found) {
        return {
            body: compactExtracted.body,
            descriptionMarkdown: String(compactExtracted.payload == null ? '' : compactExtracted.payload)
        };
    }

    return {
        body: String(bodyText || '').replace(/\r\n?/g, '\n'),
        descriptionMarkdown: ''
    };
}

function __buildCanvasNativeTextMetaCommentBlock(nodeId) {
    const normalizedId = String(nodeId || '').trim();
    if (!normalizedId) return '';
    return __buildCanvasCompactComment(__CANVAS_COMPACT_TAG_NATIVE_TEXT_META, JSON.stringify({ nodeId: normalizedId }));
}

function __extractCanvasNativeTextMetaCommentBlock(bodyText) {
    const compactExtracted = __extractCanvasCompactComment(bodyText, __CANVAS_COMPACT_TAG_NATIVE_TEXT_META);
    if (compactExtracted.found) {
        let nodeId = '';
        try {
            const parsed = JSON.parse(String(compactExtracted.payload || '').trim() || '{}');
            nodeId = String(parsed && parsed.nodeId || '').trim();
        } catch (_) {
            nodeId = String(compactExtracted.payload || '').trim();
        }
        return {
            body: compactExtracted.body,
            nodeId
        };
    }

    return {
        body: String(bodyText || '').replace(/\r\n?/g, '\n'),
        nodeId: ''
    };
}

function __normalizeCanvasFoldStateMeta(rawFoldState, options = {}) {
    const source = rawFoldState && typeof rawFoldState === 'object' ? rawFoldState : {};
    const mode = String(options.mode || '').trim().toLowerCase();
    const normalizeIds = (value) => Array.from(new Set(
        (Array.isArray(value) ? value : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    ));

    const expanded = normalizeIds(source.expanded);
    const expandedSet = new Set(expanded);
    const collapsed = mode === 'permanent'
        ? []
        : normalizeIds(source.collapsed).filter((id) => !expandedSet.has(id));

    return { expanded, collapsed };
}

function __buildCanvasFoldStateCommentBlock(foldState, options = {}) {
    const normalized = __normalizeCanvasFoldStateMeta(foldState, options);
    const hasState = normalized.expanded.length > 0 || normalized.collapsed.length > 0;
    if (!hasState && !options.force) return '';
    return __buildCanvasCompactComment(__CANVAS_COMPACT_TAG_FOLD_STATE, JSON.stringify(normalized));
}

function __extractCanvasFoldStateCommentBlock(bodyText, options = {}) {
    const compactExtracted = __extractCanvasCompactComment(bodyText, __CANVAS_COMPACT_TAG_FOLD_STATE);
    if (compactExtracted.found) {
        let foldState = null;
        try {
            const parsed = JSON.parse(String(compactExtracted.payload || '').trim() || '{}');
            foldState = __normalizeCanvasFoldStateMeta(parsed, options);
        } catch (_) {
            foldState = null;
        }
        return {
            body: compactExtracted.body,
            foldState
        };
    }

    return {
        body: String(bodyText || '').replace(/\r\n?/g, '\n'),
        foldState: null
    };
}

function __buildBookmarkItemsFromProtocolTree(treeInput, options = {}) {
    const includeRootNode = options && options.includeRootNode === true;
    const tagMapByNodeId = options && options.tagMapByNodeId instanceof Map
        ? options.tagMapByNodeId
        : null;
    const sourceNodes = Array.isArray(treeInput)
        ? treeInput
        : ((treeInput && typeof treeInput === 'object') ? [treeInput] : []);
    const entryNodes = includeRootNode
        ? sourceNodes
        : sourceNodes.flatMap((node) => (Array.isArray(node && node.children) ? node.children : []));

    const convertNode = (nodeInput) => {
        if (!nodeInput || typeof nodeInput !== 'object') return null;

        const rawUrl = String(nodeInput.url || '').trim();
        const kind = rawUrl || String(nodeInput.kind || nodeInput.type || '').trim().toLowerCase() === 'bookmark'
            ? 'bookmark'
            : 'folder';
        const title = String(nodeInput.title || nodeInput.name || rawUrl || (kind === 'bookmark' ? 'Untitled Bookmark' : 'Folder')).trim()
            || (kind === 'bookmark' ? 'Untitled Bookmark' : 'Folder');
        const normalizedId = String(nodeInput.id || '').trim();
        const normalizedSyncId = String(nodeInput.syncId || '').trim();
        const nodeIdForTagLookup = normalizedId || normalizedSyncId;
        const inlineTags = __normalizeTagArrayInput(Array.isArray(nodeInput.tags) ? nodeInput.tags : []);
        const mappedTags = (!inlineTags.length && tagMapByNodeId && nodeIdForTagLookup)
            ? __normalizeTagArrayInput(tagMapByNodeId.get(nodeIdForTagLookup))
            : [];
        const resolvedTags = inlineTags.length ? inlineTags : mappedTags;

        if (kind === 'bookmark') {
            const out = {
                ...(normalizedId ? { id: normalizedId } : {}),
                type: 'bookmark',
                title,
                url: rawUrl
            };
            if (resolvedTags.length) out.tags = resolvedTags;
            return out;
        }

        const out = {
            ...(normalizedId ? { id: normalizedId } : {}),
            type: 'folder',
            title,
            children: (Array.isArray(nodeInput.children) ? nodeInput.children : []).map(convertNode).filter(Boolean)
        };
        if (resolvedTags.length) out.tags = resolvedTags;
        return out;
    };

    return entryNodes.map(convertNode).filter(Boolean);
}

function __buildPermanentJsonTreeProtocol(bookmarkTree) {
    const normalizedTree = __buildPermanentTreeSnapshotForJsonProtocol(bookmarkTree)
        || __cloneRawChromeBookmarkTreeSnapshot(bookmarkTree);
    const sourceRoot = Array.isArray(normalizedTree) ? normalizedTree[0] : null;
    if (sourceRoot && typeof sourceRoot === 'object') {
        return sourceRoot;
    }
    return { title: '', children: [] };
}

function __buildBookmarkTreeSnapshotFromPermanentJsonProtocol(protocolInput) {
    const normalizedProtocol = __normalizeCanvasSectionJsonProtocolObject(protocolInput);
    if (!normalizedProtocol || normalizedProtocol.sectionType !== 'permanent') return null;

    const sourceTree = normalizedProtocol.tree && typeof normalizedProtocol.tree === 'object'
        ? normalizedProtocol.tree
        : null;
    const normalizedTree = __normalizePermanentTreeSnapshotForProtocol(sourceTree);
    if (normalizedTree) return normalizedTree;

    const sourceRootChildren = sourceTree && Array.isArray(sourceTree.children) ? sourceTree.children : [];

    return __normalizePermanentTreeSnapshotForProtocol([{
        title: '',
        children: sourceRootChildren
            .map((child) => __buildPermanentTreeProtocolNode(child, { isRootChild: true }))
            .filter(Boolean)
    }]);
}

function __resolvePermanentSectionDescriptionMarkdown(copyId = null, descriptionOverride = null, options = {}) {
    if (descriptionOverride !== null) {
        if (options && options.preserveRawSource === true) {
            return String(descriptionOverride == null ? '' : descriptionOverride);
        }
        return __normalizePermanentViewDescriptionMarkdown(descriptionOverride);
    }
    const sourceData = options && typeof options.sourceData === 'object' ? options.sourceData : null;
    const readOptions = sourceData
        ? { allowLiveFallback: options && options.allowLiveFallback === true }
        : {};
    return __collectPermanentViewDescriptionMarkdown(copyId, sourceData, {
        ...readOptions,
        preserveRawSource: options && options.preserveRawSource === true
    });
}

function __buildPermanentSectionJsonProtocol(bookmarkTree, descriptionOverride = null, metaOptions = null) {
    const { isEn } = __getLang();
    const permanentSlot = __normalizePositiveInt(metaOptions && metaOptions.permanentSlot) || 1;
    const slotLabel = toAlphaLabel(permanentSlot) || 'A';
    const title = __getPermanentSectionDisplayTitle(isEn);
    const copyId = String(metaOptions && metaOptions.copyId || '').trim() || null;
    const inheritFrom = __normalizeCanvasMarkdownPath(
        metaOptions && (metaOptions.inheritFrom || '')
    );

    const payload = {
        format: __CANVAS_SECTION_JSON_FORMAT,
        schemaVersion: 2,
        sectionType: 'permanent',
        slot: slotLabel,
        title,
        descriptionMd: __resolvePermanentSectionDescriptionMarkdown(copyId, descriptionOverride, {
            preserveRawSource: true
        })
    };
    if (inheritFrom) {
        payload.fileRole = 'copy-anchor';
        payload.anchorOnly = true;
        payload.fileNote = isEn
            ? 'Permanent copy anchor file: tree content is inherited from primary file; this file keeps per-copy description and canvas anchor.'
            : '永久栏目副本锚点文件：树内容继承自主文件；此文件仅保留副本说明与画布锚点。';
        payload.inheritFrom = inheritFrom;
    } else {
        payload.fileRole = 'primary';
        payload.fileNote = isEn
            ? 'Primary permanent file: canonical bookmark tree source.'
            : '永久栏目主文件：书签树的规范真相源。';
        payload.tree = __buildPermanentJsonTreeProtocol(bookmarkTree);
    }
    return payload;
}

function __buildPermanentSectionJsonMarkdown(bookmarkTree, descriptionOverride = null, metaOptions = null) {
    return __buildCanvasSectionJsonCodeBlock(
        __buildPermanentSectionJsonProtocol(bookmarkTree, descriptionOverride, metaOptions)
    ) + '\n';
}

function __buildTempSectionJsonProtocol(section) {
    const normalizedProtocol = __normalizeTempSectionProtocolObject(section) || __buildTempSectionProtocol(section);
    const sectionMeta = normalizedProtocol && normalizedProtocol.sectionMeta ? normalizedProtocol.sectionMeta : {};
    const sectionId = String((section && section.id) || sectionMeta.id || '').trim();
    const items = __buildTempSectionProtocolItems(
        Array.isArray(section && section.items)
            ? section.items
            : (normalizedProtocol && Array.isArray(normalizedProtocol.items)
                ? normalizedProtocol.items
                : []),
        sectionId
    );
    const normalizedSource = __normalizeTempSectionSourceKey(sectionMeta.source || (section && section.source) || '');
    const explicitTempKind = String(sectionMeta.tempKind || (section && section.tempKind) || '').trim().toLowerCase();
    const tempKind = (explicitTempKind === 'special' || explicitTempKind === 'regular')
        ? explicitTempKind
        : (__isSpecialTempSection(section) ? 'special' : 'regular');
    const payload = {
        format: __CANVAS_SECTION_JSON_FORMAT,
        schemaVersion: 2,
        sectionType: 'temporary',
        id: sectionId || undefined,
        label: String(sectionMeta.label || getTempSectionLabel(section) || '').trim(),
        title: String(sectionMeta.title || (section && section.title) || __getDefaultTempSectionProtocolTitle()).trim()
            || __getDefaultTempSectionProtocolTitle(),
        tempKind,
        source: normalizedSource,
        descriptionMd: String(sectionMeta.descriptionMd == null ? '' : sectionMeta.descriptionMd),
        items
    };
    if (sectionMeta.originPermanent) payload.originPermanent = sectionMeta.originPermanent;
    if (sectionMeta.sequenceNumber) payload.sequenceNumber = sectionMeta.sequenceNumber;
    if (!payload.id) delete payload.id;
    return payload;
}

function __buildTempSectionJsonMarkdown(section) {
    return __buildCanvasSectionJsonCodeBlock(__buildTempSectionJsonProtocol(section)) + '\n';
}

function __parseCanvasMarkdownPayload(fileText) {
    const rawBody = String(fileText || '');
    // Use normalized body only for parser robustness; keep rawBody unchanged for source round-trip.
    const parseBody = rawBody.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

    const extractedFormat = __extractCanvasExportFormatCompactComment(parseBody);
    const extractedDesc = __extractCanvasDescriptionCommentBlock(extractedFormat.body);
    const extractedRootMeta = __extractCanvasRootMetaCommentBlock(extractedDesc.body);
    const extractedFold = __extractCanvasFoldStateCommentBlock(extractedRootMeta.body);
    let workingBody = extractedFold.body;
    const extractedJson = __extractCanvasSectionJsonCodeBlock(workingBody);
    const jsonProtocol = extractedJson.jsonProtocol;
    let descriptionMarkdown = extractedDesc.descriptionMarkdown
        || __resolveCanvasSectionJsonDescriptionMarkdown(jsonProtocol);

    const lines = workingBody.split('\n');
    let firstNonEmptyIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (String(lines[i] || '').trim()) {
            firstNonEmptyIndex = i;
            break;
        }
    }

    const firstNonEmptyLine = firstNonEmptyIndex >= 0 ? String(lines[firstNonEmptyIndex] || '').trim() : '';
    const looksLikeTreeLine = !!jsonProtocol
        || /^(#{2,}\s+|<|[\[{])/.test(firstNonEmptyLine);
    const hasHeaderLine = !!firstNonEmptyLine && !looksLikeTreeLine;

    let contentToParse = hasHeaderLine
        ? lines.slice(firstNonEmptyIndex + 1).join('\n').trim()
        : workingBody.trim();
    if (jsonProtocol && jsonProtocol.sectionType === 'permanent') {
        const hasJsonTree = !!(jsonProtocol.tree && typeof jsonProtocol.tree === 'object');
        const inheritFrom = __normalizeCanvasMarkdownPath(jsonProtocol.inheritFrom || '').replace(/\.(md|json)$/i, '');
        if (!hasJsonTree && inheritFrom) {
            contentToParse = `![[${inheritFrom}]]`;
        }
    }

    return {
        rawBody,
        headerLine: hasHeaderLine ? firstNonEmptyLine : '',
        descriptionMarkdown,
        descriptionHtml: __renderDescriptionMarkdownToHtml(descriptionMarkdown),
        foldState: null,
        rootMeta: extractedRootMeta.rootMeta,
        exportFormatHint: extractedFormat.exportFormat || '',
        jsonProtocol,
        contentToParse
    };
}

function __stripZwsp(s) {
    return String(s || '').replace(/\u200B/g, '');
}

/**
 * Convert HTML content to Markdown source code for Obsidian rendering.
 * This function traverses the DOM and converts HTML elements to their Markdown equivalents.
 */
function __htmlToMarkdown(html, options = {}) {
    if (!html || typeof html !== 'string') return '';
    const {
        trimResult = true,
        compactNewlines = true,
        paragraphBreaks = false,
        hardLineBreaks = false
    } = options;
    const paragraphSeparator = paragraphBreaks ? '\n\n' : '\n';
    const hardBreakSeparator = hardLineBreaks ? '  \n' : '\n';
    const normalizedInput = __stripZwsp(html).replace(/\r\n?/g, '\n');
    const stripped = trimResult ? normalizedInput.trim() : normalizedInput;
    if (!stripped.trim()) return '';

    // If it doesn't look like HTML, return as-is (already Markdown)
    const looksLikeHtml = __looksLikeHtmlTagContent(stripped);
    if (!looksLikeHtml) return stripped;

    const tmp = document.createElement('div');
    tmp.innerHTML = stripped;

    const processNode = (node) => {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) {
            return (node.textContent || '')
                .replace(/\u200B/g, '')
                .replace(/\u00A0/g, ' ');
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName.toLowerCase();
        const childContent = () => Array.from(node.childNodes).map(processNode).join('');
        const childHtml = () => String(node.innerHTML || '').replace(/\u200B/g, '');

        switch (tag) {
            case 'br':
                return hardBreakSeparator;
            case 'p':
            case 'div': {
                const content = childContent();
                if (tag === 'p') {
                    const align = String(node.getAttribute('align') || '').trim().toLowerCase();
                    if (/^(left|center|right|justify)$/.test(align)) {
                        return `<p align="${align}">${content}</p>${paragraphBreaks ? paragraphSeparator : '\n'}`;
                    }
                }
                const isVisuallyEmpty = !String(content || '').replace(/[\s\u00A0]+/g, '');
                if (isVisuallyEmpty) {
                    return paragraphBreaks ? paragraphSeparator : '\n';
                }
                if (!paragraphBreaks) {
                    const blockSeparator = hardLineBreaks ? '  \n' : '\n';
                    return content.endsWith('\n') ? content : (content + blockSeparator);
                }
                const trimmedContent = content.replace(/\n+$/g, '');
                return trimmedContent ? (trimmedContent + paragraphSeparator) : paragraphSeparator;
            }
            case 'details':
                return `<details>${childContent()}</details>\n`;
            case 'summary':
                return `<summary>${childContent()}</summary>\n`;
            case 'input': {
                if (node.type === 'checkbox') {
                    const isChecked = node.hasAttribute('checked') || node.checked;
                    return `- [${isChecked ? 'x' : ' '}] `;
                }
                return '';
            }
            case 'strong':
            case 'b':
                return `**${childContent()}**`;
            case 'em':
            case 'i':
                return `_${childContent()}_`;
            case 'u':
                return `<u>${childContent()}</u>`;
            case 'del':
            case 's':
            case 'strike':
                return `~~${childContent()}~~`;
            case 'mark':
                return `==${childContent()}==`;
            case 'code':
                return `\`${childContent()}\``;
            case 'pre':
                return '```\n' + childContent() + '\n```\n';
            case 'sup':
                return childContent();
            case 'sub':
                return childContent();
            case 'a': {
                const href = node.getAttribute('href') || '';
                const text = childContent() || href;
                return `[${text}](${href})`;
            }
            case 'h1':
                return `# ${childContent()}\n`;
            case 'h2':
                return `## ${childContent()}\n`;
            case 'h3':
                return `### ${childContent()}\n`;
            case 'h4':
                return `#### ${childContent()}\n`;
            case 'h5':
                return `##### ${childContent()}\n`;
            case 'h6':
                return `###### ${childContent()}\n`;
            case 'blockquote':
                return childContent().split('\n').map(line => `> ${line}`).join('\n') + '\n';
            case 'ul':
                return Array.from(node.children).map((li, idx) => {
                    const content = processNode(li).replace(/^- /, '').trim();
                    return `- ${content}`;
                }).join('\n') + '\n';
            case 'ol':
                return Array.from(node.children).map((li, idx) => {
                    const content = processNode(li).replace(/^\d+\. /, '').trim();
                    return `${idx + 1}. ${content}`;
                }).join('\n') + '\n';
            case 'li':
                return childContent();
            case 'hr':
                return '---\n';
            case 'img': {
                const src = node.getAttribute('src') || '';
                const alt = node.getAttribute('alt') || '';
                return `![${alt}](${src})`;
            }
            case 'span': {
                const style = String(node.getAttribute('style') || '').trim();
                if (style && /^(?:\s*(?:color|background-color|text-align|font-weight|font-style|text-decoration)\s*:[^;]+;?)+$/i.test(style)) {
                    return `<span style="${style.replace(/"/g, '&quot;')}">${childContent()}</span>`;
                }
                return childContent();
            }
            case 'font': {
                const color = String(node.getAttribute('color') || '').trim();
                if (color) return `<font color="${color.replace(/"/g, '&quot;')}">${childContent()}</font>`;
                return childContent();
            }
            case 'center': {
                return `<center>${childContent()}</center>`;
            }
            default:
                return childContent();
        }
    };

    const topNodes = Array.from(tmp.childNodes);
    const isTopLevelBlockLike = (node) => {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        const tag = String(node.tagName || '').toLowerCase();
        return /^(p|div|h[1-6]|ul|ol|blockquote|pre|hr|details)$/.test(tag);
    };

    const renderedChunks = [];
    topNodes.forEach((node, index) => {
        let chunk = processNode(node);
        if (!chunk) {
            renderedChunks.push(chunk);
            return;
        }

        if (renderedChunks.length > 0) {
            const prevChunk = renderedChunks[renderedChunks.length - 1] || '';
            const prevNode = index > 0 ? topNodes[index - 1] : null;
            const currentIsBlock = isTopLevelBlockLike(node);
            const prevIsBlock = isTopLevelBlockLike(prevNode);
            // Keep markdown block boundaries explicit to avoid token concatenation
            // like "`code`## heading" after HTML -> markdown conversion.
            if ((currentIsBlock || prevIsBlock) && prevChunk && !prevChunk.endsWith('\n')) {
                renderedChunks[renderedChunks.length - 1] = prevChunk + '\n';
            }
        }

        if (node && node.nodeType === Node.TEXT_NODE) {
            const text = String(node.textContent || '').replace(/\u200B/g, '');
            const next = topNodes[index + 1] || null;
            if (text.trim() && isTopLevelBlockLike(next) && chunk && !chunk.endsWith('\n')) {
                chunk += '\n';
            }
        }

        renderedChunks.push(chunk);
    });

    const rendered = renderedChunks.join('');

    const result = rendered.replace(/\r\n?/g, '\n');
    const compacted = compactNewlines
        ? (paragraphBreaks ? result.replace(/\n{4,}/g, '\n\n\n') : result.replace(/\n{3,}/g, '\n\n'))
        : result;
    return trimResult ? compacted.trim() : compacted;
}

function __flushMdEditorsForExport(options = {}) {
    const editors = document.querySelectorAll('.md-canvas-node .md-canvas-editor');
    if (!editors || !editors.length) return;
    const skipActiveEditor = !!(options && options.skipActiveEditor);

    let changed = false;
    editors.forEach((editor) => {
        if (!editor) return;
        const host = editor.closest('.md-canvas-node');
        if (skipActiveEditor) {
            const activeEl = document.activeElement;
            const isActiveEditor = !!(activeEl && (activeEl === editor || editor.contains(activeEl)));
            const isEditingNode = !!(host && host.classList && host.classList.contains('editing'));
            // Export-time flush only needs to capture in-flight edits.
            // Skip untouched cards to avoid canonicalization churn in preset markdown files.
            if (!isActiveEditor && !isEditingNode) return;
        }
        const nodeId = host && host.id ? String(host.id) : '';
        if (!nodeId) return;
        const node = (CanvasState.mdNodes || []).find((item) => item && item.id === nodeId);
        if (!node) return;

        if (__syncMdNodeFromEditor(node, editor)) {
            changed = true;
        }
    });

    if (changed) {
        try { saveTempNodes(); } catch (_) { }
    }
}

function __isValidUrl(url) {
    const normalized = __sanitizeImportUrl(url);
    if (!normalized) return false;
    if (normalized === '#') return false;
    if (String(normalized).startsWith('unsafe:')) return false;
    return true;
}

function __escapeMarkdownLinkText(text) {
    return String(text || '').replace(/]/g, '\\]');
}

const __toAlphaLabel = (n) => {
    if (n <= 0) return '';
    let s = '';
    while (n > 0) {
        n--;
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26);
    }
    return s;
};

// Helper to get permanent expanded state (main or a copy by copyId).
const __getPermanentExpandedSet = (copyId = null) => {
    try {
        const safeCopyId = (typeof copyId === 'string' && copyId.trim()) ? copyId.trim() : '';
        const baseKey = safeCopyId ? `${PERMANENT_SECTION_EXPANDED_KEY}:${safeCopyId}` : PERMANENT_SECTION_EXPANDED_KEY;
        const currentPartition = __getCanvasViewPartitionKey();
        const currentKey = __buildCanvasPartitionedViewStateKey('expand', baseKey, currentPartition);
        const expanded = __readPartitionedViewJSON(currentKey, null);
        if (Array.isArray(expanded)) return new Set(expanded);

        const otherPartition = currentPartition === 'sidepanel' ? 'page' : 'sidepanel';
        const otherKey = __buildCanvasPartitionedViewStateKey('expand', baseKey, otherPartition);
        const expandedOther = __readPartitionedViewJSON(otherKey, null);
        if (Array.isArray(expandedOther)) return new Set(expandedOther);
    } catch (_) { }

    return new Set();
};

const __getTempSectionCollapsedSet = (sectionId) => {
    if (!sectionId) return new Set();
    try {
        const key = `temp-section-collapsed:${sectionId}`;
        const s = localStorage.getItem(key);
        return new Set(JSON.parse(s || '[]'));
    } catch (_) {
        return new Set();
    }
};

function __getPermanentFoldStateForExport(copyId = null) {
    const expandedSet = __getPermanentExpandedSet(copyId);
    return __normalizeCanvasFoldStateMeta({
        expanded: Array.from(expandedSet)
    }, { mode: 'permanent' });
}

function __getTempSectionFoldStateForExport(sectionId) {
    const normalizedSectionId = String(sectionId || '').trim();
    if (!normalizedSectionId) {
        return __normalizeCanvasFoldStateMeta({ expanded: [], collapsed: [] });
    }

    let sourceState = null;
    try {
        const currentPartition = __getCanvasViewPartitionKey();
        const currentKey = __buildCanvasPartitionedViewStateKey('expand', TEMP_EXPAND_STATE_KEY, currentPartition);
        sourceState = __readPartitionedViewJSON(currentKey, null, 'expand');
        if (sourceState == null) {
            const otherPartition = currentPartition === 'sidepanel' ? 'page' : 'sidepanel';
            const otherKey = __buildCanvasPartitionedViewStateKey('expand', TEMP_EXPAND_STATE_KEY, otherPartition);
            sourceState = __readPartitionedViewJSON(otherKey, null, 'expand');
        }
    } catch (_) {
        sourceState = null;
    }

    if (!sourceState) {
        sourceState = {
            expanded: Array.from(LAZY_LOAD_THRESHOLD && LAZY_LOAD_THRESHOLD.expandedFolders ? LAZY_LOAD_THRESHOLD.expandedFolders : []),
            collapsed: Array.from(LAZY_LOAD_THRESHOLD && LAZY_LOAD_THRESHOLD.collapsedFolders ? LAZY_LOAD_THRESHOLD.collapsedFolders : [])
        };
    }

    const normalized = __normalizeTempExpandStateForSync(sourceState);
    const prefix = `${normalizedSectionId}-`;
    const stripPrefix = (id) => {
        const normalizedId = String(id || '').trim();
        return normalizedId.startsWith(prefix) ? normalizedId.slice(prefix.length) : '';
    };

    return __normalizeCanvasFoldStateMeta({
        expanded: normalized.expanded.map(stripPrefix).filter(Boolean),
        collapsed: normalized.collapsed.map(stripPrefix).filter(Boolean)
    });
}

function __buildTempSectionFoldStateForStorage(sectionId, foldState) {
    const normalizedSectionId = String(sectionId || '').trim();
    if (!normalizedSectionId) {
        return __normalizeCanvasFoldStateMeta({ expanded: [], collapsed: [] });
    }
    const normalized = __normalizeCanvasFoldStateMeta(foldState);
    const prefix = `${normalizedSectionId}-`;
    return {
        expanded: normalized.expanded.map((id) => `${prefix}${id}`),
        collapsed: normalized.collapsed.map((id) => `${prefix}${id}`)
    };
}

function __applyTempSectionFoldStateToStorage(sectionId, foldState) {
    const normalizedSectionId = String(sectionId || '').trim();
    if (!normalizedSectionId) return;

    const sectionState = __buildTempSectionFoldStateForStorage(normalizedSectionId, foldState);
    CANVAS_VIEW_PARTITIONS.forEach((partitionKey) => {
        const targetKey = __buildCanvasPartitionedViewStateKey('expand', TEMP_EXPAND_STATE_KEY, partitionKey);
        const targetRaw = targetKey ? __readPartitionedViewJSON(targetKey, null, 'expand') : null;
        const targetState = __normalizeTempExpandStateForSync(targetRaw);
        const mergedState = __mergeTempExpandStateBySection(sectionState, targetState, normalizedSectionId);
        saveViewState('expand', TEMP_EXPAND_STATE_KEY, mergedState, { partitionKey });
    });
}

function __applyPermanentFoldStateToStorage(copyId, foldState) {
    const baseKey = copyId
        ? `${PERMANENT_SECTION_EXPANDED_KEY}:${String(copyId).trim()}`
        : PERMANENT_SECTION_EXPANDED_KEY;
    const normalized = __normalizeCanvasFoldStateMeta(foldState, { mode: 'permanent' });
    CANVAS_VIEW_PARTITIONS.forEach((partitionKey) => {
        saveViewState('expand', baseKey, normalized.expanded, { partitionKey });
    });
}

function __applyImportedSectionFoldStates(sections) {
    let hasState = false;
    (Array.isArray(sections) ? sections : []).forEach((section) => {
        if (!section || !section.id || !section.foldState) return;
        __applyTempSectionFoldStateToStorage(section.id, section.foldState);
        hasState = true;
    });
    if (hasState) {
        try { loadTempExpandState(); } catch (_) { }
    }
}

function __buildImportedTempSectionFromJsonMarkdown(node, parsedMarkdown, contentToParse, isEn) {
    const parsedJsonProtocol = parsedMarkdown && parsedMarkdown.jsonProtocol && parsedMarkdown.jsonProtocol.sectionType === 'temporary'
        ? __normalizeTempSectionProtocolObject(parsedMarkdown.jsonProtocol)
        : null;
    let items = __parseMarkdownAuto(contentToParse);
    if (parsedJsonProtocol) {
        if (Array.isArray(parsedJsonProtocol.items)) {
            items = parsedJsonProtocol.items;
        }
    }
    const fileName = node.file.split('/').pop().replace(/\.(md|json)$/i, '');
    const parsed = __parseTempSectionLabelAndTitleFromFilename(fileName);
    const headerParsed = __parseTempSectionLabelAndTitleFromFilename(parsedMarkdown.headerLine || '');
    const title = String(
        (parsedJsonProtocol && parsedJsonProtocol.sectionMeta && parsedJsonProtocol.sectionMeta.title)
        || headerParsed.title
        || parsed.title
        || (isEn ? 'Temp Section' : '临时栏目')
    ).trim() || (isEn ? 'Temp Section' : '临时栏目');

    let label = '';
    if (parsedJsonProtocol && parsedJsonProtocol.sectionMeta && parsedJsonProtocol.sectionMeta.label) {
        label = String(parsedJsonProtocol.sectionMeta.label || '').trim();
    } else if (headerParsed.label) {
        label = headerParsed.label;
    } else if (parsed.label) {
        label = parsed.label;
    }

    let sequenceNumber = parsedJsonProtocol && parsedJsonProtocol.sectionMeta
        ? __normalizePositiveInt(parsedJsonProtocol.sectionMeta.sequenceNumber)
        : null;
    const labelForSeq = label || '';
    if (!sequenceNumber && labelForSeq) {
        const alphaMatch = labelForSeq.match(/^([A-Z]+)/i);
        const alphaPart = alphaMatch ? alphaMatch[1] : labelForSeq;
        const seq = __alphaLabelToNumber(alphaPart);
        if (seq) sequenceNumber = seq;
    }

    const parsedTempKindRaw = String(
        parsedJsonProtocol && parsedJsonProtocol.sectionMeta && parsedJsonProtocol.sectionMeta.tempKind || ''
    ).trim().toLowerCase();
    const parsedTempKind = (parsedTempKindRaw === 'special' || parsedTempKindRaw === 'regular')
        ? parsedTempKindRaw
        : '';
    const inferredTempKind = parsedTempKind || __inferTempSectionKindFromFilePath(node.file);
    if (parsedJsonProtocol && inferredTempKind && !parsedTempKind) {
        parsedJsonProtocol.sectionMeta.tempKind = inferredTempKind;
    }

    const inferredSource = String(
        (parsedJsonProtocol && parsedJsonProtocol.sectionMeta && parsedJsonProtocol.sectionMeta.source)
        || __inferTempSectionSourceFromFilePath(node.file)
        || ''
    ).trim();
    if (inferredSource && !label) {
        const sourceLabel = __getSpecialTempSectionLabelBySource(inferredSource, isEn);
        if (sourceLabel) label = sourceLabel;
    }

    const protocolInput = parsedJsonProtocol || {
        sectionMeta: {
            label,
            title,
            tempKind: inferredTempKind,
            source: inferredSource,
            sequenceNumber,
            descriptionMd: String(
                parsedMarkdown && parsedMarkdown.descriptionMarkdown == null
                    ? ''
                    : parsedMarkdown.descriptionMarkdown
            )
        },
        items
    };

    const restored = __buildRuntimeTempSectionFromProtocol(protocolInput, {
        sectionId: node.id,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        color: convertObsidianColor(node.color) || '#fb464c'
    });

    if (restored) return restored;

    return {
        id: node.id,
        title,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        color: convertObsidianColor(node.color) || '#fb464c',
        items,
        descriptionMd: String(
            parsedMarkdown && parsedMarkdown.descriptionMarkdown == null
                ? ''
                : parsedMarkdown.descriptionMarkdown
        ),
        label,
        source: inferredSource || ''
    };
}

function __buildMdNodeMarkdown(node) {
    const markdownSource = __isCanvasNativeTextNode(node)
        ? __normalizeCanvasMarkdownSource(__resolveCanvasNativeTextNodeBody(node))
        : __normalizeCanvasMarkdownSource(__deriveMdNodeMarkdownSource(node));
    if (!markdownSource.trim()) return '\n';
    return markdownSource;
}

function __extractMdNodeFilenameTitle(markdownText, fallback = 'Untitled') {
    const lines = String(markdownText || '').replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
        let line = __stripZwsp(lines[i] || '').trim();
        if (!line) continue;
        while (/^#{1,6}\s+/.test(line)) {
            line = line.replace(/^#{1,6}\s+/, '').trim();
        }
        line = line
            .replace(/^>+\s*/, '')
            .replace(/^[-*+]\s+/, '')
            .replace(/^\d+[.)]\s+/, '')
            .trim();
        if (line) return line;
    }
    return String(fallback || 'Untitled').trim() || 'Untitled';
}



/**
 * Build Permanent Copy Markdown: description is per-copy, body is embedded from main #A file.
 *
 * Goal:
 * - #A: A description + shared body
 * - #B/#C/...: own description + embed A shared body
 *
 * Implementation:
 * - Embed each root section (Bookmark Bar / Other Bookmarks / Mobile Bookmarks / etc.)
 *   so we don't need to change #A's structure.
 */
/**
 * [SECURITY] Sanitize Imported URL
 * Prevent XSS (javascript:) and other dangerous schemes.
 * Allow common productivity schemes (obsidian:, zotero:, etc.)
 */
function __sanitizeImportUrl(url) {
    if (!url) return '';
    const trimmed = String(url).trim();
    if (!trimmed) return '';

    // Allow relative paths (for Obsidian internal links?) - no, usually bookmarks are absolute.
    // If it starts with #, ok.
    if (trimmed.startsWith('#')) return trimmed;

    try {
        const u = new URL(trimmed);
        const protocol = u.protocol.toLowerCase();
        // Whitelist protocols
        // http, https, ftp, mailto, tel
        // obsidian, zotero, onenote, notion (productivity tools)
        // browser-local bookmark protocols used by users
        const allowed = [
            'http:', 'https:', 'ftp:', 'mailto:', 'tel:',
            'obsidian:', 'zotero:', 'onenote:', 'notion:', 'vscode:', 'raycast:',
            'chrome:', 'edge:', 'file:', 'chrome-extension:'
        ];
        if (allowed.includes(protocol)) return trimmed;

        // Block javascript, data, vbscript
        return `unsafe:${trimmed}`;
    } catch (_) {
        // If URL parsing fails, it might be a relative path or weird string.
        // Check for javascript: explictly
        if (/^\s*(javascript|vbscript|data):/i.test(trimmed)) {
            return `unsafe:${trimmed}`;
        }
        return trimmed; // Return as is (maybe relative path)
    }
}

/**
 * Parse the current JSON Obsidian bookmark tree payload.
 */
function __parseMarkdownAuto(content) {
    if (!content || typeof content !== 'string') return [];

    const trimmed = content.trim();
    const extractedJson = __extractCanvasSectionJsonCodeBlock(trimmed);
    if (extractedJson && extractedJson.jsonProtocol) {
        console.log('[Canvas Import] Detected JSON Mode (code block)');
        if (extractedJson.jsonProtocol.sectionType === 'temporary' && Array.isArray(extractedJson.jsonProtocol.items)) {
            return extractedJson.jsonProtocol.items;
        }
        if (extractedJson.jsonProtocol.sectionType === 'permanent') {
            // Snapshot-import path: convert permanent identityMap tags into inline item.tags
            // so permanent->temporary downgrade keeps tag semantics.
            const tagMapByNodeId = new Map();
            const identityMap = Array.isArray(extractedJson.jsonProtocol.identityMap)
                ? extractedJson.jsonProtocol.identityMap
                : [];
            identityMap.forEach((entry) => {
                if (!entry || typeof entry !== 'object') return;
                const nodeId = String(entry.syncId || entry.id || '').trim();
                const tags = __normalizeTagArrayInput(Array.isArray(entry.tags) ? entry.tags : []);
                if (!nodeId || !tags.length) return;
                tagMapByNodeId.set(nodeId, tags);
            });
            return __buildBookmarkItemsFromProtocolTree(extractedJson.jsonProtocol.tree, {
                tagMapByNodeId
            });
        }
        return __buildBookmarkItemsFromProtocolTree(extractedJson.jsonProtocol.tree);
    }

    console.warn('[Canvas Import] Unsupported bookmark tree payload; current versions only accept JSON compatibility structure.');
    return [];
}

function __convertImportedTreeItemsToBookmarkSnapshotNodes(items) {
    const list = Array.isArray(items) ? items : [];

    const walk = (nodes) => {
        const output = [];
        const input = Array.isArray(nodes) ? nodes : [];
        input.forEach((node) => {
            if (!node || typeof node !== 'object') return;
            const title = String(node.title || node.name || '').trim();
            const url = String(node.url || '').trim();

            if (url) {
                output.push({
                    title: title || url,
                    url
                });
                return;
            }

            const children = walk(node.children || node.items || []);
            output.push({
                title: title || 'Folder',
                children
            });
        });
        return output;
    };

    return walk(list);
}

function __buildBookmarkTreeSnapshotFromPermanentMarkdown(contentToParse, rootMeta = null) {
    const body = String(contentToParse || '').replace(/\r\n?/g, '\n').trim();
    if (!body) return null;

    const extractedJson = __extractCanvasSectionJsonCodeBlock(body);
    if (extractedJson && extractedJson.jsonProtocol && extractedJson.jsonProtocol.sectionType === 'permanent') {
        return __buildBookmarkTreeSnapshotFromPermanentJsonProtocol(extractedJson.jsonProtocol);
    }

    const lines = body.split('\n');
    const sections = [];
    let currentTitle = '';
    let currentLines = [];

    const flush = () => {
        const title = String(currentTitle || '').trim();
        if (!title) return;
        sections.push({
            title,
            body: currentLines.join('\n').trim()
        });
    };

    lines.forEach((line) => {
        const m = String(line || '').match(/^##\s+(.+?)\s*$/);
        if (m) {
            flush();
            currentTitle = m[1];
            currentLines = [];
            return;
        }
        if (!currentTitle) return;
        currentLines.push(line);
    });
    flush();

    if (!sections.length) {
        return null;
    }

    const normalizedRootMeta = __normalizePermanentRootMeta(rootMeta);
    const sectionKeyMap = new Map();
    const rootDescriptors = Array.isArray(normalizedRootMeta && normalizedRootMeta.rootDescriptors)
        ? normalizedRootMeta.rootDescriptors
        : [];
    const descriptorBuckets = new Map();
    const usedDescriptorIndexes = new Set();
    const standardRoots = normalizedRootMeta && normalizedRootMeta.standardRoots && typeof normalizedRootMeta.standardRoots === 'object'
        ? normalizedRootMeta.standardRoots
        : {};

    rootDescriptors.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return;
        const normalizedTitle = String(entry.sectionTitle || '').trim().toLowerCase().replace(/\s+/g, ' ').trim();
        if (!normalizedTitle) return;
        if (!descriptorBuckets.has(normalizedTitle)) {
            descriptorBuckets.set(normalizedTitle, []);
        }
        descriptorBuckets.get(normalizedTitle).push({ entry, index });
    });

    Object.keys(standardRoots).forEach((rootKey) => {
        const entry = standardRoots[rootKey];
        if (!entry || entry.present === false) return;
        const resolvedFolderType = __normalizeBookmarkFolderType(entry.folderType || __permanentRootKeyToFolderType(rootKey));
        const sectionTitle = String(entry.sectionTitle || '').trim();
        if (!sectionTitle) return;
        const normalizedTitle = sectionTitle.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!normalizedTitle || sectionKeyMap.has(normalizedTitle)) return;
        sectionKeyMap.set(normalizedTitle, {
            rootKey,
            folderType: resolvedFolderType,
            syncing: __canPersistBookmarkRootSyncing(resolvedFolderType)
                ? __normalizeBookmarkRootSyncing(entry.syncing)
                : null
        });
    });

    const takeDescriptorEntry = (sectionTitle, index) => {
        const normalizedTitle = String(sectionTitle || '').trim().toLowerCase().replace(/\s+/g, ' ').trim();
        const bucket = normalizedTitle ? descriptorBuckets.get(normalizedTitle) : null;
        if (bucket && bucket.length) {
            while (bucket.length) {
                const next = bucket.shift();
                if (!next || usedDescriptorIndexes.has(next.index)) continue;
                usedDescriptorIndexes.add(next.index);
                return next.entry;
            }
        }
        if (index >= 0 && index < rootDescriptors.length && !usedDescriptorIndexes.has(index)) {
            usedDescriptorIndexes.add(index);
            return rootDescriptors[index];
        }
        return null;
    };

    const rootNodes = sections.map((section, index) => {
        const items = __parseMarkdownAuto(section.body || '');
        const children = __convertImportedTreeItemsToBookmarkSnapshotNodes(items);
        const sectionTitle = String(section.title || '').trim();
        const normalizedTitle = sectionTitle.toLowerCase().replace(/\s+/g, ' ').trim();
        const descriptorEntry = takeDescriptorEntry(sectionTitle, index);
        const metaEntry = descriptorEntry || (normalizedTitle ? sectionKeyMap.get(normalizedTitle) : null);
        const fallbackRootKey = metaEntry ? '' : __normalizePermanentRootTitleKey(sectionTitle);
        const folderType = __normalizeBookmarkFolderType(
            (metaEntry && metaEntry.folderType)
            || __permanentRootKeyToFolderType(metaEntry && metaEntry.rootKey)
            || __permanentRootKeyToFolderType(fallbackRootKey)
        );
        const syncing = __canPersistBookmarkRootSyncing(folderType)
            ? __normalizeBookmarkRootSyncing(metaEntry && metaEntry.syncing)
            : null;
        const rootNode = {
            title: sectionTitle || 'Bookmarks',
            children
        };
        if (folderType) rootNode.folderType = folderType;
        if (syncing !== null) rootNode.syncing = syncing;
        return rootNode;
    }).filter(Boolean);

    return [{
        title: '',
        children: rootNodes
    }];
}

function __rebuildPermanentTreeSnapshotFromSyncFolderFiles(folderFiles) {
    const files = folderFiles instanceof Map ? folderFiles : new Map();
    const fileLookupHelpers = __buildCanvasPackageFileLookupHelpers(files);
    const readFileTextByPath = fileLookupHelpers && typeof fileLookupHelpers.readFileTextByPath === 'function'
        ? fileLookupHelpers.readFileTextByPath
        : () => '';
    const permanentPathCandidates = [];
    const genericCandidates = [];

    for (const [name, bytes] of files.entries()) {
        const path = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/g, '').replace(/\/+/g, '/');
        if (!path || !/\.(md|json)$/i.test(path)) continue;
        if (!(bytes instanceof Uint8Array) || !bytes.length) continue;
        if (__isPermanentMarkdownPath(path)) {
            permanentPathCandidates.push({ path, bytes, sourcePriority: 0 });
            continue;
        }
        genericCandidates.push({ path, bytes, sourcePriority: 1 });
    }

    if (!permanentPathCandidates.length && !genericCandidates.length) {
        return null;
    }

    const isLikelyPermanentPayload = (parsedMarkdown, path = '') => {
        const jsonProtocol = parsedMarkdown && parsedMarkdown.jsonProtocol && typeof parsedMarkdown.jsonProtocol === 'object'
            ? parsedMarkdown.jsonProtocol
            : null;
        if (jsonProtocol && jsonProtocol.sectionType === 'permanent') return true;
        if (__isPermanentMarkdownPath(path)) return true;

        const rootMeta = parsedMarkdown && parsedMarkdown.rootMeta && typeof parsedMarkdown.rootMeta === 'object'
            ? parsedMarkdown.rootMeta
            : null;
        const hasRootMeta = !!(
            rootMeta
            && (
                (Array.isArray(rootMeta.rootDescriptors) && rootMeta.rootDescriptors.length > 0)
                || (rootMeta.standardRoots && typeof rootMeta.standardRoots === 'object' && Object.keys(rootMeta.standardRoots).length > 0)
            )
        );
        if (hasRootMeta) return true;

        const headerLine = String(parsedMarkdown && parsedMarkdown.headerLine || '').trim();
        const hasPermanentSlotHeader = /^#[A-Za-z]+(?:\s+|$)/.test(headerLine);
        const contentToParse = String(parsedMarkdown && parsedMarkdown.contentToParse || '');
        const hasSectionHeading = /^##\s+.+$/m.test(contentToParse);
        return hasPermanentSlotHeader && hasSectionHeading;
    };

    const decodeCandidates = (entries, options = {}) => {
        const decoded = [];
        const requireLikelyPermanent = !!(options && options.requireLikelyPermanent);
        entries
            .slice()
            .sort((left, right) => String(left.path || '').localeCompare(String(right.path || '')))
            .forEach((entry, index) => {
                try {
                    const fileText = new TextDecoder('utf-8').decode(entry.bytes);
                    const parsedMarkdown = __parseCanvasMarkdownPayload(fileText);
                    if (requireLikelyPermanent && !isLikelyPermanentPayload(parsedMarkdown, entry.path)) {
                        return;
                    }
                    decoded.push({
                        path: entry.path,
                        sourcePriority: Number(entry.sourcePriority) || 0,
                        slot: __resolvePermanentSectionSlotForImport(parsedMarkdown, entry.path, index + 1),
                        contentToParse: parsedMarkdown && typeof parsedMarkdown.contentToParse === 'string'
                            ? parsedMarkdown.contentToParse
                            : '',
                        rootMeta: parsedMarkdown && parsedMarkdown.rootMeta ? parsedMarkdown.rootMeta : null
                    });
                } catch (_) { }
            });
        return decoded;
    };

    let decodedCandidates = decodeCandidates(permanentPathCandidates, {
        requireLikelyPermanent: false
    });
    if (!decodedCandidates.length) {
        decodedCandidates = decodeCandidates(genericCandidates, {
            requireLikelyPermanent: true
        });
    }
    if (!decodedCandidates.length) {
        decodedCandidates = decodeCandidates(
            permanentPathCandidates.concat(genericCandidates),
            { requireLikelyPermanent: true }
        );
    }
    if (!decodedCandidates.length) {
        return null;
    }

    decodedCandidates = decodedCandidates
        .sort((left, right) => {
            const leftPriority = Number(left && left.sourcePriority) || 0;
            const rightPriority = Number(right && right.sourcePriority) || 0;
            if (leftPriority !== rightPriority) return leftPriority - rightPriority;
            const leftSlot = Number(left && left.slot) || Number.MAX_SAFE_INTEGER;
            const rightSlot = Number(right && right.slot) || Number.MAX_SAFE_INTEGER;
            if (leftSlot !== rightSlot) return leftSlot - rightSlot;
            return String(left && left.path || '').localeCompare(String(right && right.path || ''));
        });

    const tryBuildFromEntry = (entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const resolvedContentToParse = __resolveCanvasMarkdownEmbeddedContent(
            entry.contentToParse || '',
            entry.path || '',
            readFileTextByPath
        );
        const snapshotTree = __buildBookmarkTreeSnapshotFromPermanentMarkdown(resolvedContentToParse, entry.rootMeta || null);
        return snapshotTree || null;
    };

    for (const entry of decodedCandidates) {
        if (Number(entry.slot) !== 1) continue;
        const snapshotTree = tryBuildFromEntry(entry);
        if (snapshotTree) return snapshotTree;
    }

    for (const entry of decodedCandidates) {
        const snapshotTree = tryBuildFromEntry(entry);
        if (snapshotTree) return snapshotTree;
    }

    return null;
}

function __toUint8(text) {
    return new TextEncoder().encode(String(text || ''));
}

const __crc32Table = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function __crc32(bytes) {
    let crc = 0 ^ -1;
    for (let i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ __crc32Table[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
}

function __zipStore(files) {
    // files: Array<{ name: string, data: Uint8Array }>
    const parts = [];
    const central = [];
    let offset = 0;

    const writeU16 = (v) => {
        const b = new Uint8Array(2);
        new DataView(b.buffer).setUint16(0, v, true);
        return b;
    };
    const writeU32 = (v) => {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setUint32(0, v >>> 0, true);
        return b;
    };

    const dosTime = 0;
    const dosDate = 0;
    const gpFlag = 0x0800; // UTF-8
    const method = 0; // store

    files.forEach((f) => {
        const name = String(f.name || '').replace(/^\/+/, '');
        const nameBytes = __toUint8(name);
        const data = f.data instanceof Uint8Array ? f.data : new Uint8Array();
        const crc = __crc32(data);

        const localHeader = [
            writeU32(0x04034b50),
            writeU16(20),
            writeU16(gpFlag),
            writeU16(method),
            writeU16(dosTime),
            writeU16(dosDate),
            writeU32(crc),
            writeU32(data.length),
            writeU32(data.length),
            writeU16(nameBytes.length),
            writeU16(0)
        ];
        parts.push(...localHeader, nameBytes, data);

        const centralHeader = [
            writeU32(0x02014b50),
            writeU16(0x031E),
            writeU16(20),
            writeU16(gpFlag),
            writeU16(method),
            writeU16(dosTime),
            writeU16(dosDate),
            writeU32(crc),
            writeU32(data.length),
            writeU32(data.length),
            writeU16(nameBytes.length),
            writeU16(0),
            writeU16(0),
            writeU16(0),
            writeU16(0),
            writeU32(0),
            writeU32(offset)
        ];
        central.push(...centralHeader, nameBytes);

        const localSize = localHeader.reduce((sum, b) => sum + b.length, 0) + nameBytes.length + data.length;
        offset += localSize;
    });

    const centralSize = central.reduce((sum, b) => sum + b.length, 0);
    const end = [
        writeU32(0x06054b50),
        writeU16(0),
        writeU16(0),
        writeU16(files.length),
        writeU16(files.length),
        writeU32(centralSize),
        writeU32(offset),
        writeU16(0)
    ];

    return new Blob([...parts, ...central, ...end], { type: 'application/zip' });
}

function __sanitizeFilename(name) {
    return (name || '').replace(/[<>:"/\\|?*#\x00-\x1F]/g, '_').replace(/^\.+/, '').trim() || 'Untitled';
}

function __getStableBuiltinBlankSectionFilename(nodeId) {
    const id = String(nodeId || '').trim();
    if (!id) return '';
    if (id === 'md-node-demo-bookmark-guide') return 'Canvas Basics';
    if (id === 'md-node-demo-shortcut-guide') return 'Quick Actions';
    if (id === 'md-node-demo-batch-feature') return 'Features';
    return '';
}

const __OBSIDIAN_SAFE_FILENAME_MAX_BYTES = 120;
const __OBSIDIAN_SAFE_FILENAME_MIN_BASE_BYTES = 24;

function __getUtf8ByteLength(text) {
    if (typeof TextEncoder === 'undefined') {
        return String(text || '').length;
    }
    try {
        return new TextEncoder().encode(String(text || '')).length;
    } catch (_) {
        return String(text || '').length;
    }
}

function __truncateUtf8ByBytes(text, maxBytes) {
    const input = String(text || '');
    if (!input || maxBytes <= 0) return '';
    if (typeof TextEncoder === 'undefined') {
        return input.slice(0, maxBytes);
    }
    try {
        const encoder = new TextEncoder();
        let bytes = 0;
        let output = '';
        for (const ch of input) {
            const size = encoder.encode(ch).length;
            if (bytes + size > maxBytes) break;
            output += ch;
            bytes += size;
        }
        return output;
    } catch (_) {
        return input.slice(0, maxBytes);
    }
}

function __hashFilenameSeed(seed) {
    const input = String(seed || '');
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36).slice(0, 8) || '0';
}

function __normalizeSafeFilenameStem(stem, fallback = 'Untitled') {
    const normalized = __sanitizeFilename(stem).replace(/[. ]+$/g, '').trim();
    if (normalized) return normalized;
    return __sanitizeFilename(fallback).replace(/[. ]+$/g, '').trim() || 'Untitled';
}

function __buildObsidianSafeFilenameStem(name, fallback = 'Untitled', uniqueSeed = '') {
    const base = __normalizeSafeFilenameStem(name, fallback);
    if (__getUtf8ByteLength(base) <= __OBSIDIAN_SAFE_FILENAME_MAX_BYTES) {
        return base;
    }

    const suffix = `_${__hashFilenameSeed(uniqueSeed || name || fallback || base)}`;
    const allowedBytes = Math.max(
        __OBSIDIAN_SAFE_FILENAME_MIN_BASE_BYTES,
        __OBSIDIAN_SAFE_FILENAME_MAX_BYTES - __getUtf8ByteLength(suffix)
    );
    const truncated = __normalizeSafeFilenameStem(__truncateUtf8ByBytes(base, allowedBytes), fallback);
    return `${truncated}${suffix}`;
}

function __appendObsidianFilenameSuffix(stem, uniqueSeed = 'dup') {
    const suffix = `_${__hashFilenameSeed(uniqueSeed)}`;
    const allowedBytes = Math.max(
        __OBSIDIAN_SAFE_FILENAME_MIN_BASE_BYTES,
        __OBSIDIAN_SAFE_FILENAME_MAX_BYTES - __getUtf8ByteLength(suffix)
    );
    const truncated = __normalizeSafeFilenameStem(__truncateUtf8ByBytes(stem, allowedBytes), stem);
    return `${truncated}${suffix}`;
}

function __resolveObsidianExportDataFileExtension(exportFormatInput = 'json') {
    return 'json';
}

function __getPermanentSectionDisplayTitle(isEn) {
    const titleEl = document.getElementById('permanentSectionTitle');
    const titleFromDom = titleEl ? String(titleEl.textContent || '').replace(/\u200B/g, '').trim() : '';
    return titleFromDom || (isEn ? 'Permanent Bookmarks' : '书签树 (永久栏目)');
}

function __buildPermanentSectionMarkdownRelativePath(permanentSlot, isEn, exportFormat = 'json') {
    const slot = __normalizePositiveInt(permanentSlot) || 1;
    const slotLabel = toAlphaLabel(slot) || 'A';
    const folder = isEn ? 'Permanent' : '永久栏目';
    const fixedBaseName = isEn
        ? `${slotLabel}-PermanentBookmarks`
        : `${slotLabel}书签树（永久栏目）`;
    const fileName = __sanitizeFilename(fixedBaseName);
    const fileExt = __resolveObsidianExportDataFileExtension(exportFormat);
    return `${folder}/${fileName}.${fileExt}`;
}

function __normalizeObsidianExportRoot(path, isEn, options = {}) {
    const allowEmpty = !!(options && options.allowEmpty);
    const fallback = isEn ? 'bookmark-canvas' : '书签画布';
    const normalized = String(path == null ? '' : path)
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/\/+/g, '/');
    const migrated = (normalized === 'bookmark-canvas-sync'
        || normalized === 'bookmark-canvas'
        || normalized === '书签画布同步'
        || normalized === '书签画布'
        || normalized === 'Bookmark Canvas')
        ? fallback
        : normalized;
    if (allowEmpty) return migrated;
    return migrated || fallback;
}

function __joinObsidianExportPath(root, rel) {
    const normalizedRoot = String(root || '').replace(/^\/+/, '').replace(/\/+$/, '');
    const normalizedRel = String(rel || '').replace(/^\/+/, '');
    return normalizedRoot ? `${normalizedRoot}/${normalizedRel}` : normalizedRel;
}

const CANVAS_NATIVE_TEXT_SUBTYPE = 'canvas-native-text';
const CANVAS_NATIVE_TEXT_SOURCE = 'obsidian-canvas-text';
const CANVAS_PLUGIN_MARKDOWN_SUBTYPE = 'canvas-markdown-blank';
const CANVAS_PLUGIN_MARKDOWN_SOURCE = 'bookmark-canvas-blank';

function __isCanvasNativeTextNode(node) {
    if (!node || typeof node !== 'object') return false;
    const kind = String(node.canvasTextKind || '').trim().toLowerCase();
    if (kind === 'blank') return false;
    if (kind === 'native') return true;
    const subtype = String(node.subtype || '').trim().toLowerCase();
    const source = String(node.source || '').trim().toLowerCase();
    const hasNativeMarker = subtype === CANVAS_NATIVE_TEXT_SUBTYPE || source === CANVAS_NATIVE_TEXT_SOURCE;
    if (!hasNativeMarker) return false;
    const id = String(node.id || '').trim().toLowerCase();
    if (id.startsWith('md-node-')) return false;
    return true;
}

function __isCanvasPluginMarkdownNode(node) {
    if (!node || typeof node !== 'object') return false;
    const kind = String(node.canvasTextKind || '').trim().toLowerCase();
    if (kind === 'blank') return true;
    const subtype = String(node.subtype || '').trim().toLowerCase();
    const source = String(node.source || '').trim().toLowerCase();
    return subtype === CANVAS_PLUGIN_MARKDOWN_SUBTYPE || source === CANVAS_PLUGIN_MARKDOWN_SOURCE;
}

function __resolveCanvasNativeTextNodeBody(node) {
    if (!node || typeof node !== 'object') return '';
    const directText = String(node.text == null ? '' : node.text);
    if (directText.length) return directText;
    const rawHtml = String(node.html == null ? '' : node.html).trim();
    if (!rawHtml) return '';
    try {
        const div = document.createElement('div');
        div.innerHTML = rawHtml;
        return String(div.innerText || div.textContent || '');
    } catch (_) {
        return '';
    }
}

function __detectCanvasMarkdownExportFormatFromContent(fileText) {
    const parsedMarkdown = __parseCanvasMarkdownPayload(fileText);
    if (parsedMarkdown && parsedMarkdown.jsonProtocol) {
        return 'json';
    }
    const formatHint = __normalizeCanvasObsidianExportFormat(parsedMarkdown && parsedMarkdown.exportFormatHint, '');
    if (formatHint) {
        return formatHint;
    }
    return '';
}

// Export package assembly and zip import helpers moved to import-export-transfer-feature.js

function __resetCanvasDomAndStateForImport() {
    const container = document.getElementById('canvasContent');
    if (container) {
        container.querySelectorAll('.temp-canvas-node').forEach(el => el.remove());
        container.querySelectorAll('.md-canvas-node').forEach(el => el.remove());
    }
    CanvasState.tempSections = [];
    CanvasState.mdNodes = [];
    CanvasState.edges = [];
    CanvasState.tempSectionCounter = 0;
    CanvasState.tempItemCounter = 0;
    CanvasState.colorCursor = 0;
    CanvasState.tempSectionLastColor = getTempSectionDefaultColor();
    CanvasState.tempSectionPrevColor = null;
    CanvasState.mdNodeCounter = 0;
    CanvasState.edgeCounter = 0;
    CanvasState.selectedTempSectionId = null;
    CanvasState.selectedMdNodeId = null;
    CanvasState.selectedEdgeId = null;
    try { hideEdgeToolbar(); } catch (_) { }
    try { clearTempSelection(); } catch (_) { }
    try { clearMdSelection(); } catch (_) { }
}

function __applyImportedTempState(state) {
    if (!state || typeof state !== 'object') throw new Error('导入失败：状态文件无效');
    const normalizedState = __normalizeCanvasTempStateForRuntime(state);
    if (!normalizedState) throw new Error('导入失败：状态文件无效');

    CanvasState.tempSections = Array.isArray(normalizedState.sections) ? normalizedState.sections : [];
    CanvasState.tempSectionCounter = normalizedState.tempSectionCounter || CanvasState.tempSections.length;
    CanvasState.tempItemCounter = normalizedState.tempItemCounter || 0;
    CanvasState.colorCursor = normalizedState.colorCursor || 0;
    CanvasState.tempSectionLastColor = normalizedState.tempSectionLastColor || getTempSectionDefaultColor();
    CanvasState.tempSectionPrevColor = normalizedState.tempSectionPrevColor || null;
    CanvasState.mdNodes = Array.isArray(normalizedState.mdNodes) ? normalizedState.mdNodes : [];
    CanvasState.mdNodeCounter = normalizedState.mdNodeCounter || CanvasState.mdNodes.length || 0;
    CanvasState.edges = Array.isArray(normalizedState.edges) ? normalizedState.edges : [];
    CanvasState.edgeCounter = normalizedState.edgeCounter || CanvasState.edges.length || 0;

    // 区块休眠替代旧休眠：导入时不保留运行态 dormant 标记，避免“空白/隐藏栏目”
    try {
        (CanvasState.tempSections || []).forEach((s) => {
            if (!s || typeof s !== 'object') return;
            if ('dormant' in s) {
                try { delete s.dormant; } catch (_) { s.dormant = false; }
            }
        });
    } catch (_) { }

    const shouldRenderShellOnly = isCanvasVirtualizationEnabled() || isCanvasBlockDormancyEnabled();
    CanvasState.tempSections.forEach(section => {
        try { renderTempNode(section, shouldRenderShellOnly ? { skipTree: true } : {}); } catch (e) { console.warn('[Canvas] 渲染临时栏目失败:', e); }
    });
    CanvasState.mdNodes.forEach(node => {
        try { renderMdNode(node); } catch (e) { console.warn('[Canvas] 渲染空白栏目失败:', e); }
    });
    try { renderEdges(); } catch (_) { }

    // 导入：不重排序号；仅同步全局计数器，保证新建栏目不会复用旧序号
    try { __syncTempSectionSequenceCounterFromExisting(); } catch (_) { }
    try { refreshTempSectionCounters(); } catch (_) { }
    try { __refreshCanvasNodeCounters(); } catch (_) { }
    try { updateCanvasScrollBounds(); } catch (_) { }
    try { updateScrollbarThumbs(); } catch (_) { }
    try { scheduleDormancyUpdate(60); } catch (_) { }
}

function __alphaLabelToNumber(label) {
    const s = String(label || '').trim().toUpperCase();
    if (!s || !/^[A-Z]+$/.test(s)) return null;
    let num = 0;
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        // 'A' => 1 ... 'Z' => 26
        num = (num * 26) + (code - 64);
    }
    return num > 0 ? num : null;
}

function __parseTempSectionLabelAndTitleFromFilename(fileNameNoExt) {
    let name = String(fileNameNoExt || '').trim();
    // Safety check: Strip potential leading '#' if user manually added it or old version data
    if (name.startsWith('#')) name = name.substring(1).trim();

    // [Fix] Restore time format from sanitized filename (e.g. "12_30_45" -> "12:30:45")
    // Applies to basic HH_MM_SS or partial patterns if they look like timestamps
    const restoreTimeFormat = (str) => {
        if (!str) return str;
        return str.replace(/(\d{1,2})_(\d{2})_(\d{2})/g, '$1:$2:$3');
    };

    if (!name) return { label: null, title: '' };

    // Format A: "A-1 Title"
    const spaceMatch = name.match(/^([A-Za-z]+(?:-\d+)+)\s+(.+)$/);
    if (spaceMatch) {
        const label = spaceMatch[1].trim();
        const title = spaceMatch[2].trim();
        return { label: label || null, title: restoreTimeFormat(title) || name };
    }

    // Format B: "A-1" only
    const labelOnlyMatch = name.match(/^([A-Za-z]+(?:-\d+)+)$/);
    if (labelOnlyMatch) {
        const label = labelOnlyMatch[1].trim();
        return { label: label || null, title: '' };
    }

    return { label: null, title: restoreTimeFormat(name) };
}

function __normalizeTempSectionSourceKey(sourceRaw) {
    const source = String(sourceRaw || '').trim().toLowerCase();
    if (!source) return '';
    const normalized = source.replace(/[_\s]+/g, '-').replace(/-+/g, '-');

    if (SPECIAL_TEMP_SOURCE_SET.has(normalized)) return normalized;

    if (normalized === 'drop' || normalized === '拖入' || normalized === '拖放') return 'browser-drop';
    if (normalized === 'search' || normalized === '搜索' || normalized === 'search-results') return 'search-result';
    if (normalized === 'batch' || normalized === '批量') return 'batch';
    if (normalized === 'add' || normalized === 'quickadd' || normalized === '添加') return 'quick-add';
    if (normalized === 'import' || normalized === '导入') return 'file-import';
    if (normalized === 'import-file' || normalized === 'importfile' || normalized === '导入文件') return 'file-import';
    if (normalized === 'import-html' || normalized === 'html-bookmarks' || normalized === '导入html' || normalized === '导入html书签') return 'import-html-bookmarks';
    if (normalized === 'import-json' || normalized === 'json-bookmarks' || normalized === '导入json' || normalized === '导入json书签') return 'import-json-bookmarks';

    return normalized;
}

function __buildTempSectionMarkdownRelativePath(section, safeTitle, isEn, exportFormat = 'json') {
    const tempRoot = isEn ? 'Temporary' : '临时栏目';
    const fileExt = __resolveObsidianExportDataFileExtension(exportFormat);
    if (__isSpecialTempSection(section)) {
        const specialRoot = isEn ? 'Special temporary' : '特殊临时栏目';
        return `${tempRoot}/${specialRoot}/${safeTitle}.${fileExt}`;
    }
    const regularRoot = isEn ? 'General Chain' : '常规链式';
    return `${tempRoot}/${regularRoot}/${safeTitle}.${fileExt}`;
}

function __inferTempSectionSourceFromFilePath(filePath) {
    const normalizedPath = String(filePath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/g, '')
        .replace(/\/+$/g, '');
    if (!normalizedPath) return '';

    const segments = normalizedPath.split('/').filter(Boolean);
    if (!segments.length) return '';

    const tempRootIndex = segments.findIndex(seg => seg === 'Temporary' || seg === 'Temporary Sections' || seg === '临时栏目');
    if (tempRootIndex < 0) return '';

    const lv1 = segments[tempRootIndex + 1] || '';
    const lv2 = segments[tempRootIndex + 2] || '';
    const lv1Lower = lv1.toLowerCase();

    if (lv1Lower === 'general chain' || lv1Lower === 'regular' || lv1 === '常规链式' || lv1 === '普通临时栏目') return '';

    if (lv1Lower === 'special temporary' || lv1Lower === 'special' || lv1 === '特殊临时栏目') {
        const source = __normalizeTempSectionSourceKey(lv2);
        return SPECIAL_TEMP_SOURCE_SET.has(source) ? source : '';
    }

    if (segments.length >= tempRootIndex + 3) {
        const source = __normalizeTempSectionSourceKey(lv1);
        if (SPECIAL_TEMP_SOURCE_SET.has(source)) return source;
    }

    return '';
}

function __inferTempSectionKindFromFilePath(filePath) {
    const normalizedPath = String(filePath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/g, '')
        .replace(/\/+$/g, '');
    if (!normalizedPath) return '';

    const segments = normalizedPath.split('/').filter(Boolean);
    if (!segments.length) return '';

    const tempRootIndex = segments.findIndex(seg => seg === 'Temporary' || seg === 'Temporary Sections' || seg === '临时栏目');
    if (tempRootIndex < 0) return '';

    const lv1 = segments[tempRootIndex + 1] || '';
    const lv1Lower = lv1.toLowerCase();

    if (lv1Lower === 'general chain' || lv1Lower === 'regular' || lv1 === '常规链式' || lv1 === '普通临时栏目') return 'regular';
    if (lv1Lower === 'special temporary' || lv1Lower === 'special' || lv1 === '特殊临时栏目') return 'special';

    return '';
}

function __getSpecialTempSectionLabelBySource(sourceKey, isEn) {
    const source = __normalizeTempSectionSourceKey(sourceKey);
    if (!SPECIAL_TEMP_SOURCE_SET.has(source)) return '';

    const enMap = {
        'browser-drop': 'Drop',
        'search-result': 'Search',
        'batch': 'Batch',
        'quick-add': 'Add',
        'file-import': 'Import File',
        'import-html-bookmarks': 'Import HTML',
        'import-json-bookmarks': 'Import JSON'
    };
    const zhMap = {
        'browser-drop': '拖入',
        'search-result': '搜索',
        'batch': '批量',
        'quick-add': '添加',
        'file-import': '导入文件',
        'import-html-bookmarks': '导入HTML',
        'import-json-bookmarks': '导入JSON'
    };

    return isEn ? (enMap[source] || '') : (zhMap[source] || '');
}

function __parsePermanentSectionSlotFromHeaderLine(headerLine) {
    const header = String(headerLine || '').trim();
    if (!header) return null;
    const match = header.match(/^#([A-Za-z]+)(?:\s+|$)/);
    if (!match) return null;
    return __alphaLabelToNumber(match[1]) || null;
}

function __parsePermanentSectionSlotFromFilename(fileNameNoExt) {
    const name = String(fileNameNoExt || '').trim();
    if (!name) return null;

    let match = name.match(/^#([A-Za-z]+)(?:\s+|$)/);
    if (!match) match = name.match(/\(#([A-Za-z]+)\)/i);
    if (!match) match = name.match(/^([A-Za-z]{1,4})(?![A-Za-z])/);
    if (!match) return null;

    return __alphaLabelToNumber(match[1]) || null;
}

function __resolvePermanentSectionSlotForImport(parsedMarkdown, filePath, fallbackSlot = 1) {
    const headerSlot = __parsePermanentSectionSlotFromHeaderLine(parsedMarkdown && parsedMarkdown.headerLine);
    if (headerSlot) return headerSlot;

    const fileNameNoExt = String(filePath || '').split('/').pop().replace(/\.(md|json)$/i, '');
    const fileSlot = __parsePermanentSectionSlotFromFilename(fileNameNoExt);
    if (fileSlot) return fileSlot;

    const n = parseInt(fallbackSlot, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
}

function __isPermanentMarkdownPath(path) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized) return false;
    if (/(^|\/)(永久栏目|Permanent)(\/|$)/i.test(normalized)) return true;
    if (/Permanent\s*Sections/i.test(normalized)) return true;
    if (/Permanent\s*Bookmarks/i.test(normalized)) return true;
    if (/(^|\/)永久书签(\/|$)/.test(normalized)) return true;
    return false;
}

function __isExportedPermanentCanvasNode(node) {
    if (!node || typeof node !== 'object') return false;
    const nodeId = String(node.id || '').trim();
    if (!nodeId) return false;
    return nodeId === 'permanent-section' || nodeId.startsWith('permanent-section-copy-');
}

function __buildImportedTempSectionFromPermanentMarkdown(node, parsedMarkdown, descriptionHtml, contentToParse, isEn) {
    const jsonProtocol = parsedMarkdown && parsedMarkdown.jsonProtocol && parsedMarkdown.jsonProtocol.sectionType === 'permanent'
        ? parsedMarkdown.jsonProtocol
        : null;
    const headerLine = String(parsedMarkdown && parsedMarkdown.headerLine || '').trim();
    const fallbackTitle = String(node && node.file || '').split('/').pop().replace(/\.(md|json)$/i, '').trim();
    const title = String(
        (jsonProtocol && jsonProtocol.title)
        || headerLine
        || fallbackTitle
        || (isEn ? 'Temp Section' : '临时栏目')
    ).trim() || (isEn ? 'Temp Section' : '临时栏目');
    const protocolInput = {
        sectionMeta: {
            title,
            source: 'obsidian-permanent-reference',
            descriptionMd: String(
                (parsedMarkdown && typeof parsedMarkdown.descriptionMarkdown === 'string')
                    ? parsedMarkdown.descriptionMarkdown
                    : __htmlToMarkdown(descriptionHtml)
            )
        },
        items: __parseMarkdownAuto(contentToParse)
    };

    const restored = __buildRuntimeTempSectionFromProtocol(protocolInput, {
        sectionId: node.id,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        color: convertObsidianColor(node.color) || '#fb464c'
    });
    if (restored) return restored;

    return {
        id: node.id,
        title,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        color: convertObsidianColor(node.color) || '#fb464c',
        items: __parseMarkdownAuto(contentToParse),
        descriptionMd: String(
            (parsedMarkdown && typeof parsedMarkdown.descriptionMarkdown === 'string')
                ? parsedMarkdown.descriptionMarkdown
                : __htmlToMarkdown(descriptionHtml)
        ),
        source: 'obsidian-permanent-reference'
    };
}

function __normalizeCanvasMarkdownPath(path) {
    return String(path || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+/g, '')
        .replace(/\/+/g, '/')
        .replace(/\/+$/g, '');
}

function __buildCanvasMarkdownEmbedLookupCandidates(targetPath, currentFilePath = '') {
    const normalizedTarget = __normalizeCanvasMarkdownPath(targetPath).replace(/\.(md|json)$/i, '');
    if (!normalizedTarget) return [];

    const normalizedCurrentPath = __normalizeCanvasMarkdownPath(currentFilePath);
    const currentDir = normalizedCurrentPath.includes('/')
        ? normalizedCurrentPath.slice(0, normalizedCurrentPath.lastIndexOf('/'))
        : '';

    const candidates = [];
    const seen = new Set();

    const pushCandidate = (value) => {
        const normalized = __normalizeCanvasMarkdownPath(value);
        if (!normalized) return;

        if (!seen.has(normalized)) {
            seen.add(normalized);
            candidates.push(normalized);
        }

        const withMd = /\.(md|json)$/i.test(normalized) ? normalized : `${normalized}.md`;
        if (!seen.has(withMd)) {
            seen.add(withMd);
            candidates.push(withMd);
        }
        const withJson = /\.(md|json)$/i.test(normalized) ? normalized.replace(/\.md$/i, '.json') : `${normalized}.json`;
        if (!seen.has(withJson)) {
            seen.add(withJson);
            candidates.push(withJson);
        }
    };

    pushCandidate(normalizedTarget);
    if (currentDir) {
        pushCandidate(`${currentDir}/${normalizedTarget}`);
        const fileName = normalizedTarget.split('/').pop();
        if (fileName) {
            pushCandidate(`${currentDir}/${fileName}`);
        }
    }

    return candidates;
}

function __parseCanvasMarkdownEmbedReference(line) {
    const match = String(line || '').trim().match(/^!\[\[([^\]]+)\]\]$/);
    if (!match) return null;

    let inner = String(match[1] || '').trim();
    if (!inner) return null;

    const aliasIndex = inner.indexOf('|');
    if (aliasIndex >= 0) {
        inner = inner.slice(0, aliasIndex).trim();
    }
    if (!inner) return null;

    const hashIndex = inner.indexOf('#');
    const targetPath = hashIndex >= 0 ? inner.slice(0, hashIndex).trim() : inner;
    const sectionTitle = hashIndex >= 0 ? inner.slice(hashIndex + 1).trim() : '';
    if (!targetPath) return null;

    return {
        targetPath,
        sectionTitle
    };
}

function __normalizeCanvasMarkdownHeadingKey(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function __extractCanvasMarkdownSectionBody(markdownText, sectionTitle) {
    const body = String(markdownText || '').replace(/\r\n?/g, '\n');
    const targetKey = __normalizeCanvasMarkdownHeadingKey(sectionTitle);
    if (!body.trim() || !targetKey) return '';

    const lines = body.split('\n');
    const collected = [];
    let isInsideSection = false;
    let targetLevel = 0;

    for (const line of lines) {
        const headingMatch = String(line || '').match(/^(#{1,6})\s+(.+?)\s*$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const headingKey = __normalizeCanvasMarkdownHeadingKey(headingMatch[2]);

            if (!isInsideSection) {
                if (headingKey === targetKey) {
                    isInsideSection = true;
                    targetLevel = level;
                }
                continue;
            }

            if (level <= targetLevel) {
                break;
            }
        }

        if (isInsideSection) {
            collected.push(line);
        }
    }

    return isInsideSection ? collected.join('\n').trim() : '';
}

function __resolveCanvasMarkdownEmbeddedContent(contentToParse, currentFilePath, readFileTextByPath) {
    const body = String(contentToParse || '').replace(/\r\n?/g, '\n').trim();
    if (!body || typeof readFileTextByPath !== 'function') return body;

    const embedRefs = body
        .split('\n')
        .map(__parseCanvasMarkdownEmbedReference)
        .filter(Boolean);

    if (!embedRefs.length) {
        return body;
    }

    const resolvedLines = [];
    let resolvedCount = 0;

    embedRefs.forEach((embedRef) => {
        const targetFileText = readFileTextByPath(embedRef.targetPath, currentFilePath);
        if (!targetFileText) return;

        const parsedTarget = __parseCanvasMarkdownPayload(targetFileText);
        if (!embedRef.sectionTitle) {
            const targetBody = String(parsedTarget && parsedTarget.contentToParse || '').trim();
            if (!targetBody) return;
            resolvedLines.push(targetBody);
            resolvedLines.push('');
            resolvedCount += 1;
            return;
        }
        const sectionBody = __extractCanvasMarkdownSectionBody(
            parsedTarget && parsedTarget.contentToParse ? parsedTarget.contentToParse : '',
            embedRef.sectionTitle
        );
        if (!sectionBody) return;

        resolvedLines.push(`## ${embedRef.sectionTitle}`);
        resolvedLines.push(sectionBody);
        resolvedLines.push('');
        resolvedCount += 1;
    });

    if (!resolvedCount) {
        return body;
    }

    return resolvedLines.join('\n').trim();
}

function __buildCanvasPackageFileLookupHelpers(sourceFiles, packageLeaf = '') {
    const files = sourceFiles instanceof Map ? sourceFiles : new Map();
    const normalizePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
    const normalizedLeaf = packageLeaf ? String(packageLeaf).trim() : '';
    const leafSegment = normalizedLeaf ? `${normalizedLeaf}/` : '';

    const findFileBytes = (relPath) => {
        const normalizedRel = normalizePath(relPath);
        if (!normalizedRel) return null;
        if (files.has(normalizedRel)) return files.get(normalizedRel);

        if (leafSegment) {
            const idxRel = normalizedRel.indexOf(leafSegment);
            if (idxRel >= 0) {
                const suffixRel = normalizedRel.slice(idxRel);
                for (const [key, val] of files.entries()) {
                    const normalizedKey = normalizePath(key);
                    const idxKey = normalizedKey.indexOf(leafSegment);
                    if (idxKey >= 0 && normalizedKey.slice(idxKey) === suffixRel) {
                        return val;
                    }
                }
            }
        }

        for (const [key, val] of files.entries()) {
            const normalizedKey = normalizePath(key);
            if (!normalizedKey) continue;
            if (normalizedKey === normalizedRel) return val;
            if (normalizedKey.endsWith(`/${normalizedRel}`) || normalizedRel.endsWith(`/${normalizedKey}`)) return val;
            if (normalizedKey.includes(normalizedRel)) return val;
        }

        // Suffix fallback: strip first segment (e.g. package root folder name) of both paths
        const stripFirstSegment = (p) => {
            const parts = p.split('/');
            return parts.length > 1 ? parts.slice(1).join('/') : p;
        };
        const strippedRel = stripFirstSegment(normalizedRel);
        for (const [key, val] of files.entries()) {
            const normalizedKey = normalizePath(key);
            if (stripFirstSegment(normalizedKey) === strippedRel) return val;
        }

        return null;
    };

    const readFileTextByPath = (targetPath, currentFilePath = '') => {
        const candidates = __buildCanvasMarkdownEmbedLookupCandidates(targetPath, currentFilePath);
        for (const candidate of candidates) {
            const bytes = findFileBytes(candidate);
            if (!bytes) continue;
            try {
                return new TextDecoder('utf-8').decode(bytes);
            } catch (_) { }
        }
        return '';
    };

    return {
        findFileBytes,
        readFileTextByPath
    };
}

function __rebuildTempStateFromObsidianCanvasPackage(canvasData, sourceFiles, primaryState, options = {}) {
    const isEn = !!(options && options.isEn);
    const overwriteMode = !!(options && options.importMode === 'overwrite');
    const tempState = {
        sections: [],
        mdNodes: [],
        edges: [],
        tempSectionCounter: 0,
        mdNodeCounter: 0,
        edgeCounter: 0
    };
    const safePrimaryState = primaryState && typeof primaryState === 'object' ? primaryState : {};
    const { findFileBytes, readFileTextByPath } = __buildCanvasPackageFileLookupHelpers(sourceFiles, options.packageLeaf);
    const nodes = Array.isArray(canvasData && canvasData.nodes) ? canvasData.nodes : [];
    const edges = Array.isArray(canvasData && canvasData.edges) ? canvasData.edges : [];
    let importedPermanentCount = 0;

    nodes.forEach((node) => {
        if (node.type === 'group') {
            const labelRaw = (typeof node.label === 'string') ? node.label : '';
            const convertedColor = convertObsidianColor(node.color);
            const isHex = convertedColor && convertedColor.startsWith('#');

            tempState.mdNodes.push({
                id: node.id,
                type: 'md',
                subtype: 'card-group',
                x: node.x,
                y: node.y,
                width: node.width,
                height: node.height,
                label: labelRaw || (isEn ? 'Card Group' : '卡片组'),
                color: null,
                colorHex: isHex ? convertedColor : null,
                pinned: false
            });
            return;
        }

        if (node.type === 'file' && node.file) {
            const isPermanent = __isPermanentMarkdownPath(node.file);
            const isTempSection = node.file.includes('Temporary/') || node.file.includes('Temporary Sections/') || node.file.includes('临时栏目/');
            const isSpecialBookmark = (isPermanent || isTempSection) && /\.(md|json)$/i.test(String(node.file));

            if (isSpecialBookmark) {
                const fileBytes = findFileBytes(node.file);
                if (fileBytes) {
                    const fileText = new TextDecoder('utf-8').decode(fileBytes);
                    const parsedMarkdown = __parseCanvasMarkdownPayload(fileText);
                    const descriptionHtml = parsedMarkdown.descriptionHtml || '';
                    const contentToParse = parsedMarkdown.contentToParse || '';
                    const isLivePermanentNode = isPermanent && __isExportedPermanentCanvasNode(node);
                    const resolvedContentToParse = isPermanent
                        ? __resolveCanvasMarkdownEmbeddedContent(contentToParse, node.file, readFileTextByPath)
                        : contentToParse;

                    if (isLivePermanentNode) {
                        importedPermanentCount += 1;
                        const resolvedSlot = __resolvePermanentSectionSlotForImport(parsedMarkdown, node.file, importedPermanentCount);
                        try {
                            if (!safePrimaryState.permanentTreeSnapshot && Number(resolvedSlot) === 1) {
                                const snapshotTree = __buildBookmarkTreeSnapshotFromPermanentMarkdown(
                                    resolvedContentToParse,
                                    parsedMarkdown && parsedMarkdown.rootMeta ? parsedMarkdown.rootMeta : null
                                );
                                const normalizedPermanentTreeSnapshot = __normalizePermanentTreeSnapshotForProtocol(snapshotTree);
                                if (normalizedPermanentTreeSnapshot) {
                                    safePrimaryState.permanentTreeSnapshot = normalizedPermanentTreeSnapshot;
                                }
                            }
                        } catch (_) { }

                        if (overwriteMode) {
                            return;
                        }

                        const items = __parseMarkdownAuto(resolvedContentToParse);
                        const sectionId = node.id;
                        const slotLabel = toAlphaLabel(resolvedSlot) || '';
                        const suffix = slotLabel ? ` (#${slotLabel})` : '';
                        const dateStr = new Date().toISOString().slice(0, 10);
                        const snapshotTitle = isEn
                            ? `[Snapshot] Permanent Sections (${dateStr})${suffix}`
                            : `[快照] 永久栏目 (${dateStr})${suffix}`;

                        tempState.sections.push({
                            id: sectionId,
                            title: snapshotTitle,
                            x: node.x,
                            y: node.y,
                            width: node.width,
                            height: node.height,
                            color: convertObsidianColor(node.color) || '#44cf6e',
                            items,
                            descriptionMd: String(
                                (parsedMarkdown && typeof parsedMarkdown.descriptionMarkdown === 'string')
                                    ? parsedMarkdown.descriptionMarkdown
                                    : __htmlToMarkdown(descriptionHtml)
                            ),
                            isSnapshot: true
                        });
                        return;
                    }

                    if (isPermanent) {
                        if (overwriteMode) {
                            return;
                        }
                        tempState.sections.push(
                            __buildImportedTempSectionFromPermanentMarkdown(node, parsedMarkdown, descriptionHtml, resolvedContentToParse, isEn)
                        );
                        return;
                    }

                    if (isTempSection) {
                        tempState.sections.push(
                            __buildImportedTempSectionFromJsonMarkdown(node, parsedMarkdown, contentToParse, isEn)
                        );
                        return;
                    }
                }
                return;
            }

            // Fallback for unrecognized/unsupported file nodes (like .mp4 or notes outside sync paths)
            const convertedColor = convertObsidianColor(node.color);
            const isHex = convertedColor && convertedColor.startsWith('#');
            tempState.mdNodes.push({
                id: node.id,
                x: node.x,
                y: node.y,
                width: node.width,
                height: node.height,
                color: isHex ? null : node.color,
                colorHex: isHex ? convertedColor : null,
                file: String(node.file),
                type: 'file'
            });
            return;
        }

        if (node.type === 'text') {
            const convertedColor = convertObsidianColor(node.color);
            const isHex = convertedColor && convertedColor.startsWith('#');
            const isBlankCard = node.id && String(node.id).startsWith('md-node-');
            tempState.mdNodes.push({
                id: node.id,
                x: node.x,
                y: node.y,
                width: node.width,
                height: node.height,
                color: isHex ? null : node.color,
                colorHex: isHex ? convertedColor : null,
                text: String(node.text || ''),
                subtype: isBlankCard ? CANVAS_PLUGIN_MARKDOWN_SUBTYPE : CANVAS_NATIVE_TEXT_SUBTYPE,
                source: isBlankCard ? CANVAS_PLUGIN_MARKDOWN_SOURCE : CANVAS_NATIVE_TEXT_SOURCE,
                canvasTextKind: isBlankCard ? 'blank' : 'native'
            });
        }
    });

    tempState.edges = edges.map((edge) => {
        const convertedColor = convertObsidianColor(edge.color);
        const isHex = convertedColor && convertedColor.startsWith('#');
        return {
            id: edge.id,
            fromNode: edge.fromNode,
            toNode: edge.toNode,
            fromSide: edge.fromSide || '',
            toSide: edge.toSide || '',
            label: edge.label || '',
            color: isHex ? null : edge.color,
            colorHex: isHex ? convertedColor : null
        };
    });

    return tempState;
}

// Canvas package file entry points moved to import-export-transfer-feature.js

function __normalizeImportFolderFilesMap(filesByPath) {
    const output = new Map();
    const normalizePath = (path) => String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');

    const assign = (path, value) => {
        const normalizedPath = normalizePath(path);
        if (!normalizedPath) return;

        let bytes = null;
        if (value instanceof Uint8Array) {
            bytes = value;
        } else if (value instanceof ArrayBuffer) {
            bytes = new Uint8Array(value);
        } else if (typeof value === 'string') {
            bytes = new TextEncoder().encode(value);
        } else if (value && typeof value === 'object') {
            if (value.bytes instanceof Uint8Array) {
                bytes = value.bytes;
            } else if (value.bytes instanceof ArrayBuffer) {
                bytes = new Uint8Array(value.bytes);
            } else if (typeof value.content === 'string') {
                bytes = new TextEncoder().encode(value.content);
            }
        }

        if (!bytes) return;
        output.set(normalizedPath, bytes);
    };

    if (filesByPath instanceof Map) {
        for (const [path, value] of filesByPath.entries()) {
            assign(path, value);
        }
        return output;
    }

    if (filesByPath && typeof filesByPath === 'object') {
        Object.keys(filesByPath).forEach((path) => assign(path, filesByPath[path]));
    }

    return output;
}

function __rebuildPermanentViewShellSnapshotFromSyncFolderFiles(filesByPath) {
    const normalizedFiles = __normalizeImportFolderFilesMap(filesByPath);
    const emptySnapshot = __normalizePermanentViewShellSnapshotProtocol({ version: 1, views: [] });
    if (!normalizedFiles.size) {
        return emptySnapshot;
    }

    const normalizePath = (path) => String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
    const findFileBytes = (relPath) => {
        const normalizedRel = normalizePath(relPath);
        if (!normalizedRel) return null;
        if (normalizedFiles.has(normalizedRel)) return normalizedFiles.get(normalizedRel);

        let bestMatch = null;
        for (const [key, val] of normalizedFiles.entries()) {
            const normalizedKey = normalizePath(key);
            if (!normalizedKey) continue;
            if (normalizedKey.endsWith(normalizedRel)) {
                if (!bestMatch || normalizedKey.length < bestMatch.key.length) {
                    bestMatch = { key: normalizedKey, bytes: val };
                }
            }
        }
        if (bestMatch) return bestMatch.bytes;

        for (const [key, val] of normalizedFiles.entries()) {
            const normalizedKey = normalizePath(key);
            if (!normalizedKey) continue;
            if (normalizedKey.includes(normalizedRel)) return val;
        }
        return null;
    };

    const isPermanentMarkdownPath = (path) => {
        const normalized = normalizePath(path);
        if (!normalized) return false;
        if (/(^|\/)(永久栏目|Permanent)(\/|$)/i.test(normalized)) return true;
        if (/Permanent\s*Sections/i.test(normalized)) return true;
        if (/Permanent\s*Bookmarks/i.test(normalized)) return true;
        if (/(^|\/)永久书签(\/|$)/.test(normalized)) return true;
        return false;
    };

    let canvasData = null;
    for (const [key, bytes] of normalizedFiles.entries()) {
        const normalizedKey = normalizePath(key);
        if (!normalizedKey || !/\.canvas$/i.test(normalizedKey) || !bytes) continue;
        try {
            const text = new TextDecoder('utf-8').decode(bytes);
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.nodes)) {
                canvasData = parsed;
                break;
            }
        } catch (_) { }
    }
    if (!canvasData) {
        return emptySnapshot;
    }

    const toPx = (value) => {
        const n = parseFloat(String(value == null ? '' : value));
        if (!Number.isFinite(n)) return '';
        return `${Math.round(n)}px`;
    };

    const views = [];
    let permanentFallbackIndex = 0;
    const nodes = Array.isArray(canvasData.nodes) ? canvasData.nodes : [];

    nodes.forEach((node) => {
        if (!node || node.type !== 'file') return;
        const nodeId = String(node.id || '').trim();
        const filePath = String(node.file || '').trim();
        if (!nodeId || !filePath || !/\.(md|json)$/i.test(filePath)) return;
        if (!isPermanentMarkdownPath(filePath) || !__isExportedPermanentCanvasNode(node)) return;

        const fileBytes = findFileBytes(filePath);
        const fileText = fileBytes ? new TextDecoder('utf-8').decode(fileBytes) : '';
        const parsedMarkdown = __parseCanvasMarkdownPayload(fileText);
        permanentFallbackIndex += 1;
        const slot = __resolvePermanentSectionSlotForImport(parsedMarkdown, filePath, permanentFallbackIndex);
        const slotNumber = Number.isFinite(slot) && slot > 0 ? slot : 1;
        const rawDescSource = parsedMarkdown && typeof parsedMarkdown.descriptionMarkdown === 'string'
            ? parsedMarkdown.descriptionMarkdown
            : ((parsedMarkdown && typeof parsedMarkdown.descriptionHtml === 'string')
                ? __htmlToMarkdown(parsedMarkdown.descriptionHtml)
                : '');
        const descriptionMd = String(rawDescSource == null ? '' : rawDescSource);
        const cardState = {
            left: toPx(node.x),
            top: toPx(node.y),
            width: toPx(node.width),
            height: toPx(node.height)
        };

        if (nodeId === 'permanent-section' || slotNumber === 1) {
            views.push({
                copyId: null,
                descriptionMd,
                cardState
            });
            return;
        }

        const copyId = nodeId.startsWith('permanent-section-copy-')
            ? nodeId.slice('permanent-section-copy-'.length)
            : '';
        if (!copyId) return;

        views.push({
            copyId,
            displayIndex: Math.max(1, slotNumber - 1),
            descriptionMd,
            cardState
        });
    });

    return __normalizePermanentViewShellSnapshotProtocol({
        version: 1,
        views
    }, {
        preserveDescriptionRaw: true
    });
}

/**
 * 沙箱导入核心处理逻辑
 * 被 importCanvasPackageZip 和 importCanvasPackageFolder 共同使用
 * @param {Object} tempState - 临时栏目状态数据
 * @param {Object} storage - 存储数据（滚动位置等）
 * @param {Object} primaryState - 原始状态对象（用于获取书签树快照等）
 * @param {string} [importFileName] - 导入的文件名
 * @param {Object} [importMeta] - 审计上下文（source/trigger）
 */
function __processImportedPackage(tempState, storage, primaryState, importFileName = '', importMeta = null) {
    const { isEn } = __getLang();
    const importMode = __getCanvasImportRuntimeMode();
    const normalizedImportMeta = (importMeta && typeof importMeta === 'object') ? importMeta : {};
    try {
        if (__isCanonicalImportShadowAuditEnabled()) {
            __runCanonicalImportShadowAudit('manual-import', tempState, storage, primaryState, {
                source: (typeof normalizedImportMeta.source === 'string' && normalizedImportMeta.source.trim())
                    ? normalizedImportMeta.source.trim()
                    : 'unknown',
                trigger: (typeof normalizedImportMeta.trigger === 'string' && normalizedImportMeta.trigger.trim())
                    ? normalizedImportMeta.trigger.trim()
                    : 'manual-import'
            });
        }
    } catch (_) { }

    // 不再覆盖localStorage，而是直接进行沙箱导入
    // localStorage.setItem(TEMP_SECTION_STORAGE_KEY, JSON.stringify(tempState));

    // 1. Conflict Resolution & ID Remapping
    // We must remap ALL IDs in the imported state to prevent collision with existing nodes.
    // Also converts the imported "permanent-section" into a "Snapshot Temp Section".
    const { remappedNodes, remappedEdges, remappedScrolls } = __remapImportedData(tempState, storage, primaryState);
    // 2. Calculate Bounding Box of the imported batch
    const bounds = __calculateNodesBoundingBox(remappedNodes);
    const requestedCanvasPosition = (() => {
        const source = normalizedImportMeta && normalizedImportMeta.canvasPosition && typeof normalizedImportMeta.canvasPosition === 'object'
            ? normalizedImportMeta.canvasPosition
            : null;
        if (!source) return null;
        const left = Number(Object.prototype.hasOwnProperty.call(source, 'left') ? source.left : source.x);
        const top = Number(Object.prototype.hasOwnProperty.call(source, 'top') ? source.top : source.y);
        if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
        return { left, top };
    })();

    // 3. Find "Empty Space" near current viewport (guarantee non-overlap)
    const workspace = document.getElementById('canvasWorkspace');
    const workspaceRect = workspace ? workspace.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
    const zoom = (CanvasState.zoom && CanvasState.zoom > 0) ? CanvasState.zoom : 1;
    const panX = CanvasState.panOffsetX || 0;
    const panY = CanvasState.panOffsetY || 0;

    // 4. Create the "Group Container"
    const PADDING = 60;
    // 使用传入的文件名作为标题
    const containerLabel = importFileName || (isEn
        ? `📦 Imported Package(${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()})`
        : `📦 导入的包(${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()})`);

    const getRuntimeRect = (node) => {
        if (!node) return null;
        const x = Number(node.x);
        const y = Number(node.y);
        const w = Number(node.width) || 300;
        const h = Number(node.height) || 300;
        if (![x, y, w, h].every(v => Number.isFinite(v))) return null;
        return { x, y, w, h };
    };
    const rectFullyInside = (inner, outer, margin = 0) => {
        if (!inner || !outer) return false;
        const m = Number.isFinite(Number(margin)) ? Number(margin) : 0;
        return (
            inner.x >= outer.x + m &&
            inner.y >= outer.y + m &&
            inner.x + inner.w <= outer.x + outer.w - m &&
            inner.y + inner.h <= outer.y + outer.h - m
        );
    };
    const explicitContainerGroup = (() => {
        const mdNodes = Array.isArray(remappedNodes.mdNodes) ? remappedNodes.mdNodes : [];
        const groups = mdNodes.filter((node) => node && node.subtype === 'card-group');
        if (!groups.length) return null;
        const tempSections = Array.isArray(remappedNodes.tempSections) ? remappedNodes.tempSections : [];
        const candidates = groups.filter((group) => {
            const groupRect = getRuntimeRect(group);
            if (!groupRect) return false;
            const children = [
                ...tempSections,
                ...mdNodes.filter((node) => node && node.id !== group.id)
            ];
            return children.every((node) => rectFullyInside(getRuntimeRect(node), groupRect, 0));
        });
        if (!candidates.length) return null;
        candidates.sort((a, b) => {
            const ar = getRuntimeRect(a);
            const br = getRuntimeRect(b);
            const aa = ar ? ar.w * ar.h : 0;
            const ba = br ? br.w * br.h : 0;
            return ba - aa;
        });
        return candidates[0] || null;
    })();
    const useExplicitContainerGroup = !!explicitContainerGroup;
    const explicitContainerRect = useExplicitContainerGroup ? getRuntimeRect(explicitContainerGroup) : null;
    const containerWidth = useExplicitContainerGroup && explicitContainerRect
        ? explicitContainerRect.w
        : bounds.width + (PADDING * 2);
    const containerHeight = useExplicitContainerGroup && explicitContainerRect
        ? explicitContainerRect.h
        : bounds.height + (PADDING * 2);

    const viewportRightCanvasX = (workspaceRect.width - panX) / zoom;
    const viewportCenterCanvasY = (workspaceRect.height / 2 - panY) / zoom;

    const getNodeRect = (node) => {
        if (!node || !node.id) return null;
        const x = Number(node.x);
        const y = Number(node.y);
        let w = Number(node.width);
        let h = Number(node.height);
        const el = document.getElementById(node.id);
        if (el) {
            const ew = el.offsetWidth;
            const eh = el.offsetHeight;
            if (typeof ew === 'number' && isFinite(ew) && ew > 0) w = ew;
            if (typeof eh === 'number' && isFinite(eh) && eh > 0) h = eh;
        }
        if (![x, y, w, h].every(v => typeof v === 'number' && isFinite(v))) return null;
        return { x, y, w, h };
    };

    const padPx = 18;
    const pad = padPx / zoom;
    const overlaps = (ax, ay, aw, ah, bx, by, bw, bh) => {
        if (![ax, ay, aw, ah, bx, by, bw, bh].every(v => typeof v === 'number' && isFinite(v))) return false;
        return !(
            ax + aw + pad <= bx ||
            bx + bw + pad <= ax ||
            ay + ah + pad <= by ||
            by + bh + pad <= ay
        );
    };

    const collidesWithExistingGroups = (x, y, w, h) => {
        const nodes = Array.isArray(CanvasState.mdNodes) ? CanvasState.mdNodes : [];
        for (const n of nodes) {
            if (!n || n.subtype !== 'card-group') continue;
            const r = getNodeRect(n);
            if (!r) continue;
            if (overlaps(x, y, w, h, r.x, r.y, r.w, r.h)) return true;
        }
        return false;
    };

    // Keep spacing constant in screen pixels across zoom levels
    const screenSpacingPx = 160;
    const baseX = viewportRightCanvasX + (screenSpacingPx / zoom);
    const baseY = viewportCenterCanvasY - (bounds.height / 2);

    // We solve for "bounds.minX after offset" (targetBoundsMinX),
    // then container will be at (targetBoundsMinX - PADDING).
    const tryFindBoundsMinXMinY = () => {
        const xMultipliers = [0, 1, 2, 3, 4, 5, 6, 7];
        const yMultipliers = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];

        const stepX = Math.max(bounds.width + (screenSpacingPx / zoom), (workspaceRect.width / zoom) * 0.25);
        const stepY = Math.max(bounds.height * 0.7 + (screenSpacingPx / zoom) * 0.5, (workspaceRect.height / zoom) * 0.18);

        for (let xi = 0; xi < xMultipliers.length; xi++) {
            for (let yi = 0; yi < yMultipliers.length; yi++) {
                const targetBoundsMinX = baseX + xMultipliers[xi] * stepX;
                const targetBoundsMinY = baseY + yMultipliers[yi] * stepY;
                const containerX = targetBoundsMinX - PADDING;
                const containerY = targetBoundsMinY - PADDING;
                if (!collidesWithExistingGroups(containerX, containerY, containerWidth, containerHeight)) {
                    return { targetBoundsMinX, targetBoundsMinY };
                }
            }
        }
        return null;
    };

    const found = requestedCanvasPosition
        ? {
            targetBoundsMinX: requestedCanvasPosition.left + (useExplicitContainerGroup ? 0 : PADDING),
            targetBoundsMinY: requestedCanvasPosition.top + (useExplicitContainerGroup ? 0 : PADDING)
        }
        : tryFindBoundsMinXMinY();
    const targetBoundsMinX = found ? found.targetBoundsMinX : baseX;
    const targetBoundsMinY = found ? found.targetBoundsMinY : baseY;

    // Calculate offset to move the batch near the viewport
    const offsetX = targetBoundsMinX - bounds.minX;
    const offsetY = targetBoundsMinY - bounds.minY;

    const containerNode = useExplicitContainerGroup
        ? explicitContainerGroup
        : {
            id: `card-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'md',
            subtype: 'card-group',
            x: (targetBoundsMinX - PADDING),
            y: (targetBoundsMinY - PADDING),
            width: containerWidth,
            height: containerHeight,
            label: containerLabel,
            color: null,
            pinned: false
        };

    // 5. Apply Offset to all imported nodes
    remappedNodes.tempSections.forEach(s => { s.x += offsetX; s.y += offsetY; });
    remappedNodes.mdNodes.forEach(n => { n.x += offsetX; n.y += offsetY; });
    // 临时导入沙箱模式已下线：导入内容一律作为正式内容处理并持久化。

    console.log(`[Canvas] Import Stats:
        - Sections: ${remappedNodes.tempSections.length}
        - MdNodes: ${remappedNodes.mdNodes.length}
        - Edges: ${remappedEdges.length}
        - Offset: (${offsetX}, ${offsetY})`);

    // 6. Merge into CanvasState
    CanvasState.tempSections.push(...remappedNodes.tempSections);
    // Put generated container FIRST so it renders at the bottom (DOM order).
    // If the imported package already contains one real JsonCanvas group wrapping all members,
    // reuse that group instead of creating a second wrapper.
    if (!useExplicitContainerGroup) {
        CanvasState.mdNodes.unshift(containerNode);
    }
    CanvasState.mdNodes.push(...remappedNodes.mdNodes);
    CanvasState.edges.push(...remappedEdges);

    // 导入：不重排序号；仅同步全局计数器，保证新建栏目不会复用旧序号
    try { __syncTempSectionSequenceCounterFromExisting(); } catch (_) { }

    // 7. Restore Scrolls (Mapped to new IDs)
    Object.keys(remappedScrolls).forEach(scKey => {
        try {
            saveSharedState(scKey, remappedScrolls[scKey]);
        } catch (_) { }
    });

    // 8. Render & Persistence
    // 只渲染本次导入新增的节点（避免每次导入都重建全量 DOM）
    const useVirtual = isCanvasVirtualizationEnabled();
    remappedNodes.tempSections.forEach(s => {
        try { renderTempNode(s, useVirtual ? { skipTree: true } : {}); } catch (_) { }
    });
    if (!useExplicitContainerGroup) {
        try { renderMdNode(containerNode); } catch (_) { }
    }
    remappedNodes.mdNodes.forEach(n => {
        try { renderMdNode(n); } catch (_) { }
    });

    // 导入属于正式内容，必须立即持久化，避免用户导入后立刻刷新导致丢失。
    saveTempNodes({ immediate: true, skipValidation: true });

    // 边：大数据/极限模式下延后或跳过，优先保证交互流畅
    try { scheduleEdgesRender(); } catch (_) { }
    try { scheduleBoundsUpdate(); } catch (_) { }

    // 9. Auto-Pan to the new group (镜头跟随)
    const cx = containerNode.x + containerNode.width / 2;
    const cy = containerNode.y + containerNode.height / 2;
    // Zoom out slightly to see the whole package if it's big
    const fitZoom = Math.min(1, (window.innerWidth - 100) / containerNode.width);
    const z = Math.max(0.2, Math.min(1, fitZoom));

    setCanvasZoom(z, cx, cy, { recomputeBounds: false }); // Set zoom first
    CanvasState.panOffsetX = (window.innerWidth / 2) - (cx * z);
    CanvasState.panOffsetY = (window.innerHeight / 2) - (cy * z);
    updateCanvasScrollBounds();
    savePanOffsetThrottled();
    // 导入后按需加载一次（只加载视口附近少量栏目）
    try { scheduleCanvasVirtualizationUpdate(60); } catch (_) { }

    // Snapshot-package import appends new sections/nodes in-place (no full overwrite teardown).
    // Tag UI uses cached indexes + dot injection, so trigger a lightweight refresh pass here.
    try {
        const refreshAllTagDots = () => {
            try {
                if (typeof window !== 'undefined' && typeof window.__refreshAllTagDots === 'function') {
                    window.__refreshAllTagDots();
                }
            } catch (_) { }
        };
        if (typeof window !== 'undefined' && window.TagSystem && typeof window.TagSystem.ensurePermTagsLoaded === 'function') {
            window.TagSystem.ensurePermTagsLoaded(true).then(refreshAllTagDots).catch(refreshAllTagDots);
        } else {
            refreshAllTagDots();
        }
    } catch (_) { }

    console.log(`[Canvas] Import successful. mode=${importMode}. ID Remapped, Offset applied, Group created.`);
    __setCanvasImportRuntimeMode('permanent');
}

/**
 * 5.1 数据结构适配器 (Adapter Layer)
 * 将 chrome.bookmarks.getTree 返回的数据结构转换为 Canvas 内部的 TempSection items 格式
 * @param {Array} chromeTree - Chrome 书签树 (chrome.bookmarks.getTree 返回值)
 * @returns {Array} Canvas items 格式
 */
function __adaptChromeTreeToCanvasItems(chromeTree, options = {}) {
    if (!chromeTree || !Array.isArray(chromeTree)) return [];
    const tagsBySyncId = options && options.tagsBySyncId instanceof Map
        ? options.tagsBySyncId
        : null;

    const convertNode = (node) => {
        if (!node) return null;
        const nodeId = String(node.id || '').trim();
        const inlineTags = __normalizeTagArrayInput(Array.isArray(node.tags) ? node.tags : []);
        const mappedTags = (!inlineTags.length && tagsBySyncId && nodeId)
            ? __normalizeTagArrayInput(tagsBySyncId.get(nodeId))
            : [];
        const resolvedTags = inlineTags.length ? inlineTags : mappedTags;

        // 书签
        if (node.url) {
            const out = {
                id: `snapshot - ${node.id || Date.now()} - ${Math.random().toString(36).substr(2, 5)}`,
                type: 'bookmark',
                title: node.title || node.name || node.url,
                url: node.url
            };
            if (resolvedTags.length) out.tags = resolvedTags;
            return out;
        }

        // 文件夹
        const children = Array.isArray(node.children)
            ? node.children.map(convertNode).filter(Boolean)
            : [];

        const out = {
            id: `snapshot - ${node.id || Date.now()} - ${Math.random().toString(36).substr(2, 5)}`,
            type: 'folder',
            title: node.title || node.name || 'Folder',
            children: children
        };
        if (resolvedTags.length) out.tags = resolvedTags;
        return out;
    };

    // Chrome 书签树的根节点结构：[{ id: "0", children: [书签栏, 其他书签, ...] }]
    const root = chromeTree[0];
    if (!root || !Array.isArray(root.children)) return [];

    // 返回根节点下的所有子节点（书签栏、其他书签等）
    return root.children.map(convertNode).filter(Boolean);
}

// Helper: Remap all IDs to avoid collisions
function __remapImportedData(tempState, fullStorage, primaryState = {}) {
    const { isEn } = __getLang();
    const idMap = new Map(); // oldId -> newId

    const getNewId = (old) => {
        if (!old) return old; // Return if null/undefined
        if (!idMap.has(old)) idMap.set(old, `imported - ${Date.now()} - ${Math.floor(Math.random() * 100000)}`);
        return idMap.get(old);
    };

    const newTempSections = [];
    const newMdNodes = [];
    const newEdges = [];
    const newScrolls = {};
    const cloneImportedTempItems = (itemsInput) => {
        const cloned = __cloneCanvasProtocolJson(Array.isArray(itemsInput) ? itemsInput : []);
        return Array.isArray(cloned) ? cloned : [];
    };

    const readImportedStorageValue = (keys) => {
        if (!fullStorage || typeof fullStorage !== 'object') return null;
        for (const key of keys) {
            if (typeof key !== 'string' || !key) continue;
            if (!Object.prototype.hasOwnProperty.call(fullStorage, key)) continue;
            const value = fullStorage[key];
            if (typeof value === 'undefined' || value === null) continue;
            return value;
        }
        return null;
    };

    const readImportedPartitionedViewValue = (kind, baseKey) => {
        if (!kind || !baseKey) return null;

        const candidateKeys = [];
        const pushKey = (key) => {
            if (typeof key !== 'string' || !key) return;
            if (!candidateKeys.includes(key)) candidateKeys.push(key);
        };

        const preferredPartition = __getCanvasViewPartitionKey();
        pushKey(__buildCanvasPartitionedViewStateKey(kind, baseKey, preferredPartition));
        pushKey(__buildCanvasPartitionedViewStateKey(kind, baseKey, 'page'));
        pushKey(__buildCanvasPartitionedViewStateKey(kind, baseKey, 'sidepanel'));

        const direct = readImportedStorageValue(candidateKeys);
        if (direct !== null) return direct;

        if (!fullStorage || typeof fullStorage !== 'object') return null;
        const suffix = `:${baseKey}`;
        const dynamicKeys = Object.keys(fullStorage).filter((key) => {
            return typeof key === 'string'
                && key.startsWith(`${CANVAS_VIEW_STATE_STORAGE_NS}:${kind}:`)
                && key.endsWith(suffix);
        });
        return readImportedStorageValue(dynamicKeys);
    };

    const readImportedScrollState = (baseKey) => {
        const raw = readImportedPartitionedViewValue('scroll', baseKey);
        if (raw === null) return null;
        if (typeof raw === 'object') return raw;
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                return (parsed && typeof parsed === 'object') ? parsed : null;
            } catch (_) {
                return null;
            }
        }
        return null;
    };

    const getImportedTempScrollTargetKey = (sectionId) => {
        const baseKey = __getTempSectionScrollBaseKey(sectionId);
        if (!baseKey) return null;
        return __buildCanvasPartitionedViewStateKey('scroll', baseKey);
    };

    const importedPermanentLayout = __collectImportedPermanentLayoutFromStorage(fullStorage);
    const importedPermMainPayload = fullStorage && fullStorage[BCS_PERM_MAIN_KEY] && typeof fullStorage[BCS_PERM_MAIN_KEY] === 'object'
        ? fullStorage[BCS_PERM_MAIN_KEY]
        : (primaryState && primaryState[BCS_PERM_MAIN_KEY] && typeof primaryState[BCS_PERM_MAIN_KEY] === 'object'
            ? primaryState[BCS_PERM_MAIN_KEY]
            : null);
    const importedPermTagsBySyncId = (() => {
        const map = new Map();
        if (!importedPermMainPayload || !Array.isArray(importedPermMainPayload.identityMap)) return map;
        importedPermMainPayload.identityMap.forEach((entry) => {
            if (!entry || typeof entry !== 'object') return;
            const syncId = String(entry.syncId || '').trim();
            const tags = __normalizeTagArrayInput(Array.isArray(entry.tags) ? entry.tags : []);
            if (!syncId || !tags.length) return;
            map.set(syncId, tags);
        });
        return map;
    })();
    const toNumber = (value, fallback) => {
        const parsed = parseFloat(String(value == null ? '' : value));
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    // 1. Handle Permanent Section (Convert to Snapshot - 永久栏目降级策略)
    // 导入包中的"永久栏目"不可覆盖浏览器真实书签
    // 它将自动转换为一个"快照临时栏目"
    if (importedPermanentLayout && importedPermanentLayout.main) {
        const permPos = importedPermanentLayout.main;
        const snapshotId = getNewId('permanent-section');

        let snapshotItems = [];
        if (primaryState && primaryState.permanentTreeSnapshot) {
            const bookmarkTree = primaryState.permanentTreeSnapshot;
            snapshotItems = __adaptChromeTreeToCanvasItems(bookmarkTree, {
                tagsBySyncId: importedPermTagsBySyncId
            });
        }

        const dateStr = new Date().toISOString().slice(0, 10);
        const slotLabel = toAlphaLabel(1) || 'A';
        const snapshotTitle = isEn
            ? `[Snapshot] Permanent Sections (${dateStr}) (#${slotLabel})`
            : `[快照] 永久栏目 (${dateStr}) (#${slotLabel})`;
        const originalTip = (fullStorage && fullStorage[PERMANENT_MAIN_TIP_STORAGE_KEY]) || '';

        newTempSections.push({
            id: snapshotId,
            title: snapshotTitle,
            x: toNumber(permPos.left, 0),
            y: toNumber(permPos.top, 0),
            width: toNumber(permPos.width, 600),
            height: toNumber(permPos.height, 600),
            color: '#44cf6e',
            items: cloneImportedTempItems(snapshotItems),
            descriptionMd: __normalizePermanentViewDescriptionMarkdown(originalTip),
            isSnapshot: true
        });

        const importedPermanentScroll = readImportedScrollState(PERMANENT_SECTION_SCROLL_KEY);
        const snapshotScrollKey = getImportedTempScrollTargetKey(snapshotId);
        if (importedPermanentScroll && snapshotScrollKey) {
            newScrolls[snapshotScrollKey] = importedPermanentScroll;
        }
    }

    // 1.1 Handle Permanent Section Copies (Convert to Snapshot - 永久栏目副本降级策略)
    // 副本同样不可覆盖浏览器真实书签，因此导入时也转换为“快照临时栏目”
    if (importedPermanentLayout && Array.isArray(importedPermanentLayout.copies) && importedPermanentLayout.copies.length) {
        let snapshotItems = [];
        if (primaryState && primaryState.permanentTreeSnapshot) {
            try {
                snapshotItems = __adaptChromeTreeToCanvasItems(primaryState.permanentTreeSnapshot, {
                    tagsBySyncId: importedPermTagsBySyncId
                });
            } catch (_) { }
        }

        importedPermanentLayout.copies.forEach((copyPos, idx) => {
            if (!copyPos) return;
            const oldCopyId = String(copyPos.id || '').trim() || `copy-${idx + 1}`;
            const snapshotId = getNewId(`permanent-section-copy:${oldCopyId}`);
            const displayIndex = __normalizePositiveInt(copyPos.displayIndex) || (idx + 1);
            const alphaBadge = toAlphaLabel(displayIndex + 1);
            const dateStr = new Date().toISOString().slice(0, 10);
            const snapshotTitle = isEn
                ? `[Snapshot] Permanent Sections (${dateStr}) (#${alphaBadge})`
                : `[快照] 永久栏目 (${dateStr}) (#${alphaBadge})`;
            const copyTipKey = `${PERMANENT_COPY_TIP_STORAGE_PREFIX}${oldCopyId}`;
            const originalTip = (fullStorage && fullStorage[copyTipKey]) || '';
            const copyCardState = (copyPos.cardState && typeof copyPos.cardState === 'object') ? copyPos.cardState : {};

            newTempSections.push({
                id: snapshotId,
                title: snapshotTitle,
                x: toNumber(copyCardState.left, 0),
                y: toNumber(copyCardState.top, 0),
                width: toNumber(copyCardState.width, 600),
                height: toNumber(copyCardState.height, 600),
                color: '#44cf6e',
                items: cloneImportedTempItems(snapshotItems),
                descriptionMd: __normalizePermanentViewDescriptionMarkdown(originalTip),
                isSnapshot: true
            });

            const oldScrollKey = `${PERMANENT_SECTION_SCROLL_KEY}:${oldCopyId}`;
            const importedCopyScroll = readImportedScrollState(oldScrollKey);
            const snapshotScrollKey = getImportedTempScrollTargetKey(snapshotId);
            if (importedCopyScroll && snapshotScrollKey) {
                newScrolls[snapshotScrollKey] = importedCopyScroll;
            }
        });
    }

    // 2. Remap Temp Sections
    if (Array.isArray(tempState.sections)) {
        tempState.sections.forEach(sec => {
            const newId = getNewId(sec.id);
            const newSec = JSON.parse(JSON.stringify(sec));
            newSec.id = newId;
            // Iterate items to remap internal IDs if needed? 
            // Usually internal item IDs are unique per section. But let's keep them as is.

            newTempSections.push(newSec);

            // Remap scroll
            const oldScrollBaseKey = __getTempSectionScrollBaseKey(sec.id);
            const importedTempScroll = readImportedScrollState(oldScrollBaseKey);
            const targetScrollKey = getImportedTempScrollTargetKey(newId);
            if (importedTempScroll && targetScrollKey) {
                newScrolls[targetScrollKey] = importedTempScroll;
            }
        });
    }

    // 3. Remap Md Nodes
    if (Array.isArray(tempState.mdNodes)) {
        tempState.mdNodes.forEach(node => {
            const newId = getNewId(node.id);
            const newNode = { ...node, id: newId };
            newMdNodes.push(newNode);
        });
    } else {
        console.warn('[Canvas] Import: No mdNodes found in tempState', tempState);
    }

    // 4. Remap Edges
    if (Array.isArray(tempState.edges)) {
        tempState.edges.forEach(edge => {
            const newFrom = idMap.has(edge.fromNode) ? idMap.get(edge.fromNode) : null;
            const newTo = idMap.has(edge.toNode) ? idMap.get(edge.toNode) : null;

            // Only keep edge if both ends exist in the imported set (or maybe connected to existing? No, pure import)
            // If linked to 'permanent-section', it maps to our new snapshot.
            if (newFrom && newTo) {
                const newEdge = { ...edge, id: getNewId(edge.id), fromNode: newFrom, toNode: newTo };
                newEdges.push(newEdge);
            } else {
                console.warn(`[Canvas] Skipping edge ${edge.id}: Ends not found in import batch.From: ${edge.fromNode} -> ${newFrom}, To: ${edge.toNode} -> ${newTo} `);
            }
        });
    } else {
        console.warn('[Canvas] Import: No edges found in tempState');
    }

    return { remappedNodes: { tempSections: newTempSections, mdNodes: newMdNodes }, remappedEdges: newEdges, remappedScrolls: newScrolls };
}

function __calculateNodesBoundingBox(nodesPayload) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const all = [...nodesPayload.tempSections, ...nodesPayload.mdNodes];

    if (all.length === 0) return { minX: 0, minY: 0, width: 800, height: 600 };

    all.forEach(n => {
        const x = parseFloat(n.x) || 0;
        const y = parseFloat(n.y) || 0;
        const w = parseFloat(n.width) || 300;
        const h = parseFloat(n.height) || 300;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + w > maxX) maxX = x + w;
        if (y + h > maxY) maxY = y + h;
    });

    return { minX, minY, width: maxX - minX, height: maxY - minY };
}

function __findCurrentContentRightBound() {
    let maxX = -Infinity;

    // Check Permanent Section
    const perm = document.getElementById('permanentSection');
    if (perm) {
        const rect = perm.getBoundingClientRect(); // This is viewport relative. We need Canvas Coords.
        // Better to check style or saved state
        const left = parseFloat(perm.style.left) || 0;
        const width = perm.offsetWidth || 600;
        if (left + width > maxX) maxX = left + width;
    }

    // Check Temp Sections
    CanvasState.tempSections.forEach(s => {
        const r = s.x + (s.width || 400);
        if (r > maxX) maxX = r;
    });

    // Check Md Nodes
    CanvasState.mdNodes.forEach(n => {
        const r = n.x + (n.width || 300);
        if (r > maxX) maxX = r;
    });

    return maxX === -Infinity ? 100 : maxX;
}

function formatSectionText(section) {
    const lines = [`# ${section.title || '临时栏目'} `, ''];

    const appendItem = (item, depth = 0) => {
        const indent = '  '.repeat(depth);
        if (item.type === 'bookmark') {
            const title = item.title || item.url || '未命名书签';
            const url = item.url || '#';
            lines.push(`${indent} -[${title}](${url})`);
        } else {
            lines.push(`${indent} - ${item.title || '未命名文件夹'} `);
            if (item.children && item.children.length) {
                item.children.forEach(child => appendItem(child, depth + 1));
            }
        }
    };

    section.items.forEach(item => appendItem(item, 0));

    return lines.join('\n');
}

// =============================================================================
// 数据持久化
// =============================================================================


let __canvasTempStateBcsLoadInProgress = false;
let __canvasTempStateBcsWriteTimer = null;
let __canvasTempStateBcsWritePending = null;
let __canvasTempStateBcsWriteWaiters = [];
let __bcsExportRootCache = '';
let __bcsExportFormatCache = '';
let __canvasTempStateRealtimeSyncBound = false;
let __canvasTempStateRealtimeSyncApplying = false;
let __canvasTempStateRealtimeSyncTimer = null;
let __canvasTempStateRealtimeSyncPending = null;
let __canvasTempStateLastSavedTimestamp = 0;
let __canvasTempStateLastAppliedTimestamp = 0;
let __canvasTempStateLastPersistedSignature = '';
let __canvasImportRuntimeMode = 'permanent';

function __setCanvasImportRuntimeMode(mode) {
    void mode;
    __canvasImportRuntimeMode = 'permanent';
}

function __getCanvasImportRuntimeMode() {
    return 'permanent';
}

function __isPermanentCanvasNodeId(nodeId) {
    const id = String(nodeId || '').trim();
    return !!(id && (id === 'permanent-section' || id.startsWith('permanent-section-copy-')));
}

function __buildPersistedCanvasState(state, options = {}) {
    const safe = (state && typeof state === 'object') ? state : {};
    const preserveRaw = !!(options && options.preserveRaw === true);

    const sourceSections = Array.isArray(safe.sections) ? safe.sections : [];
    const sourceMdNodes = Array.isArray(safe.mdNodes) ? safe.mdNodes : [];
    const sourceEdges = Array.isArray(safe.edges) ? safe.edges : [];

    const persistedSections = sourceSections
        .map((section) => {
            const cloned = __cloneCanvasProtocolJson(section);
            if (!cloned || typeof cloned !== 'object') return null;
            if (!preserveRaw) {
                cloned.descriptionMd = __normalizeTempSectionDescriptionMarkdown(cloned);
                if (Object.prototype.hasOwnProperty.call(cloned, 'description')) {
                    delete cloned.description;
                }
            }
            return cloned;
        })
        .filter(Boolean);
    const persistedMdNodes = sourceMdNodes
        .map((node) => {
            const cloned = __cloneCanvasProtocolJson(node);
            if (!cloned || typeof cloned !== 'object') return null;
            if (!preserveRaw) {
                const isGroupNode = cloned.subtype === 'card-group';
                const isFileNode = cloned.type === 'file';
                const isSpecialNode = isGroupNode || isFileNode;
                const markedApi = (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function')
                    ? marked
                    : (typeof window !== 'undefined' && window && window.marked && typeof window.marked.parse === 'function' ? window.marked : null);
                const isMarkedLoaded = !!markedApi;
                const refreshCachesFromMarkdown = !isSpecialNode && !(typeof cloned.html === 'string' && cloned.html.trim());
                if (!isSpecialNode && !(options && options.skipValidation === true)) {
                    __ensureMdNodeMarkdownProtocol(cloned, {
                        refreshCachesFromMarkdown
                    });
                }
                if (!isSpecialNode && __isCanvasNativeTextNode(cloned)) {
                    try { delete cloned.markdownSource; } catch (_) { }
                } else if (!isSpecialNode) {
                    cloned.markdownSource = __normalizeCanvasMarkdownSource(__deriveMdNodeMarkdownSource(cloned));
                }
            }
            return cloned;
        })
        .filter(Boolean);

    let persistedEdges = [];
    if (preserveRaw) {
        persistedEdges = sourceEdges
            .map((edge) => __cloneCanvasProtocolJson(edge))
            .filter((edge) => edge && typeof edge === 'object');
    } else {
        const validIds = new Set();
        persistedSections.forEach((section) => {
            if (section && section.id) validIds.add(String(section.id).trim());
        });
        persistedMdNodes.forEach((node) => {
            if (node && node.id) validIds.add(String(node.id).trim());
        });

        persistedEdges = sourceEdges.filter((edge) => {
            if (!edge || typeof edge !== 'object') return false;
            const fromNode = String(edge.fromNode || '').trim();
            const toNode = String(edge.toNode || '').trim();
            if (!fromNode || !toNode) return false;
            const fromValid = validIds.has(fromNode) || __isPermanentCanvasNodeId(fromNode);
            const toValid = validIds.has(toNode) || __isPermanentCanvasNodeId(toNode);
            return fromValid && toValid;
        });
    }

    const persistedState = {
        ...safe,
        sections: persistedSections,
        mdNodes: persistedMdNodes,
        edges: persistedEdges,
        timestamp: (() => {
            const rawTimestamp = Number(safe.timestamp);
            return Number.isFinite(rawTimestamp) && rawTimestamp > 0
                ? rawTimestamp
                : Date.now();
        })()
    };

    return persistedState;
}

function __buildCanvasTempStateSignature(state, options = {}) {
    const persistedState = __buildPersistedCanvasState(state, options);
    if (!persistedState || typeof persistedState !== 'object') return '';
    const comparableState = {
        ...persistedState,
        timestamp: 0
    };
    try {
        return JSON.stringify(comparableState);
    } catch (_) {
        return '';
    }
}


function __collectBcsFileRefsFromState(stateInput, options = {}) {
    const { isEn } = __getLang();
    const exportFormat = __normalizeCanvasObsidianExportFormat(
        (options && typeof options.exportFormat === 'string') ? options.exportFormat : __getBcsExportFormatCached(),
        'json'
    );
    const exportRoot = __normalizeObsidianExportRoot(
        (options && typeof options.exportRoot === 'string') ? options.exportRoot : __getBcsExportRootCached(),
        isEn,
        { allowEmpty: true }
    );

    const state = stateInput && typeof stateInput === 'object' ? stateInput : {};
    const sections = Array.isArray(state.sections) ? state.sections : [];

    const tempSectionPaths = [];
    const tempSectionPathById = {};
    const usedTempRelPaths = new Set();

    sections.forEach((section) => {
        if (!section || !section.id) return;
        const seqLabel = getTempSectionLabel(section);
        const rawTitle = section.title || (isEn ? 'Temp Section' : '临时栏目');
        const fileTitle = seqLabel ? `${seqLabel} ${rawTitle}` : rawTitle;
        const safeTitle = __buildObsidianSafeFilenameStem(
            fileTitle,
            seqLabel || rawTitle || section.id || 'section',
            section.id || fileTitle
        );
        let rel = __buildTempSectionMarkdownRelativePath(section, safeTitle, isEn, exportFormat);
        if (usedTempRelPaths.has(rel)) {
            const slashIndex = rel.lastIndexOf('/');
            const relFolder = slashIndex >= 0 ? rel.slice(0, slashIndex) : '';
            const relFile = slashIndex >= 0 ? rel.slice(slashIndex + 1) : rel;
            const relStem = relFile.replace(/\.(md|json)$/i, '');
            const relExt = /\.json$/i.test(relFile) ? 'json' : 'md';
            const uniqueStem = __appendObsidianFilenameSuffix(relStem, section.id || relStem || 'section');
            const uniqueFile = `${uniqueStem}.${relExt}`;
            rel = relFolder ? `${relFolder}/${uniqueFile}` : uniqueFile;
        }
        usedTempRelPaths.add(rel);
        const path = __joinObsidianExportPath(exportRoot, rel);
        tempSectionPaths.push({ id: section.id, rel, path });
        tempSectionPathById[section.id] = path;
    });

    const permanentMdRel = __buildPermanentSectionMarkdownRelativePath(1, isEn, exportFormat);
    const permanentPath = __joinObsidianExportPath(exportRoot, permanentMdRel);
    const copyFileMap = {};
    try {
        const copies = __ensurePermanentSectionCopyDisplayIndexes();
        if (Array.isArray(copies)) {
            copies.forEach((copy) => {
                const copyId = copy && copy.id;
                const idx = __normalizePositiveInt(copy && copy.displayIndex);
                if (!copyId) return;
                const copyMdRel = __buildPermanentSectionMarkdownRelativePath(idx + 1, isEn, exportFormat);
                copyFileMap[copyId] = copyMdRel;
            });
        }
    } catch (_) { }

    const copyPathById = {};
    Object.keys(copyFileMap).forEach((copyId) => {
        copyPathById[copyId] = __joinObsidianExportPath(exportRoot, copyFileMap[copyId]);
    });

    return {
        exportRoot,
        exportFormat,
        permanentMdRel,
        permanentPath,
        copyFileMap,
        copyPathById,
        tempSectionPaths,
        tempSectionPathById
    };
}

function __buildBcsObsidianPackageFilesFromSnapshot(snapshotInput, options = {}) {
    const snapshot = snapshotInput && typeof snapshotInput === 'object' ? snapshotInput : {};
    const isEn = !!(options && options.isEn);
    const exportFormat = __normalizeCanvasObsidianExportFormat(
        (options && typeof options.exportFormat === 'string') ? options.exportFormat : 'json',
        'json'
    );
    const exportRoot = __normalizeObsidianExportRoot(
        (options && typeof options.exportRoot === 'string') ? options.exportRoot : '',
        isEn,
        { allowEmpty: false }
    );

    const tempState = __buildPersistedCanvasState(
        (snapshot.tempState && typeof snapshot.tempState === 'object') ? snapshot.tempState : {},
        options
    );
    const fileRefs = __collectBcsFileRefsFromState(tempState, { exportRoot, exportFormat });

    const permanentPayload = __buildPermanentMainSyncPayload(snapshot.permMain, {
        idsAlreadySyncIds: !(options && options.idsAlreadySyncIds === false)
    }) || (snapshot.permMain && typeof snapshot.permMain === 'object' ? snapshot.permMain : null);

    if (!permanentPayload || !permanentPayload.tree) {
        throw new Error(isEn ? 'Backup slot missing permanent main content.' : '备份槽缺少永久主体内容。');
    }

    const sectionById = new Map();
    const sections = Array.isArray(tempState.sections) ? tempState.sections : [];
    sections.forEach((section, index) => {
        if (!section || typeof section !== 'object') return;
        const fallbackId = String(section.id || `temp-section-${index + 1}`).trim() || `temp-section-${index + 1}`;
        if (!section.id) section.id = fallbackId;
        sectionById.set(String(section.id), section);
    });

    const slotToIndex = (slotValue) => {
        const slot = String(slotValue || '').trim().toUpperCase().replace(/^#/, '');
        if (!/^[A-Z]$/.test(slot)) return null;
        return slot.charCodeAt(0) - 64;
    };

    const resolveCopyEntries = () => {
        const preferred = (options && Array.isArray(options.copyEntries)) ? options.copyEntries : [];
        if (preferred.length) return preferred;

        const copies = (snapshot.permCopies && typeof snapshot.permCopies === 'object') ? snapshot.permCopies : {};
        return Object.keys(copies)
            .map((key) => {
                const normalizedKey = String(key || '').trim();
                if (!normalizedKey.startsWith('bcs:perm:copy-')) return null;
                const copyId = normalizedKey.slice('bcs:perm:copy-'.length).trim();
                if (!copyId) return null;
                const payload = copies[key];
                return {
                    key: normalizedKey,
                    copyId,
                    payload: (payload && typeof payload === 'object') ? payload : null
                };
            })
            .filter(Boolean);
    };

    const rawCopyEntries = resolveCopyEntries()
        .slice()
        .sort((a, b) => String((a && a.copyId) || '').localeCompare(String((b && b.copyId) || '')));

    const usedSlotIndexes = new Set([1]);
    const copyFileMap = {};
    const copyPathById = {};
    const normalizedCopyEntries = [];

    rawCopyEntries.forEach((entry, index) => {
        const payload = (entry && entry.payload && typeof entry.payload === 'object') ? entry.payload : null;
        if (!payload) return;
        const copyId = String((entry && (entry.copyId || entry.id || entry.copyID)) || '').trim() || `copy-${index + 1}`;

        let slotIndex = __normalizePositiveInt(entry && entry.slotIndex);
        if (!(slotIndex > 1)) slotIndex = slotToIndex(entry && entry.slot);
        if (!(slotIndex > 1)) slotIndex = slotToIndex(payload.slot);
        if (!(slotIndex > 1) || usedSlotIndexes.has(slotIndex)) {
            slotIndex = 2;
            while (usedSlotIndexes.has(slotIndex)) slotIndex += 1;
        }
        usedSlotIndexes.add(slotIndex);

        const rel = __buildPermanentSectionMarkdownRelativePath(slotIndex, isEn, exportFormat);
        copyFileMap[copyId] = rel;
        copyPathById[copyId] = __joinObsidianExportPath(exportRoot, rel);
        normalizedCopyEntries.push({ copyId, payload });
    });

    const files = [];
    const pushedNames = new Set();
    const pushFile = (name, content) => {
        const fileName = String(name || '')
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .replace(/\/+/g, '/');
        if (!fileName || pushedNames.has(fileName)) return;
        pushedNames.add(fileName);
        files.push({
            name: fileName,
            data: __toUint8(String(content == null ? '' : content))
        });
    };

    const permanentMdRel = fileRefs.permanentMdRel;
    const permanentPath = fileRefs.permanentPath;
    pushFile(
        __joinObsidianExportPath(exportRoot, permanentMdRel),
        `${__buildCanvasSectionJsonCodeBlock(permanentPayload)}\n`
    );

    normalizedCopyEntries.forEach((entry) => {
        const rel = copyFileMap[entry.copyId];
        if (!rel) return;
        let payload = entry.payload;
        try { payload = JSON.parse(JSON.stringify(entry.payload)); } catch (_) { payload = entry.payload; }
        if (payload && typeof payload === 'object' && String(payload.fileRole || '').trim() === 'copy-anchor') {
            payload.inheritFrom = permanentPath;
        }
        pushFile(
            __joinObsidianExportPath(exportRoot, rel),
            `${__buildCanvasSectionJsonCodeBlock(payload)}\n`
        );
    });

    const tempSectionPaths = Array.isArray(fileRefs.tempSectionPaths) ? fileRefs.tempSectionPaths : [];
    const tempSectionPathById = (fileRefs.tempSectionPathById && typeof fileRefs.tempSectionPathById === 'object')
        ? { ...fileRefs.tempSectionPathById }
        : {};

    tempSectionPaths.forEach((item) => {
        if (!item || !item.id || !item.rel) return;
        const section = sectionById.get(String(item.id));
        if (!section) return;
        pushFile(
            __joinObsidianExportPath(exportRoot, item.rel),
            __buildTempSectionJsonMarkdown(section)
        );
    });

    const canvasData = __buildBcsCanvasDataFromState(tempState, {
        permanentPath,
        tempSectionPathById,
        copyFileMap,
        copyPathById
    }, {
        storageMap: { 'bcs:canvas': snapshot.canvasState }
    });
    const canvasFileName = `${exportRoot}.canvas`;
    pushFile(
        __joinObsidianExportPath(exportRoot, canvasFileName),
        __formatObsidianCanvasJson(canvasData)
    );

    return {
        exportRoot,
        exportFormat,
        zipName: `${exportRoot}.zip`,
        canvasFileName,
        files,
        permanentPath,
        copyFileMap,
        copyPathById,
        tempSectionPathById
    };
}

function __buildObsidianCanvasFileNode({ id, file, x, y, width, height, color = null }) {
    const node = {
        id,
        type: 'file',
        file: String(file == null ? '' : file),
        x: Math.round(Number(x) || 0),
        y: Math.round(Number(y) || 0),
        width: Math.round(Number(width) || 0),
        height: Math.round(Number(height) || 0)
    };
    if (color != null && String(color).trim()) node.color = color;
    return node;
}

function __buildObsidianCanvasTextNode({ id, text, x, y, width, height, color = null }) {
    const node = {
        id,
        type: 'text',
        text: __normalizeCanvasMarkdownSource(text || ''),
        x: Math.round(Number(x) || 0),
        y: Math.round(Number(y) || 0),
        width: Math.round(Number(width) || 0),
        height: Math.round(Number(height) || 0)
    };
    if (color != null && String(color).trim()) node.color = color;
    return node;
}

function __buildObsidianCanvasGroupNode({ id, label = null, x, y, width, height, color = null }) {
    const node = {
        id,
        type: 'group',
        x: Math.round(Number(x) || 0),
        y: Math.round(Number(y) || 0),
        width: Math.round(Number(width) || 0),
        height: Math.round(Number(height) || 0)
    };
    if (label != null && String(label).trim()) node.label = label;
    if (color != null && String(color).trim()) node.color = color;
    return node;
}

function __buildObsidianCanvasEdge(edgeInput) {
    const edge = edgeInput && typeof edgeInput === 'object' ? edgeInput : {};
    const dir = edge.direction || 'none';
    const fromEnd = edge.fromEnd || ((dir === 'both') ? 'arrow' : 'none');
    const toEnd = edge.toEnd || ((dir === 'forward' || dir === 'both') ? 'arrow' : 'none');
    const colorHex = edge.colorHex || presetToHex(edge.color) || null;
    const base = {
        id: edge.id,
        fromNode: edge.fromNode,
        fromSide: edge.fromSide || 'right',
        toNode: edge.toNode,
        toSide: edge.toSide || 'left'
    };
    if (fromEnd === 'arrow') base.fromEnd = 'arrow';
    if (toEnd === 'none') base.toEnd = 'none';
    if (colorHex) base.color = colorHex;
    if (edge.label && String(edge.label).trim()) base.label = edge.label;
    return base;
}

function __buildBcsCanvasDataFromState(stateInput, fileRefs, options = {}) {
    const normalizedRefs = fileRefs && typeof fileRefs === 'object' ? fileRefs : {};
    const storageMap = options && options.storageMap && typeof options.storageMap === 'object'
        ? options.storageMap
        : null;
    const preferStoragePermanentLayout = !!(options && options.preferStoragePermanentLayout === true);
    const state = stateInput && typeof stateInput === 'object' ? stateInput : {};
    const persisted = __buildPersistedCanvasState(state, options);
    const sections = Array.isArray(persisted.sections) ? persisted.sections : [];
    const mdNodes = Array.isArray(persisted.mdNodes) ? persisted.mdNodes : [];
    const edges = Array.isArray(persisted.edges) ? persisted.edges : [];

    const canvasData = { nodes: [], edges: [] };

    const existingCanvasLayout = __extractPermanentLayoutFromCanvasNodes(
        (() => {
            const canvasRaw = storageMap ? storageMap[BCS_CANVAS_KEY] : null;
            const canvas = __readBcsCanvasPayload(canvasRaw);
            return Array.isArray(canvas && canvas.nodes) ? canvas.nodes : [];
        })()
    );
    const existingMainCardState = existingCanvasLayout && existingCanvasLayout.main
        ? existingCanvasLayout.main
        : null;
    const existingCopyCardStateById = existingCanvasLayout && existingCanvasLayout.copiesById && typeof existingCanvasLayout.copiesById === 'object'
        ? existingCanvasLayout.copiesById
        : {};

    const permanentSectionEl = document.getElementById('permanentSection');
    const toNumber = (value, fallback) => {
        const n = parseFloat(String(value == null ? '' : value));
        return Number.isFinite(n) ? n : fallback;
    };
    const mainDomLeft = permanentSectionEl ? __parsePermanentViewCssPixelValue(permanentSectionEl.style.left) : null;
    const mainDomTop = permanentSectionEl ? __parsePermanentViewCssPixelValue(permanentSectionEl.style.top) : null;
    const mainDomWidth = permanentSectionEl
        ? __parsePermanentViewCssPixelValue(permanentSectionEl.style.width)
        : null;
    const mainDomHeight = permanentSectionEl
        ? __parsePermanentViewCssPixelValue(permanentSectionEl.style.height)
        : null;
    const hasMainDomPixelAnchor = mainDomLeft !== null && mainDomTop !== null;
    const permanentLeft = (permanentSectionEl && !preferStoragePermanentLayout)
        ? (hasMainDomPixelAnchor
            ? mainDomLeft
            : toNumber(
                existingMainCardState && Object.prototype.hasOwnProperty.call(existingMainCardState, 'left')
                    ? existingMainCardState.left
                    : null,
                0
            ))
        : toNumber(
            existingMainCardState && Object.prototype.hasOwnProperty.call(existingMainCardState, 'left')
                ? existingMainCardState.left
                : null,
            0
        );
    const permanentTop = (permanentSectionEl && !preferStoragePermanentLayout)
        ? (hasMainDomPixelAnchor
            ? mainDomTop
            : toNumber(
                existingMainCardState && Object.prototype.hasOwnProperty.call(existingMainCardState, 'top')
                    ? existingMainCardState.top
                    : null,
                0
            ))
        : toNumber(
            existingMainCardState && Object.prototype.hasOwnProperty.call(existingMainCardState, 'top')
                ? existingMainCardState.top
                : null,
            0
        );
    const permanentW = (permanentSectionEl && !preferStoragePermanentLayout)
        ? (mainDomWidth !== null
            ? mainDomWidth
            : toNumber(
                existingMainCardState && Object.prototype.hasOwnProperty.call(existingMainCardState, 'width')
                    ? existingMainCardState.width
                    : null,
                600
            ))
        : toNumber(
            existingMainCardState && Object.prototype.hasOwnProperty.call(existingMainCardState, 'width')
                ? existingMainCardState.width
                : null,
            600
        );
    const permanentH = (permanentSectionEl && !preferStoragePermanentLayout)
        ? (mainDomHeight !== null
            ? mainDomHeight
            : toNumber(
                existingMainCardState && Object.prototype.hasOwnProperty.call(existingMainCardState, 'height')
                    ? existingMainCardState.height
                    : null,
                600
            ))
        : toNumber(
            existingMainCardState && Object.prototype.hasOwnProperty.call(existingMainCardState, 'height')
                ? existingMainCardState.height
                : null,
            600
        );

    canvasData.nodes.push(__buildObsidianCanvasFileNode({
        id: 'permanent-section',
        file: String(normalizedRefs.permanentPath || ''),
        x: Math.round(permanentLeft),
        y: Math.round(permanentTop),
        width: Math.round(permanentW),
        height: Math.round(permanentH),
        color: '4'
    }));

    try {
        const copyIds = new Set();
        const domPositions = new Map();
        const storedPositions = new Map();
        try {
            Object.keys(normalizedRefs.copyFileMap || {}).forEach((id) => { if (id) copyIds.add(String(id)); });
        } catch (_) { }
        try {
            const stored = __readPermanentSectionCopies();
            if (Array.isArray(stored)) {
                stored.forEach((payload) => {
                    if (!payload || !payload.id) return;
                    const id = String(payload.id);
                    if (!id) return;
                    copyIds.add(id);
                    storedPositions.set(id, payload);
                });
            }
        } catch (_) { }
        try {
            const canvasContent = document.getElementById('canvasContent');
            const scope = canvasContent || document;
            scope.querySelectorAll('.permanent-bookmark-section.permanent-section-copy').forEach((el) => {
                if (!el) return;
                const copyId = el.dataset ? el.dataset.permanentSectionCopyId : null;
                if (!copyId) return;
                const id = String(copyId);
                copyIds.add(id);
                domPositions.set(id, {
                    left: parseFloat(el.style.left) || 0,
                    top: parseFloat(el.style.top) || 0,
                    width: __parsePermanentViewCssPixelValue(el.style.width) || permanentW,
                    height: __parsePermanentViewCssPixelValue(el.style.height) || permanentH
                });
            });
        } catch (_) { }

        Array.from(copyIds.values()).forEach((copyId) => {
            if (!copyId) return;
            const domPos = domPositions.get(copyId) || null;
            const canvasPos = existingCopyCardStateById[copyId] || null;
            const storedPos = storedPositions.get(copyId) || null;
            const left = (domPos && !preferStoragePermanentLayout)
                ? domPos.left
                : (canvasPos
                    ? toNumber(canvasPos.left, permanentLeft)
                    : (storedPos ? toNumber(storedPos.left, permanentLeft) : permanentLeft));
            const top = (domPos && !preferStoragePermanentLayout)
                ? domPos.top
                : (canvasPos
                    ? toNumber(canvasPos.top, permanentTop)
                    : (storedPos ? toNumber(storedPos.top, permanentTop) : permanentTop));
            const w = (domPos && !preferStoragePermanentLayout)
                ? domPos.width
                : (canvasPos
                    ? toNumber(canvasPos.width, permanentW)
                    : (storedPos ? toNumber(storedPos.width, permanentW) : permanentW));
            const h = (domPos && !preferStoragePermanentLayout)
                ? domPos.height
                : (canvasPos
                    ? toNumber(canvasPos.height, permanentH)
                    : (storedPos ? toNumber(storedPos.height, permanentH) : permanentH));
            canvasData.nodes.push(__buildObsidianCanvasFileNode({
                id: `permanent-section-copy-${copyId}`,
                file: String(normalizedRefs.copyPathById && normalizedRefs.copyPathById[copyId] || normalizedRefs.permanentPath || ''),
                x: Math.round(left),
                y: Math.round(top),
                width: Math.round(w),
                height: Math.round(h),
                color: '4'
            }));
        });
    } catch (_) { }

    try {
        const exportMdBase = getBlankNodeDefaultSize();
        mdNodes.filter((n) => n && n.subtype === 'card-group').forEach((n) => {
            const label = (typeof n.label === 'string' && n.label.trim()) ? n.label : null;
            const color = n && (n.colorHex || n.color) ? (n.colorHex || n.color) : null;
            canvasData.nodes.push(__buildObsidianCanvasGroupNode({
                id: n.id,
                x: Math.round(n.x || 0),
                y: Math.round(n.y || 0),
                width: Math.round(n.width || exportMdBase.width),
                height: Math.round(n.height || exportMdBase.height),
                label,
                color
            }));
        });
    } catch (_) { }

    const exportTempBase = getTempSectionBaseSize();
    const exportMdBase = getBlankNodeDefaultSize();

    sections.forEach((section) => {
        if (!section || !section.id) return;
        const filePath = normalizedRefs.tempSectionPathById && normalizedRefs.tempSectionPathById[section.id];
        if (!filePath) return;
        canvasData.nodes.push(__buildObsidianCanvasFileNode({
            id: section.id,
            file: String(filePath),
            x: Math.round(section.x || 0),
            y: Math.round(section.y || 0),
            width: Math.round(section.width || exportTempBase.width),
            height: Math.round(section.height || exportTempBase.height),
            color: section.color || null
        }));
    });

    mdNodes.forEach((node) => {
        if (!node || !node.id) return;
        if (node.subtype === 'card-group') return;
        const color = node.colorHex || node.color || null;
        if (node.type === 'file') {
            canvasData.nodes.push(__buildObsidianCanvasFileNode({
                id: node.id,
                file: String(node.file || ''),
                x: Math.round(node.x || 0),
                y: Math.round(node.y || 0),
                width: Math.round(node.width || exportMdBase.width),
                height: Math.round(node.height || exportMdBase.height),
                color
            }));
            return;
        }
        const body = __isCanvasNativeTextNode(node)
            ? __resolveCanvasNativeTextNodeBody(node)
            : __deriveMdNodeMarkdownSource(node);
        canvasData.nodes.push(__buildObsidianCanvasTextNode({
            id: node.id,
            text: __normalizeCanvasMarkdownSource(body || ''),
            x: Math.round(node.x || 0),
            y: Math.round(node.y || 0),
            width: Math.round(node.width || exportMdBase.width),
            height: Math.round(node.height || exportMdBase.height),
            color
        }));
    });

    if (Array.isArray(edges)) {
        canvasData.edges = edges.map((edge) => __buildObsidianCanvasEdge(edge));
    }

    return canvasData;
}

function __toStableCanvasJson(value) {
    try {
        return JSON.stringify(value);
    } catch (_) {
        return '';
    }
}

function __normalizeTempSectionProtocolLabel(section) {
    const rawLabel = getTempSectionLabel(section);
    return __normalizeTempSectionLabelToDashScheme(rawLabel || '').trim();
}

function __normalizeTempSectionProtocolRootId(section) {
    const label = __normalizeTempSectionProtocolLabel(section);
    if (label) return `tmp/${label}`;

    const sequenceNumber = __normalizePositiveInt(section && section.sequenceNumber);
    if (sequenceNumber) {
        const alpha = toAlphaLabel(sequenceNumber) || `S${sequenceNumber}`;
        return `tmp/${alpha}-1`;
    }

    const rawSectionId = String(section && section.id || '').trim();
    const safeSectionId = rawSectionId
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (safeSectionId) return `tmp/${safeSectionId}`;

    return 'tmp/section';
}

function __normalizeTempSectionDescriptionMarkdown(section) {
    if (!section || typeof section !== 'object') return '';
    return String(section.descriptionMd == null ? '' : section.descriptionMd);
}

function __getDefaultTempSectionProtocolTitle() {
    return (typeof currentLang !== 'undefined' && String(currentLang).toLowerCase().startsWith('en'))
        ? 'Temp Section'
        : '临时栏目';
}

function __resolveTempBookmarkTreeProtocolNodeKind(nodeInput) {
    const rawUrl = String(nodeInput && nodeInput.url || '').trim();
    const kindRaw = String(nodeInput && (nodeInput.kind || nodeInput.type) || '').trim().toLowerCase();
    return (kindRaw === 'bookmark' || (rawUrl && kindRaw !== 'folder')) ? 'bookmark' : 'folder';
}

const TEMP_SECTION_PROTOCOL_ITEM_RESERVED_KEYS = new Set([
    'id',
    'sectionId',
    'title',
    'name',
    'url',
    'type',
    'kind',
    'children',
    'createdAt',
    'updatedAt',
    'dateAdded',
    'parentId',
    'index',
    'syncing'
]);

function __buildTempSectionProtocolItems(itemsInput, sectionIdFallback = '') {
    const list = Array.isArray(itemsInput) ? itemsInput : [];
    return list
        .map((item) => __buildTempSectionProtocolItemPayload(item, sectionIdFallback))
        .filter(Boolean);
}

function __buildTempSectionProtocolItemPayload(itemInput, sectionIdFallback = '') {
    if (!itemInput || typeof itemInput !== 'object') return null;
    const source = __cloneCanvasProtocolJson(itemInput);
    if (!source || typeof source !== 'object') return null;

    const rawUrl = String(source.url || '').trim();
    const kind = __resolveTempBookmarkTreeProtocolNodeKind(source);
    const itemId = String(source.id || '').trim();
    const sectionId = String(source.sectionId || sectionIdFallback || '').trim();
    const title = String(
        source.title
        || source.name
        || rawUrl
        || (kind === 'bookmark' ? 'Untitled Bookmark' : 'Folder')
    ).trim() || (kind === 'bookmark' ? 'Untitled Bookmark' : 'Folder');
    const children = __buildTempSectionProtocolItems(
        Array.isArray(source.children) ? source.children : [],
        sectionId
    );

    const payload = {};
    if (itemId) payload.id = itemId;
    if (sectionId) payload.sectionId = sectionId;
    payload.title = title;
    payload.url = rawUrl;
    payload.type = kind;
    payload.children = children;

    const dateAdded = __parseCanvasProtocolDateValue(source.dateAdded);
    if (dateAdded > 0) payload.dateAdded = dateAdded;

    const parentId = String(source.parentId || '').trim();
    if (parentId) payload.parentId = parentId;

    const index = Number(source.index);
    if (Number.isFinite(index) && index >= 0) payload.index = Math.floor(index);

    if (typeof source.syncing === 'boolean') {
        payload.syncing = source.syncing;
    }

    Object.keys(source).sort().forEach((key) => {
        if (!key || TEMP_SECTION_PROTOCOL_ITEM_RESERVED_KEYS.has(key)) return;
        if (typeof source[key] === 'undefined') return;
        payload[key] = __cloneCanvasProtocolJson(source[key]);
    });

    return payload;
}

function __buildTempSectionProtocolMeta(section) {
    const normalizedSource = __normalizeTempSectionSourceKey(section && section.source);
    const normalizedLabel = __normalizeTempSectionProtocolLabel(section);
    const explicitTempKind = String(section && section.tempKind || '').trim().toLowerCase();
    const resolvedTempKind = (explicitTempKind === 'special' || explicitTempKind === 'regular')
        ? explicitTempKind
        : (normalizedSource && SPECIAL_TEMP_SOURCE_SET.has(normalizedSource)
            ? 'special'
            : (__isSpecialTempSection(section) ? 'special' : 'regular'));
    const meta = {
        tempKind: resolvedTempKind,
        title: String(section && section.title || '').trim(),
        descriptionMd: __normalizeTempSectionDescriptionMarkdown(section)
    };

    if (normalizedLabel) meta.label = normalizedLabel;
    if (normalizedSource) meta.source = normalizedSource;

    const sequenceNumber = __normalizePositiveInt(section && section.sequenceNumber);
    if (sequenceNumber) meta.sequenceNumber = sequenceNumber;

    const originPermanent = __normalizeOriginPermanentPayload(section && section.originPermanent);
    if (originPermanent) meta.originPermanent = originPermanent;

    return meta;
}

function __buildTempSectionProtocol(section) {
    if (!section || typeof section !== 'object') return null;
    return {
        sectionMeta: __buildTempSectionProtocolMeta(section),
        items: Array.isArray(section.items) ? section.items : []
    };
}

function __buildTempSectionProtocolSnapshot(stateInput) {
    const state = stateInput && typeof stateInput === 'object' ? stateInput : {};
    const sections = Array.isArray(state.sections)
        ? state.sections
        : (Array.isArray(state.tempSections) ? state.tempSections : []);

    return {
        version: 2,
        sections: sections
            .filter((section) => section && typeof section === 'object')
            .map((section) => __normalizeTempSectionProtocolObject(section) || __buildTempSectionProtocol(section))
            .filter(Boolean)
    };
}

function __normalizeTempSectionProtocolObject(protocolInput) {
    if (!protocolInput || typeof protocolInput !== 'object') return null;

    const source = __cloneCanvasProtocolJson(protocolInput);
    if (!source) return null;

    const rawMeta = source.sectionMeta && typeof source.sectionMeta === 'object'
        ? source.sectionMeta
        : source;
    const sectionLike = {
        id: source.sectionId || source.id || null,
        tempKind: rawMeta.tempKind,
        label: rawMeta.label,
        title: rawMeta.title,
        source: rawMeta.source,
        sequenceNumber: rawMeta.sequenceNumber,
        descriptionMd: rawMeta.descriptionMd,
        originPermanent: rawMeta.originPermanent
    };
    const sectionMeta = __buildTempSectionProtocolMeta(sectionLike);
    let sourceItems = [];
    if (Array.isArray(source.items)) {
        sourceItems = source.items;
    } else if (Array.isArray(source.bookmarkTree)) {
        sourceItems = source.bookmarkTree;
    } else if (source.bookmarkTree && typeof source.bookmarkTree === 'object') {
        sourceItems = [source.bookmarkTree];
    }
    const sectionId = String(sectionLike.id || '').trim();
    return {
        sectionMeta,
        items: __buildTempSectionProtocolItems(sourceItems, sectionId)
    };
}

function __buildRuntimeTempSectionFromProtocol(protocolInput, options = {}) {
    const normalized = __normalizeTempSectionProtocolObject(protocolInput);
    if (!normalized) return null;

    const sectionMeta = normalized.sectionMeta || {};
    __buildRuntimeTempSectionFromProtocol.__counter = (__buildRuntimeTempSectionFromProtocol.__counter || 0) + 1;
    const sectionId = String(options.sectionId || '').trim()
        || __generateTempSectionId();
    const hasItemPayloads = Array.isArray(normalized.items);
    const payloads = hasItemPayloads ? normalized.items : [];
    let restoredItemCounter = 0;
    const convertPayloadToRuntimeItem = (payload) => {
        if (!payload || typeof payload !== 'object') return null;
        const payloadSource = __cloneCanvasProtocolJson(payload);
        if (!payloadSource || typeof payloadSource !== 'object') return null;

        const rawUrl = String(payloadSource.url || '').trim();
        const kind = __resolveTempBookmarkTreeProtocolNodeKind(payloadSource);
        const payloadId = String(payloadSource.id || '').trim();
        const runtimeItem = {
            id: (hasItemPayloads && payloadId)
                ? payloadId
                : `temp-${sectionId}-${++restoredItemCounter}`,
            sectionId,
            title: String(payloadSource.title || payloadSource.name || rawUrl || (kind === 'bookmark' ? 'Untitled Bookmark' : 'Folder')).trim()
                || (kind === 'bookmark' ? 'Untitled Bookmark' : 'Folder'),
            url: rawUrl,
            type: kind,
            children: []
        };

        const dateAdded = __parseCanvasProtocolDateValue(payloadSource.dateAdded);
        if (dateAdded > 0) runtimeItem.dateAdded = dateAdded;

        const parentId = String(payloadSource.parentId || '').trim();
        if (parentId) runtimeItem.parentId = parentId;

        const index = Number(payloadSource.index);
        if (Number.isFinite(index) && index >= 0) runtimeItem.index = Math.floor(index);

        if (typeof payloadSource.syncing === 'boolean') {
            runtimeItem.syncing = payloadSource.syncing;
        }

        Object.keys(payloadSource).sort().forEach((key) => {
            if (!key || TEMP_SECTION_PROTOCOL_ITEM_RESERVED_KEYS.has(key)) return;
            if (typeof payloadSource[key] === 'undefined') return;
            runtimeItem[key] = __cloneCanvasProtocolJson(payloadSource[key]);
        });

        const payloadChildren = Array.isArray(payloadSource.children) ? payloadSource.children : [];
        if (payloadChildren.length) {
            runtimeItem.children = payloadChildren.map(convertPayloadToRuntimeItem).filter(Boolean);
        }
        return runtimeItem;
    };
    const items = payloads.map(convertPayloadToRuntimeItem).filter(Boolean);

    const restored = {
        id: sectionId,
        title: String(sectionMeta.title || '').trim()
            || __getDefaultTempSectionProtocolTitle(),
        items,
        x: Number.isFinite(Number(options.x)) ? Number(options.x) : 0,
        y: Number.isFinite(Number(options.y)) ? Number(options.y) : 0,
        width: Number.isFinite(Number(options.width)) ? Number(options.width) : 0,
        height: Number.isFinite(Number(options.height)) ? Number(options.height) : 0,
        color: String(options.color || '').trim() || getTempSectionDefaultColor(sectionMeta),
        colorLocked: typeof options.colorLocked === 'boolean' ? options.colorLocked : __getDefaultTempColorLockedState(),
        pinned: !!options.pinned
    };

    if (sectionMeta.label) restored.label = sectionMeta.label;
    if (sectionMeta.source) restored.source = sectionMeta.source;
    if (sectionMeta.tempKind) restored.tempKind = sectionMeta.tempKind;
    if (sectionMeta.sequenceNumber) restored.sequenceNumber = sectionMeta.sequenceNumber;
    if (sectionMeta.originPermanent) restored.originPermanent = __normalizeOriginPermanentPayload(sectionMeta.originPermanent);
    const restoredDescriptionMd = String(sectionMeta.descriptionMd == null ? '' : sectionMeta.descriptionMd);
    restored.descriptionMd = restoredDescriptionMd;
    restored.description = __normalizeCanvasRichHtml(__coerceDescriptionSourceToHtml(restoredDescriptionMd));

    return restored;
}

function __buildCanvasTempStateProtocolView(stateInput, options = {}) {
    const state = stateInput && typeof stateInput === 'object' ? stateInput : {};
    const sections = Array.isArray(state.sections)
        ? state.sections
        : (Array.isArray(state.tempSections) ? state.tempSections : []);
    const mdNodes = Array.isArray(state.mdNodes)
        ? state.mdNodes
        : (Array.isArray(state.cards) ? state.cards : []);
    const edges = Array.isArray(state.edges) ? state.edges : [];

    const normalizedMdNodes = mdNodes
        .map((node) => {
            const cloned = __cloneCanvasProtocolJson(node);
            if (!cloned) return null;
            if (cloned.subtype === 'card-group') {
                return cloned;
            }
            if (options && options.skipValidation === true) {
                return cloned;
            }
            const markedApi = (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function')
                ? marked
                : (typeof window !== 'undefined' && window && window.marked && typeof window.marked.parse === 'function' ? window.marked : null);
            const isMarkedLoaded = !!markedApi;
            const refreshCachesFromMarkdown = !(typeof cloned.html === 'string' && cloned.html.trim());
            __ensureMdNodeMarkdownProtocol(cloned, {
                refreshCachesFromMarkdown
            });
            return cloned;
        })
        .filter(Boolean);

    return __buildPersistedCanvasState({
        ...state,
        sections: sections.map((section) => __cloneCanvasProtocolJson(section)).filter(Boolean),
        mdNodes: normalizedMdNodes,
        edges: edges.map((edge) => __cloneCanvasProtocolJson(edge)).filter(Boolean)
    }, {
        preserveRaw: !!(options && options.preserveRaw === true)
    });
}

// =============================================================================
// One-shot migration: drop legacy temp-section-<N> storage residue.
// =============================================================================
// The temp-section ID scheme changed to stable hash IDs (tempSecId_*). Old chrome.storage.local
// keys like `temp-section-scroll:temp-section-3` are not parseable under the new rules. The
// doc explicitly authorizes wiping legacy temp-section state on first boot under the new
// codebase, so we do exactly that, then mark the migration as done.

async function __migrateLegacyTempSectionKeysOnce() {
    try {
        const flag = await __bcsStorageGet([BCS_LEGACY_TEMP_MIGRATION_DONE_KEY]);
        if (flag && flag[BCS_LEGACY_TEMP_MIGRATION_DONE_KEY]) return { skipped: true };
    } catch (_) { return { skipped: true }; }

    const all = await __bcsStorageGetAll();
    const toRemove = [];
    Object.keys(all || {}).forEach((key) => {
        if (typeof key !== 'string') return;
        if (
            /^temp-section-scroll:temp-section-\d+$/.test(key)
            || /^temp-section-collapsed:temp-section-\d+$/.test(key)
            || /^temp-section-scroll:temp-section-protocol-/.test(key)
            || /^temp-section-collapsed:temp-section-protocol-/.test(key)
        ) {
            toRemove.push(key);
        }
    });

    if (toRemove.length) {
        try { await __bcsStorageRemove(toRemove); } catch (_) {}
        try { console.info(`[BCS] legacy temp-section keys cleaned: ${toRemove.length}`); } catch (_) {}
    }

    try { await __bcsStorageSet({ [BCS_LEGACY_TEMP_MIGRATION_DONE_KEY]: { migratedAt: Date.now(), removed: toRemove.length } }, { immediate: true }); } catch (_) {}
    return { removed: toRemove.length };
}

// =============================================================================
// Export Sandbox: build an in-memory clone of the local state for export/sync/backup.
// =============================================================================
// All "sensitive" mutation work — replacing chromeIds with syncIds, dropping `index`,
// pruning identityMap, embedding tags — happens against this sandbox copy, never against
// live storage. Pipeline:
//   1. __buildExportSandbox()              snapshot local BCS into a plain object
//   2. __applySyncIdReplacementInSandbox() rewrite tree.id/parentId → syncId, drop index
//   3. __pruneIdentityMapEntriesInSandbox() strip entries with only {id, syncId}
//   4. __embedTempSectionTagsInSandbox()   (placeholder for phase 3 tag system)
// The same pipeline feeds both export downloads and the single-slot backup.

function __cloneForSandbox(state) {
    if (state == null) return state;
    try {
        if (typeof structuredClone === 'function') return structuredClone(state);
    } catch (_) {}
    try { return JSON.parse(JSON.stringify(state)); } catch (_) { return null; }
}

async function __buildExportSandbox(options = {}) {
    if (!(options && options.skipRuntimeFlush === true)) {
        await __flushRuntimeCanvasStateToBcs(options);
    }
    const all = await __bcsStorageGetAll();
    const permMainRaw = all && all[BCS_PERM_MAIN_KEY] ? all[BCS_PERM_MAIN_KEY] : null;
    const metaRaw = all && all[BCS_META_KEY] ? all[BCS_META_KEY] : null;
    const tempStateRaw = __buildCanvasTempStateFromBcsStorage(all, metaRaw, { skipValidation: true });
    const copyKeys = Object.keys(all || {}).filter((key) => typeof key === 'string' && key.startsWith(BCS_PERM_COPY_PREFIX));
    const copies = {};
    for (const key of copyKeys) {
        copies[key] = __cloneForSandbox(all[key]);
    }
    const canvasRaw = all && all[BCS_CANVAS_KEY] ? all[BCS_CANVAS_KEY] : null;
    const rootMetaRaw = all && all[PERMANENT_ROOT_META_STORAGE_KEY] ? all[PERMANENT_ROOT_META_STORAGE_KEY] : null;
    return {
        sandboxBuiltAt: Date.now(),
        sandboxOptions: { reason: String(options && options.reason || 'export') },
        permMain: __cloneForSandbox(permMainRaw),
        permCopies: copies,
        tempState: __cloneForSandbox(tempStateRaw),
        canvasState: __cloneForSandbox(canvasRaw),
        bcsMeta: __cloneForSandbox(metaRaw),
        permRootMeta: __cloneForSandbox(rootMetaRaw)
    };
}

async function __flushRuntimeCanvasStateToBcs(options = {}) {
    try {
        if (typeof __flushPermanentSectionScrollStates === 'function') {
            __flushPermanentSectionScrollStates();
        }
    } catch (_) { }
    try {
        __flushMdEditorsForExport(options);
    } catch (_) { }
    try {
        const saveFn = (typeof saveTempNodes === 'function')
            ? saveTempNodes
            : ((typeof window !== 'undefined' && typeof window.saveTempNodes === 'function') ? window.saveTempNodes : null);
        if (saveFn) {
            const result = saveFn({
                immediate: true
            });
            if (result && typeof result.then === 'function') {
                await result;
            }
        }
    } catch (_) { }
}

function __replaceIdsWithSyncIdsInTree(treeRoot, byChromeId) {
    if (!treeRoot || typeof treeRoot !== 'object') return treeRoot;
    const stack = [treeRoot];
    while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        if (Object.prototype.hasOwnProperty.call(node, 'index')) delete node.index;
        const chromeId = String(node.id || '').trim();
        if (chromeId) {
            const mapped = byChromeId.get(chromeId);
            if (mapped) node.id = mapped.syncId;
        }
        const parentChromeId = String(node.parentId || '').trim();
        if (parentChromeId) {
            const parentMapped = byChromeId.get(parentChromeId);
            if (parentMapped) node.parentId = parentMapped.syncId;
        }
        if (Array.isArray(node.children)) {
            for (const child of node.children) stack.push(child);
        }
    }
    return treeRoot;
}

function __applySyncIdReplacementInSandbox(sandbox) {
    if (!sandbox || typeof sandbox !== 'object') return sandbox;
    const targets = [];
    if (sandbox.permMain) targets.push(sandbox.permMain);
    if (sandbox.permCopies && typeof sandbox.permCopies === 'object') {
        for (const key of Object.keys(sandbox.permCopies)) {
            const copy = sandbox.permCopies[key];
            if (copy) targets.push(copy);
        }
    }
    for (const content of targets) {
        if (!content || typeof content !== 'object' || !content.tree) continue;
        const list = Array.isArray(content.identityMap) ? content.identityMap : [];
        const byChromeId = new Map();
        for (const entry of list) {
            if (!entry || typeof entry !== 'object') continue;
            const id = String(entry.id || '').trim();
            const syncId = String(entry.syncId || '').trim();
            if (id && syncId) byChromeId.set(id, entry);
        }
        __replaceIdsWithSyncIdsInTree(content.tree, byChromeId);
    }
    return sandbox;
}

function __pruneIdentityMapEntriesInSandbox(sandbox) {
    if (!sandbox || typeof sandbox !== 'object') return sandbox;
    const targets = [];
    if (sandbox.permMain) targets.push(sandbox.permMain);
    if (sandbox.permCopies && typeof sandbox.permCopies === 'object') {
        for (const key of Object.keys(sandbox.permCopies)) {
            const copy = sandbox.permCopies[key];
            if (copy) targets.push(copy);
        }
    }
    // Doc requirement (current execution baseline):
    // - 本地 identityMap: { id: chromeId, syncId, ...extras }
    // - 导出沙盒 identityMap: 去掉 id，仅保留含扩展字段的 { syncId, ...extras }
    // - 若某项除 id/syncId 外无任何扩展字段，则整项不导出。
    // - 若全部项都被裁剪，则不输出 identityMap 字段。
    for (const content of targets) {
        if (!content || !Array.isArray(content.identityMap)) continue;
        const next = [];
        for (const entry of content.identityMap) {
            if (!entry || typeof entry !== 'object') continue;
            const syncId = String(entry.syncId || '').trim();
            if (!syncId) continue;
            const pruned = {};
            for (const key of Object.keys(entry)) {
                if (key === 'id' || key === 'syncId') continue;
                pruned[key] = entry[key];
            }
            if (!Object.keys(pruned).length) continue;
            pruned.syncId = syncId;
            next.push(pruned);
        }
        if (next.length) {
            content.identityMap = next;
        } else {
            delete content.identityMap;
        }
    }
    return sandbox;
}

function __embedTempSectionTagsInSandbox(sandbox) {
    // Placeholder. Tag fields on temp-section tree-node JSON live alongside `createdAt`
    // and move with the node by virtue of being nested in the node itself. The sandbox
    // already deep-clones temp state, so any pre-existing `tags` arrays survive untouched.
    // When phase 3 lands the tag UI, this function becomes the post-processing hook.
    return sandbox;
}

function __processExportSandboxForExport(sandbox) {
    __applySyncIdReplacementInSandbox(sandbox);
    __pruneIdentityMapEntriesInSandbox(sandbox);
    __embedTempSectionTagsInSandbox(sandbox);
    return sandbox;
}

async function __writeBackupSlotFromSandbox(sandbox) {
    if (!sandbox || typeof sandbox !== 'object') return null;
    const payload = {
        savedAt: Date.now(),
        sandbox: __cloneForSandbox(sandbox)
    };
    try {
        await __bcsStorageSet({ [BCS_BACKUP_SLOT_KEY]: payload }, { immediate: true });
        return payload;
    } catch (_) {
        return null;
    }
}

async function __readBackupSlot() {
    const all = await __bcsStorageGet([BCS_BACKUP_SLOT_KEY]);
    return (all && all[BCS_BACKUP_SLOT_KEY]) || null;
}

async function __getImportOverwriteThreshold() {
    try {
        const result = await __bcsStorageGet([BCS_IMPORT_THRESHOLD_KEY]);
        const stored = result && result[BCS_IMPORT_THRESHOLD_KEY];
        if (stored && typeof stored === 'object' && Number.isFinite(Number(stored.value))) {
            const v = Number(stored.value);
            if (v > 0) return v;
        }
        if (Number.isFinite(Number(stored))) {
            const v = Number(stored);
            if (v > 0) return v;
        }
    } catch (_) {}
    return BCS_IMPORT_THRESHOLD_DEFAULT;
}

async function __setImportOverwriteThreshold(value) {
    const v = Math.max(1, Math.min(100000, Math.round(Number(value) || BCS_IMPORT_THRESHOLD_DEFAULT)));
    try { await __bcsStorageSet({ [BCS_IMPORT_THRESHOLD_KEY]: { value: v, savedAt: Date.now() } }, { immediate: true }); } catch (_) {}
    return v;
}

if (typeof window !== 'undefined') {
    window.CanvasProtocolBridge = Object.assign(window.CanvasProtocolBridge || {}, {
        version: 1,
        generateSyncId() { return __generateSyncId(); },
        generateTempId() { return __generateTempId(); },
        generateTempSectionId() { return __generateTempSectionId(); },
        rememberExistingBcsId(value) { __rememberExistingBcsId(value); },
        isHashedTempSectionId(value) { return __isHashedTempSectionId(value); },
        isHashedTempItemId(value) { return __isHashedTempItemId(value); },
        isHashedSyncId(value) { return __isHashedSyncId(value); },
        isLegacyTempSectionId(value) { return __isLegacyTempSectionId(value); },
        async migrateLegacyTempSectionKeysOnce() {
            return await __migrateLegacyTempSectionKeysOnce();
        },
        getIdentityMapIndex(content) { return __getIdentityMapIndex(content); },
        normalizeIdentityMapArray(rawList) { return __normalizeIdentityMapArray(rawList); },
        verifyAndHealIdentityMap(content) { return __verifyAndHealIdentityMap(content); },
        validateImportedIdentityMapAgainstTree(treeRoot, identityMap, expectedSyncIds, options = {}) {
            return __validateImportedIdentityMapAgainstTree(treeRoot, identityMap, expectedSyncIds, options);
        },
        collectIgnoredChromeIdsFromFreshTree(treeRoot) {
            return __collectIgnoredChromeIdsFromFreshTree(treeRoot);
        },
        rebuildIdentityMapPreservingExisting(prev, treeRoot) { return __rebuildIdentityMapPreservingExisting(prev, treeRoot); },
        applyIdentityMapDeltaFromBookmarkEvents(content, events) { return __applyIdentityMapDeltaFromBookmarkEvents(content, events); },
        bootstrapIdentityMapFromTree(treeRoot) { return __bootstrapIdentityMapFromTree(treeRoot); },
        // ----- Tag CRUD (doc §3) -----
        makeTagKey(color, text) { return __makeTagKey(color, text); },
        normalizeTagInput(raw) { return __normalizeTagInput(raw); },
        normalizeTagArray(rawList) { return __normalizeTagArrayInput(rawList); },
        getPermanentNodeTagsFromContent(content, chromeId) { return __getPermanentNodeTagsFromContent(content, chromeId); },
        setPermanentNodeTagsInContent(content, chromeId, tagsInput) { return __setPermanentNodeTagsInContent(content, chromeId, tagsInput); },
        togglePermanentNodeTagInContent(content, chromeId, tagInput) { return __togglePermanentNodeTagInContent(content, chromeId, tagInput); },
        async readPermanentNodeTags(chromeId) { return await __readPermanentNodeTags(chromeId); },
        async writePermanentNodeTags(chromeId, tagsInput, options = {}) { return await __writePermanentNodeTags(chromeId, tagsInput, options); },
        async togglePermanentNodeTag(chromeId, tagInput, options = {}) { return await __togglePermanentNodeTag(chromeId, tagInput, options); },
        async writePermanentNodeTagsBulk(updates, options = {}) { return await __writePermanentNodeTagsBulk(updates, options); },
        collectTagsFromIdentityMap(content) { return __collectTagsFromIdentityMap(content); },
        collectTagsFromTempState(stateInput) { return __collectTagsFromTempState(stateInput); },
        async collectAllUsedTags() { return await __collectAllUsedTags(); },
        async buildExportSandbox(options = {}) { return await __buildExportSandbox(options); },
        async flushRuntimeCanvasStateToBcs(options = {}) { return await __flushRuntimeCanvasStateToBcs(options); },
        cloneForSandbox(state) { return __cloneForSandbox(state); },
        applySyncIdReplacementInSandbox(sandbox) { return __applySyncIdReplacementInSandbox(sandbox); },
        pruneIdentityMapEntriesInSandbox(sandbox) { return __pruneIdentityMapEntriesInSandbox(sandbox); },
        embedTempSectionTagsInSandbox(sandbox) { return __embedTempSectionTagsInSandbox(sandbox); },
        processExportSandboxForExport(sandbox) { return __processExportSandboxForExport(sandbox); },
        async writeBackupSlotFromSandbox(sandbox) { return await __writeBackupSlotFromSandbox(sandbox); },
        async readBackupSlot() { return await __readBackupSlot(); },
        async getImportOverwriteThreshold() { return await __getImportOverwriteThreshold(); },
        async setImportOverwriteThreshold(value) { return await __setImportOverwriteThreshold(value); },
        buildObsidianPackageFilesFromSnapshot(snapshotInput, options = {}) {
            return __buildBcsObsidianPackageFilesFromSnapshot(snapshotInput, options);
        },
        normalizeBlankMarkdownNode(node, options = {}) {
            const cloned = __cloneCanvasProtocolJson(node);
            if (!cloned) return null;
            return __ensureMdNodeMarkdownProtocol(cloned, {
                refreshCachesFromMarkdown: options.refreshCachesFromMarkdown === true
            });
        },
        normalizeCanvasTempState(stateInput, options = {}) {
            return __buildCanvasTempStateProtocolView(stateInput, options);
        },
        async loadCanvasTempStateFromBcs(options = {}) {
            return await __loadCanvasTempStateFromBcs(options);
        },
        async saveCanvasTempStateToBcsStorage(stateInput, options = {}) {
            return await __saveCanvasTempStateToBcsStorage(stateInput, options);
        },
        normalizeTempSectionProtocol(sectionInput) {
            return __normalizeTempSectionProtocolObject(sectionInput) || __buildTempSectionProtocol(sectionInput);
        },
        buildTempSectionJsonProtocol(sectionInput) {
            return __buildTempSectionJsonProtocol(sectionInput);
        },
        buildObsidianSafeFilenameStem(name, fallback = 'Untitled', uniqueSeed = '') {
            return __buildObsidianSafeFilenameStem(name, fallback, uniqueSeed);
        },
        buildTempSectionMarkdownRelativePath(sectionInput, safeTitle, isEn, exportFormat = 'json') {
            return __buildTempSectionMarkdownRelativePath(sectionInput, safeTitle, isEn, exportFormat);
        },
        collectTempSectionProtocolSnapshot(stateInput) {
            return __buildTempSectionProtocolSnapshot(stateInput);
        },
        restoreTempSectionFromProtocol(protocolInput, options = {}) {
            return __buildRuntimeTempSectionFromProtocol(protocolInput, options);
        },
        clonePermanentTreeSnapshotRaw(treeInput) {
            return __cloneRawChromeBookmarkTreeSnapshot(treeInput);
        },
        normalizePermanentTreeSnapshot(treeInput, options = {}) {
            return __buildPermanentTreeSnapshotForJsonProtocol(treeInput, options);
        },
        async ensurePermanentMainContentInBcs(options = {}) {
            return await __ensurePermanentMainContentInBcs(options);
        },
        buildPermanentMainSyncPayload(contentInput, options = {}) {
            return __buildPermanentMainSyncPayload(contentInput, options);
        },
        buildPermanentSectionMarkdownRelativePath(permanentSlot, isEn, exportFormat = 'json') {
            return __buildPermanentSectionMarkdownRelativePath(permanentSlot, isEn, exportFormat);
        },
        async readPermanentMainContentFromBcs(options = {}) {
            return await __readPermanentMainContentFromBcs(options);
        },
        async readPermanentTreeSnapshotFromBcs(options = {}) {
            return await __readPermanentTreeSnapshotFromBcs(options);
        },
        async writePermanentTreeSnapshotAfterChromeApply(localTreeInput, options = {}) {
            return await __writePermanentTreeSnapshotAfterChromeApply(localTreeInput, options);
        },
        async preparePermanentCreateNodeInBcs(createInfo, options = {}) {
            return await __preparePermanentCreateNodeInBcs(createInfo, options);
        },
        async commitPermanentCreatedNodeInBcs(pendingId, createdNode, options = {}) {
            return await __commitPermanentCreatedNodeInBcs(pendingId, createdNode, options);
        },
        async updatePermanentNodeInBcs(nodeId, updates, options = {}) {
            return await __updatePermanentNodeInBcs(nodeId, updates, options);
        },
        async removePermanentNodeFromBcs(nodeId, options = {}) {
            return await __removePermanentNodeFromBcs(nodeId, options);
        },
        async movePermanentNodeInBcs(nodeId, target, options = {}) {
            return await __movePermanentNodeInBcs(nodeId, target, options);
        },
        async applyPermanentBookmarkEventsToBcs(events, options = {}) {
            return await __applyPermanentBookmarkEventsToBcs(events, options);
        },
        async restorePermanentMainContentSnapshot(contentInput, options = {}) {
            return await __restorePermanentMainContentSnapshot(contentInput, options);
        },
        async syncPermanentMainTreeFromChromeBookmarks(options = {}) {
            return await __syncPermanentMainTreeFromChromeBookmarks(options);
        },
        stripPermanentLocalIdsFromTree(treeInput) {
            return __stripPermanentLocalIdsFromTree(treeInput);
        },
        clearPermanentTreeRenderCaches() {
            return __clearPermanentTreeRenderCachesAfterStorageUpdate();
        },
        applyPermanentRootMetaToTreeSnapshot(treeInput, rootMetaInput) {
            return __applyPermanentRootMetaToTreeSnapshot(treeInput, rootMetaInput);
        },
        persistPermanentRootMetaFromTree(treeInput) {
            return __persistPermanentRootMetaFromTreeSnapshot(treeInput);
        },
        readPermanentRootMeta() {
            return __readPermanentRootMetaStorageValue();
        },
        collectPermanentViewShellSnapshot(sourceInput = null, options = {}) {
            return __buildPermanentViewShellSnapshotProtocol(sourceInput, options);
        },
        normalizePermanentViewShellSnapshot(snapshotInput, options = {}) {
            return __normalizePermanentViewShellSnapshotProtocol(snapshotInput, options);
        },
        resolvePermanentViewShell(copyId = null, sourceInput = null) {
            return __resolvePermanentViewShell(copyId, sourceInput);
        },
        resolvePermanentSectionElement(copyId = null, options = {}) {
            return __resolvePermanentSectionElement(copyId, options);
        },
        resolvePermanentSectionContext(sectionEl, options = {}) {
            return __resolvePermanentSectionContext(sectionEl, options);
        },
        applyPermanentViewShellSnapshot(snapshotInput, options = {}) {
            return __applyPermanentViewShellSnapshotProtocol(snapshotInput, options);
        }
    });
}

function __isCanvasTempStateBcsMarker(state) {
    return !!(state && typeof state === 'object' && state.__storage === 'bcs');
}

function __getCanvasStorageLocalArea() {
    try {
        if (typeof browserAPI !== 'undefined' && browserAPI && browserAPI.storage && browserAPI.storage.local) return browserAPI.storage.local;
    } catch (_) { }
    try {
        if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local) return chrome.storage.local;
    } catch (_) { }
    try {
        if (typeof browser !== 'undefined' && browser && browser.storage && browser.storage.local) return browser.storage.local;
    } catch (_) { }
    return null;
}


function __buildBcsSectionKey(sectionId) {
    const id = String(sectionId || '').trim();
    return id ? `${BCS_SECTION_PREFIX}${id}` : '';
}

function __buildBcsPermCopyKey(copyId) {
    const id = String(copyId || '').trim();
    return id ? `${BCS_PERM_COPY_PREFIX}${id}` : '';
}

function __isBcsMetaPayload(meta) {
    return !!(meta && typeof meta === 'object' && Number(meta.schemaVersion) >= BCS_META_SCHEMA_VERSION);
}

function __bcsStorageGet(keys) {
    const storage = __getCanvasStorageLocalArea();
    const wantAll = keys == null;
    return new Promise((resolve) => {
        if (!storage || typeof storage.get !== 'function') {
            if (wantAll) {
                resolve({});
                return;
            }
            const list = Array.isArray(keys) ? keys : [keys];
            const result = {};
            list.forEach((key) => {
                if (!key) return;
                try {
                    const raw = localStorage.getItem(key);
                    result[key] = __safeParseCanvasStorageJson(raw);
                } catch (_) { }
            });
            resolve(result);
            return;
        }
        try {
            const maybePromise = storage.get(wantAll ? null : (Array.isArray(keys) ? keys : [keys]), (result) => {
                resolve(result && typeof result === 'object' ? result : {});
            });
            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.then((result) => resolve(result && typeof result === 'object' ? result : {})).catch(() => resolve({}));
            }
        } catch (_) {
            resolve({});
        }
    });
}

function __bcsStorageGetAll() {
    return __bcsStorageGet(null);
}

function __bcsStorageRemove(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const storage = __getCanvasStorageLocalArea();
    if (!list.length) return Promise.resolve(false);
    if (!storage || typeof storage.remove !== 'function') {
        list.forEach((key) => {
            if (!key) return;
            try { localStorage.removeItem(key); } catch (_) { }
        });
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        let settled = false;
        const done = (ok) => {
            if (settled) return;
            settled = true;
            resolve(ok !== false);
        };
        try {
            const maybePromise = storage.remove(list, () => {
                done(true);
            });
            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.then(() => done(true)).catch(() => done(false));
            }
        } catch (_) {
            done(false);
        }
    });
}

function __bcsStorageSet(payload, { immediate = false } = {}) {
    if (!payload || typeof payload !== 'object') return Promise.resolve(false);
    const storage = __getCanvasStorageLocalArea();
    if (!storage || typeof storage.set !== 'function') {
        Object.keys(payload).forEach((key) => {
            if (!key) return;
            try { saveSharedState(key, payload[key]); } catch (_) { }
        });
        return Promise.resolve(true);
    }

    if (!immediate) {
        __canvasTempStateBcsWritePending = Object.assign({}, __canvasTempStateBcsWritePending || {}, payload);
        const waiter = new Promise((resolve) => {
            __canvasTempStateBcsWriteWaiters.push(resolve);
        });
        if (!__canvasTempStateBcsWriteTimer) {
            __canvasTempStateBcsWriteTimer = setTimeout(() => {
                __canvasTempStateBcsWriteTimer = null;
                const pending = __canvasTempStateBcsWritePending;
                const waiters = __canvasTempStateBcsWriteWaiters.slice();
                __canvasTempStateBcsWritePending = null;
                __canvasTempStateBcsWriteWaiters = [];
                if (!pending) {
                    waiters.forEach((resolve) => {
                        try { resolve(false); } catch (_) { }
                    });
                    return;
                }
                __bcsStorageSet(pending, { immediate: true }).then((ok) => {
                    waiters.forEach((resolve) => {
                        try { resolve(ok); } catch (_) { }
                    });
                });
            }, 320);
        }
        return waiter;
    }

    return new Promise((resolve) => {
        let settled = false;
        const done = (ok) => {
            if (settled) return;
            settled = true;
            resolve(ok !== false);
        };
        try {
            const maybePromise = storage.set(payload, () => {
                done(true);
            });
            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.then(() => done(true)).catch(() => done(false));
            }
        } catch (_) {
            done(false);
        }
    });
}

function __buildBcsStableJsonValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => __buildBcsStableJsonValue(item));
    }
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc, key) => {
            acc[key] = __buildBcsStableJsonValue(value[key]);
            return acc;
        }, {});
    }
    return value;
}

function __hashBcsString(input) {
    const text = String(input == null ? '' : input);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = (hash >>> 0) * 0x01000193;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function __buildBcsSignature(value) {
    const stable = __buildBcsStableJsonValue(value);
    let raw = '';
    try {
        raw = JSON.stringify(stable);
    } catch (_) {
        raw = '';
    }
    return __hashBcsString(raw);
}

function __buildBcsTextSignature(value) {
    return __hashBcsString(String(value == null ? '' : value));
}

function __getBcsExportRootCached() {
    const { isEn } = __getLang();
    return __normalizeObsidianExportRoot(__bcsExportRootCache || '', isEn, { allowEmpty: true });
}

function __getBcsExportFormatCached() {
    return __normalizeCanvasObsidianExportFormat(__bcsExportFormatCache || '', 'json');
}

function __copyCanvasExtraKeys(source, target, reservedKeys) {
    if (!source || typeof source !== 'object' || !target || typeof target !== 'object') return target;
    Object.keys(source).forEach((key) => {
        if (!key || reservedKeys.has(key)) return;
        if (typeof source[key] === 'undefined') return;
        target[key] = source[key];
    });
    return target;
}

function __canonicalizeObsidianCanvasNodeForJson(nodeInput) {
    const node = (nodeInput && typeof nodeInput === 'object') ? nodeInput : {};
    const type = String(node.type || '').trim();
    const baseKeys = new Set(['id', 'type', 'x', 'y', 'width', 'height']);
    if (type === 'file') {
        const result = {
            id: node.id,
            type: 'file',
            file: String(node.file == null ? '' : node.file),
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height
        };
        if (node.color != null && String(node.color).trim()) result.color = node.color;
        return __copyCanvasExtraKeys(node, result, new Set([...baseKeys, 'file', 'color']));
    }
    if (type === 'text') {
        const result = {
            id: node.id,
            type: 'text',
            text: String(node.text == null ? '' : node.text),
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height
        };
        if (node.color != null && String(node.color).trim()) result.color = node.color;
        return __copyCanvasExtraKeys(node, result, new Set([...baseKeys, 'text', 'color']));
    }
    if (type === 'group') {
        // 严格 JsonCanvas group：仅保留标准 8 字段，不透传任何私有 extra key。
        const result = {
            id: node.id,
            type: 'group',
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height
        };
        if (node.label != null && String(node.label).trim()) result.label = node.label;
        if (node.color != null && String(node.color).trim()) result.color = node.color;
        return result;
    }
    return __copyCanvasExtraKeys(node, {
        id: node.id,
        type: node.type,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height
    }, baseKeys);
}

function __canonicalizeObsidianCanvasEdgeForJson(edgeInput) {
    const edge = (edgeInput && typeof edgeInput === 'object') ? edgeInput : {};
    const result = {
        id: edge.id,
        fromNode: edge.fromNode,
        fromSide: edge.fromSide || 'right',
        toNode: edge.toNode,
        toSide: edge.toSide || 'left'
    };
    const fromEnd = edge.fromEnd === 'arrow' ? 'arrow' : 'none';
    const toEnd = edge.toEnd === 'none' ? 'none' : 'arrow';
    if (fromEnd !== 'none') result.fromEnd = fromEnd;
    if (toEnd !== 'arrow') result.toEnd = toEnd;
    if (edge.color != null && String(edge.color).trim()) result.color = edge.color;
    if (edge.label != null && String(edge.label).trim()) result.label = edge.label;
    return __copyCanvasExtraKeys(edge, result, new Set([
        'id',
        'fromNode',
        'fromSide',
        'toNode',
        'toSide',
        'fromEnd',
        'toEnd',
        'color',
        'label'
    ]));
}

function __formatObsidianCanvasJson(canvasDataInput) {
    const canvasData = (canvasDataInput && typeof canvasDataInput === 'object') ? canvasDataInput : { nodes: [], edges: [] };
    const nodes = Array.isArray(canvasData.nodes) ? canvasData.nodes.map(__canonicalizeObsidianCanvasNodeForJson) : [];
    const edges = Array.isArray(canvasData.edges) ? canvasData.edges.map(__canonicalizeObsidianCanvasEdgeForJson) : [];
    const lines = ['{', '	"nodes":['];

    nodes.forEach((node, index) => {
        const suffix = index < (nodes.length - 1) ? ',' : '';
        lines.push(`		${JSON.stringify(node)}${suffix}`);
    });

    lines.push('	],', '	"edges":[');

    edges.forEach((edge, index) => {
        const suffix = index < (edges.length - 1) ? ',' : '';
        lines.push(`		${JSON.stringify(edge)}${suffix}`);
    });

    lines.push('	]', '}');
    return lines.join('\n');
}

function __normalizeBcsCanvasPayload(payloadInput) {
    const source = (payloadInput && typeof payloadInput === 'object') ? payloadInput : {};
    return {
        nodes: Array.isArray(source.nodes) ? source.nodes : [],
        edges: Array.isArray(source.edges) ? source.edges : []
    };
}

function __readBcsCanvasPayload(rawValue, options = {}) {
    if (typeof rawValue === 'string') {
        const text = String(rawValue).trim();
        if (!text) {
            return options && options.allowEmptyFallback === false ? null : __normalizeBcsCanvasPayload(null);
        }
        try {
            return __normalizeBcsCanvasPayload(JSON.parse(text));
        } catch (_) {
            return options && options.allowEmptyFallback === false ? null : __normalizeBcsCanvasPayload(null);
        }
    }
    if (rawValue && typeof rawValue === 'object') {
        return __normalizeBcsCanvasPayload(rawValue);
    }
    return options && options.allowEmptyFallback === false ? null : __normalizeBcsCanvasPayload(null);
}

function __canonicalizeBcsCanvasStorageIfNeeded(storageMap, options = {}) {
    const storage = storageMap && typeof storageMap === 'object' ? storageMap : {};
    if (!Object.prototype.hasOwnProperty.call(storage, BCS_CANVAS_KEY)) return false;

    const canvasRaw = storage[BCS_CANVAS_KEY];
    const parsedPayload = __readBcsCanvasPayload(canvasRaw, { allowEmptyFallback: false });
    if (!parsedPayload) return false;

    const canonicalText = __formatObsidianCanvasJson(parsedPayload);
    const needsCanvasRewrite = (typeof canvasRaw !== 'string') || (canvasRaw !== canonicalText);
    if (!needsCanvasRewrite) return false;

    const updates = {};
    if (needsCanvasRewrite) updates[BCS_CANVAS_KEY] = canonicalText;
    __bcsStorageSet(updates, { immediate: !!(options && options.immediate) });
    return true;
}

function __buildBcsCanvasFilePath(exportRoot, canvasFileName = '') {
    const { isEn } = __getLang();
    const normalizedRoot = String(exportRoot || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const defaultName = isEn ? 'bookmark-canvas' : '书签画布';
    const leaf = normalizedRoot.split('/').filter(Boolean).slice(-1)[0] || defaultName;
    const fileName = String(canvasFileName || '').trim() || `${leaf}.canvas`;
    return __joinObsidianExportPath(normalizedRoot, fileName);
}

function __buildBcsMetaPayloadFromState(stateInput) {
    const state = stateInput && typeof stateInput === 'object' ? stateInput : {};
    return {
        schemaVersion: BCS_META_SCHEMA_VERSION,
        tempSectionCounter: Number(state.tempSectionCounter) || 0,
        tempItemCounter: Number(state.tempItemCounter) || 0,
        mdNodeCounter: Number(state.mdNodeCounter) || 0,
        edgeCounter: Number(state.edgeCounter) || 0,
        colorCursor: Number(state.colorCursor) || 0,
        tempSectionLastColor: state.tempSectionLastColor || getTempSectionDefaultColor(),
        tempSectionPrevColor: state.tempSectionPrevColor || null,
        timestamp: Number(state.timestamp) || Date.now()
    };
}

function __buildBcsSectionPayloadFromSection(section) {
    if (!section || typeof section !== 'object') return null;
    const protocol = __buildTempSectionJsonProtocol(section);
    if (!protocol || typeof protocol !== 'object') return null;
    if (!protocol.id && section.id) {
        protocol.id = String(section.id);
    }
    return protocol;
}

function __buildBcsPermanentPayload(copyId = null) {
    if (copyId) return __buildPermanentCopyAnchorContentPayload(copyId);
    return null;
}

async function __buildBcsDocumentsFromState(stateInput, options = {}) {
    const state = __buildPersistedCanvasState(stateInput, options);
    if (!state || typeof state !== 'object') return null;
    const storage = options && options.storage && typeof options.storage === 'object'
        ? options.storage
        : null;
    const fileRefs = options && options.fileRefs && typeof options.fileRefs === 'object'
        ? options.fileRefs
        : __collectBcsFileRefsFromState(state, {
            exportRoot: (options && typeof options.exportRoot === 'string') ? options.exportRoot : __getBcsExportRootCached(),
            exportFormat: (options && typeof options.exportFormat === 'string') ? options.exportFormat : __getBcsExportFormatCached()
        });
    const canvasData = __buildBcsCanvasDataFromState(state, fileRefs, {
        storageMap: storage,
        preferStoragePermanentLayout: options && options.preferStoragePermanentLayout === true
    });
    const updates = {};
    const removals = [];
    const sections = Array.isArray(state.sections) ? state.sections : [];
    const sectionById = new Map();
    const sectionIdSet = new Set();

    sections.forEach((section) => {
        const id = String(section && section.id || '').trim();
        if (!id) return;
        sectionById.set(id, section);
        sectionIdSet.add(id);
    });

    updates[BCS_META_KEY] = __buildBcsMetaPayloadFromState(state);
    updates[BCS_CANVAS_KEY] = __formatObsidianCanvasJson({
        nodes: Array.isArray(canvasData && canvasData.nodes) ? canvasData.nodes : [],
        edges: Array.isArray(canvasData && canvasData.edges) ? canvasData.edges : []
    });

    Array.from(sectionIdSet.values()).forEach((idInput) => {
        const id = String(idInput || '').trim();
        if (!id) return;
        const section = sectionById.get(id);
        if (!section) return;
        const payload = __buildBcsSectionPayloadFromSection(section);
        if (!payload) return;
        updates[__buildBcsSectionKey(id)] = payload;
    });

    const permContentBase = await __ensurePermanentMainContentInBcs();
    const permContent = permContentBase && typeof permContentBase === 'object'
        ? {
            ...permContentBase,
            descriptionMd: __resolvePermanentSectionDescriptionMarkdown(null, null, {
                preserveRawSource: true
            })
        }
        : null;
    if (permContent) {
        updates[BCS_PERM_MAIN_KEY] = permContent;
    }

    const copyIds = Object.keys((fileRefs && fileRefs.copyPathById) ? fileRefs.copyPathById : {});
    const copyIdSet = new Set(copyIds.map((id) => String(id || '').trim()).filter(Boolean));
    copyIds.forEach((copyId) => {
        const id = String(copyId || '').trim();
        if (!id) return;
        updates[__buildBcsPermCopyKey(id)] = __buildBcsPermanentPayload(id);
    });

    if (storage && typeof storage === 'object') {
        Object.keys(storage).forEach((key) => {
            if (!key) return;
            if (key.startsWith(BCS_SECTION_PREFIX)) {
                const id = key.slice(BCS_SECTION_PREFIX.length);
                if (!sectionIdSet.has(id)) removals.push(key);
            } else if (key.startsWith(BCS_PERM_COPY_PREFIX)) {
                const id = key.slice(BCS_PERM_COPY_PREFIX.length);
                if (!copyIdSet.has(id)) removals.push(key);
            }
        });
    }

    return {
        state,
        fileRefs,
        canvasData,
        updates,
        removals,
        sectionIdSet,
        copyIdSet
    };
}

async function __saveCanvasTempStateToBcsStorage(stateInput, options = {}) {
    try {
        const state = __buildPersistedCanvasState(stateInput, options);
        if (!state || typeof state !== 'object') return;
        const fileRefs = __collectBcsFileRefsFromState(state, {
            exportRoot: __getBcsExportRootCached(),
            exportFormat: __getBcsExportFormatCached()
        });
        const storage = await __bcsStorageGetAll();
        const storagePatch = (options && options.storagePatch && typeof options.storagePatch === 'object')
            ? options.storagePatch
            : null;
        if (storagePatch) {
            Object.assign(storage, storagePatch);
        }
        const documents = await __buildBcsDocumentsFromState(state, {
            fileRefs,
            storage,
            preferStoragePermanentLayout: options && options.preferStoragePermanentLayout === true
        });
        if (!documents) return;
        const immediate = !!(options && options.immediate);
        const updates = documents.updates || {};
        const removals = Array.isArray(documents.removals) ? documents.removals : [];

        if (immediate && __canvasTempStateBcsWriteTimer) {
            try { clearTimeout(__canvasTempStateBcsWriteTimer); } catch (_) { }
            __canvasTempStateBcsWriteTimer = null;
            __canvasTempStateBcsWritePending = null;
            const waiters = __canvasTempStateBcsWriteWaiters.slice();
            __canvasTempStateBcsWriteWaiters = [];
            waiters.forEach((resolve) => {
                try { resolve(false); } catch (_) { }
            });
        }

        if (removals.length) {
            await __bcsStorageRemove(removals);
        }
        await __bcsStorageSet(updates, { immediate });
        try {
            await __bcsStorageSet({
                [BCS_SIGNAL_KEY]: {
                    __storage: 'bcs',
                    timestamp: Number(state.timestamp) || Date.now()
                }
            }, { immediate });
        } catch (_) { }
        try {
            saveSharedState(BCS_SIGNAL_KEY, {
                __storage: 'bcs',
                timestamp: Number(state.timestamp) || Date.now()
            });
        } catch (_) { }
    } catch (e) {
        console.warn('[Canvas] BCS 分片写入失败:', e);
    }
}

async function __loadCanvasTempStateFromBcs(options = {}) {
    try { await __migrateLegacyTempSectionKeysOnce(); } catch (_) {}
    const bundle = await __loadCanvasTempStateBundleFromBcs(options);
    return bundle ? bundle.state : null;
}

async function __loadCanvasTempStateBundleFromBcs(options = {}) {
    const storage = await __bcsStorageGetAll();
    const meta = storage ? storage[BCS_META_KEY] : null;
    if (!__isBcsMetaPayload(meta)) return null;
    try {
        __canonicalizeBcsCanvasStorageIfNeeded(storage, {
            immediate: true
        });
    } catch (_) { }
    const mergedOptions = { skipValidation: true, ...options };
    return {
        state: __buildCanvasTempStateFromBcsStorage(storage, meta, mergedOptions),
        storage
    };
}

function __buildCanvasTempStateFromBcsStorage(storageMap, metaPayload, options = {}) {
    const storage = storageMap && typeof storageMap === 'object' ? storageMap : {};
    const meta = metaPayload && typeof metaPayload === 'object' ? metaPayload : {};
    const canvasRaw = storage[BCS_CANVAS_KEY];
    const canvas = __readBcsCanvasPayload(canvasRaw);
    const nodes = Array.isArray(canvas && canvas.nodes) ? canvas.nodes : [];
    const edges = Array.isArray(canvas && canvas.edges) ? canvas.edges : [];

    const nodeById = new Map();
    nodes.forEach((node) => {
        if (!node || !node.id) return;
        nodeById.set(String(node.id), node);
    });

    const tempState = {
        sections: [],
        mdNodes: [],
        edges: [],
        tempSectionCounter: Number(meta.tempSectionCounter) || 0,
        tempItemCounter: Number(meta.tempItemCounter) || 0,
        mdNodeCounter: Number(meta.mdNodeCounter) || 0,
        edgeCounter: Number(meta.edgeCounter) || 0,
        colorCursor: Number(meta.colorCursor) || 0,
        tempSectionLastColor: meta.tempSectionLastColor || getTempSectionDefaultColor(),
        tempSectionPrevColor: Object.prototype.hasOwnProperty.call(meta, 'tempSectionPrevColor') ? meta.tempSectionPrevColor : null,
        timestamp: Number(meta.timestamp) || Date.now()
    };

    try {
        const permMainRaw = storage[BCS_PERM_MAIN_KEY];
        const permMain = permMainRaw && typeof permMainRaw === 'object' ? permMainRaw : null;
        const rootMeta = __normalizePermanentRootMeta(permMain && permMain.rootMeta ? permMain.rootMeta : null);
        if (rootMeta) {
            __persistPermanentRootMetaStorageValue(rootMeta);
        }
    } catch (_) { }

    const sectionPayloadById = new Map();
    Object.keys(storage).forEach((key) => {
        if (!key || !key.startsWith(BCS_SECTION_PREFIX)) return;
        const id = key.slice(BCS_SECTION_PREFIX.length);
        if (!id) return;
        const payload = storage[key];
        if (!payload || typeof payload !== 'object') return;
        if (!payload.id) payload.id = id;
        sectionPayloadById.set(String(id), payload);
    });

    const orderedSectionIds = [];
    const seenSectionIds = new Set();
    nodes.forEach((node) => {
        const id = String(node && node.id || '').trim();
        if (!id || !sectionPayloadById.has(id) || seenSectionIds.has(id)) return;
        seenSectionIds.add(id);
        orderedSectionIds.push(id);
    });
    Array.from(sectionPayloadById.keys())
        .sort((a, b) => String(a).localeCompare(String(b)))
        .forEach((id) => {
            if (seenSectionIds.has(id)) return;
            seenSectionIds.add(id);
            orderedSectionIds.push(id);
        });

    orderedSectionIds.forEach((id) => {
        const payload = sectionPayloadById.get(id);
        if (!payload) return;
        const layout = nodeById.get(id) || null;
        const convertedColor = layout && layout.color ? convertObsidianColor(layout.color) : null;
        const section = __buildRuntimeTempSectionFromProtocol(payload, {
            sectionId: id,
            x: layout ? layout.x : 0,
            y: layout ? layout.y : 0,
            width: layout ? layout.width : 0,
            height: layout ? layout.height : 0,
            color: convertedColor || getTempSectionDefaultColor(payload),
            pinned: false
        });
        if (section) tempState.sections.push(section);
    });

    const { isEn } = __getLang();

    nodes.forEach((node) => {
        if (!node || !node.id) return;

        if (node.type === 'group') {
            const labelRaw = (typeof node.label === 'string') ? node.label : '';
            const convertedColor = convertObsidianColor(node.color);
            const isHex = convertedColor && convertedColor.startsWith('#');

            tempState.mdNodes.push({
                id: node.id,
                type: 'md',
                subtype: 'card-group',
                x: node.x,
                y: node.y,
                width: node.width,
                height: node.height,
                label: labelRaw || (isEn ? 'Card Group' : '卡片组'),
                color: null,
                colorHex: isHex ? convertedColor : null,
                pinned: false
            });
            return;
        }

        if (node.type === 'file' && node.file) {
            const isSection = sectionPayloadById.has(String(node.id));
            if (!isSection) {
                const isPermanent = __isPermanentMarkdownPath(node.file);
                const isTempSection = node.file.includes('Temporary/') || node.file.includes('Temporary Sections/') || node.file.includes('临时栏目/');
                const isSpecialBookmark = (isPermanent || isTempSection) && /\.(md|json)$/i.test(String(node.file));

                if (!isSpecialBookmark) {
                    const convertedColor = convertObsidianColor(node.color);
                    const isHex = convertedColor && convertedColor.startsWith('#');
                    tempState.mdNodes.push({
                        id: node.id,
                        x: node.x,
                        y: node.y,
                        width: node.width,
                        height: node.height,
                        color: isHex ? null : node.color,
                        colorHex: isHex ? convertedColor : null,
                        file: String(node.file),
                        type: 'file'
                    });
                }
            }
            return;
        }

        if (node.type === 'text') {
            const convertedColor = convertObsidianColor(node.color);
            const isHex = convertedColor && convertedColor.startsWith('#');
            const isBlankCard = node.id && String(node.id).startsWith('md-node-');

            tempState.mdNodes.push({
                id: node.id,
                x: node.x,
                y: node.y,
                width: node.width,
                height: node.height,
                color: isHex ? null : node.color,
                colorHex: isHex ? convertedColor : null,
                text: String(node.text || ''),
                subtype: isBlankCard ? CANVAS_PLUGIN_MARKDOWN_SUBTYPE : CANVAS_NATIVE_TEXT_SUBTYPE,
                source: isBlankCard ? CANVAS_PLUGIN_MARKDOWN_SOURCE : CANVAS_NATIVE_TEXT_SOURCE,
                canvasTextKind: isBlankCard ? 'blank' : 'native'
            });
        }
    });

    tempState.edges = edges.map((edge) => {
        const convertedColor = convertObsidianColor(edge.color);
        const isHex = convertedColor && convertedColor.startsWith('#');
        const fromEnd = edge && edge.fromEnd === 'arrow' ? 'arrow' : 'none';
        const toEnd = edge && edge.toEnd === 'none' ? 'none' : 'arrow';
        const direction = (fromEnd === 'arrow' && toEnd === 'arrow')
            ? 'both'
            : (toEnd === 'arrow' ? 'forward' : 'none');

        return {
            id: edge.id,
            fromNode: edge.fromNode,
            toNode: edge.toNode,
            fromSide: edge.fromSide || '',
            toSide: edge.toSide || '',
            label: edge.label || '',
            direction,
            color: isHex ? null : edge.color,
            colorHex: isHex ? convertedColor : null
        };
    });

    return __buildCanvasTempStateProtocolView(tempState, options);
}
