# 存储 / 导出 / 同步（JSON）一致性检查脚本（2026-04-06）

目标：一次性检查以下四块是否一致。

- 本地存储（BCS 分片 + `bcs:canvas`）
- 导出 `json` 模式
- 导出 `visual` 模式
- 导出 `visual-no-icon` 模式
- 同步到云端链路（当前等价于 `buildSyncFiles({ exportFormat: "json" })`）

运行位置：书签画布页面的 `DevTools -> Console`。

## 1) 先执行：引导脚本（只需一次）

```js
(function bootstrapCanvasStorageExportProbeV2() {
  if (window.__canvasStorageExportProbeV2 && window.__canvasStorageExportProbeV2.version) {
    console.log("[probe-v2] already ready:", window.__canvasStorageExportProbeV2.version);
    return;
  }

  var VERSION = "2026-04-06-v2";
  var runtime = window.browserAPI || window.chrome || window.browser;

  function toPromiseCall(fn, ctx) {
    var args = Array.prototype.slice.call(arguments, 2);
    return new Promise(function (resolve, reject) {
      try {
        var maybe = fn.call(ctx, ...args, function (result) {
          var err = runtime && runtime.runtime && runtime.runtime.lastError;
          if (err && err.message) {
            reject(new Error(err.message));
            return;
          }
          resolve(result);
        });
        if (maybe && typeof maybe.then === "function") {
          maybe.then(resolve).catch(reject);
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  function deepClone(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return null;
    }
  }

  function normalizeText(value) {
    return String(value == null ? "" : value).replace(/\r\n?/g, "\n");
  }

  function normalizePath(path) {
    return String(path || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+/g, "/")
      .trim();
  }

  function parseMaybeJson(value) {
    if (typeof value !== "string") return value;
    var text = value.trim();
    if (!text) return value;
    try {
      return JSON.parse(text);
    } catch (_) {
      return value;
    }
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
      var out = {};
      Object.keys(value).sort().forEach(function (k) {
        out[k] = stableValue(value[k]);
      });
      return out;
    }
    return value;
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  function fnv1a(input) {
    var text = String(input == null ? "" : input);
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = (hash >>> 0) * 0x01000193;
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function textHash(text) {
    return fnv1a(normalizeText(text).trimEnd());
  }

  function downloadJson(filename, data) {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadText(filename, text, mime) {
    var blob = new Blob([String(text == null ? "" : text)], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  async function storageGetAll() {
    if (!runtime || !runtime.storage || !runtime.storage.local || typeof runtime.storage.local.get !== "function") {
      throw new Error("[probe-v2] storage.local not available");
    }
    try {
      var maybe = runtime.storage.local.get(null);
      if (maybe && typeof maybe.then === "function") return maybe;
    } catch (_) {}
    return toPromiseCall(runtime.storage.local.get, runtime.storage.local, null);
  }

  function isCanvasNativeTextNode(node) {
    if (!node || typeof node !== "object") return false;
    var subtype = String(node.subtype || "").trim().toLowerCase();
    var source = String(node.source || "").trim().toLowerCase();
    return subtype === "canvas-native-text" || source === "obsidian-canvas-text";
  }

  function readGuardMeta(rawPayload) {
    var payload = parseMaybeJson(rawPayload);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { hasGuard: false, dirty: false, filePath: "", signature: "", lastSyncedSignature: "" };
    }
    var hasGuard = Object.prototype.hasOwnProperty.call(payload, "_signature")
      || Object.prototype.hasOwnProperty.call(payload, "_lastSyncedSignature")
      || Object.prototype.hasOwnProperty.call(payload, "_dirty")
      || Object.prototype.hasOwnProperty.call(payload, "_filePath");
    return {
      hasGuard: hasGuard,
      dirty: !!payload._dirty,
      filePath: String(payload._filePath || ""),
      signature: String(payload._signature || ""),
      lastSyncedSignature: String(payload._lastSyncedSignature || "")
    };
  }

  function readCanvasPayload(rawCanvas) {
    var parsed = parseMaybeJson(rawCanvas);
    if (!parsed || typeof parsed !== "object") return { nodes: [], edges: [] };
    var nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    var edges = Array.isArray(parsed.edges) ? parsed.edges : [];
    return { nodes: nodes, edges: edges };
  }

  function summarizeCanvasPayload(canvasPayload) {
    var payload = canvasPayload && typeof canvasPayload === "object" ? canvasPayload : { nodes: [], edges: [] };
    var nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    var edges = Array.isArray(payload.edges) ? payload.edges : [];
    var textNodes = nodes.filter(function (n) { return n && String(n.type || "") === "text"; });
    var fileNodes = nodes.filter(function (n) { return n && String(n.type || "") === "file"; });
    var groupNodes = nodes.filter(function (n) { return n && String(n.type || "") === "group"; });
    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      textNodeCount: textNodes.length,
      fileNodeCount: fileNodes.length,
      groupNodeCount: groupNodes.length,
      textNodeIdList: textNodes.map(function (n) { return String(n.id || ""); }).filter(Boolean).sort()
    };
  }

  function classifySyncPath(path) {
    var p = normalizePath(path);
    if (!p) return "other";
    if (/\.canvas$/i.test(p)) return "canvas";
    if (/(^|\/)(永久栏目|Permanent)(\/|$)/i.test(p)) return "permanent";
    if (/(^|\/)(临时栏目|Temporary)(\/|$)/i.test(p)) return "temporary";
    if (/(^|\/)(说明导入规则\.md|README_Import_Rules\.md|说明_导入规则\.md)$/i.test(p)) return "guide";
    return "other";
  }

  function buildBundleHash(files) {
    var normalized = (Array.isArray(files) ? files : []).map(function (f) {
      var p = normalizePath(f && f.path);
      var c = String(f && f.content || "");
      return p + "::" + textHash(c);
    }).sort();
    return fnv1a(normalized.join("\n"));
  }

  function summarizeBundle(bundle) {
    var files = Array.isArray(bundle && bundle.files) ? bundle.files : [];
    var normalizedFiles = files.map(function (f) {
      var path = normalizePath(f && f.path);
      var content = String(f && f.content || "");
      var kind = classifySyncPath(path);
      return {
        path: path,
        kind: kind,
        content: content,
        contentHash: textHash(content)
      };
    });

    var byKind = { permanent: 0, temporary: 0, canvas: 0, guide: 0, other: 0 };
    normalizedFiles.forEach(function (f) {
      byKind[f.kind] = (byKind[f.kind] || 0) + 1;
    });

    var canvasFile = normalizedFiles.find(function (f) { return f.kind === "canvas" && /\.canvas$/i.test(f.path); }) || null;
    var canvasPayload = canvasFile ? parseMaybeJson(canvasFile.content) : null;
    var canvasSummary = summarizeCanvasPayload(canvasPayload || { nodes: [], edges: [] });

    var permanentPaths = normalizedFiles.filter(function (f) { return f.kind === "permanent"; }).map(function (f) { return f.path; });
    var temporaryPaths = normalizedFiles.filter(function (f) { return f.kind === "temporary"; }).map(function (f) { return f.path; });
    var blankPathHits = normalizedFiles
      .filter(function (f) { return /(^|\/)(空白栏目|Blank)(\/|$)/i.test(f.path); })
      .map(function (f) { return f.path; });

    return {
      exportRoot: String(bundle && bundle.exportRoot || ""),
      exportFormat: String(bundle && bundle.exportFormat || ""),
      canvasFileName: String(bundle && bundle.canvasFileName || ""),
      totalFiles: normalizedFiles.length,
      byKind: byKind,
      permanentPaths: permanentPaths,
      temporaryPaths: temporaryPaths,
      blankPathHits: blankPathHits,
      canvasSummary: canvasSummary,
      bundleHash: buildBundleHash(normalizedFiles),
      files: normalizedFiles.map(function (f) {
        return { path: f.path, kind: f.kind, contentHash: f.contentHash };
      })
    };
  }

  function checkExtensions(paths, expectedExt) {
    var ext = String(expectedExt || "").toLowerCase().replace(/^\./, "");
    return (Array.isArray(paths) ? paths : []).filter(function (p) {
      return !new RegExp("\\." + ext + "$", "i").test(String(p || ""));
    });
  }

  async function collectLocalSnapshot() {
    var all = await storageGetAll();
    var keys = Object.keys(all || {}).sort();

    var sectionKeys = keys.filter(function (k) { return k.indexOf("bcs:section:") === 0; });
    var mdShardKeys = keys.filter(function (k) { return k.indexOf("bcs:md:") === 0; });
    var permCopyKeys = keys.filter(function (k) { return k.indexOf("bcs:perm:copy-") === 0; });

    var canvasRaw = all["bcs:canvas"];
    var canvasPayload = readCanvasPayload(canvasRaw);
    var canvasSummary = summarizeCanvasPayload(canvasPayload);
    var canvasMeta = readGuardMeta(all["bcs:canvas:meta"]);

    var sectionDirtyKeys = sectionKeys.filter(function (k) {
      var meta = readGuardMeta(all[k]);
      return meta.hasGuard && meta.dirty;
    });

    var permMainMeta = readGuardMeta(all["bcs:perm:main"]);
    var permCopyDirtyKeys = permCopyKeys.filter(function (k) {
      var meta = readGuardMeta(all[k]);
      return meta.hasGuard && meta.dirty;
    });

    var protocolSummary = null;
    try {
      if (window.CanvasProtocolBridge && typeof window.CanvasProtocolBridge.loadCanvasTempStateFromBcs === "function") {
        var protocolState = await window.CanvasProtocolBridge.loadCanvasTempStateFromBcs();
        var sections = Array.isArray(protocolState && protocolState.sections) ? protocolState.sections : [];
        var mdNodes = Array.isArray(protocolState && protocolState.mdNodes) ? protocolState.mdNodes : [];
        var blankNodes = mdNodes.filter(function (n) { return n && n.subtype !== "import-container"; });
        var nativeTextNodes = blankNodes.filter(isCanvasNativeTextNode);
        protocolSummary = {
          sectionCount: sections.length,
          mdNodeCount: mdNodes.length,
          blankNodeCount: blankNodes.length,
          nativeTextNodeCount: nativeTextNodes.length
        };
      }
    } catch (e) {
      protocolSummary = { error: String(e && e.message || e) };
    }

    var runtimeSummary = null;
    try {
      var state = window.CanvasModule && window.CanvasModule.CanvasState;
      if (state && typeof state === "object") {
        var rtSections = Array.isArray(state.tempSections) ? state.tempSections : [];
        var rtMdNodes = Array.isArray(state.mdNodes) ? state.mdNodes : [];
        var rtBlankNodes = rtMdNodes.filter(function (n) { return n && n.subtype !== "import-container"; });
        var rtNativeTextNodes = rtBlankNodes.filter(isCanvasNativeTextNode);
        runtimeSummary = {
          sectionCount: rtSections.length,
          mdNodeCount: rtMdNodes.length,
          blankNodeCount: rtBlankNodes.length,
          nativeTextNodeCount: rtNativeTextNodes.length
        };
      }
    } catch (e) {
      runtimeSummary = { error: String(e && e.message || e) };
    }

    return {
      keyCount: keys.length,
      keys: {
        metaKey: keys.indexOf("bcs:meta") >= 0,
        canvasKey: keys.indexOf("bcs:canvas") >= 0,
        canvasMetaKey: keys.indexOf("bcs:canvas:meta") >= 0,
        sectionKeyCount: sectionKeys.length,
        mdShardKeyCount: mdShardKeys.length,
        permCopyKeyCount: permCopyKeys.length
      },
      dirty: {
        canvasDirty: !!canvasMeta.dirty,
        sectionDirtyCount: sectionDirtyKeys.length,
        permMainDirty: !!permMainMeta.dirty,
        permCopyDirtyCount: permCopyDirtyKeys.length
      },
      canvasSummary: canvasSummary,
      protocolSummary: protocolSummary,
      runtimeSummary: runtimeSummary,
      hashes: {
        canvasTextHash: textHash(stableStringify(canvasSummary.textNodeIdList))
      }
    };
  }

  async function collectModeBundle(exportFormat, exportRoot) {
    if (!window.CanvasObsidianExportBridge || typeof window.CanvasObsidianExportBridge.buildSyncFiles !== "function") {
      throw new Error("[probe-v2] CanvasObsidianExportBridge.buildSyncFiles not available");
    }
    var built = await window.CanvasObsidianExportBridge.buildSyncFiles({
      exportFormat: exportFormat,
      exportRoot: typeof exportRoot === "string" ? exportRoot : undefined
    });
    var summary = summarizeBundle(built);
    return { bundle: built, summary: summary };
  }

  function buildChecks(payload) {
    var checks = [];
    function push(id, pass, detail) {
      checks.push({ id: id, pass: !!pass, detail: String(detail || "") });
    }

    var local = payload.local || {};
    var localCanvasTextCount = Number(local && local.canvasSummary && local.canvasSummary.textNodeCount) || 0;
    var localProtocolNativeCount = Number(local && local.protocolSummary && local.protocolSummary.nativeTextNodeCount) || 0;
    var localRuntimeNativeCount = Number(local && local.runtimeSummary && local.runtimeSummary.nativeTextNodeCount) || 0;

    push(
      "local-no-bcs-md-shards",
      (local.keys && local.keys.mdShardKeyCount === 0),
      "bcs:md:* keys = " + (local.keys ? local.keys.mdShardKeyCount : "N/A")
    );
    push(
      "local-canvas-vs-protocol-native-text",
      localProtocolNativeCount === 0 || localCanvasTextCount === localProtocolNativeCount,
      "canvas.text=" + localCanvasTextCount + ", protocol.nativeText=" + localProtocolNativeCount
    );
    push(
      "local-canvas-vs-runtime-native-text",
      localRuntimeNativeCount === 0 || localCanvasTextCount === localRuntimeNativeCount,
      "canvas.text=" + localCanvasTextCount + ", runtime.nativeText=" + localRuntimeNativeCount
    );

    ["json", "visual", "visual-no-icon"].forEach(function (mode) {
      var modeInfo = payload.exports && payload.exports[mode] ? payload.exports[mode] : null;
      var summary = modeInfo && modeInfo.summary ? modeInfo.summary : null;
      if (!summary) {
        push("mode-" + mode + "-exists", false, "summary missing");
        return;
      }

      var expectedExt = mode === "json" ? "json" : "md";
      var badPermExt = checkExtensions(summary.permanentPaths, expectedExt);
      var badTempExt = checkExtensions(summary.temporaryPaths, expectedExt);

      push(
        "mode-" + mode + "-no-blank-folder-files",
        (summary.blankPathHits || []).length === 0,
        "hits=" + JSON.stringify(summary.blankPathHits || [])
      );
      push(
        "mode-" + mode + "-permanent-ext",
        badPermExt.length === 0,
        "bad=" + JSON.stringify(badPermExt)
      );
      push(
        "mode-" + mode + "-temporary-ext",
        badTempExt.length === 0,
        "bad=" + JSON.stringify(badTempExt)
      );
      push(
        "mode-" + mode + "-canvas-text-count-match-local",
        (Number(summary.canvasSummary && summary.canvasSummary.textNodeCount) || 0) === localCanvasTextCount,
        "mode=" + (summary.canvasSummary ? summary.canvasSummary.textNodeCount : "N/A") + ", local=" + localCanvasTextCount
      );
    });

    var syncJson = payload.syncJson && payload.syncJson.summary ? payload.syncJson.summary : null;
    var exportJson = payload.exports && payload.exports.json && payload.exports.json.summary ? payload.exports.json.summary : null;
    push(
      "sync-json-hash-equals-export-json-hash",
      !!(syncJson && exportJson && syncJson.bundleHash === exportJson.bundleHash),
      "sync=" + (syncJson ? syncJson.bundleHash : "N/A") + ", export-json=" + (exportJson ? exportJson.bundleHash : "N/A")
    );

    return checks;
  }

  async function collectAll(options) {
    var opts = options && typeof options === "object" ? options : {};
    var fixedRoot = typeof opts.exportRoot === "string" ? opts.exportRoot : undefined;

    var local = await collectLocalSnapshot();
    var exportJson = await collectModeBundle("json", fixedRoot);
    var exportVisual = await collectModeBundle("visual", fixedRoot);
    var exportVisualNoIcon = await collectModeBundle("visual-no-icon", fixedRoot);

    // 同步链路当前就是 JSON 兼容模式 buildSyncFiles。
    var syncJson = {
      bundle: deepClone(exportJson.bundle),
      summary: deepClone(exportJson.summary)
    };

    var report = {
      version: VERSION,
      generatedAt: new Date().toISOString(),
      local: local,
      exports: {
        json: exportJson,
        visual: exportVisual,
        "visual-no-icon": exportVisualNoIcon
      },
      syncJson: syncJson
    };
    report.checks = buildChecks(report);
    report.pass = report.checks.every(function (c) { return !!c.pass; });
    return report;
  }

  async function runQuickCheck(options) {
    var report = await collectAll(options);
    window.__canvasStorageExportProbeV2.lastReport = report;
    var total = report.checks.length;
    var pass = report.checks.filter(function (c) { return c.pass; }).length;
    var failed = report.checks.filter(function (c) { return !c.pass; });

    console.log("[probe-v2] pass:", report.pass, "(" + pass + "/" + total + ")");
    if (failed.length) {
      console.table(failed);
    }
    return report;
  }

  async function downloadPack(prefix, options) {
    var name = String(prefix || "probe-v2");
    var report = await collectAll(options);
    window.__canvasStorageExportProbeV2.lastReport = report;

    downloadJson(name + "-report.json", report);
    downloadJson(name + "-local.json", report.local);
    downloadJson(name + "-export-json-summary.json", report.exports.json.summary);
    downloadJson(name + "-export-visual-summary.json", report.exports.visual.summary);
    downloadJson(name + "-export-visual-no-icon-summary.json", report.exports["visual-no-icon"].summary);
    downloadJson(name + "-sync-json-summary.json", report.syncJson.summary);

    return report;
  }

  window.__canvasStorageExportProbeV2 = {
    version: VERSION,
    collectAll: collectAll,
    runQuickCheck: runQuickCheck,
    downloadPack: downloadPack,
    collectLocalSnapshot: collectLocalSnapshot,
    collectModeBundle: collectModeBundle,
    downloadJson: downloadJson,
    downloadText: downloadText,
    lastReport: null
  };

  console.log("[probe-v2] ready:", VERSION);
})();
```

