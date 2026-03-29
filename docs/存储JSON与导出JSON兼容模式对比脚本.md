# 存储 JSON 与导出 JSON 兼容模式对比脚本

用途：在**书签画布页面**直接提取“当前真实存储数据”，按分类下载 JSON，并与“JSON 兼容模式导出”结果做自动对比。  
运行位置：扩展页面（Canvas 页面）`DevTools -> Console`。  

## 1) 先执行：引导脚本（只需一次）

```js
(function bootstrapCanvasJsonProbe() {
  if (window.__canvasJsonProbe && window.__canvasJsonProbe.__version) {
    console.log('[canvas-json-probe] already ready:', window.__canvasJsonProbe.__version);
    return;
  }

  const PROBE_VERSION = '2026-03-31-v5';
  const runtime = window.browserAPI || window.chrome || window.browser;
  if (!runtime) {
    throw new Error('[canvas-json-probe] runtime API not found.');
  }

  const storageArea = (() => {
    try { if (runtime.storage && runtime.storage.local) return runtime.storage.local; } catch (_) {}
    return null;
  })();

  const bookmarksApi = (() => {
    try { if (runtime.bookmarks) return runtime.bookmarks; } catch (_) {}
    return null;
  })();
  const protocolBridge = (() => {
    try { return window.CanvasProtocolBridge || null; } catch (_) { return null; }
  })();

  const toPromiseCall = (fn, ctx, ...args) => new Promise((resolve, reject) => {
    try {
      const maybe = fn.call(ctx, ...args, (result) => {
        const err = runtime && runtime.runtime && runtime.runtime.lastError;
        if (err && err.message) {
          reject(new Error(err.message));
          return;
        }
        resolve(result);
      });
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(resolve).catch(reject);
      }
    } catch (e) {
      reject(e);
    }
  });

  const storageGetAll = async () => {
    if (!storageArea || typeof storageArea.get !== 'function') {
      throw new Error('[canvas-json-probe] storage.local is unavailable.');
    }
    try {
      const maybe = storageArea.get(null);
      if (maybe && typeof maybe.then === 'function') return maybe;
    } catch (_) {}
    return toPromiseCall(storageArea.get, storageArea, null);
  };

  const bookmarksGetTree = async () => {
    if (!bookmarksApi || typeof bookmarksApi.getTree !== 'function') {
      throw new Error('[canvas-json-probe] bookmarks API is unavailable.');
    }
    try {
      const maybe = bookmarksApi.getTree();
      if (maybe && typeof maybe.then === 'function') return maybe;
    } catch (_) {}
    return toPromiseCall(bookmarksApi.getTree, bookmarksApi);
  };

  const parseMaybeJson = (value) => {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (_) { return value; }
  };

  const deepClone = (value) => {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
  };

  const normalizePermanentTreeSnapshotForCompare = (treeInput) => {
    try {
      if (protocolBridge && typeof protocolBridge.normalizePermanentTreeSnapshot === 'function') {
        const normalized = protocolBridge.normalizePermanentTreeSnapshot(treeInput, { persistRootMeta: false });
        if (Array.isArray(normalized) && normalized.length) return deepClone(normalized);
      }
    } catch (_) {}
    return deepClone(treeInput);
  };

  const readLocalStorageItem = (key) => {
    try {
      if (typeof localStorage === 'undefined' || !localStorage || typeof localStorage.getItem !== 'function') {
        return null;
      }
      return localStorage.getItem(String(key || ''));
    } catch (_) {
      return null;
    }
  };

  const collectLocalStorageByPrefixes = (prefixes = []) => {
    const list = Array.isArray(prefixes) ? prefixes.map((item) => String(item || '')) : [];
    const out = {};
    try {
      if (typeof localStorage === 'undefined' || !localStorage || typeof localStorage.length !== 'number') {
        return out;
      }
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (!list.some((prefix) => prefix && key.startsWith(prefix))) continue;
        out[key] = localStorage.getItem(key);
      }
    } catch (_) {}
    return out;
  };

  const stripGuardFields = (payload) => {
    const source = parseMaybeJson(payload);
    if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
    const cloned = deepClone(source);
    if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) return cloned;
    delete cloned._signature;
    delete cloned._lastSyncedSignature;
    delete cloned._dirty;
    delete cloned._filePath;
    return cloned;
  };

  const stableValue = (value) => {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach((k) => { out[k] = stableValue(value[k]); });
      return out;
    }
    return value;
  };

  const stableStringify = (value) => JSON.stringify(stableValue(value));
  const stableEqual = (a, b) => stableStringify(a) === stableStringify(b);

  const normalizeText = (text) => String(text == null ? '' : text).replace(/\r\n?/g, '\n').trimEnd();

  const fnv1a = (input) => {
    const text = String(input == null ? '' : input);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = (hash >>> 0) * 0x01000193;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };

  const textHash = (text) => fnv1a(normalizeText(text));

  const downloadJson = (filename, data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadText = (filename, text, mime = 'text/plain;charset=utf-8') => {
    const blob = new Blob([String(text == null ? '' : text)], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const formatCanvasLikeObsidian = (canvasDataInput) => {
    const canvasData = (canvasDataInput && typeof canvasDataInput === 'object')
      ? canvasDataInput
      : { nodes: [], edges: [] };
    const nodes = Array.isArray(canvasData.nodes) ? canvasData.nodes : [];
    const edges = Array.isArray(canvasData.edges) ? canvasData.edges : [];
    const lines = ['{', '\t\"nodes\":['];
    nodes.forEach((node, index) => {
      const suffix = index < (nodes.length - 1) ? ',' : '';
      lines.push(`\t\t${JSON.stringify(node)}${suffix}`);
    });
    lines.push('\t],', '\t\"edges\":[');
    edges.forEach((edge, index) => {
      const suffix = index < (edges.length - 1) ? ',' : '';
      lines.push(`\t\t${JSON.stringify(edge)}${suffix}`);
    });
    lines.push('\t]', '}');
    return lines.join('\n');
  };

  const downloadCanvasLikeObsidian = (filename, canvasPayload) => {
    const safe = (canvasPayload && typeof canvasPayload === 'object')
      ? canvasPayload
      : { nodes: [], edges: [] };
    downloadText(filename, formatCanvasLikeObsidian(safe), 'application/json;charset=utf-8');
  };

  const readCanvasPayloadFromStorageValue = (rawValue) => {
    if (typeof rawValue === 'string') {
      const text = String(rawValue || '').trim();
      if (!text) return { nodes: [], edges: [] };
      try {
        const parsed = JSON.parse(text);
        return {
          nodes: Array.isArray(parsed && parsed.nodes) ? parsed.nodes : [],
          edges: Array.isArray(parsed && parsed.edges) ? parsed.edges : []
        };
      } catch (_) {
        return { nodes: [], edges: [] };
      }
    }
    const source = stripGuardFields(rawValue);
    return {
      nodes: Array.isArray(source && source.nodes) ? source.nodes : [],
      edges: Array.isArray(source && source.edges) ? source.edges : []
    };
  };

  const isPermanentPath = (path) => /(^|\/)(永久栏目|Permanent)(\/|$)/i.test(String(path || ''));
  const isTemporaryPath = (path) => /(^|\/)(临时栏目|Temporary)(\/|$)/i.test(String(path || ''));
  const isBlankPath = (path) => /(^|\/)(空白栏目|Blank)(\/|$)/i.test(String(path || ''));
  const isCanvasPath = (path) => /\.canvas$/i.test(String(path || ''));

  const classifyExportFile = (file) => {
    const path = String(file && file.path || '');
    const content = String(file && file.content || '');
    const meta = file && file.meta ? deepClone(file.meta) : null;
    let parsed = null;
    if (/\.json$/i.test(path) || isCanvasPath(path)) {
      try { parsed = JSON.parse(content); } catch (_) { parsed = null; }
    }
    return {
      path,
      meta,
      content,
      contentHash: textHash(content),
      json: parsed
    };
  };

  const collectActual = async () => {
    const all = await storageGetAll();
    const bookmarkTree = await bookmarksGetTree();
    const bookmarkTreeProtocol = normalizePermanentTreeSnapshotForCompare(bookmarkTree);
    const localStoragePermanentSubset = collectLocalStorageByPrefixes(['bcs:perm:']);
    const permMainPayload = stripGuardFields(all['bcs:perm:main']);
    const permCopiesMetaRaw = readLocalStorageItem('bcs:perm:copies');
    const permRootMetaLocalRaw = readLocalStorageItem('bcs:perm:root-meta');
    const permTipMainRaw = readLocalStorageItem('bcs:perm:tip-main');

    const copyTips = {};
    Object.keys(localStoragePermanentSubset || {})
      .filter((key) => key.startsWith('bcs:perm:tip-copy-'))
      .sort()
      .forEach((key) => {
        const copyId = key.slice('bcs:perm:tip-copy-'.length);
        copyTips[copyId] = String(localStoragePermanentSubset[key] == null ? '' : localStoragePermanentSubset[key]);
      });

    const sectionEntries = Object.keys(all || {})
      .filter((key) => key.startsWith('bcs:section:'))
      .sort()
      .map((key) => ({
        key,
        id: key.slice('bcs:section:'.length),
        payload: stripGuardFields(all[key])
      }));

    const mdEntries = Object.keys(all || {})
      .filter((key) => key.startsWith('bcs:md:'))
      .sort()
      .map((key) => {
        const payload = stripGuardFields(all[key]);
        return {
          key,
          id: key.slice('bcs:md:'.length),
          payload,
          markdownHash: textHash(payload && payload.markdownSource || '')
        };
      });

    const permCopyEntries = Object.keys(all || {})
      .filter((key) => key.startsWith('bcs:perm:copy-'))
      .sort()
      .map((key) => ({
        key,
        copyId: key.slice('bcs:perm:copy-'.length),
        payload: stripGuardFields(all[key])
      }));

    const canvasRawValue = all['bcs:canvas'];
    const canvasPayload = readCanvasPayloadFromStorageValue(canvasRawValue);
    const canvasRawText = typeof canvasRawValue === 'string'
      ? String(canvasRawValue)
      : formatCanvasLikeObsidian(canvasPayload);

    return {
      generatedAt: new Date().toISOString(),
      source: 'actual-storage',
      storageKeyCount: Object.keys(all || {}).length,
      permanent: {
        bookmarkTreeSnapshotRaw: deepClone(bookmarkTree),
        bookmarkTreeSnapshotProtocol: bookmarkTreeProtocol,
        permMainPayload,
        permCopyPayloads: permCopyEntries,
        copiesMeta: parseMaybeJson(permCopiesMetaRaw),
        rootMeta: parseMaybeJson(permRootMetaLocalRaw)
          || (permMainPayload && permMainPayload.rootMeta ? deepClone(permMainPayload.rootMeta) : null),
        tipMain: String(permTipMainRaw == null ? '' : permTipMainRaw),
        tipCopies: copyTips,
        localStoragePermanentSubset: deepClone(localStoragePermanentSubset)
      },
      temporary: {
        meta: stripGuardFields(all['bcs:meta']),
        sections: sectionEntries,
        legacyTempSnapshot: parseMaybeJson(all['bcs:temp-state-snapshot'])
      },
      blank: {
        mdNodes: mdEntries
      },
      canvas: {
        storageType: typeof canvasRawValue,
        rawText: canvasRawText,
        payload: canvasPayload,
        meta: deepClone(all['bcs:canvas:meta']) || null
      },
      rawStorage: {
        storageLocal: deepClone(all),
        localStoragePermanentSubset: deepClone(localStoragePermanentSubset)
      }
    };
  };

  const collectExportJsonMode = async () => {
    const bridge = window.CanvasObsidianExportBridge;
    if (!bridge || typeof bridge.buildSyncFiles !== 'function') {
      throw new Error('[canvas-json-probe] CanvasObsidianExportBridge.buildSyncFiles is unavailable.');
    }

    const all = await storageGetAll();
    const settings = parseMaybeJson(all['canvas-obsidian-git-sync-settings-v1']) || {};
    const exportRoot = (settings && typeof settings.obsidianExportRoot === 'string')
      ? settings.obsidianExportRoot
      : '';

    const built = await bridge.buildSyncFiles({
      exportFormat: 'json',
      exportRoot
    });

    const files = Array.isArray(built && built.files) ? built.files.map(classifyExportFile) : [];

    const permanentFiles = files.filter((f) => isPermanentPath(f.path) && /\.json$/i.test(f.path));
    const temporaryFiles = files.filter((f) => isTemporaryPath(f.path) && /\.json$/i.test(f.path));
    const blankFiles = files.filter((f) => isBlankPath(f.path));
    const canvasFile = files.find((f) => isCanvasPath(f.path)) || null;

    const mainPermanent = permanentFiles.find((f) => f.json && f.json.sectionType === 'permanent' && f.json.fileRole !== 'copy-anchor') || null;
    const copyPermanent = permanentFiles.filter((f) => f.json && f.json.sectionType === 'permanent' && f.json.fileRole === 'copy-anchor');

    return {
      generatedAt: new Date().toISOString(),
      source: 'export-json-mode',
      exportRoot: built && typeof built.exportRoot === 'string' ? built.exportRoot : exportRoot,
      canvasFileName: built && typeof built.canvasFileName === 'string' ? built.canvasFileName : '',
      fileCount: files.length,
      permanent: {
        files: permanentFiles,
        main: mainPermanent,
        copies: copyPermanent
      },
      temporary: {
        files: temporaryFiles
      },
      blank: {
        files: blankFiles
      },
      canvas: {
        file: canvasFile
      },
      allFiles: files
    };
  };

  const compareActualWithExport = async () => {
    const actual = await collectActual();
    const exported = await collectExportJsonMode();

    const actualRoot = Array.isArray(actual.permanent.bookmarkTreeSnapshotProtocol)
      ? (actual.permanent.bookmarkTreeSnapshotProtocol[0] || null)
      : null;
    const exportMainTree = exported.permanent.main && exported.permanent.main.json
      ? (exported.permanent.main.json.tree || null)
      : null;

    const normalizeTempKind = (value) => {
      const raw = String(value == null ? '' : value).trim().toLowerCase();
      return (raw === 'special' || raw === 'regular') ? raw : '';
    };

    const normalizeTempSource = (value) => {
      const raw = String(value == null ? '' : value).trim().toLowerCase();
      if (!raw) return '';
      return raw.replace(/[_\s]+/g, '-').replace(/-+/g, '-');
    };
    const specialTempSourceSet = new Set([
      'browser-drop',
      'search-result',
      'batch',
      'quick-add',
      'file-import',
      'import-html-bookmarks',
      'import-json-bookmarks'
    ]);

    const classifyTempKind = (protocol, path = '') => {
      const direct = normalizeTempKind(protocol && protocol.tempKind);
      if (direct) return direct;
      const source = normalizeTempSource(protocol && protocol.source);
      if (specialTempSourceSet.has(source)) return 'special';
      if (/(^|\/)(特殊临时栏目|Special temporary)(\/|$)/i.test(String(path || ''))) return 'special';
      return 'regular';
    };

    const flattenTempItemsPreorder = (itemsInput, trace = [], prefix = '') => {
      const items = Array.isArray(itemsInput) ? itemsInput : [];
      items.forEach((item, index) => {
        const node = item && typeof item === 'object' ? item : {};
        const pathToken = `${prefix}${index}`;
        trace.push({
          path: pathToken,
          id: String(node.id || ''),
          sectionId: String(node.sectionId || ''),
          type: String(node.type || ''),
          title: String(node.title || ''),
          url: String(node.url || '')
        });
        const children = Array.isArray(node.children) ? node.children : [];
        if (children.length) {
          flattenTempItemsPreorder(children, trace, `${pathToken}.`);
        }
      });
      return trace;
    };

    const buildTempPreorderSignature = (protocol) => {
      const list = flattenTempItemsPreorder(protocol && protocol.items);
      return list.map((item) => `${item.path}|${item.type}|${item.id}|${item.sectionId}|${item.title}|${item.url}`).join('\n');
    };

    const sortTempProtocolById = (left, right) => {
      return String(left && left.id || '').localeCompare(String(right && right.id || ''));
    };

    const actualTempEntries = (actual.temporary.sections || [])
      .map((entry, index) => {
        const protocol = entry && entry.payload ? entry.payload : null;
        if (!protocol || protocol.sectionType !== 'temporary') return null;
        const id = String(protocol.id || '').trim() || `__actual_${index}`;
        const kind = classifyTempKind(protocol, '');
        return {
          id,
          kind,
          path: '',
          protocol,
          preorderSignature: buildTempPreorderSignature(protocol)
        };
      })
      .filter(Boolean);

    const exportTempEntries = (exported.temporary.files || [])
      .map((entry, index) => {
        const protocol = entry && entry.json ? entry.json : null;
        if (!protocol || protocol.sectionType !== 'temporary') return null;
        const path = String(entry && entry.path || '');
        const id = String(protocol.id || '').trim() || `__export_${index}`;
        const kind = classifyTempKind(protocol, path);
        return {
          id,
          kind,
          path,
          protocol,
          preorderSignature: buildTempPreorderSignature(protocol)
        };
      })
      .filter(Boolean);

    const actualTempProtocols = actualTempEntries
      .map((entry) => entry.protocol)
      .sort(sortTempProtocolById);

    const exportTempProtocols = exportTempEntries
      .map((entry) => entry.protocol)
      .sort(sortTempProtocolById);

    const buildTempGroupComparison = (kind) => {
      const actualList = actualTempEntries.filter((entry) => entry.kind === kind)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const exportList = exportTempEntries.filter((entry) => entry.kind === kind)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));

      const actualIds = actualList.map((entry) => entry.id);
      const exportIds = exportList.map((entry) => entry.id);
      const onlyInActual = actualIds.filter((id) => !exportIds.includes(id));
      const onlyInExport = exportIds.filter((id) => !actualIds.includes(id));
      const sharedIds = actualIds.filter((id) => exportIds.includes(id));

      const actualById = new Map(actualList.map((entry) => [entry.id, entry]));
      const exportById = new Map(exportList.map((entry) => [entry.id, entry]));
      const preorderMismatches = sharedIds.filter((id) => {
        const left = actualById.get(id);
        const right = exportById.get(id);
        return String(left && left.preorderSignature || '') !== String(right && right.preorderSignature || '');
      });

      return {
        countActual: actualList.length,
        countExport: exportList.length,
        actualIds,
        exportIds,
        onlyInActual,
        onlyInExport,
        preorderMismatches,
        protocolsMatch: stableEqual(
          actualList.map((entry) => entry.protocol),
          exportList.map((entry) => entry.protocol)
        ),
        preorderMatch: onlyInActual.length === 0
          && onlyInExport.length === 0
          && preorderMismatches.length === 0
      };
    };

    const temporaryRegular = buildTempGroupComparison('regular');
    const temporarySpecial = buildTempGroupComparison('special');

    const actualPermanentMainDescription = String(
      (actual && actual.permanent && (
        actual.permanent.tipMain
        || (actual.permanent.permMainPayload && actual.permanent.permMainPayload.descriptionMd)
      )) || ''
    );
    const exportPermanentMainDescription = String(
      (exported && exported.permanent && exported.permanent.main && exported.permanent.main.json
        ? exported.permanent.main.json.descriptionMd
        : '') || ''
    );

    const actualPermanentCopyDescriptionById = {};
    (actual && actual.permanent && Array.isArray(actual.permanent.permCopyPayloads)
      ? actual.permanent.permCopyPayloads
      : []).forEach((entry) => {
      const copyId = String(entry && entry.copyId || '').trim();
      if (!copyId) return;
      const payload = entry && entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
      actualPermanentCopyDescriptionById[copyId] = String(payload.descriptionMd || '');
    });
    const actualTipCopies = actual && actual.permanent && actual.permanent.tipCopies && typeof actual.permanent.tipCopies === 'object'
      ? actual.permanent.tipCopies
      : {};
    Object.keys(actualTipCopies).forEach((copyId) => {
      const normalizedId = String(copyId || '').trim();
      if (!normalizedId) return;
      actualPermanentCopyDescriptionById[normalizedId] = String(actualTipCopies[copyId] || '');
    });

    const exportPermanentCopyDescriptionById = {};
    (exported && exported.permanent && Array.isArray(exported.permanent.copies)
      ? exported.permanent.copies
      : []).forEach((entry, index) => {
      const copyId = String(
        (entry && entry.meta && entry.meta.copyId)
        || (entry && entry.json && entry.json.copyId)
        || ''
      ).trim() || `__copy_index_${index}`;
      const desc = String((entry && entry.json && entry.json.descriptionMd) || '');
      exportPermanentCopyDescriptionById[copyId] = desc;
    });

    const actualPermanentCopyIds = Object.keys(actualPermanentCopyDescriptionById).sort();
    const exportPermanentCopyIds = Object.keys(exportPermanentCopyDescriptionById).sort();
    const permanentCopyIdsIntersection = actualPermanentCopyIds.filter((id) => exportPermanentCopyIds.includes(id));
    const permanentCopyDescriptionHashMismatches = permanentCopyIdsIntersection.filter((id) => {
      return textHash(actualPermanentCopyDescriptionById[id]) !== textHash(exportPermanentCopyDescriptionById[id]);
    });
    const permanentCopyOnlyInActual = actualPermanentCopyIds.filter((id) => !exportPermanentCopyIds.includes(id));
    const permanentCopyOnlyInExport = exportPermanentCopyIds.filter((id) => !actualPermanentCopyIds.includes(id));
    const permanentMainDescriptionMatch = textHash(actualPermanentMainDescription) === textHash(exportPermanentMainDescription);
    const permanentCopyDescriptionsMatch = permanentCopyOnlyInActual.length === 0
      && permanentCopyOnlyInExport.length === 0
      && permanentCopyDescriptionHashMismatches.length === 0;

    const actualBlankByNodeId = {};
    (actual.blank.mdNodes || []).forEach((entry) => {
      const id = String(entry && entry.id || '').trim();
      if (!id) return;
      const markdownSource = String(entry && entry.payload && entry.payload.markdownSource || '');
      actualBlankByNodeId[id] = {
        markdownHash: textHash(markdownSource),
        markdownSource
      };
    });

    const exportBlankByNodeId = {};
    (exported.blank.files || []).forEach((entry) => {
      const nodeId = String(entry && entry.meta && entry.meta.nodeId || '').trim();
      if (!nodeId) return;
      exportBlankByNodeId[nodeId] = {
        contentHash: textHash(entry.content),
        content: entry.content,
        path: entry.path
      };
    });

    const blankIdsActual = Object.keys(actualBlankByNodeId).sort();
    const blankIdsExport = Object.keys(exportBlankByNodeId).sort();
    const blankIdsIntersection = blankIdsActual.filter((id) => blankIdsExport.includes(id));

    const blankHashMismatches = blankIdsIntersection.filter((id) => {
      return actualBlankByNodeId[id].markdownHash !== exportBlankByNodeId[id].contentHash;
    });

    const actualCanvasPayload = actual.canvas.payload || { nodes: [], edges: [] };
    const exportCanvasPayload = exported.canvas.file && exported.canvas.file.json
      ? exported.canvas.file.json
      : null;

    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        permanentTreeMatch: stableEqual(actualRoot, exportMainTree),
        permanentMainDescriptionMatch,
        permanentCopyDescriptionsMatch,
        permanentDescriptionAllMatch: permanentMainDescriptionMatch && permanentCopyDescriptionsMatch,
        temporaryProtocolsMatch: stableEqual(actualTempProtocols, exportTempProtocols),
        temporaryRegularProtocolsMatch: temporaryRegular.protocolsMatch,
        temporarySpecialProtocolsMatch: temporarySpecial.protocolsMatch,
        temporaryRegularPreorderMatch: temporaryRegular.preorderMatch,
        temporarySpecialPreorderMatch: temporarySpecial.preorderMatch,
        temporaryGroupedAllMatch: temporaryRegular.protocolsMatch
          && temporarySpecial.protocolsMatch
          && temporaryRegular.preorderMatch
          && temporarySpecial.preorderMatch,
        canvasPayloadMatch: stableEqual(actualCanvasPayload, exportCanvasPayload),
        blankNodeIdSetMatch: stableEqual(blankIdsActual, blankIdsExport),
        blankContentHashAllMatch: blankHashMismatches.length === 0
      },
      details: {
        permanent: {
          actualRootExists: !!actualRoot,
          exportMainTreeExists: !!exportMainTree,
          exportCopyFileCount: (exported.permanent.copies || []).length,
          description: {
            main: {
              actualHash: textHash(actualPermanentMainDescription),
              exportHash: textHash(exportPermanentMainDescription),
              match: permanentMainDescriptionMatch
            },
            copies: {
              actualCount: actualPermanentCopyIds.length,
              exportCount: exportPermanentCopyIds.length,
              onlyInActual: permanentCopyOnlyInActual,
              onlyInExport: permanentCopyOnlyInExport,
              hashMismatches: permanentCopyDescriptionHashMismatches,
              match: permanentCopyDescriptionsMatch
            }
          }
        },
        temporary: {
          actualCount: actualTempProtocols.length,
          exportCount: exportTempProtocols.length,
          actualIds: actualTempProtocols.map((item) => item && item.id || ''),
          exportIds: exportTempProtocols.map((item) => item && item.id || ''),
          regular: temporaryRegular,
          special: temporarySpecial
        },
        blank: {
          actualCount: blankIdsActual.length,
          exportCount: blankIdsExport.length,
          onlyInActual: blankIdsActual.filter((id) => !blankIdsExport.includes(id)),
          onlyInExport: blankIdsExport.filter((id) => !blankIdsActual.includes(id)),
          hashMismatches: blankHashMismatches
        },
        canvas: {
          actualStorageType: actual && actual.canvas ? actual.canvas.storageType : '',
          actualRawTextHash: textHash(actual && actual.canvas ? actual.canvas.rawText : ''),
          exportRawTextHash: textHash(exported && exported.canvas && exported.canvas.file ? exported.canvas.file.content : ''),
          actualNodeCount: Array.isArray(actualCanvasPayload && actualCanvasPayload.nodes) ? actualCanvasPayload.nodes.length : 0,
          actualEdgeCount: Array.isArray(actualCanvasPayload && actualCanvasPayload.edges) ? actualCanvasPayload.edges.length : 0,
          exportNodeCount: Array.isArray(exportCanvasPayload && exportCanvasPayload.nodes) ? exportCanvasPayload.nodes.length : 0,
          exportEdgeCount: Array.isArray(exportCanvasPayload && exportCanvasPayload.edges) ? exportCanvasPayload.edges.length : 0
        }
      },
      actual,
      exported
    };

    return report;
  };

  window.__canvasJsonProbe = {
    __version: PROBE_VERSION,
    collectActual,
    collectExportJsonMode,
    compareActualWithExport,
    downloadJson,
    downloadText,
    formatCanvasLikeObsidian,
    downloadCanvasLikeObsidian,
    stableStringify
  };

  console.log('[canvas-json-probe] ready:', PROBE_VERSION);
})();
```

