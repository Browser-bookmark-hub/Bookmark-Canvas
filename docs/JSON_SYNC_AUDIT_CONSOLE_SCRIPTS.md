# JSON Sync Audit Console Scripts

Use this file only. Copy one full code block at a time into DevTools Console.

Important:
- Switch to English input method.
- Do not copy headings or list text.
- Only copy from `(() => {` to `})();`.

## 0) Minimal test

```js
(() => { console.log("console js ok"); })();
```

## 1) Collect local storage + sync-json bundle snapshot

```js
(() => {
  function getStorageArea() {
    if (window.browserAPI && browserAPI.storage && browserAPI.storage.local) return browserAPI.storage.local;
    if (window.chrome && chrome.storage && chrome.storage.local) return chrome.storage.local;
    if (window.browser && browser.storage && browser.storage.local) return browser.storage.local;
    return null;
  }

  function getAllStorage() {
    return new Promise((resolve) => {
      const area = getStorageArea();
      if (!area || typeof area.get !== "function") {
        resolve({});
        return;
      }

      let done = false;
      const finish = (obj) => {
        if (done) return;
        done = true;
        resolve(obj && typeof obj === "object" ? obj : {});
      };

      try {
        const maybe = area.get(null, finish);
        if (maybe && typeof maybe.then === "function") {
          maybe.then(finish).catch(() => finish({}));
        }
      } catch (e) {
        finish({});
      }
    });
  }

  function stripGuard(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const out = {};
    for (const k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      if (k === "_signature" || k === "_lastSyncedSignature" || k === "_dirty" || k === "_filePath") continue;
      out[k] = v[k];
    }
    return out;
  }

  function safeParse(raw) {
    if (typeof raw !== "string") return raw;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return raw;
    }
  }

  function downloadJson(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  async function run() {
    const bridge = window.CanvasObsidianExportBridge;
    if (!bridge || typeof bridge.buildSyncFiles !== "function") {
      console.error("CanvasObsidianExportBridge.buildSyncFiles not found");
      return;
    }

    const storage = await getAllStorage();
    const bcsKeys = Object.keys(storage).filter((k) => k.indexOf("bcs:") === 0).sort();

    const bcsRaw = {};
    const sectionsById = {};
    const mdById = {};
    const permCopiesById = {};

    for (const k of bcsKeys) {
      bcsRaw[k] = storage[k];
      if (k.indexOf("bcs:section:") === 0) sectionsById[k.slice("bcs:section:".length)] = stripGuard(storage[k]);
      if (k.indexOf("bcs:md:") === 0) mdById[k.slice("bcs:md:".length)] = stripGuard(storage[k]);
      if (k.indexOf("bcs:perm:copy-") === 0) permCopiesById[k.slice("bcs:perm:copy-".length)] = stripGuard(storage[k]);
    }

    const bundle = await bridge.buildSyncFiles({ exportFormat: "json" });
    const files = Array.isArray(bundle && bundle.files) ? bundle.files : [];

    const syncPermanent = [];
    const syncTemporary = [];
    const parseErrors = [];
    let syncCanvas = null;

    for (const f of files) {
      const path = String((f && f.path) || "");
      const content = String((f && f.content) || "");

      if (/\.canvas$/i.test(path)) {
        try {
          syncCanvas = { path, payload: JSON.parse(content) };
        } catch (e) {
          parseErrors.push({ path, error: String(e) });
        }
        continue;
      }

      if (!/\.json$/i.test(path)) continue;

      try {
        const p = JSON.parse(content);
        const item = { path, payload: p };
        if (p && p.sectionType === "permanent") syncPermanent.push(item);
        if (p && p.sectionType === "temporary") syncTemporary.push(item);
      } catch (e) {
        parseErrors.push({ path, error: String(e) });
      }
    }

    const snapshot = {
      generatedAt: new Date().toISOString(),
      local: {
        bcsKeys,
        bcsRaw,
        bcsClean: {
          meta: storage["bcs:meta"] || null,
          canvas: stripGuard(storage["bcs:canvas"] || null),
          permMain: stripGuard(storage["bcs:perm:main"] || null),
          sectionsById,
          mdById,
          permCopiesById
        },
        localStorage: {
          permCopies: safeParse(localStorage.getItem("bcs:perm:copies")),
          permRootMeta: safeParse(localStorage.getItem("bcs:perm:root-meta")),
          permTipMain: localStorage.getItem("bcs:perm:tip-main") || ""
        }
      },
      syncJson: {
        exportRoot: bundle && bundle.exportRoot,
        exportFormat: bundle && bundle.exportFormat,
        canvasFileName: bundle && bundle.canvasFileName,
        fileCount: files.length,
        permanentFiles: syncPermanent,
        temporaryFiles: syncTemporary,
        canvas: syncCanvas,
        parseErrors
      }
    };

    window.__bcsAuditSnapshot = snapshot;
    downloadJson("bcs-audit-snapshot-" + Date.now() + ".json", snapshot);

    console.log("done", {
      bcsKeys: snapshot.local.bcsKeys.length,
      permJsonFiles: syncPermanent.length,
      tempJsonFiles: syncTemporary.length,
      fileCount: files.length
    });
  }

  run().catch((e) => console.error(e));
})();
```

