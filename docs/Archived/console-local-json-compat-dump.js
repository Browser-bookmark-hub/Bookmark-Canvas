(async function () {
  var rt = window.browserAPI || window.chrome || window.browser;
  if (!rt || !rt.storage || !rt.storage.local) {
    throw new Error("storage.local unavailable");
  }

  function toPromiseCall(fn, ctx) {
    var args = Array.prototype.slice.call(arguments, 2);
    return new Promise(function (resolve, reject) {
      try {
        var cb = function (result) {
          var err = rt && rt.runtime && rt.runtime.lastError;
          if (err && err.message) {
            reject(new Error(err.message));
            return;
          }
          resolve(result);
        };
        var callArgs = args.slice();
        callArgs.push(cb);
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
    } catch (_) { }
    return toPromiseCall(rt.storage.local.get, rt.storage.local, null);
  }

  function bookmarksGetTreeSafe() {
    if (!rt || !rt.bookmarks || typeof rt.bookmarks.getTree !== "function") {
      return Promise.resolve([]);
    }
    try {
      var maybe = rt.bookmarks.getTree();
      if (maybe && typeof maybe.then === "function") return maybe;
    } catch (_) { }
    return toPromiseCall(rt.bookmarks.getTree, rt.bookmarks).catch(function () {
      return [];
    });
  }

  function deepClone(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  }

  function parseMaybeJson(value) {
    if (typeof value !== "string") return value;
    var text = String(value || "").trim();
    if (!text) return value;
    try {
      return JSON.parse(text);
    } catch (_) {
      return value;
    }
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
        var key = localStorage.key(i);
        if (!key) continue;
        if (String(key).indexOf(prefix) !== 0) continue;
        out[key] = localStorage.getItem(key);
      }
    } catch (_) { }
    return out;
  }

  function collectChromeStorageEntries(storage, prefix) {
    return Object.keys(storage || {})
      .filter(function (k) { return String(k).indexOf(prefix) === 0; })
      .sort()
      .map(function (k) {
        return {
          key: k,
          id: String(k).slice(prefix.length),
          value: deepClone(storage[k])
        };
      });
  }

  function summarizeBookmarkTree(treeInput) {
    var tree = Array.isArray(treeInput) ? treeInput : [];
    var summary = {
      rootCount: tree.length,
      folderCount: 0,
      bookmarkCount: 0,
      maxDepth: 0
    };
    var walk = function (node, depth) {
      if (!node || typeof node !== "object") return;
      if (depth > summary.maxDepth) summary.maxDepth = depth;
      if (node.url) {
        summary.bookmarkCount += 1;
      } else {
        summary.folderCount += 1;
      }
      var children = Array.isArray(node.children) ? node.children : [];
      children.forEach(function (child) { walk(child, depth + 1); });
    };
    tree.forEach(function (node) { walk(node, 0); });
    return summary;
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

  var all = await storageGetAll();
  var bookmarkTree = await bookmarksGetTreeSafe();
  var now = new Date().toISOString();
  var stamp = now.replace(/[:.]/g, "-");

  var BCS_META_KEY = "bcs:meta";
  var BCS_CANVAS_KEY = "bcs:canvas";
  var BCS_CANVAS_META_KEY = "bcs:canvas:meta";
  var BCS_SECTION_PREFIX = "bcs:section:";
  var BCS_MD_PREFIX = "bcs:md:";
  var BCS_PERM_MAIN_KEY = "bcs:perm:main";
  var BCS_PERM_COPY_PREFIX = "bcs:perm:copy-";

  var permCopiesRaw = readLocalStorageItem("bcs:perm:copies");
  var permRootMetaRaw = readLocalStorageItem("bcs:perm:root-meta");
  var permTipMainRaw = readLocalStorageItem("bcs:perm:tip-main");
  var permChromeStorageKeys = Object.keys(all || {})
    .filter(function (k) { return String(k).indexOf("bcs:perm:") === 0; })
    .sort();

  var permanentFile = {
    generatedAt: now,
    source: "chrome.storage.local + window.localStorage",
    note: "该文件只包含永久栏目在本地存储层的壳数据（说明、副本索引、rootMeta 等），不包含浏览器书签树本体。",
    chromeStorage: {
      permKeys: permChromeStorageKeys,
      main: {
        key: BCS_PERM_MAIN_KEY,
        value: Object.prototype.hasOwnProperty.call(all, BCS_PERM_MAIN_KEY) ? deepClone(all[BCS_PERM_MAIN_KEY]) : null
      },
      copies: collectChromeStorageEntries(all, BCS_PERM_COPY_PREFIX)
    },
    localStorage: {
      permCopiesRaw: permCopiesRaw,
      permCopiesParsed: parseMaybeJson(permCopiesRaw),
      permRootMetaRaw: permRootMetaRaw,
      permRootMetaParsed: parseMaybeJson(permRootMetaRaw),
      permTipMain: permTipMainRaw,
      permTipCopies: collectLocalStorageByPrefix("bcs:perm:tip-copy-")
    }
  };

  var permanentTreeFile = {
    generatedAt: now,
    source: "chrome.bookmarks.getTree()",
    note: "该文件是永久栏目实际书签树本体快照，用于和导出/云端文件做内容级对比。",
    summary: summarizeBookmarkTree(bookmarkTree),
    tree: deepClone(bookmarkTree)
  };

  var temporaryFile = {
    generatedAt: now,
    source: "chrome.storage.local",
    chromeStorage: {
      meta: {
        key: BCS_META_KEY,
        value: Object.prototype.hasOwnProperty.call(all, BCS_META_KEY) ? deepClone(all[BCS_META_KEY]) : null
      },
      sections: collectChromeStorageEntries(all, BCS_SECTION_PREFIX),
      legacyTempSnapshot: {
        key: "bcs:temp-state-snapshot",
        value: Object.prototype.hasOwnProperty.call(all, "bcs:temp-state-snapshot") ? deepClone(all["bcs:temp-state-snapshot"]) : null
      }
    }
  };

  var blankCanvasFile = {
    generatedAt: now,
    source: "chrome.storage.local",
    chromeStorage: {
      canvas: {
        key: BCS_CANVAS_KEY,
        valueType: typeof all[BCS_CANVAS_KEY],
        value: Object.prototype.hasOwnProperty.call(all, BCS_CANVAS_KEY) ? deepClone(all[BCS_CANVAS_KEY]) : null
      },
      canvasMeta: {
        key: BCS_CANVAS_META_KEY,
        value: Object.prototype.hasOwnProperty.call(all, BCS_CANVAS_META_KEY) ? deepClone(all[BCS_CANVAS_META_KEY]) : null
      },
      mdShards: collectChromeStorageEntries(all, BCS_MD_PREFIX)
    }
  };

  downloadJson("local-storage-permanent-and-copies-" + stamp + ".json", permanentFile);
  downloadJson("local-permanent-bookmark-tree-" + stamp + ".json", permanentTreeFile);
  downloadJson("local-storage-temporary-sections-" + stamp + ".json", temporaryFile);
  downloadJson("local-storage-blank-canvas-" + stamp + ".json", blankCanvasFile);

  console.table([{
    permanent_main: permanentFile.chromeStorage.main.value ? 1 : 0,
    permanent_copies: permanentFile.chromeStorage.copies.length,
    permanent_tree_bookmarks: permanentTreeFile.summary.bookmarkCount,
    permanent_tree_folders: permanentTreeFile.summary.folderCount,
    temporary_sections: temporaryFile.chromeStorage.sections.length,
    blank_canvas_key_exists: blankCanvasFile.chromeStorage.canvas.value ? 1 : 0,
    md_shards: blankCanvasFile.chromeStorage.mdShards.length
  }]);
})();