## 2) 脚本 A：下载“永久栏目及其副本（实际存储）”

```js
const actual = await window.__canvasJsonProbe.collectActual();
window.__canvasJsonProbe.downloadJson('actual-permanent-and-copies.json', actual.permanent);
```

## 3) 脚本 B：下载“临时栏目（实际存储）”

```js
const actual = await window.__canvasJsonProbe.collectActual();
window.__canvasJsonProbe.downloadJson('actual-temporary-sections.json', actual.temporary);
```

## 4) 脚本 C：下载“空白栏目（实际存储）”

```js
const actual = await window.__canvasJsonProbe.collectActual();
window.__canvasJsonProbe.downloadJson('actual-blank-sections.json', actual.blank);
```

## 5) 脚本 D：下载“画布文件（实际存储）”

```js
(async () => {
  const actual = await window.__canvasJsonProbe.collectActual();
  const rawText = actual && actual.canvas && typeof actual.canvas.rawText === 'string'
    ? actual.canvas.rawText
    : window.__canvasJsonProbe.formatCanvasLikeObsidian(actual && actual.canvas && actual.canvas.payload);

  // 1) 这是 storage.local 里的 bcs:canvas 实际文本（不是重排后的 wrapper）
  window.__canvasJsonProbe.downloadText('actual-canvas-file.json', rawText, 'application/json;charset=utf-8');
  // 2) 画布 meta（_signature/_dirty/_filePath）单独看
  window.__canvasJsonProbe.downloadJson('actual-canvas-meta.json', actual && actual.canvas ? actual.canvas.meta : null);
  // 3) 调试用完整 wrapper
  window.__canvasJsonProbe.downloadJson('actual-canvas-wrapper.json', actual.canvas);
})();
```