## 2) Compare B1/B2 replaceability

```js
(() => {
  const s = window.__bcsAuditSnapshot;
  if (!s) {
    console.error("run script1 first");
    return;
  }

  function stable(v) {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object") {
      const out = {};
      Object.keys(v).sort().forEach((k) => {
        out[k] = stable(v[k]);
      });
      return out;
    }
    return v;
  }

  function same(a, b) {
    try {
      return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
    } catch (e) {
      return false;
    }
  }

  const permFiles = Array.isArray(s.syncJson && s.syncJson.permanentFiles) ? s.syncJson.permanentFiles : [];
  let permMainRemote = null;

  for (const x of permFiles) {
    const p = x && x.payload;
    if (p && p.sectionType === "permanent" && p.fileRole !== "copy-anchor") {
      permMainRemote = p;
      break;
    }
  }

  if (!permMainRemote && permFiles.length) {
    permMainRemote = permFiles[0].payload || null;
  }

  const permMainLocal = (s.local && s.local.bcsClean && s.local.bcsClean.permMain) ? s.local.bcsClean.permMain : null;

  const localTemps = (s.local && s.local.bcsClean && s.local.bcsClean.sectionsById) ? s.local.bcsClean.sectionsById : {};
  const remoteTemps = {};
  const tempFiles = Array.isArray(s.syncJson && s.syncJson.temporaryFiles) ? s.syncJson.temporaryFiles : [];

  tempFiles.forEach((f, i) => {
    const p = f && f.payload;
    const id = p && p.id ? String(p.id) : "__no_id_" + i;
    remoteTemps[id] = p || null;
  });

  const ids = Array.from(new Set(Object.keys(localTemps).concat(Object.keys(remoteTemps)))).sort();
  const mismatches = [];

  ids.forEach((id) => {
    if (!same(localTemps[id] || null, remoteTemps[id] || null)) {
      mismatches.push({ id: id, localExists: !!localTemps[id], remoteExists: !!remoteTemps[id] });
    }
  });

  const result = {
    generatedAt: new Date().toISOString(),
    keyFacts: {
      has_bcs_perm_main: !!(s.local && s.local.bcsRaw && s.local.bcsRaw["bcs:perm:main"]),
      has_bcs_perm_position: localStorage.getItem("bcs:perm:position") !== null,
      has_bcs_perm_copies: localStorage.getItem("bcs:perm:copies") !== null,
      sync_export_format: s.syncJson && s.syncJson.exportFormat
    },
    permanent: {
      local_permMain_descriptionMd: permMainLocal && permMainLocal.descriptionMd ? permMainLocal.descriptionMd : "",
      remote_permMain_descriptionMd: permMainRemote && permMainRemote.descriptionMd ? permMainRemote.descriptionMd : "",
      description_same:
        String((permMainLocal && permMainLocal.descriptionMd) || "") ===
        String((permMainRemote && permMainRemote.descriptionMd) || ""),
      note: "permanent tree source is chrome.bookmarks, not bcs:perm:main"
    },
    temporary: {
      local_count: Object.keys(localTemps).length,
      remote_count: Object.keys(remoteTemps).length,
      mismatch_count: mismatches.length,
      mismatches: mismatches
    },
    replaceability: {
      permanent_full_raw_replace: false,
      temporary_shard_replace: mismatches.length === 0
    }
  };

  window.__bcsAuditCompare = result;
  console.log(result);
  copy(JSON.stringify(result, null, 2));
})();
```

## 3) Export full permanent-section HTML (optional)

```js
(() => {
  const html = document.getElementById("permanentSection") ? document.getElementById("permanentSection").outerHTML : "";
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "permanent-section-" + Date.now() + ".html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  console.log("exported html length:", html.length);
})();
```
