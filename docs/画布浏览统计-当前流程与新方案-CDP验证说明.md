# 画布浏览统计：当前流程 vs 新方案，及 CDP 验证说明

用途：交给负责实测的 agent，用真实 Chrome + CDP 逐条验证“当前流程的问题”和“新方案依赖的前提”。
本文件只描述方法与验证步骤，不包含实现代码。

相关代码（扩展根目录 `Bookmark-Canvas-main/`）：

| 文件 | 作用 |
|---|---|
| `history_html/search/history_stats_service.js` | 浏览统计核心（全量 / 增量 / 删除对账 / 查询） |
| `background.js`（约 665–775 行） | 后台监听浏览器删除历史，写删除标记 |
| `history_html/search/search.js` | `@热度/@hot/@最近/@` 搜索、排序、展示，调用统计 |
| `history_html/bookmark_tree_context_menu.js` | 右键「信息」里的访问次数 |
| `history_html/search/search_index_db.js` | IndexedDB 快照读写（键 `bookmark_visit_analytics`） |

相关提交：`6aa030b`（@热度）、`3631bb5`（删除标记与水位线）。`847aea4`（另一版大重构，已被 reset，可作参考）。

---

## 一、当前方法（HEAD 代码实际行为）

| 环节 | 当前做法 |
|---|---|
| 书签名单 | 来自搜索索引里的书签列表；搜索索引只在聚焦搜索框时载入内存 |
| 预热 | 页面初始化时会调用，但此时书签名单为空，直接返回；只有搜索索引后台重建（索引变脏 + 电脑空闲 15 秒）时顺带真正构建 |
| 首次全量 | 一次 `history.search` 拉近 90 天、最多 5 万条，用书签反向过滤 |
| 匹配 | 网址（去 `#`、utm/ref/from 等参数、末尾斜杠）→ 去协议和 www 的网址 → 「域名+标题」，三层结果都计入 |
| 同书签多个网址变体 | 次数相加 |
| 存储 | IndexedDB 一条记录：每个网址 `[url, 标题, 次数, 最近访问]` + 单独一份域名统计 + 上次同步时间 |
| 从快照恢复 | 用快照重建；先读入旧域名统计，再把每条书签访问又加一遍 |
| 增量 | 距上次同步 > 30 秒时，拉上次同步以来的历史，次数取新旧较大值 |
| 空库自检 | 每次调用都查一次历史是否为空 |
| 删除（后台） | 监听 `onVisitRemoved`，防抖 500ms：清空全部 → 「已清空」标记；超过 300 条 → 「大批删除」时间戳；否则累积删除网址列表。后台内存里另有一个只会置为真的开关 |
| 删除（前台） | 每次调用 / 存储变化 / 窗口获得焦点时检查标记；已处理版本只存内存；命中书签 ≤50 用 `getVisits(规范化网址)` 修补，否则全量重建 |
| 页面开着时新访问 | 无监听，等下次增量 |
| 新收藏书签 | 只更新名单，不补查以前的访问 |
| 域名行热度 | 读按完整主机名存的域名统计 |
| 右键单个书签 | 内存有就用；否则 `history.search({text: url, maxResults: 10})`，不传 startTime，未精确命中时取 `results[0]` |
| 右键文件夹 | 统计未就绪时调用构建，但拿不到书签名单 |

### 已实测到的问题（需复测确认）

