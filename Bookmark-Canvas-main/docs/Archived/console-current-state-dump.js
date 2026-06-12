(async function () {
  var rt = window.browserAPI || window.chrome || window.browser;
  if (!rt || !rt.storage || !rt.storage.local) {
    throw new Error("storage.local unavailable");
  }

  function toPromiseCall(fn, ctx) {
    var args = Array.prototype.slice.call(arguments, 2);
    return new Promise(function (resolve, reject) {
      try {
        var callback = function (result) {
          var err = rt && rt.runtime && rt.runtime.lastError;
          if (err && err.message) {
            reject(new Error(err.message));
            return;
          }
          resolve(result);
        };
        var callArgs = args.slice();
        callArgs.push(callback);
        var maybe = fn.apply(ctx, callArgs);
        if (maybe && typeof maybe.then === "function") {
          maybe.then(resolve).catch(reject);
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  function storageGetAll() {
    try {
      var maybe = rt.storage.local.get(null);
      if (maybe && typeof maybe.then === "function") return maybe;
    } catch (_) {}
    return toPromiseCall(rt.storage.local.get, rt.storage.local, null);
  }

  function bookmarksGetTreeSafe() {
    if (!rt.bookmarks || typeof rt.bookmarks.getTree !== "function") {
      return Promise.resolve([]);
    }
    try {
      var maybe = rt.bookmarks.getTree();
      if (maybe && typeof maybe.then === "function") return maybe;
    } catch (_) {}
    return toPromiseCall(rt.bookmarks.getTree, rt.bookmarks).catch(function () {
      return [];
    });
  }

  function parseMaybeJson(value) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch (_) {
      return value;
    }
  }

  function deepClone(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return null;
    }
  }

  function stripGuardFields(payload) {
    var source = parseMaybeJson(payload);
    if (!source || typeof source !== "object" || Array.isArray(source)) return source;
    var cloned = deepClone(source);
    if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) return cloned;
    delete cloned._signature;
    delete cloned._lastSyncedSignature;
    delete cloned._dirty;
    delete cloned._filePath;
    return cloned;
  }

  function readLocalStorageItem(key) {
    try {
      if (typeof localStorage === "undefined" || !localStorage) return null;
      return localStorage.getItem(String(key || ""));
    } catch (_) {
      return null;
    }
  }

  function collectLocalStorageByPrefix(prefix) {
    var out = {};
    try {
      if (typeof localStorage === "undefined" || !localStorage) return out;
      for (var i = 0; i < localStorage.length; i += 1) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (String(k).indexOf(prefix) !== 0) continue;
        out[k] = localStorage.getItem(k);
      }
    } catch (_) {}
    return out;
  }

  function formatCanvasLikeObsidian(canvasDataInput) {
    var canvasData = (canvasDataInput && typeof canvasDataInput === "object")
      ? canvasDataInput
      : { nodes: [], edges: [] };
    var nodes = Array.isArray(canvasData.nodes) ? canvasData.nodes : [];
    var edges = Array.isArray(canvasData.edges) ? canvasData.edges : [];
    var lines = ["{", "\t\"nodes\":["]; 
    for (var i = 0; i < nodes.length; i += 1) {
      lines.push("\t\t" + JSON.stringify(nodes[i]) + (i < nodes.length - 1 ? "," : ""));
    }
    lines.push("\t],", "\t\"edges\":[");
    for (var j = 0; j < edges.length; j += 1) {
      lines.push("\t\t" + JSON.stringify(edges[j]) + (j < edges.length - 1 ? "," : ""));
    }
    lines.push("\t]", "}");
    return lines.join("\n");
  }

  function readCanvasPayloadFromStorageValue(rawValue) {
    if (typeof rawValue === "string") {
      var text = String(rawValue || "").trim();
      if (!text) return { nodes: [], edges: [] };
      try {
        var parsed = JSON.parse(text);
        return {
          nodes: Array.isArray(parsed && parsed.nodes) ? parsed.nodes : [],
          edges: Array.isArray(parsed && parsed.edges) ? parsed.edges : []
        };
      } catch (_) {
        return { nodes: [], edges: [] };
      }
    }
    var source = stripGuardFields(rawValue);
    return {
      nodes: Array.isArray(source && source.nodes) ? source.nodes : [],
      edges: Array.isArray(source && source.edges) ? source.edges : []
    };
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

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  var forcedPersist = false;
  try {
    if (typeof window.saveTempNodes === "function") {
      window.saveTempNodes({ immediate: true, skipUnchangedPersist: false });
      forcedPersist = true;
      await sleep(320);
    }
  } catch (_) {}

  var all = await storageGetAll();
  var bookmarkTree = await bookmarksGetTreeSafe();
  var localStoragePermSubset = collectLocalStorageByPrefix("bcs:perm:");

  var permMainPayload = stripGuardFields(all["bcs:perm:main"]);
  var permCopiesMetaRaw = readLocalStorageItem("bcs:perm:copies");
  var permRootMetaLocalRaw = readLocalStorageItem("bcs:perm:root-meta");
  var permTipMainRaw = readLocalStorageItem("bcs:perm:tip-main");

  var copyTips = {};
  Object.keys(localStoragePermSubset || {})
    .filter(function (k) { return String(k).indexOf("bcs:perm:tip-copy-") === 0; })
    .sort()
    .forEach(function (k) {
      var copyId = k.slice("bcs:perm:tip-copy-".length);
      copyTips[copyId] = String(localStoragePermSubset[k] == null ? "" : localStoragePermSubset[k]);
    });

  var sectionEntries = Object.keys(all || {})
    .filter(function (k) { return String(k).indexOf("bcs:section:") === 0; })
    .sort()
    .map(function (k) {
      return {
        key: k,
        id: k.slice("bcs:section:".length),
        payload: stripGuardFields(all[k])
      };
    });

  var mdEntries = Object.keys(all || {})
    .filter(function (k) { return String(k).indexOf("bcs:md:") === 0; })
    .sort()
    .map(function (k) {
      return {
        key: k,
        id: k.slice("bcs:md:".length),
        payload: stripGuardFields(all[k])
      };
    });

  var permCopyEntries = Object.keys(all || {})
    .filter(function (k) { return String(k).indexOf("bcs:perm:copy-") === 0; })
    .sort()
    .map(function (k) {
      return {
        key: k,
        copyId: k.slice("bcs:perm:copy-".length),
        payload: stripGuardFields(all[k])
      };
    });

  var canvasRawValue = all["bcs:canvas"];
  var canvasPayload = readCanvasPayloadFromStorageValue(canvasRawValue);
  var canvasRawText = (typeof canvasRawValue === "string")
    ? String(canvasRawValue)
    : formatCanvasLikeObsidian(canvasPayload);

  var actual = {
    generatedAt: new Date().toISOString(),
    source: "actual-storage",
    storageKeyCount: Object.keys(all || {}).length,
    permanent: {
      bookmarkTreeSnapshotRaw: deepClone(bookmarkTree),
      permMainPayload: permMainPayload,
      permCopyPayloads: permCopyEntries,
      copiesMeta: parseMaybeJson(permCopiesMetaRaw),
      rootMeta: parseMaybeJson(permRootMetaLocalRaw) || (permMainPayload && permMainPayload.rootMeta ? deepClone(permMainPayload.rootMeta) : null),
      tipMain: String(permTipMainRaw == null ? "" : permTipMainRaw),
      tipCopies: copyTips,
      localStoragePermanentSubset: deepClone(localStoragePermSubset)
    },
    temporary: {
      meta: stripGuardFields(all["bcs:meta"]),
      sections: sectionEntries,
      legacyTempSnapshot: parseMaybeJson(all["bcs:temp-state-snapshot"])
    },
    blank: {
      mdNodes: mdEntries
    },
    canvas: {
      storageType: typeof canvasRawValue,
      rawText: canvasRawText,
      payload: canvasPayload,
      meta: deepClone(all["bcs:canvas:meta"]) || null
    },
    rawStorage: {
      storageLocal: deepClone(all),
      localStoragePermanentSubset: deepClone(localStoragePermSubset)
    }
  };

  var cs = (window.CanvasModule && window.CanvasModule.CanvasState) || window.CanvasState || {};
  var liveCanvasState = {
    generatedAt: new Date().toISOString(),
    href: location.href,
    forcedPersist: forcedPersist,
    state: {
      tempSections: deepClone(Array.isArray(cs.tempSections) ? cs.tempSections : []),
      tempSectionCounter: Number(cs.tempSectionCounter) || 0,
      tempItemCounter: Number(cs.tempItemCounter) || 0,
      colorCursor: Number(cs.colorCursor) || 0,
      tempSectionLastColor: cs.tempSectionLastColor || null,
      tempSectionPrevColor: cs.tempSectionPrevColor || null,
      mdNodes: deepClone(Array.isArray(cs.mdNodes) ? cs.mdNodes : []),
      mdNodeCounter: Number(cs.mdNodeCounter) || 0,
      edges: deepClone(Array.isArray(cs.edges) ? cs.edges : []),
      edgeCounter: Number(cs.edgeCounter) || 0,
      timestamp: Date.now()
    }
  };

  var tempRaw = typeof all["bcs:temp-state-snapshot"] === "string" ? all["bcs:temp-state-snapshot"] : "";
  var tempParsed = null;
  try { tempParsed = JSON.parse(tempRaw); } catch (_) {}
  var canvasParsed = null;
  try { canvasParsed = typeof all["bcs:canvas"] === "string" ? JSON.parse(all["bcs:canvas"]) : all["bcs:canvas"]; } catch (_) {}

  var liveVsStorage = {
    generatedAt: new Date().toISOString(),
    href: location.href,
    forcedPersist: forcedPersist,
    live: {
      tempSections: Array.isArray(cs.tempSections) ? cs.tempSections.length : 0,
      mdNodes: Array.isArray(cs.mdNodes) ? cs.mdNodes.length : 0,
      edges: Array.isArray(cs.edges) ? cs.edges.length : 0
    },
    storage: {
      bcsSectionKeys: Object.keys(all).filter(function (k) { return k.indexOf("bcs:section:") === 0; }).length,
      bcsMdKeys: Object.keys(all).filter(function (k) { return k.indexOf("bcs:md:") === 0; }).length,
      tempSections: tempParsed && Array.isArray(tempParsed.sections) ? tempParsed.sections.length : -1,
      mdNodes: tempParsed && Array.isArray(tempParsed.mdNodes) ? tempParsed.mdNodes.length : -1,
      canvasNodes: canvasParsed && Array.isArray(canvasParsed.nodes) ? canvasParsed.nodes.length : -1
    }
  };

  console.table([{
    live_temp: liveVsStorage.live.tempSections,
    storage_temp: liveVsStorage.storage.tempSections,
    live_md: liveVsStorage.live.mdNodes,
    storage_md: liveVsStorage.storage.mdNodes,
    storage_canvas_nodes: liveVsStorage.storage.canvasNodes
  }]);

  downloadJson("actual-permanent-and-copies.json", actual.permanent);
  downloadJson("actual-temporary-sections.json", actual.temporary);
  downloadJson("actual-blank-sections.json", actual.blank);
  downloadText("actual-canvas-file.json", actual.canvas.rawText, "application/json;charset=utf-8");
  downloadJson("actual-canvas-meta.json", actual.canvas.meta);
  downloadJson("actual-canvas-wrapper.json", actual.canvas);
  downloadJson("live-vs-storage-snapshot.json", liveVsStorage);
  downloadJson("live-canvas-state.json", liveCanvasState);
})();
