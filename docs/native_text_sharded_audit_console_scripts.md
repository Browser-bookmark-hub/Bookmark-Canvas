# Native Text 分片对齐 - F12 控制台校验脚本

说明：每段脚本请整段一次性粘贴，不要手动换行，不要混入中文引号。

---

## S1: 分片键基础检查

```javascript
(async function () {
  const storage = await new Promise(function (resolve) {
    chrome.storage.local.get(null, function (r) { resolve(r || {}); });
  });
  const keys = Object.keys(storage || {});
  const sectionKeys = keys.filter(function (k) { return k.indexOf("bcs:section:") === 0; });
  const mdKeys = keys.filter(function (k) { return k.indexOf("bcs:md:") === 0; });

  console.log("S1", {
    has_bcs_meta: !!storage["bcs:meta"],
    has_bcs_canvas: !!storage["bcs:canvas"],
    section_shards: sectionKeys.length,
    md_shards: mdKeys.length
  });
})();
```

---

## S2: 运行时 ID 与分片 ID 对齐（含 native text）

```javascript
(function () {
  function uniq(arr) { return Array.from(new Set(arr)); }
  function diff(a, b) { return a.filter(function (x) { return b.indexOf(x) < 0; }); }

  chrome.storage.local.get(null, function (storage) {
    storage = storage || {};
    var keys = Object.keys(storage);
    var sectionShardIds = keys
      .filter(function (k) { return k.indexOf("bcs:section:") === 0; })
      .map(function (k) { return k.slice("bcs:section:".length); });
    var mdShardIds = keys
      .filter(function (k) { return k.indexOf("bcs:md:") === 0; })
      .map(function (k) { return k.slice("bcs:md:".length); });

    var proto = window.CanvasProtocolBridge;
    var state = (proto && proto.normalizeCanvasTempState)
      ? (proto.normalizeCanvasTempState(window.CanvasModule.CanvasState || {}) || {})
      : {};

    var runtimeSectionIds = uniq((state.sections || [])
      .map(function (s) { return String((s && s.id) || "").trim(); })
      .filter(Boolean));

    var runtimeMdIds = uniq((state.mdNodes || [])
      .filter(function (n) { return n && n.id && n.subtype !== "import-container"; })
      .map(function (n) { return String(n.id).trim(); })
      .filter(Boolean));

    var out = {
      section: {
        runtimeCount: runtimeSectionIds.length,
        shardCount: sectionShardIds.length,
        runtimeOnly: diff(runtimeSectionIds, sectionShardIds),
        shardOnly: diff(sectionShardIds, runtimeSectionIds)
      },
      md: {
        runtimeCount: runtimeMdIds.length,
        shardCount: mdShardIds.length,
        runtimeOnly: diff(runtimeMdIds, mdShardIds),
        shardOnly: diff(mdShardIds, runtimeMdIds)
      }
    };

    console.log("S2", out);
    globalThis.__BCS_S2 = out;
  });
})();
```

---

## S3: 导出/解析 roundtrip 检查（JSON 模式）

```javascript
(async function () {
  var bridge = window.CanvasObsidianExportBridge;
  var proto = window.CanvasProtocolBridge;
  if (!bridge || !proto) {
    console.log("S3", { ok: false, reason: "bridge not ready" });
    return;
  }

  var bundle = await bridge.buildSyncFiles({ exportFormat: "json" });
  if (!bundle || !Array.isArray(bundle.files)) {
    console.log("S3", { ok: false, reason: "buildSyncFiles failed" });
    return;
  }

  var enc = new TextEncoder();
  var fileMap = new Map();
  bundle.files.forEach(function (f) {
    var p = String((f && f.path) || "").replace(/^\/+/, "");
    var c = String((f && f.content) || "");
    if (p) fileMap.set(p, enc.encode(c));
  });

  var parsed = await bridge.parseSyncFolderFilesForSync(fileMap, "audit");
  var back = proto.normalizeCanvasTempState((parsed && parsed.tempState) || {}) || {};
  var rt = proto.normalizeCanvasTempState(window.CanvasModule.CanvasState || {}) || {};

  var rtSections = Array.isArray(rt.sections) ? rt.sections.length : 0;
  var rtMd = Array.isArray(rt.mdNodes) ? rt.mdNodes.filter(function (n) { return n && n.subtype !== "import-container"; }).length : 0;
  var rtEdges = Array.isArray(rt.edges) ? rt.edges.length : 0;

  var bkSections = Array.isArray(back.sections) ? back.sections.length : 0;
  var bkMd = Array.isArray(back.mdNodes) ? back.mdNodes.filter(function (n) { return n && n.subtype !== "import-container"; }).length : 0;
  var bkEdges = Array.isArray(back.edges) ? back.edges.length : 0;

  var out = {
    ok: rtSections === bkSections && rtMd === bkMd && rtEdges === bkEdges,
    runtime: { sections: rtSections, md: rtMd, edges: rtEdges },
    roundtrip: { sections: bkSections, md: bkMd, edges: bkEdges }
  };

  console.log("S3", out);
  globalThis.__BCS_S3 = out;
})();
```