| # | 问题 | 之前的实测结果 |
|---|---|---|
| P1 | 每次重载页面，域名热度重复累加 | 模拟测试 15→32→50→69；真实 Chrome github.com 显示 64，实际 16 |
| P2 | 删除标记写入后永不清除，之后每次打开页面都全量重拉 | 删 350 条后，每次重载首次搜索都发起 `maxResults: 50000` 的 search |
| P3 | 批量删除后，小删除被静默忽略 | 删掉某书签全部历史，内存仍显示 8 次 |
| P4 | 增量“取较大值”与全量“相加”冲突，热度卡住 | 15 次后又访问 3 次，仍显示 15 |
| P5 | 修补用规范化网址调 `getVisits`，误删 | 书签 `…/path/` 实际 20 次，修补后变 0 |
| P6 | 右键单个书签：24 小时限制 + `results[0]` 凑数 | 实际 42 次（3 天前），显示 99 |
| P7 | 「域名+标题」把同标题的非书签页面计入 | 1 个 Notion 书签 → 201 条记录，域名热度 803 |
| P8 | 跳转类书签（短链 / 302 / JS 跳转）被算成 0 | `history.search` 不返回跳转源网址；`getVisits(原网址)` 能查到 3 次 |
| P9 | 主域名模式下域名行热度为 0 | 1500 个书签的 example.com 显示「-」 |
| P10 | 没点过搜索框时右键文件夹「信息」显示 0 | 显示 `0 visits (50 bookmarks)`，实际 383 |
| P11 | 新收藏的网页显示 0 | 收藏一个已访问 7 次的网页，显示 0 |
| P12 | 首次 `@热度` 无加载提示 | 冷启动 366ms 才出结果，期间是旧内容 |
| P13 | 隔两周首次使用时增量卡一次 | 2.1 万条增量产生一次约 73ms 长任务 |
| P14 | 普通搜索排序在统计就绪前后不同 | 查询 `page 1` 前 8 名完全不同 |

---

## 二、新方案

### 核心思想

- **访问变多交给增量**：`history.search` 返回的每个网址的 `visitCount` 就是当前总数，直接覆盖。
- **访问变少交给核对**：浏览器对「部分删除」不发通知（官方文档：`deleteRange` 只有全部访问都落在范围内的网址才会被删除；`onVisitRemoved` 只报整条被删的网址）。所以在**显示前**，对用户看得见的书签用 `getVisits(书签原网址及其变体网址)` 精确核对。
- **只核对看得见的**：每次触发只核对前 50 个；加载更多时只核对新出现的一批；本次使用内核对过的不重复核对。
- **书签名单仍来自搜索索引**（已确认，不改）。
- **画布页不监听**：只在触发时计算。

### 流程

| 时机 | 做什么 |
|---|---|
| 打开页面 | 什么都不做 |
| 触发（聚焦搜索框 / 输入 `@` / 右键「信息」） | 几秒内多次触发只执行一次 |
| 冷启动（无快照） | 显示「正在统计」→ 拉 90 天历史反向过滤（每 2000 条让出）→ 记录每个书签的所有网址变体及次数 → 零命中书签用原网址 `getVisits` 补查，查到的记入「跳转书签名单」→ 存快照 |
| 每次触发 | ① 读后台的两个时间（清空全部 / 一次删了很多），和快照比较；② 增量：拉上次同步以来的历史，按网址覆盖次数；顺带核对「跳转书签名单」；③ 新书签：搜索索引里新增的网址补查；④ 核对将显示的前 50 个；⑤ 显示 |
| 收到「一次删了很多」 | 下次触发时核对全部书签（每批 100 个） |
| 收到「清空全部」 | 清零，下次触发重新冷启动 |
| 后台 | 只在删除历史时写两个时间：清空全部、一次删了很多（单次通知含多个网址或累计超限）。不留内存开关，不存网址列表 |

### 数据规则

- 每个书签下按「原始网址变体」分别存 `{次数, 最近访问时间}`，书签总数 = 各变体之和。
- 域名、文件夹热度不存，每次由书签统计汇总。
- 「近 3 个月」按访问时间过滤（`getVisits` 返回全部保留的访问，需要自己过滤）。
- 右键单个书签：`getVisits(原网址)`，按 90 天过滤。
- 右键文件夹：先载入搜索索引，再汇总。

### 匹配规则（保留约 80% 的模糊命中，堵住离谱错配）