如果你担心页面里 probe 不是最新版，直接用下面这个“强制脚本”（不依赖 `window.__canvasJsonProbe`）：

```js
(async () => {
  const runtime = window.browserAPI || window.chrome || window.browser;
  if (!runtime || !runtime.storage || !runtime.storage.local) throw new Error('storage.local unavailable');
  const storage = runtime.storage.local;
  const readAll = () => new Promise((resolve) => {
    try {
      const maybe = storage.get(null, (result) => resolve(result && typeof result === 'object' ? result : {}));
      if (maybe && typeof maybe.then === 'function') maybe.then((result) => resolve(result && typeof result === 'object' ? result : {})).catch(() => resolve({}));
    } catch (_) {
      resolve({});
    }
  });
  const all = await readAll();
  const raw = all['bcs:canvas'];
  let text = '';
  if (typeof raw === 'string') {
    text = raw;
  } else {
    const source = raw && typeof raw === 'object' ? raw : {};
    const payload = {
      nodes: Array.isArray(source.nodes) ? source.nodes : [],
      edges: Array.isArray(source.edges) ? source.edges : []
    };
    const lines = ['{', '\t\"nodes\":['];
    payload.nodes.forEach((node, index) => {
      lines.push(`\t\t${JSON.stringify(node)}${index < payload.nodes.length - 1 ? ',' : ''}`);
    });
    lines.push('\t],', '\t\"edges\":[');
    payload.edges.forEach((edge, index) => {
      lines.push(`\t\t${JSON.stringify(edge)}${index < payload.edges.length - 1 ? ',' : ''}`);
    });
    lines.push('\t]', '}');
    text = lines.join('\n');
  }
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'actual-canvas-file.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
})();
```

