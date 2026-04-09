#!/usr/bin/env node
'use strict';

/**
 * Bookmark-Canvas 搜索压力测试（离线合成数据）
 *
 * 用法示例：
 *   node tools/search-stress-benchmark.js --bookmarks 200000 --folders 50000 --queries search,ai,chrome
 *   node tools/search-stress-benchmark.js --bookmarks 500000 --folders 100000 --queries ai
 */

const { performance } = require('node:perf_hooks');

function parseArgs(argv) {
  const out = {
    bookmarks: 200000,
    folders: 50000,
    queries: ['search', 'ai', 'chrome', 'project'],
    seed: 42
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    if (arg === '--bookmarks') out.bookmarks = Math.max(0, parseInt(argv[++i], 10) || out.bookmarks);
    else if (arg === '--folders') out.folders = Math.max(0, parseInt(argv[++i], 10) || out.folders);
    else if (arg === '--queries') out.queries = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--seed') out.seed = parseInt(argv[++i], 10) || out.seed;
  }
  return out;
}

function makeRng(seed) {
  let x = (seed >>> 0) || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 0xFFFFFFFF);
  };
}

function formatMs(ms) {
  return `${ms.toFixed(1)}ms`;
}

function formatMem(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return '';
  }
}

function buildSyntheticIndex(bookmarkCount, folderCount, seed) {
  const rng = makeRng(seed);
  const domains = [
    'linux.do',
    'github.com',
    'bing.com',
    'zhihu.com',
    'duckduckgo.com',
    'models.dev',
    'openai.com',
    'news.ycombinator.com',
    'stackoverflow.com',
    'example.org'
  ];
  const topics = [
    'search',
    'ai',
    'project',
    'browser',
    'chrome',
    'bookmark',
    'tool',
    'guide',
    'docs',
    'workflow'
  ];

  const items = [];
  let order = 0;

  for (let i = 0; i < folderCount; i += 1) {
    const t1 = topics[Math.floor(rng() * topics.length)];
    const t2 = topics[Math.floor(rng() * topics.length)];
    const title = `folder-${t1}-${t2}-${i}`;
    const path = `root > ${t1} > ${t2}`;
    items.push({
      id: `f-${i}`,
      type: 'bookmark-item',
      source: 'permanent',
      nodeType: 'folder',
      title,
      url: '',
      __title: title.toLowerCase(),
      __url: '',
      __path: path.toLowerCase(),
      bookmarkSearchOrder: order++
    });
  }

  for (let i = 0; i < bookmarkCount; i += 1) {
    const d = domains[Math.floor(rng() * domains.length)];
    const t1 = topics[Math.floor(rng() * topics.length)];
    const t2 = topics[Math.floor(rng() * topics.length)];
    const title = `${t1} ${t2} article ${i}`;
    const url = `https://${d}/t/${t1}-${t2}-${i}`;
    const path = `root > ${d.split('.')[0]} > ${t1}`;
    items.push({
      id: `b-${i}`,
      type: 'bookmark-item',
      source: 'permanent',
      nodeType: 'bookmark',
      title,
      url,
      __title: title.toLowerCase(),
      __url: url.toLowerCase(),
      __path: path.toLowerCase(),
      bookmarkSearchOrder: order++
    });
  }

  return items;
}

function scoreBookmarkItem(item, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return -Infinity;
  const tokens = q.split(/\s+/).map(s => s.trim()).filter(Boolean);
  if (!tokens.length) return -Infinity;

  let tokenScoreSum = 0;
  for (const t of tokens) {
    const isSingleToken = t.length === 1;
    let tokenScore = 0;
    if (item.__title) {
      if (item.__title.startsWith(t)) tokenScore = Math.max(tokenScore, 140);
      else if (item.__title.includes(t)) tokenScore = Math.max(tokenScore, 110);
    }
    if (item.__url && !isSingleToken && item.__url.includes(t)) tokenScore = Math.max(tokenScore, 90);
    if (tokenScore === 0) return -Infinity;
    tokenScoreSum += tokenScore;
  }
  return tokenScoreSum;
}