## 2) 快速跑一遍（先看结论）

```js
await window.__canvasStorageExportProbeV2.runQuickCheck();
```

如果 `pass: true`，说明这 4 条链路在当前数据下是对齐的。  
如果 `pass: false`，控制台会自动 `console.table` 打印失败项。

## 3) 下载完整报告（建议你每轮测试都留档）

```js
await window.__canvasStorageExportProbeV2.downloadPack("test-round-01");
```

会下载这些文件：

- `test-round-01-report.json`（总报告）
- `test-round-01-local.json`（本地存储摘要）
- `test-round-01-export-json-summary.json`
- `test-round-01-export-visual-summary.json`
- `test-round-01-export-visual-no-icon-summary.json`
- `test-round-01-sync-json-summary.json`

## 4) 单独检查某一种导出模式（细查）

```js
await window.__canvasStorageExportProbeV2.collectModeBundle("json");
```

```js
await window.__canvasStorageExportProbeV2.collectModeBundle("visual");
```

```js
await window.__canvasStorageExportProbeV2.collectModeBundle("visual-no-icon");
```

## 5) 判定重点（这次改造后你最该看什么）

- `local-no-bcs-md-shards` 必须通过：说明旧的 `bcs:md:*` 分片已经清空。
- `mode-*-no-blank-folder-files` 必须通过：说明空白栏目不再导出成独立空白栏目文件。
- `mode-*-canvas-text-count-match-local` 必须通过：说明空白栏目都走 `.canvas text` 节点，数量一致。
- `sync-json-hash-equals-export-json-hash` 必须通过：说明“同步到云端 JSON 链路”和“导出 JSON 模式”是同一份产物。

## 6) 说明（同步链路）

当前实现里，同步上传文件来自 `CanvasObsidianExportBridge.buildSyncFiles({ exportFormat: "json" })`。  
所以“同步模式”只有 JSON 兼容模式，这份脚本里 `syncJson` 就是按这个路径验证的。