| 情况 | 处理 |
|---|---|
| http/https、www、末尾斜杠、utm 追踪参数、页内锚点 | 归并到书签（保留现状） |
| 登录后多一串尾巴、路径微调但标题没变 | 「域名+标题」归并（保留） |
| 短链 / 302 / JS 跳转 | 用原网址 `getVisits` 补查 |
| 同域名同标题对应很多不同网址（单页应用） | 不用标题匹配 |
| 标题匹配到的网址 | 次数只记到书签名下，不单独成为一条，不进域名统计 |
| 原网址已有次数 | 不再叠加标题匹配（避免一次点击算两次） |

### 已有的性能实测（1507 书签）

| 操作 | 2.1 万条历史 | 5.1 万条历史 | 主线程长任务 |
|---|---|---|---|
| 核对前 50 个 | 1.8ms | 2.0ms | 无 |
| 核对全部（每批 100） | 59ms | 61ms（另一次 75ms） | 无 |
| 核对全部（一次全发） | — | 72ms | 无，但同时间的存储读写被拖慢约 30ms |
| 拉 90 天全部历史 | 149ms | 168–331ms | 无 |

---

## 三、需要实测的项目

每项请记录：步骤、实际结果（数字 / 截图）、是否通过。

### A. 复测当前问题（基线，用 HEAD 代码）

| 编号 | 对应问题 | 步骤要点 | 通过标准（表示问题存在） |
|---|---|---|---|
| A1 | P1 | 聚焦搜索框建好统计；记下某域名热度；访问一次该域名书签；重载页面 3 次，每次聚焦后读 `HistoryStatsService.getDomainStats(host)` | 数值每次增长，远超 `getVisits` 求和 |
| A2 | P2/P3 | 用 `chrome.history.deleteUrl` 连续删 350 个非书签网址；检查 `chrome.storage.local` 中 `canvasHistoryStats*` 键；在页面注入 `history.search` 计数钩子，重载 3 次并聚焦搜索框；再删掉一个书签的全部历史 | 每次重载都有 `maxResults: 50000` 调用；书签仍显示旧次数 |
| A3 | P4 | 准备书签 `https://a/x`，历史里有 `https://a/x` 和 `https://a/x?utm_source=1`；建统计；再访问 `https://a/x` 3 次；触发增量 | 次数不变 |
| A4 | P8 | 起本地服务：`/short` 302 到 `/long/article?session=abc`，`/js-redirect` 用 `location.replace` 跳到 `/after-login?token=随机`；收藏 `/short`、`/js-redirect`；`chrome.tabs.create` 打开各 3 次；比较 `history.search` 结果和 `getVisits(原网址)` | search 里没有跳转源；getVisits 各 3 次；`@热度` 里这两个书签为 0 |
| A5 | P10 | 重载后不碰搜索框，右键文件夹 → 信息与笔记 | 显示 0，与子书签 `getVisits` 求和不符 |
| A6 | P11 | 统计就绪后，对一个未收藏网址 `addUrl` 6 次，再收藏它，触发搜索索引重建和统计 | 显示 0 |
| A7 | P9 | 筛选「域名」、主域名模式，看 example.com 的 Visits 列 | 显示「-」 |

### B. 验证新方案依赖的浏览器行为（与代码无关，直接调 API）