## 6) 脚本 E：下载“JSON 兼容模式导出结果（同一代码路径）”

```js
const exported = await window.__canvasJsonProbe.collectExportJsonMode();
window.__canvasJsonProbe.downloadJson('export-json-permanent-and-copies.json', exported.permanent);
window.__canvasJsonProbe.downloadJson('export-json-temporary-sections.json', exported.temporary);
window.__canvasJsonProbe.downloadJson('export-json-blank-sections.json', exported.blank);
window.__canvasJsonProbe.downloadJson('export-json-canvas-file.json', exported.canvas);
```

## 7) 脚本 F：自动对比并下载报告

```js
const report = await window.__canvasJsonProbe.compareActualWithExport();
console.table(report.summary);
window.__canvasJsonProbe.downloadJson('compare-report-actual-vs-export-json-mode.json', report);
```

## 8) 脚本 G：同步链路“临时栏目直通”对比（本地 vs 最近上传）

```js
(async () => {
  const runtime = window.browserAPI || window.chrome || window.browser;
  if (!runtime || !runtime.storage || !runtime.storage.local) {
    throw new Error('storage.local unavailable');
  }

  const readAll = () => new Promise((resolve) => {
    try {
      const maybe = runtime.storage.local.get(null, (result) => resolve(result && typeof result === 'object' ? result : {}));
      if (maybe && typeof maybe.then === 'function') {
        maybe.then((result) => resolve(result && typeof result === 'object' ? result : {})).catch(() => resolve({}));
      }
    } catch (_) {
      resolve({});
    }
  });

  const all = await readAll();
  const localRawFromLocalStorage = (() => {
    try { return String(localStorage.getItem('bcs:temp-state-snapshot') || ''); } catch (_) { return ''; }
  })();
  const localRawFromStorage = typeof all['bcs:temp-state-snapshot'] === 'string'
    ? all['bcs:temp-state-snapshot']
    : '';
  const localRaw = localRawFromLocalStorage || localRawFromStorage || '';

  const uploadedRawFromStorage = typeof all['canvas-obsidian-git-sync-last-uploaded-temp-state-v1'] === 'string'
    ? all['canvas-obsidian-git-sync-last-uploaded-temp-state-v1']
    : '';
  const uploadedRawFromLocalStorage = (() => {
    try { return String(localStorage.getItem('canvas-obsidian-git-sync-last-uploaded-temp-state-v1') || ''); } catch (_) { return ''; }
  })();
  const uploadedRaw = uploadedRawFromStorage || uploadedRawFromLocalStorage || '';

  const parseJson = (raw) => {
    try { return JSON.parse(String(raw || '')); } catch (_) { return null; }
  };

  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach((k) => { out[k] = stable(value[k]); });
      return out;
    }
    return value;
  };

  const stableText = (value) => {
    try { return JSON.stringify(stable(value)); } catch (_) { return ''; }
  };

  const hashText = (text) => {
    const input = String(text || '');
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = (hash >>> 0) * 0x01000193;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };

  const localJson = parseJson(localRaw);
  const uploadedJson = parseJson(uploadedRaw);
  const report = {
    generatedAt: new Date().toISOString(),
    localBytes: localRaw.length,
    uploadedBytes: uploadedRaw.length,
    localHash: hashText(localRaw),
    uploadedHash: hashText(uploadedRaw),
    rawEqual: localRaw === uploadedRaw,
    semanticEqual: stableText(localJson) && stableText(uploadedJson)
      ? stableText(localJson) === stableText(uploadedJson)
      : false
  };

  console.table(report);
  window.__canvasJsonProbe.downloadJson('compare-temp-sync-pass-through-report.json', {
    report,
    localRaw,
    uploadedRaw
  });
})();
```