function compareBookmarkItems(a, b) {
  const ao = Number.isFinite(a.bookmarkSearchOrder) ? a.bookmarkSearchOrder : Number.POSITIVE_INFINITY;
  const bo = Number.isFinite(b.bookmarkSearchOrder) ? b.bookmarkSearchOrder : Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  const td = String(a.title || '').localeCompare(String(b.title || ''));
  if (td !== 0) return td;
  return String(a.url || '').localeCompare(String(b.url || ''));
}

function runBookmarkSearch(items, query) {
  const t0 = performance.now();
  const scored = [];
  for (const item of items) {
    const raw = scoreBookmarkItem(item, query);
    if (raw > -Infinity) scored.push({ item, rawScore: raw, s: raw });
  }
  const tScan = performance.now();

  scored.sort((x, y) => {
    const xr = Number(x.rawScore);
    const yr = Number(y.rawScore);
    if (Number.isFinite(yr) && Number.isFinite(xr) && yr !== xr) return yr - xr;
    return compareBookmarkItems(x.item, y.item);
  });
  const tSort = performance.now();

  const groups = new Map();
  for (const pair of scored) {
    const it = pair.item;
    const key = it.nodeType === 'folder'
      ? `FOLDER::${it.title}`
      : `BM::${it.url}::${it.title}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, nodeType: it.nodeType, title: it.title, url: it.url, children: [] };
      groups.set(key, g);
    }
    g.children.push(pair);
  }
  const tGroup = performance.now();

  const domainStats = runDomainSearch(items, query);
  const tDomain = performance.now();

  return {
    query,
    matchedItems: scored.length,
    groupedItems: groups.size,
    timings: {
      scan: tScan - t0,
      sort: tSort - tScan,
      group: tGroup - tSort,
      domain: tDomain - tGroup,
      total: tDomain - t0
    },
    domainStats
  };
}

function runDomainSearch(items, query) {
  const q = String(query || '').trim().toLowerCase();
  const byDomain = new Map();
  for (const item of items) {
    if (!item || item.nodeType !== 'bookmark' || !item.url) continue;
    const domain = getDomainFromUrl(item.url);
    if (!domain) continue;
    let e = byDomain.get(domain);
    if (!e) {
      e = { count: 0, matched: 0, hosts: new Set(), matchedHosts: new Set() };
      byDomain.set(domain, e);
    }
    const host = domain;
    e.count += 1;
    e.hosts.add(host);
    const matched = !q
      || domain.includes(q)
      || String(item.__title || '').includes(q)
      || String(item.__url || '').includes(q);
    if (matched) {
      e.matched += 1;
      e.matchedHosts.add(host);
    }
  }
  let visibleDomains = 0;
  let matchedBookmarks = 0;
  for (const [, v] of byDomain.entries()) {
    if (!q || v.matched > 0) {
      visibleDomains += 1;
      matchedBookmarks += q ? v.matched : v.count;
    }
  }
  return { visibleDomains, matchedBookmarks };
}

function main() {
  const args = parseArgs(process.argv);
  console.log('[SearchStress] config:', JSON.stringify(args));

  const tBuild0 = performance.now();
  const items = buildSyntheticIndex(args.bookmarks, args.folders, args.seed);
  const tBuild1 = performance.now();
  console.log(`[SearchStress] build: items=${items.length}, time=${formatMs(tBuild1 - tBuild0)}`);
  const memAfterBuild = process.memoryUsage();
  console.log(`[SearchStress] memory after build: heapUsed=${formatMem(memAfterBuild.heapUsed)}, rss=${formatMem(memAfterBuild.rss)}`);

  for (const q of args.queries) {
    const result = runBookmarkSearch(items, q);
    console.log(
      `[SearchStress] query="${result.query}" matchedItems=${result.matchedItems}, grouped=${result.groupedItems}, `
      + `domains=${result.domainStats.visibleDomains}, domainMatches=${result.domainStats.matchedBookmarks}, `
      + `scan=${formatMs(result.timings.scan)}, sort=${formatMs(result.timings.sort)}, group=${formatMs(result.timings.group)}, `
      + `domain=${formatMs(result.timings.domain)}, total=${formatMs(result.timings.total)}`
    );
  }

  const memAfterRun = process.memoryUsage();
  console.log(`[SearchStress] memory after run: heapUsed=${formatMem(memAfterRun.heapUsed)}, rss=${formatMem(memAfterRun.rss)}`);
}

main();