| 编号 | 要确认的行为 | 步骤要点 | 期望 |
|---|---|---|---|
| B1 | 部分删除不通知 | 某书签有旧访问；`addUrl` 新增 3 次；注册 `onVisitRemoved`；`deleteRange` 删最近这段时间 | 书签次数减少，但不出现在通知里（已测一次：5→2，通知只含一个只在这段时间访问过的网址） |
| B2 | 整条删除会通知 | `deleteUrl(书签网址)` | 通知里有该网址 |
| B3 | 清空全部 | `deleteAll()`（先备份或用一次性 profile） | 通知 `allHistory: true` |
| B4 | 核对耗时与历史量无关 | 历史分别约 2 万 / 5 万 / 10 万条时，测 `getVisits` 前 50 个和全部书签的耗时 | 基本不变 |
| B5 | 并发影响 | 核对全部书签：每批 100 vs 一次全发；期间测 `storage.local.get` 延迟、`longtask` | 每批 100 时其他读写延迟 < 5ms，无长任务 |
| B6 | `onVisited` 是否对跳转源触发 | 打开 `/short` | 已测：会触发（新方案不使用监听，仅记录） |
| B7 | **同步设备的访问是否计入**（待定问题） | 需要登录开启历史同步的 profile；比较 `getVisits` 里 `isLocal: false` 的条目和 `HistoryItem.visitCount` | 记录 visitCount 是否包含其他设备的访问，供产品决定是否只算本机 |
| B8 | 90 天以前的访问 | 无法用 `addUrl` 造旧时间；如有真实 profile，抽查 `getVisits` 最早 `visitTime` | 记录保留期限 |

### C. 新方案实现后的验收（实现完成后执行）

| 编号 | 场景 | 通过标准 |
|---|---|---|
| C1 | 打开页面不触发 | 无任何 `history.search` / `getVisits` 调用 |
| C2 | 冷启动 | 显示「正在统计」，完成后数字与 `getVisits` 一致；跳转类书签不为 0 |
| C3 | 日常触发 | 增量 + 核对总耗时 < 10ms；无长任务 |
| C4 | 点开书签回来再 `@热度` | 次数 +1 |
| C5 | 删除某书签几条历史（`deleteRange` 部分删除） | 该书签出现在前 50 时显示正确次数，不闪旧数字 |
| C6 | 清除大量历史 | 下次触发核对全部，之后数字正确；再次打开不重复处理 |
| C7 | 清空全部 | 数字清零；之后重新冷启动一次 |
| C8 | 重载 5 次 | 域名热度不变 |
| C9 | 右键单个书签 / 文件夹（未点过搜索框） | 数字与 `getVisits`（90 天过滤）求和一致 |
| C10 | 新收藏已访问过的网页 | 立即显示已有次数 |
| C11 | 主页面 + 侧边栏同时打开，一边删除后另一边使用 | 显示正确 |
| C12 | 隔两周（把快照水位线改为 14 天前） | 首次使用无 > 50ms 长任务 |

---

## 四、CDP 测试环境搭建

注意：

- 品牌版 Chrome 137+ 不支持 `--load-extension`，用 `--remote-debugging-pipe --enable-unsafe-extension-debugging` + CDP `Extensions.loadUnpacked`。
- 必须使用独立的 `--user-data-dir`，不要碰用户自己正在用的 Chrome。
- headless 下 `chrome.idle` 一直是 `active`，后台空闲重建索引不会自然触发；需要时可在页面里手动调用 `SearchIndexManager.markDirty({ full: true })` + `SearchIndexManager.triggerIdleIndexing()`。
- 扩展页面是从磁盘读文件，改代码后重载页面即可。

### 4.1 CDP 控制服务（`server.mjs`）

启动后监听 `localhost:9333`，提供：`POST /eval?t=page`（在页面执行表达式，支持 await）、`/logs`（取错误日志）、`/reload`、`/open?name=xx`（body 为扩展内路径）、`/cdp`（body: `{method, params, t}`）、`/screenshot?f=路径`、`/quit`。