说明：
1. `uploadedRaw` 来自 `canvas-obsidian-git-sync-last-uploaded-temp-state-v1`，只有“成功上传后”才会刷新。
2. `rawEqual` 看字节级一致；`semanticEqual` 看 JSON 语义一致（忽略对象键顺序差异）。

## 9) 判定标准

1. `permanentTreeMatch === true`：永久树（标准协议树，去动态 `id`）与 JSON 兼容模式主文件一致。
2. `permanentMainDescriptionMatch === true` 且 `permanentCopyDescriptionsMatch === true`：永久栏目主卡与副本说明一致。
3. `temporaryProtocolsMatch === true`：临时栏目整体协议对象集合一致（含 `descriptionMd`）。
4. `temporaryRegularProtocolsMatch === true` 且 `temporarySpecialProtocolsMatch === true`：常规链式/特殊临时两组协议都一致。
5. `temporaryRegularPreorderMatch === true` 且 `temporarySpecialPreorderMatch === true`：两组节点 preorder 顺序一致（不是仅仅 key 顺序一致）。
6. `canvasPayloadMatch === true`：`bcs:canvas` 解析后的 `nodes/edges` 与导出 `.canvas` 一致。
7. `blankNodeIdSetMatch === true` 且 `blankContentHashAllMatch === true`：空白栏目节点及内容一致（来自 `markdownSource`）。
8. 脚本 G 的 `semanticEqual === true`：同步链路下临时栏目本地与最近上传语义一致。

如果有 `false`，优先看报告里的 `details`（IDs 差异、hash 不一致项）。
