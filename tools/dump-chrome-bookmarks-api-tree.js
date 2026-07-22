(function installChromeBookmarksApiTreeDumper(global) {
    'use strict';

    function getBookmarksApi() {
        const candidates = [
            global && global.chrome,
            global && global.browser,
            global && global.browserAPI
        ];
        for (const candidate of candidates) {
            if (candidate && candidate.bookmarks && typeof candidate.bookmarks.getTree === 'function') {
                return candidate.bookmarks;
            }
        }
        return null;
    }

    function getTree(api) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const done = (value, error) => {
                if (settled) return;
                settled = true;
                if (error) {
                    reject(error);
                    return;
                }
                resolve(Array.isArray(value) ? value : []);
            };

            try {
                const maybePromise = api.getTree((tree) => done(tree));
                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.then((tree) => done(tree)).catch((error) => done(null, error));
                }
            } catch (error) {
                done(null, error);
            }
        });
    }

    function summarizeTree(tree) {
        const summary = {
            roots: Array.isArray(tree) ? tree.length : 0,
            nodes: 0,
            folders: 0,
            bookmarks: 0,
            maxDepth: 0
        };

        const visit = (node, depth) => {
            if (!node || typeof node !== 'object') return;
            summary.nodes += 1;
            summary.maxDepth = Math.max(summary.maxDepth, depth);
            if (typeof node.url === 'string' && node.url) summary.bookmarks += 1;
            else summary.folders += 1;
            if (Array.isArray(node.children)) {
                node.children.forEach((child) => visit(child, depth + 1));
            }
        };

        (Array.isArray(tree) ? tree : []).forEach((root) => visit(root, 0));
        return summary;
    }

    function downloadJson(tree) {
        if (!global.document || typeof global.Blob !== 'function' || !global.URL) {
            throw new Error('This script must run in an extension page DevTools console.');
        }

        const stamp = new Date().toISOString()
            .replace(/[-:]/g, '')
            .replace(/\.\d+Z$/, 'Z');
        const filename = `chrome-bookmarks-getTree-${stamp}.json`;
        const blob = new Blob([JSON.stringify(tree, null, 2)], {
            type: 'application/json;charset=utf-8'
        });
        const url = global.URL.createObjectURL(blob);
        const anchor = global.document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.style.display = 'none';
        global.document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
        return filename;
    }

    async function dumpChromeBookmarksApiTree() {
        const api = getBookmarksApi();
        if (!api) {
            throw new Error('chrome.bookmarks/browser.bookmarks is unavailable in this DevTools context.');
        }

        const tree = await getTree(api);
        const filename = downloadJson(tree);
        const result = {
            source: 'bookmarks.getTree',
            filename,
            summary: summarizeTree(tree),
            tree
        };

        global.__chromeBookmarksApiTreeDump = result;
        console.log('[Chrome Bookmarks API] downloaded:', filename);
        console.table(result.summary);
        console.log('[Chrome Bookmarks API] raw tree:', tree);
        return result;
    }

    global.dumpChromeBookmarksApiTree = dumpChromeBookmarksApiTree;
    dumpChromeBookmarksApiTree().catch((error) => {
        console.error('[Chrome Bookmarks API] dump failed:', error);
    });
})(typeof globalThis !== 'undefined' ? globalThis : window);