```js
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta';
const EXT = '/Users/kk/Downloads/kk/canvas/Bookmark-Canvas/Bookmark-Canvas-main';
const PROFILE = process.env.PROFILE || '/tmp/cdp_bc/profile';
const headless = process.env.HEADFUL ? [] : ['--headless=new'];
const proc = spawn(CHROME, [
  ...headless, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
proc.stderr.on('data', () => {});
const out = proc.stdio[3], inp = proc.stdio[4];
let id = 0; const pending = new Map(); const logs = []; let buf = '';
const sessions = {};
inp.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); }
    else if (msg.method === 'Runtime.exceptionThrown') logs.push({ type: 'exception', text: msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text });
    else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) logs.push({ type: msg.params.type, text: msg.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 500) });
    else if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) logs.push({ type: 'log-' + msg.params.entry.level, text: msg.params.entry.text.slice(0, 500), url: msg.params.entry.url });
  }
});
function send(method, params = {}, sessionId) {
  const mid = ++id;
  out.write(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  return new Promise((res, rej) => pending.set(mid, { res, rej }));
}
async function attach(targetId, name) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId).catch(() => {});
  sessions[name] = sessionId;
}
const { id: extId } = await send('Extensions.loadUnpacked', { path: EXT });
await new Promise(r => setTimeout(r, 1500));
const targets = {};
async function openPage(name, path) {
  const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/${path}` });
  await attach(targetId, name); targets[name] = targetId;
}
await openPage('page', 'history_html/history.html?view=canvas');
async function evaluate(name, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 600000 }, sessions[name]);
  return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text } : r.result.value;
}
http.createServer(async (req, res) => {
  let body = ''; req.on('data', c => body += c); await new Promise(r => req.on('end', r));
  try {
    const u = new URL(req.url, 'http://x'); let result;
    if (u.pathname === '/eval') result = await evaluate(u.searchParams.get('t') || 'page', body);
    else if (u.pathname === '/logs') result = logs.splice(0);
    else if (u.pathname === '/open') { await openPage(u.searchParams.get('name'), body); result = { ok: true }; }
    else if (u.pathname === '/reload') { await send('Page.reload', {}, sessions[u.searchParams.get('t') || 'page']); result = { ok: true }; }
    else if (u.pathname === '/cdp') { const { method, params, t } = JSON.parse(body); result = await send(method, params, t ? sessions[t] : undefined); }
    else if (u.pathname === '/screenshot') { const r = await send('Page.captureScreenshot', { format: 'png' }, sessions[u.searchParams.get('t') || 'page']); fs.writeFileSync(u.searchParams.get('f') || '/tmp/cdp_bc/shot.png', Buffer.from(r.data, 'base64')); result = { ok: true }; }
    else if (u.pathname === '/quit') { res.end('{}'); proc.kill(); process.exit(0); }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result ?? null, null, 1));
  } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e) })); }
}).listen(9333, () => console.log('ready ext=' + extId));
```

用法示例：

```bash
node server.mjs &                       # 等出现 ready
curl -s -X POST localhost:9333/eval --data 'HistoryStatsService.isCacheReady()'
curl -s -X POST localhost:9333/eval --data-binary @seed.js
```

需要真实鼠标（右键菜单等）时用 `Input.dispatchMouseEvent`（`mouseMoved` → `mousePressed` → `mouseReleased`，`button: "right"`, `buttons: 2`）。

统计 `history.search` 调用次数：在 `Page.enable` 之后用 `Page.addScriptToEvaluateOnNewDocument` 注入包装 `chrome.history.search` 的脚本，把参数推入 `window.__hsCalls`，再重载页面。

### 4.2 造数据（`seed.js`，在画布页执行）

```js
(async () => {
  const root = await chrome.bookmarks.create({ parentId: '1', title: 'Seed' });
  const bms = []; const rand = (n) => Math.floor(Math.random() * n);
  for (let f = 0; f < 30; f++) {
    const folder = await chrome.bookmarks.create({ parentId: root.id, title: 'Folder ' + f });
    const ps = [];
    for (let i = 0; i < 50; i++) {
      const d = (f * 50 + i) % 60;
      ps.push(chrome.bookmarks.create({ parentId: folder.id, title: `Page ${f}-${i} on site${d}`,
        url: `https://site${d}.example.com/page/${f}-${i}` + (i % 7 === 0 ? '/' : '') }));
    }
    bms.push(...await Promise.all(ps));
  }
  const special = await chrome.bookmarks.create({ parentId: root.id, title: 'Special' });
  for (const [title, url] of [['GitHub Docs', 'https://docs.github.com/en'], ['Gist', 'https://gist.github.com/'], ['GitHub', 'https://github.com/'], ['Notion', 'https://app.notion.so/abc']])
    bms.push(await chrome.bookmarks.create({ parentId: special.id, title, url }));
  const visits = [];
  for (const b of bms) { const k = rand(15); for (let j = 0; j < k; j++) visits.push(b.url); }
  for (let j = 0; j < 20000; j++) visits.push(`https://noise${j % 400}.example.org/item/${j}`);
  for (let j = 0; j < 300; j++) visits.push(`https://app.notion.so/page-${j}`);
  for (let i = 0; i < visits.length; i += 500) await Promise.all(visits.slice(i, i + 500).map(url => chrome.history.addUrl({ url })));
  return { bookmarks: bms.length, visits: visits.length };
})()
```

注意：`addUrl` 只能产生“当前时间”的访问，且无法设置标题；需要“旧访问”时，先造访问，等待一段时间后再造新访问，用 `deleteRange` 只删新的那段。

### 4.3 跳转测试服务（`srv.mjs`）

```js
import http from 'node:http';
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const html = (t, body = '') => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<title>${t}</title>${body}`); };
  if (u.pathname === '/short') { res.writeHead(302, { location: '/long/article?session=abc123' }); return res.end(); }
  if (u.pathname === '/long/article') return html('Long Article Title Here');
  if (u.pathname === '/js-redirect') return html('Redirecting', `<script>location.replace('/after-login?token=' + Math.random().toString(36).slice(2))</script>`);
  if (u.pathname === '/after-login') return html('My Dashboard Page');
  html('Plain Page');
}).listen(9555);
```

在画布页用 `chrome.tabs.create({ url, active: false })` 打开、等 1.5 秒、关闭，模拟用户点开书签。

### 4.4 常用页面内对象

| 对象 / 函数 | 用途 |
|---|---|
| `HistoryStatsService.ensureHistoryStatsIndex()` | 构建 / 恢复统计 |
| `HistoryStatsService.getBookmarkStatsFromIndex({ url })` | 读单书签统计 |
| `HistoryStatsService.getDomainStats(host)` | 读域名统计 |
| `HistoryStatsService.performIncrementalDeltaSync()` | 手动增量 |
| `HistoryStatsService.getSingleUrlHistoryStats(url, title)` | 右键单书签用的查询 |
| `SearchIndexDb.getBookmarkVisitStats()` / `saveBookmarkVisitStats(x)` | 读写快照（写 `null` = 清快照） |
| `ensureIndexForModeLoaded('bookmark')` | 载入搜索索引 |
| `canvasSearchDb.bookmarkIndex` | 书签名单 |
| `searchCanvasAndRender(q, { source: 'input' })` | 直接执行搜索渲染 |
| `searchUiState` | 当前查询、筛选、结果 |

---

## 五、工作区里尚未提交的改动（测试时注意）

这些是 UI 修复，不涉及统计流程：

1. `@热度/@hot/@最近/@` 默认筛选「书签」；手动点过筛选会记住；回到普通词或清空恢复「全部」（`search.js`）。
2. 网格视图卡片右上角的访问次数 / 最近访问 / 创建日期小标去掉（`search.js`）。
3. 右键另一个节点时关闭旧的二级面板；点「标签」不再在左上角多出一个面板（`bookmark_tree_context_menu.js`）。
4. `window_marker.js` 的内联事件属性改为正常事件绑定（MV3 CSP 拦截问题）。
5. 删除未引用的 `history_html/test_rendering.html`。
