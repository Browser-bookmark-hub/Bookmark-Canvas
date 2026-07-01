(function (global) {
    'use strict';

    function getDefaultRemoteRoot() {
        return t('书签画布', 'bookmark-canvas');
    }
    const DEFAULT_PULL_MODE = 'overwrite';
    const DEFAULT_OVERWRITE_THRESHOLD = 500;
    const DEFAULT_COMMIT_MSG_TEMPLATE = 'Bookmark Canvas: push package {path} {time}';
    const DEFAULT_COMMIT_DESC_TEMPLATE = 'Updated: {updated} files, Deleted: {deleted} files';
    const STORAGE_KEYS = [
        'githubRepoToken',
        'githubRepoOwner',
        'githubRepoName',
        'githubRepoBranch',
        'githubRepoBasePath',
        'githubCanvasRemoteRoot',
        'githubDefaultPullMode',
        'githubOverwriteThreshold',
        'githubLastOperation',
        'githubLastPullRemotePath',
        'githubCanvasPushGuideChoice',
        'githubCanvasPushGuideCustomName',
        'githubConfirmCommitDetails',
        'githubCommitMsgTemplate',
        'githubCommitDescTemplate',
        'githubPullMethod'
    ];

    function getOverlayContainer() {
        if (typeof window !== 'undefined' && typeof window.getOverlayContainer === 'function') {
            return window.getOverlayContainer();
        }
        const container = document.querySelector('.canvas-main-container');
        if (container && (document.fullscreenElement === container || 
                          document.webkitFullscreenElement === container || 
                          document.mozFullScreenElement === container || 
                          document.msFullscreenElement === container)) {
            return container;
        }
        return document.body;
    }

    let activeConfigDialog = null;
    let activeConfirmDialog = null;
    let activeProgressDialog = null;
    let originalProgressTitle = '';
    let progressStuckTimer = null;
    let operationRunning = false;
    let activeAbortController = null;

    function getApi() {
        return global.BookmarkCanvasGithubRepoApi || null;
    }

    function isEn() {
        try {
            if (typeof __getLang === 'function') return !!__getLang().isEn;
        } catch (_) { }
        try {
            return String(localStorage.getItem('language') || '').toLowerCase().startsWith('en');
        } catch (_) { }
        return false;
    }

    function t(zh, en) {
        return isEn() ? en : zh;
    }

    function showToast(message, type = 'info', duration = 3200) {
        try {
            if (typeof showCanvasToast === 'function') {
                showCanvasToast(String(message || ''), type, duration);
                return;
            }
        } catch (_) { }
        if (type === 'error' || type === 'warning') {
            alert(String(message || ''));
        }
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeRepoPath(path) {
        const normalized = String(path == null ? '' : path)
            .trim()
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .replace(/\/+$/, '')
            .replace(/\/+/g, '/');
        if (normalized === 'bookmark-canvas-sync' || normalized === 'bookmark-canvas' || normalized === '书签画布同步' || normalized === '书签画布' || normalized === 'Bookmark Canvas') {
            return getDefaultRemoteRoot();
        }
        return normalized;
    }

    function joinRepoPath() {
        return Array.from(arguments)
            .map(normalizeRepoPath)
            .filter(Boolean)
            .join('/');
    }

    function getPathLeaf(path, fallback = null) {
        const normalized = normalizeRepoPath(path);
        const fb = fallback === null ? getDefaultRemoteRoot() : fallback;
        if (!normalized) return fb;
        return normalized.split('/').filter(Boolean).slice(-1)[0] || fb;
    }

    function isValidRepoFolderPath(path, { allowEmpty = true } = {}) {
        const normalized = normalizeRepoPath(path);
        if (!normalized) return !!allowEmpty;
        const segments = normalized.split('/');
        for (const segment of segments) {
            if (!segment || segment === '.' || segment === '..') return false;
            if (/[<>:"\\|?*\x00-\x1F]/.test(segment)) return false;
            if (/[. ]$/.test(segment)) return false;
        }
        return true;
    }

    function normalizePullMode(value) {
        return value === 'overwrite' ? 'overwrite' : 'snapshot';
    }

    function normalizeThreshold(value) {
        const n = Math.round(Number(value));
        if (!Number.isFinite(n)) return DEFAULT_OVERWRITE_THRESHOLD;
        return Math.max(1, Math.min(100000, n));
    }

    function normalizeLastPullRemotePath(value) {
        if (typeof value === 'string') {
            const path = normalizeRepoPath(value);
            return path ? { path, branch: '', sha: '', at: 0 } : null;
        }
        if (!value || typeof value !== 'object') return null;
        const path = normalizeRepoPath(value.path);
        if (!path) return null;
        const at = Number(value.at);
        return {
            path,
            branch: String(value.branch || ''),
            sha: String(value.sha || ''),
            at: Number.isFinite(at) && at > 0 ? at : 0,
            commitMessage: String(value.commitMessage || ''),
            commitDescription: String(value.commitDescription || '')
        };
    }

    function getStorageArea() {
        try {
            if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local) return chrome.storage.local;
        } catch (_) { }
        try {
            if (typeof browser !== 'undefined' && browser && browser.storage && browser.storage.local) return browser.storage.local;
        } catch (_) { }
        return null;
    }

    function storageGet(keys) {
        const area = getStorageArea();
        if (area && typeof area.get === 'function') {
            return new Promise((resolve) => {
                try {
                    const result = area.get(keys, (items) => {
                        try {
                            if (chrome && chrome.runtime && chrome.runtime.lastError) {
                                resolve({});
                                return;
                            }
                        } catch (_) { }
                        resolve(items || {});
                    });
                    if (result && typeof result.then === 'function') result.then(resolve).catch(() => resolve({}));
                } catch (_) {
                    resolve({});
                }
            });
        }
        const out = {};
        const list = Array.isArray(keys) ? keys : Object.keys(keys || {});
        list.forEach((key) => {
            try {
                const raw = localStorage.getItem(key);
                if (raw == null) return;
                try { out[key] = JSON.parse(raw); } catch (_) { out[key] = raw; }
            } catch (_) { }
        });
        return Promise.resolve(out);
    }

    function storageSet(values) {
        const safeValues = values && typeof values === 'object' ? values : {};
        const area = getStorageArea();
        if (area && typeof area.set === 'function') {
            return new Promise((resolve, reject) => {
                try {
                    const result = area.set(safeValues, () => {
                        try {
                            if (chrome && chrome.runtime && chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message || 'storage.set failed'));
                                return;
                            }
                        } catch (_) { }
                        resolve();
                    });
                    if (result && typeof result.then === 'function') result.then(resolve).catch(reject);
                } catch (error) {
                    reject(error);
                }
            });
        }
        Object.keys(safeValues).forEach((key) => {
            try { localStorage.setItem(key, JSON.stringify(safeValues[key])); } catch (_) { }
        });
        return Promise.resolve();
    }

    async function readDefaultOverwriteThreshold() {
        try {
            const bridge = global.CanvasProtocolBridge;
            if (bridge && typeof bridge.getImportOverwriteThreshold === 'function') {
                return normalizeThreshold(await bridge.getImportOverwriteThreshold());
            }
        } catch (_) { }
        return DEFAULT_OVERWRITE_THRESHOLD;
    }

    async function loadConfig() {
        const raw = await storageGet(STORAGE_KEYS);
        const fallbackThreshold = await readDefaultOverwriteThreshold();
        return {
            token: String(raw.githubRepoToken || '').trim(),
            owner: String(raw.githubRepoOwner || '').trim(),
            repo: String(raw.githubRepoName || '').trim(),
            branch: String(raw.githubRepoBranch || '').trim(),
            basePath: normalizeRepoPath(raw.githubRepoBasePath || ''),
            remoteRoot: normalizeRepoPath(raw.githubCanvasRemoteRoot || getDefaultRemoteRoot()) || getDefaultRemoteRoot(),
            defaultPullMode: normalizePullMode(raw.githubDefaultPullMode || DEFAULT_PULL_MODE),
            overwriteThreshold: normalizeThreshold(raw.githubOverwriteThreshold || fallbackThreshold),
            lastOperation: raw.githubLastOperation && typeof raw.githubLastOperation === 'object' ? raw.githubLastOperation : null,
            lastPullRemotePath: normalizeLastPullRemotePath(raw.githubLastPullRemotePath),
            pushGuideChoice: String(raw.githubCanvasPushGuideChoice || 'agents').trim(),
            pushGuideCustomName: String(raw.githubCanvasPushGuideCustomName || '').trim(),
            confirmCommitDetails: raw.githubConfirmCommitDetails !== false,
            commitMsgTemplate: String(raw.githubCommitMsgTemplate !== undefined ? raw.githubCommitMsgTemplate : DEFAULT_COMMIT_MSG_TEMPLATE).trim(),
            commitDescTemplate: String(raw.githubCommitDescTemplate !== undefined ? raw.githubCommitDescTemplate : DEFAULT_COMMIT_DESC_TEMPLATE).trim(),
            pullMethod: raw.githubPullMethod === 'targeted' ? 'targeted' : 'zipball'
        };
    }

    async function saveConfig(config) {
        const safe = {
            githubRepoToken: String(config && config.token || '').trim(),
            githubRepoOwner: String(config && config.owner || '').trim(),
            githubRepoName: String(config && config.repo || '').trim(),
            githubRepoBranch: String(config && config.branch || '').trim(),
            githubRepoBasePath: normalizeRepoPath(config && config.basePath),
            githubCanvasRemoteRoot: normalizeRepoPath(config && config.remoteRoot) || getDefaultRemoteRoot(),
            githubDefaultPullMode: normalizePullMode(config && config.defaultPullMode),
            githubOverwriteThreshold: normalizeThreshold(config && config.overwriteThreshold),
            githubCanvasPushGuideChoice: String(config && config.pushGuideChoice || 'agents').trim(),
            githubCanvasPushGuideCustomName: String(config && config.pushGuideCustomName || '').trim(),
            githubConfirmCommitDetails: config && config.confirmCommitDetails !== false,
            githubCommitMsgTemplate: String(config && (config.commitMsgTemplate !== undefined ? config.commitMsgTemplate : DEFAULT_COMMIT_MSG_TEMPLATE)).trim(),
            githubCommitDescTemplate: String(config && (config.commitDescTemplate !== undefined ? config.commitDescTemplate : DEFAULT_COMMIT_DESC_TEMPLATE)).trim(),
            githubPullMethod: config && config.pullMethod === 'targeted' ? 'targeted' : 'zipball'
        };
        await storageSet(safe);
        return await loadConfig();
    }

    async function saveLastOperation(operation) {
        const payload = {
            type: String(operation && operation.type || ''),
            at: Date.now(),
            result: String(operation && operation.result || ''),
            path: normalizeRepoPath(operation && operation.path),
            branch: String(operation && operation.branch || ''),
            sha: String(operation && operation.sha || '').trim(),
            message: String(operation && operation.message || ''),
            error: String(operation && operation.error || ''),
            commitMessage: String(operation && operation.commitMessage || '').trim(),
            commitDescription: String(operation && operation.commitDescription || '').trim()
        };
        await storageSet({ githubLastOperation: payload });
        return payload;
    }

    async function saveLastPullRemotePath(operation) {
        const path = normalizeRepoPath(operation && operation.path);
        if (!path) return null;
        const payload = {
            path,
            branch: String(operation && operation.branch || ''),
            sha: String(operation && operation.sha || '').trim(),
            at: Date.now(),
            commitMessage: String(operation && operation.commitMessage || '').trim(),
            commitDescription: String(operation && operation.commitDescription || '').trim()
        };
        await storageSet({ githubLastPullRemotePath: payload });
        return payload;
    }

    function getRepoParams(config, branchOverride = '') {
        return {
            token: config.token,
            owner: config.owner,
            repo: config.repo,
            branch: branchOverride || config.branch,
            basePath: config.basePath
        };
    }

    function getRemoteRootPath(config) {
        return joinRepoPath(config.basePath, config.remoteRoot || getDefaultRemoteRoot());
    }

    function validateConfig(config, { requireRepo = false } = {}) {
        if (!isValidRepoFolderPath(config.basePath, { allowEmpty: true })) {
            return t('Base Path 不合法，请使用仓库内相对路径。', 'Invalid Base Path. Use a relative path inside the repo.');
        }
        if (!isValidRepoFolderPath(config.remoteRoot, { allowEmpty: false })) {
            return t('远端路径不合法，请使用合法的仓库文件夹路径。', 'Invalid remote path. Use a valid repo folder path.');
        }
        if (requireRepo) {
            if (!config.owner || !config.repo || !config.token) {
                return t('请先填写 Owner、Repo 和 Token。', 'Please fill Owner, Repo, and Token first.');
            }
        }
        return '';
    }

    function formatDateTime(ms) {
        const n = Number(ms);
        if (!Number.isFinite(n) || n <= 0) return '-';
        try {
            return new Date(n).toLocaleString(isEn() ? 'en-US' : 'zh-CN', { hour12: false });
        } catch (_) {
            return new Date(n).toISOString();
        }
    }

    function formatLastOperation(last) {
        if (!last || typeof last !== 'object') return `<span class="github-config-muted">${escapeHtml(t('暂无操作记录', 'No operation yet'))}</span>`;
        const typeLabel = last.type === 'push'
            ? t('推送', 'Push')
            : (last.type === 'pull' ? t('拉取', 'Pull') : escapeHtml(last.type || '-'));
        const resultLabel = last.result === 'success'
            ? t('成功', 'Success')
            : (last.result === 'failed'
                ? t('失败', 'Failed')
                : (last.result === 'cancelled' ? t('已取消', 'Cancelled') : (last.result || '-')));
        
        let html = '';
        html += `<div><strong>${escapeHtml(t('类型', 'Type'))}:</strong> ${escapeHtml(typeLabel)}</div>`;
        html += `<div><strong>${escapeHtml(t('时间', 'Time'))}:</strong> ${escapeHtml(formatDateTime(last.at))}</div>`;
        html += `<div><strong>${escapeHtml(t('结果', 'Result'))}:</strong> ${escapeHtml(resultLabel)}</div>`;
        html += `<div><strong>${escapeHtml(t('路径', 'Path'))}:</strong> ${escapeHtml(last.path || '-')}</div>`;
        
        if (last.branch) {
            html += `<div><strong>${escapeHtml(t('分支', 'Branch'))}:</strong> ${escapeHtml(last.branch)}</div>`;
        }
        if (last.sha) {
            html += `<div><strong>${escapeHtml(t('提交哈希', 'Commit SHA'))}:</strong> ${escapeHtml(last.sha.slice(0, 7))}</div>`;
        }
        if (last.commitMessage) {
            html += `<div><strong>${escapeHtml(t('提交信息', 'Commit Message'))}:</strong> ${escapeHtml(last.commitMessage)}</div>`;
        }
        const displayDesc = (last.commitDescription || '').trim() || '-';
        html += `
            <div style="display: flex; align-items: flex-start; gap: 4px; margin-top: 2px;">
                <span style="flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;">
                    <strong>${escapeHtml(t('描述', 'Description'))}</strong>
                    <span class="github-config-info-trigger">?
                        <span class="github-config-info-tooltip is-zh" style="width: 170px;">${escapeHtml(t('描述过长时，此处仅展示前三行。', 'If the description is too long, only the first three lines are shown here.'))}</span>
                    </span>
                </span><strong>:</strong>
                <span style="flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; font-family: inherit; font-size: 11px; color: var(--text-muted, var(--text-secondary)); margin-top: 1.5px; line-height: 1.4;">${escapeHtml(displayDesc)}</span>
            </div>
        `;
        if (last.message) {
            html += `<div><strong>${escapeHtml(t('说明', 'Note'))}:</strong> ${escapeHtml(last.message)}</div>`;
        }
        if (last.error) {
            html += `<div><strong>${escapeHtml(t('错误', 'Error'))}:</strong> <span style="color: var(--tag-red, #cf222e);">${escapeHtml(last.error)}</span></div>`;
        }
        return html;
    }

    function formatLastPullRemotePath(lastPullInput) {
        const lastPull = normalizeLastPullRemotePath(lastPullInput);
        if (!lastPull) {
            return `<span class="github-config-muted">${escapeHtml(t('暂无成功拉取路径', 'No successful pull path yet'))}</span>`;
        }
        const branchWithSha = lastPull.branch
            ? `${lastPull.branch}${lastPull.sha ? ` (${lastPull.sha.slice(0, 7)})` : ''}`
            : '';
        const meta = [
            branchWithSha ? `${t('分支', 'Branch')}: ${branchWithSha}` : '',
            lastPull.at ? `${t('时间', 'Time')}: ${formatDateTime(lastPull.at)}` : ''
        ].filter(Boolean).join(' · ');

        let commitMsgHtml = '';
        if (lastPull.commitMessage) {
            commitMsgHtml = `
                <div style="font-size: 11px; opacity: 0.85; margin-top: 4px; word-break: break-all;">
                    <strong>${escapeHtml(t('提交信息', 'Commit Message'))}:</strong> ${escapeHtml(lastPull.commitMessage)}
                </div>
            `;
        }
        const displayPullDesc = (lastPull.commitDescription || '').trim() || '-';
        commitMsgHtml += `
            <div style="display: flex; align-items: flex-start; gap: 4px; margin-top: 2px;">
                <span style="flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;">
                    <strong>${escapeHtml(t('描述', 'Description'))}</strong>
                    <span class="github-config-info-trigger">?
                        <span class="github-config-info-tooltip is-zh" style="width: 170px;">${escapeHtml(t('描述过长时，此处仅展示前三行。', 'If the description is too long, only the first three lines are shown here.'))}</span>
                    </span>
                </span><strong>:</strong>
                <span style="flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; font-family: inherit; font-size: 11px; color: var(--text-muted, var(--text-secondary)); margin-top: 1.5px; line-height: 1.4;">${escapeHtml(displayPullDesc)}</span>
            </div>
        `;

        return `
            <div class="github-config-last-pull-row">
                <code>${escapeHtml(lastPull.path)}</code>
                <button type="button" class="github-path-copy-btn import-option-btn" id="githubLastPullPathCopyBtn" data-copy-value="${escapeHtml(lastPull.path)}" style="min-width: 48px; display: inline-flex; justify-content: center; align-items: center; text-align: center; padding: 0 6px !important;">${escapeHtml(t('复制', 'Copy'))}</button>
            </div>
            ${meta ? `<div class="github-config-muted">${escapeHtml(meta)}</div>` : ''}
            ${commitMsgHtml}
        `;
    }

    function copyTextToClipboard(text) {
        const value = String(text == null ? '' : text);
        if (!value) return Promise.resolve(false);
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                return navigator.clipboard.writeText(value).then(() => true).catch(() => false);
            }
        } catch (_) { }
        return new Promise((resolve) => {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = value;
                textarea.setAttribute('readonly', 'readonly');
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                textarea.style.top = '0';
                document.body.appendChild(textarea);
                textarea.select();
                const ok = document.execCommand('copy');
                textarea.remove();
                resolve(!!ok);
            } catch (_) {
                resolve(false);
            }
        });
    }

    function openTokenGuide() {
        const lang = isEn() ? 'en' : 'zh';
        const theme = (() => {
            try { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; } catch (_) { return 'light'; }
        })();
        const path = `github/github-token-guide.html?lang=${encodeURIComponent(lang)}&theme=${encodeURIComponent(theme)}`;
        let url = path;
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
                url = chrome.runtime.getURL(path);
            }
        } catch (_) { }
        try {
            if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.create === 'function') {
                chrome.tabs.create({ url });
                return;
            }
        } catch (_) { }
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    function collectDialogConfig(dialog) {
        const get = (id) => {
            const el = dialog.querySelector(`#${id}`);
            return el ? String(el.value || '').trim() : '';
        };
        const getRadioValue = (name, fallback = 'agents') => {
            const el = dialog.querySelector(`input[name="${name}"]:checked`);
            return el ? el.value : fallback;
        };
        const getCheckbox = (id) => {
            const el = dialog.querySelector(`#${id}`);
            return el ? el.checked : false;
        };
        return {
            token: get('githubConfigToken'),
            owner: get('githubConfigOwner'),
            repo: get('githubConfigRepo'),
            branch: get('githubConfigBranch'),
            basePath: normalizeRepoPath(get('githubConfigBasePath')),
            remoteRoot: normalizeRepoPath(get('githubConfigRemoteRoot')),
            defaultPullMode: normalizePullMode(get('githubConfigDefaultPullMode')),
            overwriteThreshold: normalizeThreshold(get('githubConfigOverwriteThreshold')),
            pushGuideChoice: getRadioValue('githubPushGuideChoice'),
            pushGuideCustomName: get('githubPushGuideCustomInput'),
            confirmCommitDetails: getRadioValue('githubPushMode') === 'prompt',
            commitMsgTemplate: get('githubConfigCommitMsgTemplate'),
            commitDescTemplate: get('githubConfigCommitDescTemplate'),
            pullMethod: getRadioValue('githubPullMethod', 'zipball')
        };
    }

    function setDialogStatus(dialog, message, type = 'info') {
        const el = dialog.querySelector('#githubConfigStatus');
        if (!el) return;
        el.textContent = String(message || '');
        el.dataset.type = type;
    }

    function buildPathHelpTemplateHtml(config) {
        const basePath = normalizeRepoPath(config && config.basePath);
        const folderName = getPathLeaf(config && config.remoteRoot, getDefaultRemoteRoot());
        const isDark = (() => {
            try { return (document.documentElement.getAttribute('data-theme') || '') === 'dark'; } catch (_) { return false; }
        })();
        const hl = (value) => {
            const style = isDark
                ? 'color:#fde68a;background:rgba(245,158,11,0.18);border:1px solid rgba(245,158,11,0.35);padding:0 4px;border-radius:6px;font-weight:700;'
                : 'color:#92400e;background:rgba(245,158,11,0.22);border:1px solid rgba(245,158,11,0.38);padding:0 4px;border-radius:6px;font-weight:700;';
            return `<span style="${style}">${escapeHtml(value)}</span>`;
        };
        const hlGray = (value) => {
            const style = isDark
                ? 'color:#8b949e;background:rgba(240,246,252,0.1);border:1px solid #3a3b3c;padding:0 4px;border-radius:6px;font-family:monospace;font-weight:700;'
                : 'color:#57606a;background:rgba(175,184,193,0.2);border:1px solid #d0d7de;padding:0 4px;border-radius:6px;font-family:monospace;font-weight:700;';
            return `<span style="${style}">${escapeHtml(value)}</span>`;
        };
        const arrow = '<div style="margin:8px 0; line-height:1; display:flex; justify-content:center;"><i class="fas fa-arrow-down"></i></div>';
        
        let pathRelationHtml = '';
        if (basePath) {
            pathRelationHtml = isEn()
                ? `<div style="margin: 10px 0; padding: 10px; background: rgba(255, 255, 255, 0.03); border: 1px dashed rgba(229, 231, 235, 0.2); border-radius: 8px;">
                     <div style="font-weight: 600; margin-bottom: 4px; color: var(--text-primary);">Fixed Prefix UI Explanation:</div>
                     <div style="line-height: 1.5;">The gray prefix ${hlGray(basePath + '/')} in front of the input field is your configured ${hl('Base Path')}.</div>
                   </div>`
                : `<div style="margin: 10px 0; padding: 10px; background: rgba(255, 255, 255, 0.03); border: 1px dashed rgba(229, 231, 235, 0.2); border-radius: 8px;">
                     <div style="font-weight: 600; margin-bottom: 4px; color: var(--text-primary);">固定前缀 UI 说明：</div>
                     <div style="line-height: 1.5;">输入框前方的灰色前缀 ${hlGray(basePath + '/')} 是您配置的 ${hl('Base Path')}（仓库基础路径）。</div>
                   </div>`;
        }

        const repoName = config && config.repo ? config.repo : t('您的仓库', 'your-repo');
        
        const mainDesc = isEn()
            ? `<div style="margin-top: 12px; line-height: 1.6;">
                 Please ensure that you use ${hl('「Open folder as vault」')} in Obsidian to open the folder cloned (pulled) from GitHub: ${hl(repoName)}.
               </div>`
            : `<div style="margin-top: 12px; line-height: 1.6;">
                 请确保在 Obsidian 中使用 ${hl('「打开本地仓库」')} 打开您从 GitHub 克隆（拉取）到本地的 ${hl(repoName)} 文件夹（即Repo名字的文件夹）。
               </div>`;

        const targetPath = getRemoteRootPath(config) || getDefaultRemoteRoot();
        const targetFolderLeaf = getPathLeaf(targetPath);
        const warningDesc = isEn()
            ? `<div style="margin-top: 12px; line-height: 1.6; padding: 10px; border-radius: 6px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); color: var(--tag-red, #cf222e); font-size: 11px;">
                 <strong>⚠️ Warning (Important):</strong><br>
                 1. External file nodes (videos, audio, images, PDFs, etc.) are prohibited in the canvas.<br>
                 2. Pushing will automatically clean up the remote directory. Do NOT store any unrelated files (e.g. personal notes, media files) inside the sync directory ${hl(targetPath)} (the ${hl(targetFolderLeaf)} folder), otherwise they will be deleted!
               </div>`
            : `<div style="margin-top: 12px; line-height: 1.6; padding: 10px; border-radius: 6px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); color: var(--tag-red, #cf222e); font-size: 11px;">
                 <strong>⚠️ 安全警示 (切记)：</strong><br>
                 1. 画布中禁止接入任何外部 file 节点（如视频、音频、图片、PDF 等）。<br>
                 2. 推送时同步机制会清理远端目录。请勿在同步目录 ${hl(targetPath)}（即 ${hl(targetFolderLeaf)} 文件夹）下存放任何无关文件（如个人笔记、多媒体等），否则它们将被<strong>彻底删除</strong>！
               </div>`;

        return `
            <div class="github-path-help-notes">
                ${pathRelationHtml}
                ${mainDesc}
                ${warningDesc}
            </div>
        `;
    }

    function showPathHelpDialog(configInput) {
        if (activeConfirmDialog) {
            try { activeConfirmDialog.remove(); } catch (_) { }
            activeConfirmDialog = null;
        }
        const config = configInput && typeof configInput === 'object' ? configInput : {};
        const initialPath = normalizeRepoPath(config.remoteRoot || getDefaultRemoteRoot()) || getDefaultRemoteRoot();
        const dialog = document.createElement('div');
        dialog.className = 'import-dialog github-path-help-dialog';
        dialog.innerHTML = `
            <div class="import-dialog-content github-path-help-content">
                <div class="import-dialog-header" style="padding-left: 14px; padding-right: 14px;">
                    <h3>${escapeHtml(t('推送：「.canvas」内部路径', 'Push: ".canvas" Internal Path'))}</h3>
                    <button class="import-dialog-close" id="githubPathHelpClose" type="button">&times;</button>
                </div>
                <div class="import-dialog-body github-confirm-body">
                    <div class="github-path-detail-editor">
                        <div class="github-path-detail-label">${escapeHtml(t('请输入路径', 'Enter path'))}</div>
                        <div class="github-path-detail-input-row">
                            <div class="github-path-input-wrapper">
                                ${config.basePath ? `<span class="github-path-prefix" title="${escapeHtml(config.basePath)}/">${escapeHtml(config.basePath)}/</span>` : ''}
                                <input id="githubPathHelpInput" type="text" autocomplete="off" value="${escapeHtml(initialPath)}" placeholder="${escapeHtml(getDefaultRemoteRoot())}">
                            </div>
                            <button id="githubPathHelpOk" type="button" class="import-option-btn">${escapeHtml(t('确定', 'OK'))}</button>
                        </div>
                    </div>
                    <hr class="github-path-help-divider">
                    <div class="github-confirm-message">${buildPathHelpTemplateHtml(config)}</div>
                </div>
            </div>
        `;
        getOverlayContainer().appendChild(dialog);
        activeConfirmDialog = dialog;

        return new Promise((resolve) => {
            const input = dialog.querySelector('#githubPathHelpInput');
            const cleanup = (value) => {
                try { dialog.remove(); } catch (_) { }
                if (activeConfirmDialog === dialog) activeConfirmDialog = null;
                resolve(value);
            };
            const confirm = () => {
                const val = input ? String(input.value || '').trim() : '';
                if (!val) {
                    alert(isEn() ? 'Path cannot be empty.' : '路径不能为空，已自动恢复默认值。');
                    if (input) {
                        input.value = getDefaultRemoteRoot();
                        try { input.focus(); input.select(); } catch (_) {}
                    }
                    return;
                }
                cleanup({
                    path: val
                });
            };
            const closeBtn = dialog.querySelector('#githubPathHelpClose');
            const okBtn = dialog.querySelector('#githubPathHelpOk');
            if (closeBtn) closeBtn.addEventListener('click', () => cleanup(null));
            if (okBtn) okBtn.addEventListener('click', confirm);
            if (input) {
                try { input.focus(); input.select(); } catch (_) { }
                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        if (event.isComposing) return;
                        event.preventDefault();
                        confirm();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        cleanup(null);
                    }
                });
            }
            dialog.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cleanup(null);
                }
            });
        });
    }

    function showPullMethodHelpDialog() {
        if (activeConfirmDialog) {
            try { activeConfirmDialog.remove(); } catch (_) { }
            activeConfirmDialog = null;
        }
        const dialog = document.createElement('div');
        dialog.className = 'import-dialog github-path-help-dialog';
        dialog.innerHTML = `
            <div class="import-dialog-content github-path-help-content" style="width: min(92vw, 540px);">
                <div class="import-dialog-header" style="padding-left: 14px; padding-right: 14px;">
                    <h3>${escapeHtml(t('拉取数据包方式说明', 'Pull Package Method Explanation'))}</h3>
                    <button class="import-dialog-close" id="githubPullMethodHelpClose" type="button">&times;</button>
                </div>
                <div class="import-dialog-body github-confirm-body" style="font-size: 13px; line-height: 1.6; color: var(--text-primary);">
                    <div style="display: flex; flex-direction: column; gap: 12px; text-align: left;">
                        
                        <table style="width: 100%; border-collapse: collapse; margin-bottom: 4px; font-size: 12px; border: 1px solid var(--border-color, rgba(0,0,0,0.15)); border-radius: 6px; overflow: hidden;">
                            <thead>
                                <tr style="background: var(--bg-secondary, rgba(0, 0, 0, 0.04)); border-bottom: 2px solid var(--border-color, rgba(0,0,0,0.15));">
                                    <th style="padding: 8px; text-align: left; font-weight: bold; width: 100px;">${escapeHtml(t('拉取方式', 'Method'))}</th>
                                    <th style="padding: 8px; text-align: left; font-weight: bold; width: 130px;">${escapeHtml(t('特点', 'Characteristics'))}</th>
                                    <th style="padding: 8px; text-align: left; font-weight: bold;">${escapeHtml(t('适用场景', 'Best Scenario'))}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr style="border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.08));">
                                    <td style="padding: 8px; font-weight: bold; color: var(--accent-primary, #0969da);">${escapeHtml(t('整仓压缩包法', 'Full Repo ZIP'))}</td>
                                    <td style="padding: 8px; color: var(--text-primary); font-weight: 600;">${t('速度<span style="color: #2da44e;">快</span>，但需<span style="color: #bc4c00;">过滤</span>', 'Speed is <span style="color: #2da44e;">fast</span>, but needs <span style="color: #bc4c00;">filtering</span>')}</td>
                                    <td style="padding: 8px; color: var(--text-secondary);">${t('永久/临时栏目卡片<span style="color: #0969da; font-weight: bold;">多</span>，仓库其他文件<span style="color: #2da44e; font-weight: bold;">少</span>', 'Canvas cards count is <span style="color: #0969da; font-weight: bold;">high</span>, other files in repo are <span style="color: #2da44e; font-weight: bold;">few</span>')}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px; font-weight: bold; color: var(--accent-primary, #0969da);">${escapeHtml(t('定点拉取法', 'Targeted Pull'))}</td>
                                    <td style="padding: 8px; color: var(--text-primary); font-weight: 600;">${t('速度<span style="color: #cf222e;">慢</span>，但<span style="color: #2da44e;">精准</span>', 'Speed is <span style="color: #cf222e;">slow</span>, but <span style="color: #2da44e;">precise</span>')}</td>
                                    <td style="padding: 8px; color: var(--text-secondary);">${t('永久/临时栏目卡片<span style="color: #2da44e; font-weight: bold;">少</span>，仓库其他文件<span style="color: #cf222e; font-weight: bold;">多</span>', 'Canvas cards count is <span style="color: #2da44e; font-weight: bold;">low</span>, other files in repo are <span style="color: #cf222e; font-weight: bold;">many</span>')}</td>
                                </tr>
                            </tbody>
                        </table>

                        <div>
                            <strong style="font-size: 13px; display: block; margin-bottom: 4px;">${escapeHtml(t('原因妥协：', 'Technical Compromise:'))}</strong>
                            <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5; padding: 10px; border-radius: 6px; background: var(--bg-secondary, rgba(0, 0, 0, 0.03)); border: 1px dashed var(--border-color, rgba(0, 0, 0, 0.15));">
                                <span>「${t('GitHub 官方的 /zipball 接口设计非常简单，它只接受 owner（所有者）、repo（仓库）和 branch（分支/引用），<strong>无法指定路径的文件或文件夹进行压缩</strong>。', 'GitHub\'s /zipball API is simple and only accepts owner, repo, and branch, and <strong>cannot specify paths of files or folders to compress</strong>.')}」</span>
                                <div style="margin-top: 6px;">
                                    <a href="https://github.com/orgs/community/discussions/178419" target="_blank" rel="noopener noreferrer" style="color: var(--accent-primary, #0969da); text-decoration: underline; word-break: break-all;">https://github.com/orgs/community/discussions/178419</a>
                                </div>
                            </div>
                        </div>

                        <div>
                            <strong style="font-size: 13px; display: block; margin-bottom: 4px;">${escapeHtml(t('建议：', 'Recommendation:'))}</strong>
                            <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5; padding: 8px 10px; border-radius: 6px; background: rgba(9, 105, 218, 0.06); border: 1px solid rgba(9, 105, 218, 0.15);">
                                <span>${t('默认选「整仓压缩包法」，强烈建议用一个<span style="color: #2da44e; font-weight: bold;">干净的仓库</span>存放。', 'Defaults to "Full Repo ZIPball", highly recommended to store in a <span style="color: #2da44e; font-weight: bold;">clean repository</span>.')}</span>
                            </div>
                        </div>

                    </div>
                    <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                        <button id="githubPullMethodHelpOk" type="button" class="import-mode-btn import-mode-btn-confirm" style="min-width: 80px;">${escapeHtml(t('关闭', 'Close'))}</button>
                    </div>
                </div>
            </div>
        `;
        getOverlayContainer().appendChild(dialog);
        activeConfirmDialog = dialog;

        return new Promise((resolve) => {
            const cleanup = () => {
                try { dialog.remove(); } catch (_) { }
                if (activeConfirmDialog === dialog) activeConfirmDialog = null;
                resolve();
            };
            const closeBtn = dialog.querySelector('#githubPullMethodHelpClose');
            const okBtn = dialog.querySelector('#githubPullMethodHelpOk');
            if (closeBtn) closeBtn.addEventListener('click', cleanup);
            if (okBtn) okBtn.addEventListener('click', cleanup);
            dialog.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' || event.key === 'Enter') {
                    event.preventDefault();
                    cleanup();
                }
            });
            dialog.addEventListener('click', (event) => {
                if (event.target === dialog) cleanup();
            });
        });
    }

    async function showConfigDialog(options = {}) {
        if (activeConfigDialog) {
            try { activeConfigDialog.remove(); } catch (_) { }
            activeConfigDialog = null;
        }
        const config = await loadConfig();
        const title = t('GitHub 推送/拉取配置', 'GitHub Push/Pull Config');
        const dialog = document.createElement('div');
        dialog.className = 'import-dialog github-config-dialog';
        dialog.id = 'githubTransferConfigDialog';
        dialog.innerHTML = `
            <style>
                .inferred-path-tooltip {
                    left: 0 !important;
                    transform: translateY(4px) !important;
                    width: max-content !important;
                    max-width: none !important;
                    white-space: nowrap !important;
                }
                .github-config-info-trigger:hover .inferred-path-tooltip {
                    opacity: 1 !important;
                    transform: translateY(0) !important;
                }
            </style>
            <div class="import-dialog-content github-config-content">
                <div class="import-dialog-header">
                    <h3>${escapeHtml(title)}</h3>
                    <button class="import-dialog-close" id="githubConfigClose" type="button">&times;</button>
                </div>
                <div class="import-dialog-body github-config-body">
                    <div class="github-config-section">
                        <div class="github-config-section-title">${escapeHtml(t('1、仓库配置', '1. Repository'))}</div>
                        <div class="github-config-grid github-config-repo-grid">
                            <label class="github-config-field">
                                <span>Owner</span>
                                <input id="githubConfigOwner" type="text" autocomplete="off" value="${escapeHtml(config.owner)}" placeholder="your-name">
                            </label>
                            <label class="github-config-field">
                                <span>Repo</span>
                                <input id="githubConfigRepo" type="text" autocomplete="off" value="${escapeHtml(config.repo)}" placeholder="bookmark-canvas">
                            </label>
                            <label class="github-config-field">
                                <span>Branch</span>
                                <input id="githubConfigBranch" type="text" autocomplete="off" value="${escapeHtml(config.branch)}" placeholder="${escapeHtml(t('留空=默认分支', 'empty = default branch'))}">
                            </label>
                            <label class="github-config-field">
                                <span>Base Path</span>
                                <input id="githubConfigBasePath" type="text" autocomplete="off" value="${escapeHtml(config.basePath)}" placeholder="${escapeHtml(t('可不填(路径前缀)', 'empty = path prefix'))}">
                            </label>
                        </div>
                    </div>

                    <div class="github-config-auth-row">
                        <label class="github-config-field github-config-token-field">
                            <span>Token (PAT)</span>
                            <input id="githubConfigToken" type="password" autocomplete="off" value="${escapeHtml(config.token)}" placeholder="github_pat_...">
                        </label>
                        <div class="github-config-actions">
                            <button id="githubConfigGuideBtn" type="button" class="import-option-btn github-config-secondary">${escapeHtml(t('Token 说明', 'Token Guide'))}</button>
                            <button id="githubConfigTestBtn" type="button" class="import-option-btn github-config-secondary" style="border: 1px solid var(--accent-primary, #0969da) !important; color: var(--accent-primary, #0969da) !important;">${escapeHtml(t('测试连接', 'Test'))}</button>
                        </div>
                    </div>
                    <div id="githubConfigStatus" class="github-config-status" data-type="info">${escapeHtml(t('修改后会自动保存。', 'Changes are saved automatically.'))}</div>

                    <div class="github-config-subsection">
                        <div class="github-config-subtitle">${escapeHtml(t('2.1、推送', '2.1 Push'))}</div>
                        <div class="github-config-inline">
                            <div style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px;">
                                <span style="font-size: 12px; font-weight: 600; color: var(--text-primary);">${escapeHtml(t('2.1.1、推送提交模式', '2.1.1 Push Commit Mode'))}</span>
                                <div style="display: flex; align-items: center; gap: 16px; margin-top: 2px;">
                                    <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: var(--text-primary); user-select: none; font-weight: normal;">
                                        <input type="radio" name="githubPushMode" value="prompt" ${config.confirmCommitDetails !== false ? 'checked' : ''} style="margin: 0; cursor: pointer; accent-color: var(--accent-primary);">
                                        <span>${escapeHtml(t('推送前弹出面板 (手动输入)', 'Pop up panel before push (Manual input)'))}</span>
                                    </label>
                                    <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: var(--text-primary); user-select: none; font-weight: normal;">
                                        <input type="radio" name="githubPushMode" value="silent" ${config.confirmCommitDetails === false ? 'checked' : ''} style="margin: 0; cursor: pointer; accent-color: var(--accent-primary);">
                                        <span>${escapeHtml(t('静默推送 (使用模板)', 'Silent push (Use templates)'))}</span>
                                    </label>
                                </div>
                            </div>
                            <div id="githubConfigCommitTemplatesContainer" style="grid-column: 1 / -1; display: ${config.confirmCommitDetails === false ? 'flex' : 'none'}; flex-direction: column; gap: 8px; margin-bottom: 8px; border-left: 2px solid var(--accent-primary, #7c3aed); padding-left: 8px; margin-left: 4px;">
                                <label class="github-config-field" style="width: 100%;">
                                    <span>${escapeHtml(t('提交信息模板', 'Commit Message Template'))}</span>
                                    <input id="githubConfigCommitMsgTemplate" type="text" autocomplete="off" value="${escapeHtml(config.commitMsgTemplate)}" placeholder="e.g. Bookmark Canvas: push package {path} {time}">
                                </label>
                                <label class="github-config-field" style="width: 100%;">
                                    <span>${escapeHtml(t('描述模板', 'Commit Description Template'))}</span>
                                    <textarea id="githubConfigCommitDescTemplate" rows="2" style="resize: vertical; min-height: 40px; font-family: inherit; font-size: 12px;" placeholder="e.g. Updated: {updated} files, Deleted: {deleted} files">${escapeHtml(config.commitDescTemplate)}</textarea>
                                </label>
                                <div style="font-size: 11px; color: var(--text-secondary); opacity: 0.8; line-height: 1.4;">
                                    ${escapeHtml(t('支持占位符：{time} (时间), {path} (路径), {updated} (更新数), {deleted} (删除数), {branch} (分支)', 'Supported placeholders: {time} (time), {path} (path), {updated} (updated files), {deleted} (deleted files), {branch} (branch)'))}
                                </div>
                            </div>
                            <div class="github-config-divider-micro"></div>
                            <div class="github-config-guide-container" style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
                                <span style="font-size: 12px; font-weight: 700; color: var(--text-primary);">${escapeHtml(t('2.1.2、AI 指南文件名', '2.1.2 AI Guide Filename'))}</span>
                                <div class="github-config-guide-rows" style="display: flex; flex-direction: column; gap: 8px;">
                                    <div class="github-config-guide-row-1" style="display: flex; align-items: center; gap: 16px;">
                                        <label class="github-config-guide-option" style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-weight: normal; font-size: 12px; color: var(--text-primary);">
                                            <input type="radio" name="githubPushGuideChoice" value="agents" id="githubPushGuideAgents" ${config.pushGuideChoice === 'agents' ? 'checked' : ''} style="margin: 0; cursor: pointer; accent-color: var(--accent-primary);">
                                            <span style="font-weight: 600;">AGENTS.md</span>
                                            <span style="font-size: 11px; color: var(--text-secondary); opacity: 0.8;">codex</span>
                                        </label>
                                        <label class="github-config-guide-option" style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-weight: normal; font-size: 12px; color: var(--text-primary);">
                                            <input type="radio" name="githubPushGuideChoice" value="claude" id="githubPushGuideClaude" ${config.pushGuideChoice === 'claude' ? 'checked' : ''} style="margin: 0; cursor: pointer; accent-color: var(--accent-primary);">
                                            <span style="font-weight: 600;">CLAUDE.md</span>
                                            <span style="font-size: 11px; color: var(--text-secondary); opacity: 0.8;">Claude Code</span>
                                        </label>
                                    </div>
                                    <div class="github-config-guide-row-2" style="display: grid; grid-template-columns: minmax(0, var(--github-config-control-width)) auto; gap: 6px; align-items: center; width: fit-content; max-width: 100%;">
                                        <div style="display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0;">
                                            <label class="github-config-guide-option" style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-weight: normal; font-size: 12px; color: var(--text-primary); flex-shrink: 0; margin: 0;">
                                                <input type="radio" name="githubPushGuideChoice" value="custom" id="githubPushGuideCustom" ${config.pushGuideChoice === 'custom' ? 'checked' : ''} style="margin: 0; cursor: pointer; accent-color: var(--accent-primary);">
                                                <span style="font-weight: 600;">${escapeHtml(t('自定义', 'Custom'))}</span>
                                            </label>
                                            <input type="text" id="githubPushGuideCustomInput" class="github-config-guide-input" placeholder="${escapeHtml(t('例如 GUIDE.md', 'e.g. GUIDE.md'))}" value="${escapeHtml(config.pushGuideCustomName)}" ${config.pushGuideChoice === 'custom' ? '' : 'disabled'} style="flex: 1; min-width: 0;">
                                        </div>
                                        <button type="button" class="import-option-btn github-path-detail-btn" style="visibility: hidden; pointer-events: none; border: 1px solid var(--accent-primary, #0969da) !important; color: var(--accent-primary, #0969da) !important; margin: 0;">${escapeHtml(t('详情', 'Details'))}</button>
                                    </div>
                                </div>
                            </div>
                            <div class="github-config-divider-micro"></div>
                            <label class="github-config-field github-config-remote-field">
                                <span>${escapeHtml(t('2.1.3、「.canvas」内部路径', '2.1.3 ".canvas" Internal Path'))}</span>
                                <div class="github-path-input-row">
                                    <div class="github-path-input-wrapper">
                                        ${config.basePath ? `<span class="github-path-prefix" title="${escapeHtml(config.basePath)}/">${escapeHtml(config.basePath)}/</span>` : ''}
                                        <input id="githubConfigRemoteRoot" type="text" autocomplete="off" value="${escapeHtml(config.remoteRoot)}" placeholder="${escapeHtml(getDefaultRemoteRoot())}">
                                    </div>
                                    <button id="githubPathHelpBtn" type="button" class="import-option-btn github-path-detail-btn" style="border: 1px solid var(--accent-primary, #0969da) !important; color: var(--accent-primary, #0969da) !important;">${escapeHtml(t('详情', 'Details'))}</button>
                                </div>
                            </label>
                        </div>
                    </div>

                    <div class="github-config-subsection">
                        <div class="github-config-subtitle">${escapeHtml(t('2.2、拉取', '2.2 Pull'))}</div>
                        <div class="github-config-inline">
                            <div class="github-config-pull-method-row" style="grid-column: 1 / -1; display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
                                <span style="font-size: 12px; font-weight: 700; color: var(--text-primary); display: inline-flex; align-items: center; gap: 4px; user-select: none;">
                                    ${escapeHtml(t('2.2.1、拉取数据包方式', '2.2.1 Pull Package Method'))}
                                    <span class="github-config-info-trigger" id="githubPullMethodHelpBtn" style="cursor: pointer;">?</span>
                                </span>
                                <div style="display: flex; align-items: center; gap: 16px; margin-top: 2px;">
                                    <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-weight: normal; font-size: 12px; color: var(--text-primary); margin: 0;">
                                        <input type="radio" name="githubPullMethod" value="zipball" id="githubPullMethodZipball" ${config.pullMethod === 'zipball' ? 'checked' : ''} style="margin: 0; cursor: pointer; accent-color: var(--accent-primary);">
                                        <span style="font-weight: 600;">${escapeHtml(t('整仓压缩包法', 'Full Repo ZIPball'))}</span>
                                    </label>
                                    <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-weight: normal; font-size: 12px; color: var(--text-primary); margin: 0;">
                                        <input type="radio" name="githubPullMethod" value="targeted" id="githubPullMethodTargeted" ${config.pullMethod === 'targeted' ? 'checked' : ''} style="margin: 0; cursor: pointer; accent-color: var(--accent-primary);">
                                        <span style="font-weight: 600;">${escapeHtml(t('定点拉取法', 'Targeted Pull'))}</span>
                                    </label>
                                </div>
                            </div>
                            <div class="github-config-divider-micro"></div>
                            <div class="github-config-pull-row">
                                <label class="github-config-field github-config-pull-mode-field">
                                    <span>${escapeHtml(t('2.2.2、默认数据包导入方式', '2.2.2 Default Data Package Import Mode'))}</span>
                                    <select id="githubConfigDefaultPullMode">
                                        <option value="snapshot"${config.defaultPullMode === 'snapshot' ? ' selected' : ''}>${escapeHtml(t('快照包导入', 'Snapshot import'))}</option>
                                        <option value="overwrite"${config.defaultPullMode === 'overwrite' ? ' selected' : ''}>${escapeHtml(t('全量覆盖', 'Full Overwrite'))}</option>
                                    </select>
                                </label>
                                <label class="github-config-field github-config-threshold-field">
                                    <span style="display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
                                        ${escapeHtml(t('差异阈值', 'Diff Threshold'))}
                                        <span class="github-config-info-trigger">?
                                            <span class="github-config-info-tooltip ${isEn() ? 'is-en' : 'is-zh'}">${t('差异条目 ≥ 阈值时全量覆盖，<br>否则按增量更新。', 'If diff entries ≥ threshold, perform full overwrite; otherwise incremental.')}</span>
                                        </span>
                                    </span>
                                    <input id="githubConfigOverwriteThreshold" type="number" min="1" max="100000" step="1" value="${escapeHtml(config.overwriteThreshold)}">
                                </label>
                            </div>
                            <div class="github-config-divider-micro"></div>
                            <div class="github-config-inferred-row" style="grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; width: var(--github-config-control-width); max-width: 100%; margin-top: 8px;">
                                <span style="font-size: 12px; font-weight: 600; white-space: nowrap; flex-shrink: 0; color: var(--text-primary); display: inline-flex; align-items: center; gap: 4px;">
                                    ${escapeHtml(t('2.2.3、拉取路径', '2.2.3 Pull Path'))}
                                    <span class="github-config-info-trigger">?
                                        <span class="github-config-info-tooltip inferred-path-tooltip ${isEn() ? 'is-en' : 'is-zh'}">${t('根据「.canvas」内部路径计算。', 'Calculated from the \".canvas\" internal path.')}</span>
                                    </span>
                                </span>
                                <div class="github-config-last-content" id="githubConfigInferredPathDisplay" style="font-family: monospace; word-break: break-all; min-height: 30px; display: inline-flex; align-items: center; padding: 5px 8px; flex: 1; min-width: 0; box-sizing: border-box; line-height: 1.4;">-</div>
                            </div>
                        </div>
                    </div>

                    <div class="github-config-last">
                        <div class="github-config-subtitle">${escapeHtml(t('3、上一次操作', '3. Last Operation'))}</div>
                        <div class="github-config-last-content">${formatLastOperation(config.lastOperation)}</div>
                        <div class="github-config-subtitle github-config-last-pull-title">${escapeHtml(t('上次拉取路径', 'Last Pull Path'))}</div>
                        <div class="github-config-last-content github-config-last-pull-content">${formatLastPullRemotePath(config.lastPullRemotePath)}</div>
                    </div>
                </div>
            </div>
        `;

        getOverlayContainer().appendChild(dialog);
        activeConfigDialog = dialog;

        return new Promise((resolve) => {
            let saveTimer = null;
            let lastSavedConfig = config;
            let saveSeq = 0;

            const cleanup = (result) => {
                if (saveTimer) {
                    clearTimeout(saveTimer);
                    saveTimer = null;
                }
                try { dialog.remove(); } catch (_) { }
                if (activeConfigDialog === dialog) activeConfigDialog = null;
                resolve(result);
            };

            const updatePullModeState = () => {
                const select = dialog.querySelector('#githubConfigDefaultPullMode');
                const input = dialog.querySelector('#githubConfigOverwriteThreshold');
                const field = input ? input.closest('.github-config-field') : null;
                const disabled = !select || select.value !== 'overwrite';
                if (input) input.disabled = disabled;
                if (field) field.classList.toggle('is-disabled', disabled);
            };

            const updateInferredPath = () => {
                const nextConfig = collectDialogConfig(dialog);
                const inferredPath = joinRepoPath(nextConfig.basePath, nextConfig.remoteRoot || getDefaultRemoteRoot());
                const displayEl = dialog.querySelector('#githubConfigInferredPathDisplay');
                if (displayEl) {
                    displayEl.textContent = inferredPath || getDefaultRemoteRoot();
                }
            };

            const runAutoSave = async (options = {}) => {
                const nextConfig = collectDialogConfig(dialog);
                if (!nextConfig.remoteRoot) {
                    const remoteInput = dialog.querySelector('#githubConfigRemoteRoot');
                    if (remoteInput && document.activeElement === remoteInput) {
                        return null;
                    }
                    if (remoteInput) {
                        remoteInput.value = getDefaultRemoteRoot();
                    }
                    nextConfig.remoteRoot = getDefaultRemoteRoot();
                    updateInferredPath();
                    setDialogStatus(dialog, t('无法保存：路径不能为空，已自动恢复默认值。', 'Cannot save: path cannot be empty. Default value restored.'), 'error');
                    try {
                        const saved = await saveConfig(nextConfig);
                        lastSavedConfig = saved;
                    } catch (_) {}
                    return null;
                }
                const pathError = validateConfig(nextConfig, { requireRepo: false });
                if (pathError) {
                    setDialogStatus(dialog, pathError, 'error');
                    return null;
                }
                const seq = ++saveSeq;
                if (!options.quiet) setDialogStatus(dialog, t('正在自动保存...', 'Saving...'), 'info');
                try {
                    const saved = await saveConfig(nextConfig);
                    if (seq === saveSeq) {
                        lastSavedConfig = saved;
                        if (!options.quiet) {
                            setDialogStatus(dialog, t('已自动保存。', 'Saved automatically.'), 'success');
                        }
                    }
                    return saved;
                } catch (err) {
                    if (seq === saveSeq) {
                        setDialogStatus(dialog, (err && err.message) || String(err), 'error');
                    }
                    return null;
                }
            };

            const scheduleAutoSave = () => {
                updatePullModeState();
                updateInferredPath();
                if (saveTimer) clearTimeout(saveTimer);
                saveTimer = setTimeout(() => {
                    saveTimer = null;
                    void runAutoSave();
                }, 450);
            };

            const closeWithAutoSave = async () => {
                if (saveTimer) {
                    clearTimeout(saveTimer);
                    saveTimer = null;
                }
                const saved = await runAutoSave({ quiet: true });
                const finalConfig = saved || lastSavedConfig || collectDialogConfig(dialog);
                if (options.requireRepo === true) {
                    const error = validateConfig(finalConfig, { requireRepo: true });
                    if (error) {
                        cleanup(null);
                        return;
                    }
                }
                cleanup(finalConfig);
            };

            const closeBtn = dialog.querySelector('#githubConfigClose');
            if (closeBtn) closeBtn.addEventListener('click', () => { void closeWithAutoSave(); });
            dialog.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    void closeWithAutoSave();
                }
            });

            const guideBtn = dialog.querySelector('#githubConfigGuideBtn');
            if (guideBtn) guideBtn.addEventListener('click', openTokenGuide);

            const pathHelpBtn = dialog.querySelector('#githubPathHelpBtn');
            if (pathHelpBtn) {
                pathHelpBtn.addEventListener('click', async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const nextConfig = Object.assign({}, lastSavedConfig || config, collectDialogConfig(dialog));
                    nextConfig.lastPullRemotePath = (lastSavedConfig && lastSavedConfig.lastPullRemotePath) || config.lastPullRemotePath || null;
                    const result = await showPathHelpDialog(nextConfig);
                    if (!result || typeof result.path !== 'string') return;
                    const remoteInput = dialog.querySelector('#githubConfigRemoteRoot');
                    if (!remoteInput) return;
                    remoteInput.value = normalizeRepoPath(result.path) || getDefaultRemoteRoot();
                    remoteInput.dispatchEvent(new Event('input', { bubbles: true }));
                });
            }

            const pullMethodHelpBtn = dialog.querySelector('#githubPullMethodHelpBtn');
            if (pullMethodHelpBtn) {
                pullMethodHelpBtn.addEventListener('click', async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    await showPullMethodHelpDialog();
                });
            }

            const lastPullPathCopyBtn = dialog.querySelector('#githubLastPullPathCopyBtn');
            if (lastPullPathCopyBtn) {
                lastPullPathCopyBtn.addEventListener('click', async () => {
                    const value = lastPullPathCopyBtn.getAttribute('data-copy-value') || '';
                    const ok = await copyTextToClipboard(value);
                    showToast(ok ? t('已复制路径。', 'Path copied.') : t('复制失败，请手动复制。', 'Copy failed. Please copy manually.'), ok ? 'success' : 'error', 2200);
                });
            }

            const testBtn = dialog.querySelector('#githubConfigTestBtn');
            if (testBtn) {
                testBtn.addEventListener('click', async () => {
                    const api = getApi();
                    if (!api || typeof api.testRepoConnection !== 'function') {
                        setDialogStatus(dialog, 'GitHub API unavailable.', 'error');
                        return;
                    }
                    if (saveTimer) {
                        clearTimeout(saveTimer);
                        saveTimer = null;
                    }
                    const nextConfig = await runAutoSave({ quiet: true }) || collectDialogConfig(dialog);
                    const error = validateConfig(nextConfig, { requireRepo: true });
                    if (error) {
                        setDialogStatus(dialog, error, 'error');
                        return;
                    }
                    try {
                        testBtn.disabled = true;
                        setDialogStatus(dialog, t('正在测试连接...', 'Testing connection...'), 'info');
                        const result = await api.testRepoConnection(getRepoParams(nextConfig));
                        if (!result || result.success !== true) {
                            setDialogStatus(dialog, result && result.error ? result.error : t('连接失败', 'Connection failed'), 'error');
                            return;
                        }
                        let msg = t('连接成功。', 'Connection succeeded.');
                        if (result.branchWillBeCreated) {
                            msg += t(' 目标分支当前不存在，首次推送会自动创建。', ' Target branch does not exist and will be created on first push.');
                        }
                        setDialogStatus(dialog, msg, 'success');
                    } catch (err) {
                        setDialogStatus(dialog, (err && err.message) || String(err), 'error');
                    } finally {
                        testBtn.disabled = false;
                    }
                });
            }

            const syncPushGuideCustomEnabled = () => {
                const customRadio = dialog.querySelector('#githubPushGuideCustom');
                const customInput = dialog.querySelector('#githubPushGuideCustomInput');
                const isCustom = !!(customRadio && customRadio.checked);
                if (customInput) {
                    customInput.disabled = !isCustom;
                    if (isCustom) {
                        try { customInput.focus(); } catch (_) { }
                    }
                }
            };

            const pushGuideRadios = dialog.querySelectorAll('input[name="githubPushGuideChoice"]');
            pushGuideRadios.forEach((r) => {
                r.addEventListener('change', () => {
                    syncPushGuideCustomEnabled();
                });
            });

            const pushModeRadios = dialog.querySelectorAll('input[name="githubPushMode"]');
            const templatesContainer = dialog.querySelector('#githubConfigCommitTemplatesContainer');
            pushModeRadios.forEach((r) => {
                r.addEventListener('change', () => {
                    if (templatesContainer) {
                        templatesContainer.style.display = r.value === 'silent' ? 'flex' : 'none';
                    }
                });
            });

            dialog.querySelectorAll('input, select, textarea').forEach((el) => {
                el.addEventListener('input', scheduleAutoSave);
                el.addEventListener('change', scheduleAutoSave);
            });
            const remoteRootEl = dialog.querySelector('#githubConfigRemoteRoot');
            if (remoteRootEl) {
                remoteRootEl.addEventListener('blur', () => {
                    const val = String(remoteRootEl.value || '').trim();
                    if (!val) {
                        void runAutoSave();
                    }
                });
            }

            const updateRemoteRootPrefix = () => {
                const basePathInput = dialog.querySelector('#githubConfigBasePath');
                const basePath = basePathInput ? normalizeRepoPath(basePathInput.value) : '';
                const wrapper = dialog.querySelector('.github-path-input-row .github-path-input-wrapper');
                if (!wrapper) return;
                let prefixEl = wrapper.querySelector('.github-path-prefix');
                if (basePath) {
                    if (!prefixEl) {
                        prefixEl = document.createElement('span');
                        prefixEl.className = 'github-path-prefix';
                        wrapper.insertBefore(prefixEl, wrapper.firstChild);
                    }
                    prefixEl.textContent = basePath + '/';
                    prefixEl.title = basePath + '/';
                    prefixEl.style.display = '';
                } else {
                    if (prefixEl) {
                        prefixEl.style.display = 'none';
                    }
                }
            };

            const basePathInput = dialog.querySelector('#githubConfigBasePath');
            if (basePathInput) {
                basePathInput.addEventListener('input', updateRemoteRootPrefix);
                basePathInput.addEventListener('change', updateRemoteRootPrefix);
            }

            updatePullModeState();
            updateInferredPath();
            updateRemoteRootPrefix();
            syncPushGuideCustomEnabled();
            const firstInput = dialog.querySelector('#githubConfigOwner');
            try { if (firstInput) firstInput.focus(); } catch (_) { }
        });
    }

    function showConfirmDialog(options = {}) {
        if (activeConfirmDialog) {
            try { activeConfirmDialog.remove(); } catch (_) { }
            activeConfirmDialog = null;
        }
        const dialog = document.createElement('div');
        dialog.className = 'import-dialog github-confirm-dialog';
        const title = String(options.title || t('确认操作', 'Confirm'));
        const messageHtml = String(options.messageHtml || '');
        const confirmText = String(options.confirmText || t('继续', 'Continue'));
        const cancelText = String(options.cancelText || t('取消', 'Cancel'));
        const danger = options.danger === true;
        dialog.innerHTML = `
            <div class="import-dialog-content github-confirm-content">
                <div class="import-dialog-header">
                    <h3>${escapeHtml(title)}</h3>
                    <button class="import-dialog-close" id="githubConfirmClose" type="button">&times;</button>
                </div>
                <div class="import-dialog-body github-confirm-body">
                    <div class="github-confirm-message">${messageHtml}</div>
                    <div class="github-confirm-actions">
                        <button id="githubConfirmCancel" type="button" class="import-mode-btn import-mode-btn-cancel">${escapeHtml(cancelText)}</button>
                        <button id="githubConfirmOk" type="button" class="import-mode-btn${danger ? ' github-danger-btn' : ''}">${escapeHtml(confirmText)}</button>
                    </div>
                </div>
            </div>
        `;
        getOverlayContainer().appendChild(dialog);
        activeConfirmDialog = dialog;
        return new Promise((resolve) => {
            const cleanup = (value) => {
                try { dialog.remove(); } catch (_) { }
                if (activeConfirmDialog === dialog) activeConfirmDialog = null;
                resolve(value);
            };
            const closeBtn = dialog.querySelector('#githubConfirmClose');
            const cancelBtn = dialog.querySelector('#githubConfirmCancel');
            const okBtn = dialog.querySelector('#githubConfirmOk');
            if (closeBtn) closeBtn.addEventListener('click', () => cleanup(false));
            if (cancelBtn) cancelBtn.addEventListener('click', () => cleanup(false));
            if (okBtn) okBtn.addEventListener('click', () => cleanup(true));
            dialog.addEventListener('click', (event) => {
                if (event.target === dialog) cleanup(false);
            });
            dialog.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cleanup(false);
                }
            });
        });
    }

    function showProgressDialog(title) {
        originalProgressTitle = title;
        if (progressStuckTimer) {
            clearTimeout(progressStuckTimer);
            progressStuckTimer = null;
        }

        if (activeProgressDialog) {
            try { activeProgressDialog.remove(); } catch (_) { }
            activeProgressDialog = null;
        }
        const dialog = document.createElement('div');
        dialog.className = 'github-progress-dialog';
        dialog.innerHTML = `
            <div class="github-progress-content">
                <div class="github-progress-body">
                    <div class="github-progress-icon-container">
                        <span class="github-progress-spinner"></span>
                    </div>
                    <div class="github-progress-title">${escapeHtml(title)}</div>
                    <div class="github-progress-text">${escapeHtml(t('正在初始化...', 'Initializing...'))}</div>
                    <div class="github-progress-bar-container">
                        <div class="github-progress-bar" style="width: 0%"></div>
                    </div>
                    <div class="github-progress-percentage">0%</div>
                    <div class="github-progress-actions" style="margin-top: 16px; display: flex; justify-content: center; width: 100%;">
                        <button id="githubProgressCancel" type="button" class="import-mode-btn import-mode-btn-cancel" style="margin-top: 0; min-width: 100px;">
                            ${escapeHtml(t('取消', 'Cancel'))}
                        </button>
                    </div>
                </div>
            </div>
        `;
        const cancelBtn = dialog.querySelector('#githubProgressCancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                if (activeAbortController) {
                    try { activeAbortController.abort(); } catch (_) { }
                }
            });
        }
        getOverlayContainer().appendChild(dialog);
        activeProgressDialog = dialog;
    }

    function updateProgress(percent, text) {
        if (!activeProgressDialog) return;
        const bar = activeProgressDialog.querySelector('.github-progress-bar');
        const textEl = activeProgressDialog.querySelector('.github-progress-text');
        const pctEl = activeProgressDialog.querySelector('.github-progress-percentage');
        
        const clamped = Math.max(0, Math.min(100, percent));
        if (bar) bar.style.width = `${clamped}%`;
        if (pctEl) pctEl.textContent = `${clamped}%`;
        if (text) {
            if (textEl) textEl.textContent = text;
        }

        if (percent === 15 || percent === 85) {
            if (!progressStuckTimer) {
                progressStuckTimer = setTimeout(() => {
                    if (activeProgressDialog) {
                        const titleEl = activeProgressDialog.querySelector('.github-progress-title');
                        if (titleEl) {
                            titleEl.textContent = t('时间稍长, 请核查数据大小或者网络问题', 'Taking a while, please check data size or network issues');
                        }
                    }
                }, 10000);
            }
        } else {
            if (progressStuckTimer) {
                clearTimeout(progressStuckTimer);
                progressStuckTimer = null;
            }
            const titleEl = activeProgressDialog.querySelector('.github-progress-title');
            if (titleEl && originalProgressTitle) {
                titleEl.textContent = originalProgressTitle;
            }
        }
    }

    function closeProgressDialog(delay = 0, isSuccess = true) {
        if (progressStuckTimer) {
            clearTimeout(progressStuckTimer);
            progressStuckTimer = null;
        }

        if (!activeProgressDialog) return Promise.resolve();
        const dialog = activeProgressDialog;
        activeProgressDialog = null;

        const cancelBtn = dialog.querySelector('#githubProgressCancel');
        if (cancelBtn) {
            cancelBtn.style.display = 'none';
        }

        if (isSuccess) {
            updateProgress(100, t('同步完成！', 'Sync complete!'));
            const iconContainer = dialog.querySelector('.github-progress-icon-container');
            if (iconContainer) {
                iconContainer.innerHTML = `<span class="github-progress-success-icon"><i class="fas fa-check-circle"></i></span>`;
            }
        }

        return new Promise((resolve) => {
            setTimeout(() => {
                try { dialog.remove(); } catch (_) { }
                resolve();
            }, delay);
        });
    }

    function buildOperationPathHtml(label, path) {
        return `
            <div class="github-operation-line">
                <span>${escapeHtml(label)}</span>
                <code>${escapeHtml(path || getDefaultRemoteRoot())}</code>
            </div>
        `;
    }

    function buildOperationNoticeHtml({ title, description, pathLabel, path, metaHtml = '' } = {}) {
        const english = isEn();
        const separator = english ? '. ' : '。';
        const endPunctuation = english ? '.' : '。';
        const text = [title, description].map((item) => String(item || '').trim()).filter(Boolean).join(separator);
        return `
            <div class="github-operation-text">${escapeHtml(text)}${text && !/[。.!?？]$/.test(text) ? endPunctuation : ''}</div>
            ${buildOperationPathHtml(pathLabel || t('目标路径', 'Target path'), path)}
            ${metaHtml ? `<div class="github-operation-line github-operation-meta">${metaHtml}</div>` : ''}
        `;
    }

    async function ensureReadyConfig(actionLabel) {
        let config = await loadConfig();
        const missing = validateConfig(config, { requireRepo: true });
        if (!missing) return config;
        showToast(t('请先完成 GitHub 配置。', 'Please finish GitHub config first.'), 'warning');
        const next = await showConfigDialog({ requireRepo: true, actionLabel });
        if (!next) return null;
        config = await loadConfig();
        const error = validateConfig(config, { requireRepo: true });
        if (error) {
            showToast(error, 'error', 5000);
            return null;
        }
        return config;
    }

    function getCanvasFileEntries(files, rootPath) {
        const normalizedRoot = normalizeRepoPath(rootPath);
        const prefix = normalizedRoot ? `${normalizedRoot}/` : '';
        return (Array.isArray(files) ? files : []).filter((file) => {
            const path = normalizeRepoPath(file && file.path);
            if (!path) return false;
            if (normalizedRoot && path !== normalizedRoot && !path.startsWith(prefix)) return false;
            return /\.canvas$/i.test(path.split('/').pop() || '');
        });
    }

    function classifyRemoteRoot(listResult, rootPath) {
        const files = Array.isArray(listResult && listResult.files) ? listResult.files : [];
        const canvasFiles = getCanvasFileEntries(files, rootPath);
        if (!listResult || listResult.rootExists === false) {
            return { kind: 'missing', files, canvasFiles };
        }
        if (!files.length) return { kind: 'empty', files, canvasFiles };
        if (canvasFiles.length > 0) return { kind: 'valid-package', files, canvasFiles };
        return { kind: 'foreign-files', files, canvasFiles };
    }

    async function confirmPushPreflight({ config, connection, classification, rootPath }) {
        if (connection && connection.branchWillBeCreated) {
            const ok = await showConfirmDialog({
                title: t('首次推送：创建分支', 'First Push: Create Branch'),
                messageHtml: buildOperationNoticeHtml({
                    title: t('目标分支当前不存在', 'Target branch does not exist'),
                    description: t('将先创建分支，再继续推送。', 'Create the branch first, then continue pushing.'),
                    pathLabel: t('目标分支', 'Target branch'),
                    path: connection.resolvedBranch || config.branch || ''
                }),
                confirmText: t('创建并继续', 'Create and Continue')
            });
            if (!ok) return false;
        }

        if (!classification || classification.kind === 'missing') {
            return await showConfirmDialog({
                title: t('首次推送：初始化远端路径', 'First Push: Initialize Remote Path'),
                messageHtml: buildOperationNoticeHtml({
                    title: t('远端路径尚未创建', 'Remote path has not been created'),
                    description: t('将创建完整导出包。', 'Create a full export package.'),
                    pathLabel: t('目标路径', 'Target path'),
                    path: rootPath || getDefaultRemoteRoot()
                }),
                confirmText: t('初始化并推送', 'Initialize and Push')
            });
        }

        if (classification.kind === 'empty') {
            return await showConfirmDialog({
                title: t('首次推送：空路径', 'First Push: Empty Path'),
                messageHtml: buildOperationNoticeHtml({
                    title: t('远端路径为空', 'Remote path is empty'),
                    description: t('将写入完整导出包。', 'Write a full export package.'),
                    pathLabel: t('目标路径', 'Target path'),
                    path: rootPath || DEFAULT_REMOTE_ROOT
                }),
                confirmText: t('写入导出包', 'Write Package')
            });
        }

        if (classification.kind === 'foreign-files') {
            const count = classification.files.length;
            return await showConfirmDialog({
                title: t('路径风险提示', 'Path Risk'),
                messageHtml: buildOperationNoticeHtml({
                    title: t('该路径不像书签画布导出包', 'This path does not look like a Bookmark Canvas package'),
                    description: t('已有文件，但没有识别到 .canvas 包。', 'Files exist, but no .canvas package was found.'),
                    pathLabel: t('目标路径', 'Target path'),
                    path: rootPath || getDefaultRemoteRoot(),
                    metaHtml: `<span>${escapeHtml(t('远端文件数', 'Remote files'))}</span><strong>${count}</strong>`
                }),
                confirmText: t('仍然覆盖', 'Overwrite Anyway'),
                cancelText: t('停止', 'Stop'),
                danger: true
            });
        }

        return true;
    }

    function uint8ToText(data) {
        if (typeof data === 'string') return data;
        try {
            return new TextDecoder('utf-8').decode(data instanceof Uint8Array ? data : new Uint8Array(data || []));
        } catch (_) {
            return String(data == null ? '' : data);
        }
    }

    function textToUtf8Bytes(text) {
        try {
            return new TextEncoder().encode(String(text == null ? '' : text));
        } catch (_) {
            return new Uint8Array();
        }
    }

    function bytesToHex(bytes) {
        return Array.from(bytes || [])
            .map((byte) => Number(byte || 0).toString(16).padStart(2, '0'))
            .join('');
    }

    async function sha1Hex(bytes) {
        try {
            const cryptoApi = global.crypto || global.msCrypto || null;
            const subtle = cryptoApi && cryptoApi.subtle;
            if (!subtle || typeof subtle.digest !== 'function') return '';
            const digest = await subtle.digest('SHA-1', bytes);
            return bytesToHex(new Uint8Array(digest));
        } catch (_) {
            return '';
        }
    }

    async function calculateGitBlobSha(content) {
        const bodyBytes = textToUtf8Bytes(content);
        const headerBytes = textToUtf8Bytes(`blob ${bodyBytes.byteLength}\0`);
        const payload = new Uint8Array(headerBytes.byteLength + bodyBytes.byteLength);
        payload.set(headerBytes, 0);
        payload.set(bodyBytes, headerBytes.byteLength);
        return await sha1Hex(payload);
    }

    function replacePackageRootPrefixInText(text, packageRoot, remoteRootPath) {
        const fromRoot = normalizeRepoPath(packageRoot);
        const toRoot = normalizeRepoPath(remoteRootPath);
        if (!fromRoot || !toRoot || fromRoot === toRoot) return text;
        const escaped = fromRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return String(text || '').replace(new RegExp(`${escaped}/`, 'g'), `${toRoot}/`);
    }

    async function buildPushChanges(bundle, config, remoteFiles, options = {}) {
        const remoteRootPath = normalizeRepoPath(options.remoteRootPath || getRemoteRootPath(config));
        const packageRoot = normalizeRepoPath(options.packageRoot || getPathLeaf(config.remoteRoot));
        const localByPath = new Map();
        const remoteShaByPath = new Map();
        const files = Array.isArray(bundle && bundle.files) ? bundle.files : [];
        (Array.isArray(remoteFiles) ? remoteFiles : []).forEach((file) => {
            const path = normalizeRepoPath(file && file.path);
            const sha = String(file && file.sha || '').trim();
            if (path && sha) remoteShaByPath.set(path, sha);
        });

        files.forEach((file) => {
            const name = normalizeRepoPath(file && file.name);
            if (!name) return;
            const relPath = packageRoot && name.startsWith(`${packageRoot}/`)
                ? name.slice(packageRoot.length + 1)
                : name;
            const path = joinRepoPath(remoteRootPath, relPath);
            const rawContent = uint8ToText(file.data);
            const shouldRewriteRefs = /\.(canvas|json)$/i.test(name);
            localByPath.set(path, {
                path,
                content: shouldRewriteRefs
                    ? replacePackageRootPrefixInText(rawContent, packageRoot, joinRepoPath(config.basePath, config.remoteRoot || getDefaultRemoteRoot()))
                    : rawContent
            });
        });

        const localEntries = Array.from(localByPath.values());
        const updateChanges = [];
        let skipped = 0;
        let hashCompared = 0;
        const hashConcurrency = Math.max(1, Math.min(12, localEntries.length || 1));
        let cursor = 0;
        let comparedCount = 0;
        const total = localEntries.length || 1;
        const workers = Array.from({ length: hashConcurrency }, async () => {
            while (cursor < localEntries.length) {
                const entry = localEntries[cursor];
                cursor += 1;
                const remoteSha = remoteShaByPath.get(entry.path) || '';
                const localSha = remoteSha ? await calculateGitBlobSha(entry.content) : '';
                if (remoteSha && localSha) {
                    hashCompared += 1;
                    if (remoteSha === localSha) {
                        skipped += 1;
                        comparedCount += 1;
                        updateProgress(30 + Math.round((comparedCount / total) * 30), t(`正在比对本地与远端文件 (${comparedCount}/${total})...`, `Comparing local and remote files (${comparedCount}/${total})...`));
                        continue;
                    }
                }
                updateChanges.push(entry);
                comparedCount += 1;
                updateProgress(30 + Math.round((comparedCount / total) * 30), t(`正在比对本地与远端文件 (${comparedCount}/${total})...`, `Comparing local and remote files (${comparedCount}/${total})...`));
            }
        });
        await Promise.all(workers);

        const deleteChanges = [];
        (Array.isArray(remoteFiles) ? remoteFiles : []).forEach((file) => {
            const path = normalizeRepoPath(file && file.path);
            if (!path || localByPath.has(path)) return;
            deleteChanges.push({ path, delete: true });
        });
        return {
            changes: updateChanges.concat(deleteChanges),
            updated: updateChanges.length,
            deleted: deleteChanges.length,
            skipped,
            hashCompared,
            localCount: localEntries.length,
            remoteCount: Array.isArray(remoteFiles) ? remoteFiles.length : 0
        };
    }

    function resolveTemplate(template, { branch, path, updated, deleted }) {
        const now = new Date();
        const pad2 = (n) => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
        
        return String(template || '')
            .replace(/{time}/g, stamp)
            .replace(/{datetime}/g, stamp)
            .replace(/{path}/g, path || '')
            .replace(/{updated}/g, String(updated || 0))
            .replace(/{deleted}/g, String(deleted || 0))
            .replace(/{branch}/g, branch || '');
    }

    function buildCommitMessage(type, rootPath) {
        const now = new Date();
        const stamp = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
        if (type === 'pull') return `Bookmark Canvas: pull package ${stamp}`;
        return `Bookmark Canvas: push package ${rootPath || getDefaultRemoteRoot()} ${stamp}`;
    }

    function getPushGuideNames(config) {
        const choice = config.pushGuideChoice || 'agents';
        const customName = config.pushGuideCustomName || '';
        let name = 'AGENTS.md';
        if (choice === 'claude') {
            name = 'CLAUDE.md';
        } else if (choice === 'custom') {
            const sanitizeGuideFileName = (raw) => {
                let s = String(raw == null ? '' : raw).trim().replace(/[\\/:*?"<>|]+/g, '').trim();
                if (!s) return '';
                if (!/\.[A-Za-z0-9]+$/.test(s)) s += '.md';
                return s;
            };
            name = sanitizeGuideFileName(customName) || 'AGENTS.md';
        }
        return [name];
    }

    async function showPushCommitDetailsDialog({ config, branch, rootPath, updatedCount, deletedCount }) {
        if (activeConfirmDialog) {
            try { activeConfirmDialog.remove(); } catch (_) { }
            activeConfirmDialog = null;
        }
        const dialog = document.createElement('div');
        dialog.className = 'import-dialog github-confirm-dialog';
        
        const resolvedMsg = resolveTemplate(config.commitMsgTemplate || DEFAULT_COMMIT_MSG_TEMPLATE, {
            branch,
            path: rootPath || getDefaultRemoteRoot(),
            updated: updatedCount,
            deleted: deletedCount
        });
        const resolvedDesc = resolveTemplate(config.commitDescTemplate || DEFAULT_COMMIT_DESC_TEMPLATE, {
            branch,
            path: rootPath || getDefaultRemoteRoot(),
            updated: updatedCount,
            deleted: deletedCount
        });
        
        dialog.innerHTML = `
            <div class="import-dialog-content github-confirm-content" style="width: min(94vw, 480px);">
                <div class="import-dialog-header">
                    <h3>${escapeHtml(t('推送确认 & 提交信息', 'Push Confirm & Commit Details'))}</h3>
                    <button class="import-dialog-close" id="githubPushDetailsClose" type="button">&times;</button>
                </div>
                <div class="import-dialog-body github-confirm-body" style="display: flex; flex-direction: column; gap: 12px;">
                    <!-- Push Summary Card -->
                    <div style="padding: 10px; border-radius: 6px; background: var(--bg-secondary, rgba(0, 0, 0, 0.03)); border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1)); font-size: 12px; line-height: 1.6;">
                        <div style="display: flex; justify-content: space-between;">
                            <span><strong>${escapeHtml(t('目标分支', 'Branch'))}:</strong></span>
                            <span><code>${escapeHtml(branch)}</code></span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-top: 4px;">
                            <span><strong>${escapeHtml(t('远端路径', 'Remote Path'))}:</strong></span>
                            <span><code>${escapeHtml(rootPath || getDefaultRemoteRoot())}</code></span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-top: 4px; border-top: 1px solid var(--border-color, rgba(0, 0, 0, 0.08)); padding-top: 4px;">
                            <span><strong>${escapeHtml(t('待推送变更', 'Pending Changes'))}:</strong></span>
                            <span>
                                <span style="color: var(--accent-primary, #0969da); font-weight: bold;">${updatedCount}</span> ${escapeHtml(t('个更新', 'updated'))} · 
                                <span style="color: var(--tag-red, #cf222e); font-weight: bold;">${deletedCount}</span> ${escapeHtml(t('个删除', 'deleted'))}
                            </span>
                        </div>
                    </div>

                    <!-- Input Fields -->
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <label style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600;">
                            <span style="color: var(--accent-primary, #0969da);">${escapeHtml(t('提交信息 (Commit Message)', 'Commit Message'))}</span>
                            <input id="githubPushCommitMsgInput" type="text" autocomplete="off" 
                                class="github-config-guide-input"
                                value="" 
                                placeholder="${escapeHtml(resolvedMsg)}">
                        </label>
                        <label style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600;">
                            <span style="color: var(--accent-primary, #0969da);">${escapeHtml(t('描述 (Commit Description)', 'Commit Description'))}</span>
                            <textarea id="githubPushCommitDescInput" rows="4" 
                                class="github-config-guide-input"
                                placeholder="${escapeHtml(t('请输入描述（可选）...', 'Enter description (optional)...'))}"
                                style="resize: vertical; min-height: 80px; font-family: inherit; height: auto;"></textarea>
                        </label>
                    </div>

                    <div class="github-confirm-actions" style="margin-top: 8px;">
                        <button id="githubPushDetailsCancel" type="button" class="import-mode-btn import-mode-btn-cancel">${escapeHtml(t('取消', 'Cancel'))}</button>
                        <button id="githubPushDetailsConfirm" type="button" class="import-mode-btn import-mode-btn-confirm">${escapeHtml(t('推送', 'Push'))}</button>
                    </div>
                </div>
            </div>
        `;

        getOverlayContainer().appendChild(dialog);
        activeConfirmDialog = dialog;

        return new Promise((resolve) => {
            const cleanup = (value) => {
                try { dialog.remove(); } catch (_) { }
                if (activeConfirmDialog === dialog) activeConfirmDialog = null;
                resolve(value);
            };
            const closeBtn = dialog.querySelector('#githubPushDetailsClose');
            const cancelBtn = dialog.querySelector('#githubPushDetailsCancel');
            const confirmBtn = dialog.querySelector('#githubPushDetailsConfirm');
            const msgInput = dialog.querySelector('#githubPushCommitMsgInput');
            const descInput = dialog.querySelector('#githubPushCommitDescInput');

            if (closeBtn) closeBtn.addEventListener('click', () => cleanup(null));
            if (cancelBtn) cancelBtn.addEventListener('click', () => cleanup(null));

            if (confirmBtn) {
                confirmBtn.addEventListener('click', () => {
                    const msg = (msgInput ? msgInput.value : '').trim() || resolvedMsg;
                    const desc = (descInput ? descInput.value : '').trim();
                    cleanup({ commitMessage: msg, commitDescription: desc });
                });
            }

            dialog.addEventListener('click', (event) => {
                if (event.target === dialog) cleanup(null);
            });

            dialog.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cleanup(null);
                } else if (event.key === 'Enter' && event.ctrlKey) {
                    event.preventDefault();
                    if (confirmBtn) confirmBtn.click();
                }
            });

            try { if (msgInput) msgInput.focus(); } catch (_) {}
        });
    }

    async function push() {
        if (operationRunning) {
            showToast(t('已有 GitHub 操作正在执行。', 'A GitHub operation is already running.'), 'warning');
            return;
        }
        operationRunning = true;
        activeAbortController = new AbortController();
        const signal = activeAbortController.signal;
        let rootPath = '';
        try {
            const api = getApi();
            if (!api) throw new Error('GitHub API unavailable.');
            const config = await ensureReadyConfig('push');
            if (!config) {
                return;
            }
            rootPath = getRemoteRootPath(config);

            showToast(t('正在检查 GitHub 配置...', 'Checking GitHub config...'), 'info', 2200);

            let connection = null;
            let listResult = null;
            let classification = null;

            if (config.branch) {
                try {
                    listResult = await api.listRepoFiles({
                        token: config.token,
                        owner: config.owner,
                        repo: config.repo,
                        branch: config.branch,
                        rootPath,
                        signal
                    });
                    if (listResult && listResult.success === true) {
                        connection = {
                            success: true,
                            branchExists: true,
                            resolvedBranch: config.branch
                        };
                        classification = classifyRemoteRoot(listResult, rootPath);
                    }
                } catch (err) {
                    if (err && (err.code === 'GITHUB_OPERATION_CANCELLED' || err.name === 'AbortError')) throw err;
                    ;
                }
            }

            if (!connection || !listResult || listResult.success !== true) {
                connection = await api.testRepoConnection({
                    ...getRepoParams(config),
                    basePath: '',
                    signal
                });
                if (!connection || connection.success !== true) {
                    throw new Error(connection && connection.error ? connection.error : t('GitHub 连接失败', 'GitHub connection failed'));
                }
                if (connection.repo && connection.repo.permissions && connection.repo.permissions.push === false) {
                    throw new Error(t('当前 Token 没有仓库写入权限。', 'The current token has no repo write permission.'));
                }

                if (connection.branchExists === false) {
                    classification = { kind: 'missing', files: [], canvasFiles: [] };
                } else {
                    listResult = await api.listRepoFiles({
                        token: config.token,
                        owner: config.owner,
                        repo: config.repo,
                        branch: connection.resolvedBranch || config.branch,
                        rootPath,
                        signal
                    });
                    if (!listResult || listResult.success !== true) {
                        throw new Error(listResult && listResult.error ? listResult.error : t('读取远端路径失败', 'Failed to read remote path'));
                    }
                    classification = classifyRemoteRoot(listResult, rootPath);
                }
            }

            const ok = await confirmPushPreflight({ config, connection, classification, rootPath });
            if (!ok) {
                return;
            }

            const buildPackage = global.buildCanvasGithubPackageFiles ||
                (global.BookmarkCanvasPackageTransferBridge && global.BookmarkCanvasPackageTransferBridge.buildFullCanvasPackageFromCurrent);
            if (typeof buildPackage !== 'function') throw new Error('Canvas export package bridge unavailable.');
            const packageRoot = getPathLeaf(config.remoteRoot || getDefaultRemoteRoot());
            const guideNames = getPushGuideNames(config);
            const bundle = await buildPackage({
                exportRoot: packageRoot,
                vaultPrefix: rootPath || packageRoot,
                reason: 'github-push',
                guideNames: guideNames
            });

            if (signal.aborted) {
                const err = new Error('GitHub operation cancelled');
                err.code = 'GITHUB_OPERATION_CANCELLED';
                throw err;
            }

            const pushPlan = await buildPushChanges(bundle, config, classification.files, { packageRoot, remoteRootPath: rootPath });
            const changes = Array.isArray(pushPlan && pushPlan.changes) ? pushPlan.changes : [];
            if (!changes.length) {
                const note = t('远端已是最新。', 'Remote already up to date.');
                await saveLastOperation({
                    type: 'push',
                    result: 'success',
                    path: rootPath,
                    branch: connection.resolvedBranch || config.branch,
                    sha: connection.branchHeadSha || null,
                    message: note
                });
                showToast(note, 'success', 4200);
                return;
            }

            // Detect files larger than 5MB
            const LARGE_FILE_LIMIT = 5 * 1024 * 1024; // 5MB
            const largeFiles = [];
            changes.forEach((entry) => {
                if (entry.delete) return;
                const size = entry.content ? textToUtf8Bytes(entry.content).length : 0;
                if (size > LARGE_FILE_LIMIT) {
                    largeFiles.push({ path: entry.path, size });
                }
            });

            if (largeFiles.length > 0) {
                const listHtml = largeFiles.map((f) => {
                    const sizeMB = (f.size / (1024 * 1024)).toFixed(2);
                    return `<li style="word-break: break-all; margin-bottom: 4px;"><code>${escapeHtml(f.path)}</code> (${sizeMB} MB)</li>`;
                }).join('');

                const warningMsg = t(
                    `检测到以下待推送文件超过了建议的 5MB 大小限制，可能会导致网络请求失败或耗时极长。是否继续推送？<br><ul style="text-align: left; margin-top: 8px; max-height: 120px; overflow-y: auto; padding-left: 20px;">${listHtml}</ul>`,
                    `The following files exceed the recommended 5MB limit and might cause network failure or take too long. Do you want to continue?<br><ul style="text-align: left; margin-top: 8px; max-height: 120px; overflow-y: auto; padding-left: 20px;">${listHtml}</ul>`
                );

                const continuePush = await showConfirmDialog({
                    title: t('大文件推送警告', 'Large File Warning'),
                    messageHtml: warningMsg,
                    confirmText: t('仍然推送', 'Push Anyway'),
                    cancelText: t('取消', 'Cancel'),
                    danger: true
                });

                if (!continuePush) {
                    showToast(t('推送已取消。', 'Push cancelled.'), 'info', 3000);
                    return;
                }
            }

            let commitMessage = '';
            let commitDescription = '';

            if (config.confirmCommitDetails !== false) {
                const commitDetails = await showPushCommitDetailsDialog({
                    config,
                    branch: connection.resolvedBranch || config.branch,
                    rootPath,
                    updatedCount: pushPlan.updated || 0,
                    deletedCount: pushPlan.deleted || 0
                });
                if (!commitDetails) {
                    return;
                }
                commitMessage = commitDetails.commitMessage;
                commitDescription = commitDetails.commitDescription;
            } else {
                commitMessage = resolveTemplate(config.commitMsgTemplate || DEFAULT_COMMIT_MSG_TEMPLATE, {
                    branch: connection.resolvedBranch || config.branch,
                    path: rootPath || getDefaultRemoteRoot(),
                    updated: pushPlan.updated || 0,
                    deleted: pushPlan.deleted || 0
                });
                commitDescription = resolveTemplate(config.commitDescTemplate || DEFAULT_COMMIT_DESC_TEMPLATE, {
                    branch: connection.resolvedBranch || config.branch,
                    path: rootPath || getDefaultRemoteRoot(),
                    updated: pushPlan.updated || 0,
                    deleted: pushPlan.deleted || 0
                });
            }

            showProgressDialog(t('GitHub 推送中...', 'GitHub Push...'));
            updateProgress(75, t('正在准备推送变更...', 'Preparing upload changes...'));
            updateProgress(
                85,
                t(
                    `正在推送到 GitHub（${pushPlan.updated || 0} 个变更，${pushPlan.deleted || 0} 个删除）...`,
                    `Pushing to GitHub (${pushPlan.updated || 0} changed, ${pushPlan.deleted || 0} deleted)...`
                )
            );

            const finalMessage = commitDescription
                ? `${commitMessage}\n\n${commitDescription}`
                : commitMessage;

            const result = await api.applyRepoFilesBatch({
                token: config.token,
                owner: config.owner,
                repo: config.repo,
                branch: connection.resolvedBranch || config.branch,
                message: finalMessage,
                changes,
                signal
            });
            if (!result || result.success !== true) {
                throw new Error(result && result.error ? result.error : t('推送失败', 'Push failed'));
            }
            const note = result.noChanges
                ? t('远端已是最新。', 'Remote already up to date.')
                : t(`已推送 ${result.updated || 0} 个文件，删除 ${result.deleted || 0} 个旧文件。`, `Pushed ${result.updated || 0} files, deleted ${result.deleted || 0} old files.`);
            
            updateProgress(95, t('正在保存同步状态...', 'Saving sync status...'));
            await saveLastOperation({
                type: 'push',
                result: 'success',
                path: rootPath,
                branch: result.branch || connection.resolvedBranch || config.branch,
                sha: result.commitSha || null,
                commitMessage: commitMessage,
                commitDescription: commitDescription,
                message: note
            });
            await closeProgressDialog(800, true);
            showToast(note, 'success', 5000);
        } catch (error) {
            await closeProgressDialog(0, false);
            const msg = (error && error.message) || String(error);
            const isCancelled = error && (error.code === 'GITHUB_OPERATION_CANCELLED' || error.name === 'AbortError');
            if (isCancelled) {
                const cancelNote = t('操作已取消。', 'Operation cancelled.');
                try { await saveLastOperation({ type: 'push', result: 'cancelled', path: rootPath, error: cancelNote }); } catch (_) { }
                showToast(cancelNote, 'info', 4000);
            } else {
                try { await saveLastOperation({ type: 'push', result: 'failed', path: rootPath, error: msg }); } catch (_) { }
                showToast(`${t('推送失败：', 'Push failed: ')}${msg}`, 'error', 7000);
            }
        } finally {
            operationRunning = false;
            activeAbortController = null;
        }
    }

    async function downloadRemoteFilesToFolderMap({ api, config, branch, files, signal }) {
        const folderFiles = new Map();
        const list = Array.isArray(files) ? files : [];
        const concurrency = Math.max(1, Math.min(6, list.length || 1));
        let nextIndex = 0;
        let completedCount = 0;
        const total = list.length || 1;

        const worker = async () => {
            while (nextIndex < list.length) {
                if (signal && signal.aborted) {
                    const err = new Error('GitHub operation cancelled');
                    err.code = 'GITHUB_OPERATION_CANCELLED';
                    throw err;
                }
                const file = list[nextIndex];
                nextIndex += 1;
                const filePath = normalizeRepoPath(file && file.path);
                if (!filePath) {
                    completedCount += 1;
                    updateProgress(20 + Math.round((completedCount / total) * 50), t(`正在下载远端文件 (${completedCount}/${total})...`, `Downloading remote files (${completedCount}/${total})...`));
                    continue;
                }
                let fileResult = null;
                if (typeof api.getRepoFileRaw === 'function') {
                    fileResult = await api.getRepoFileRaw({
                        token: config.token,
                        owner: config.owner,
                        repo: config.repo,
                        branch,
                        path: filePath,
                        signal
                    });
                }
                if (!fileResult || fileResult.success !== true) {
                    fileResult = await api.getRepoFile({
                        token: config.token,
                        owner: config.owner,
                        repo: config.repo,
                        branch,
                        path: filePath,
                        signal
                    });
                }
                if (!fileResult || fileResult.success !== true) {
                    if (signal && signal.aborted) {
                        const err = new Error('GitHub operation cancelled');
                        err.code = 'GITHUB_OPERATION_CANCELLED';
                        throw err;
                    }
                    throw new Error(fileResult && fileResult.error ? `${filePath}: ${fileResult.error}` : `${filePath}: ${t('下载失败', 'download failed')}`);
                }
                const resultPath = normalizeRepoPath(fileResult.path || filePath) || filePath;
                folderFiles.set(resultPath, fileResult.contentBytes || new Uint8Array());
                completedCount += 1;
                updateProgress(20 + Math.round((completedCount / total) * 50), t(`正在下载远端文件 (${completedCount}/${total})...`, `Downloading remote files (${completedCount}/${total})...`));
            }
        };

        const workers = [];
        for (let i = 0; i < concurrency; i += 1) workers.push(worker());
        await Promise.all(workers);
        return folderFiles;
    }

    async function choosePullMode(config, rootPath, fileCount, commitInfo = null) {
        const defaultMode = normalizePullMode(config.defaultPullMode);

        const formatCommitDate = (isoString) => {
            if (!isoString) return '';
            try {
                const date = new Date(isoString);
                if (isNaN(date.getTime())) return isoString;
                const pad2 = (n) => String(n).padStart(2, '0');
                return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
            } catch (_) {
                return isoString;
            }
        };

        let commitInfoHtml = '';
        if (commitInfo && commitInfo.sha) {
            const displayDesc = (commitInfo.description || '').trim() || '-';
            const descHtml = `
                <div style="display: flex; align-items: flex-start; gap: 4px; margin-top: 2px;">
                    <span style="flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;">
                        <strong>${escapeHtml(t('描述', 'Description'))}</strong>
                        <span class="github-config-info-trigger">?
                            <span class="github-config-info-tooltip is-zh" style="width: 170px;">${escapeHtml(t('描述过长时，此处仅展示前三行。', 'If the description is too long, only the first three lines are shown here.'))}</span>
                        </span>
                    </span><strong>:</strong>
                    <span style="flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; font-family: inherit; font-size: 11px; color: var(--text-muted, var(--text-secondary)); margin-top: 1.5px; line-height: 1.4;">${escapeHtml(displayDesc)}</span>
                </div>
            `;

            commitInfoHtml = `
                <div class="github-commit-info-card" style="margin-top: 10px; padding: 10px; border-radius: 6px; background: var(--bg-secondary, rgba(0, 0, 0, 0.03)); border: 1px dashed var(--border-color, rgba(0, 0, 0, 0.15)); font-size: 12px; line-height: 1.6; text-align: left;">
                    <div style="font-weight: bold; margin-bottom: 6px; color: var(--accent-primary, #7c3aed); display: flex; align-items: center; gap: 6px;">
                        <i class="fas fa-history"></i> ${escapeHtml(t('远端最新提交', 'Latest Cloud Commit'))}
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <div><strong>${escapeHtml(t('提交信息', 'Commit Message'))}:</strong> <span style="word-break: break-all; color: var(--text-primary); font-weight: 500;">${escapeHtml(commitInfo.message)}</span></div>
                        ${descHtml}
                        <div><strong>${escapeHtml(t('提交时间', 'Time'))}:</strong> <span style="color: var(--text-secondary);">${escapeHtml(formatCommitDate(commitInfo.date))}${commitInfo.authorName ? ` by ${escapeHtml(commitInfo.authorName)}` : ''}</span></div>
                        <div><strong>${escapeHtml(t('提交哈希', 'Commit SHA'))}:</strong> <code style="background: rgba(0, 0, 0, 0.05); padding: 1px 4px; border-radius: 3px; font-family: monospace;">${escapeHtml(commitInfo.sha.slice(0, 7))}</code></div>
                    </div>
                </div>
            `;
        }

        const pullMessageHtml = buildOperationNoticeHtml({
            title: t('读取远端完整 .canvas 包', 'Read the full remote .canvas package'),
            description: t('请选择导入方式。', 'Choose an import mode.'),
            pathLabel: t('远端路径', 'Remote path'),
            path: rootPath || getDefaultRemoteRoot(),
            metaHtml: `<span>${escapeHtml(t('远端文件数', 'Remote files'))}</span><strong>${fileCount}</strong>`
        }) + commitInfoHtml;
        const dialog = document.createElement('div');
        dialog.className = 'import-dialog github-pull-mode-dialog';
        dialog.innerHTML = `
            <div class="import-dialog-content github-confirm-content">
                <div class="import-dialog-header">
                    <h3>${escapeHtml(t('选择拉取方式', 'Choose Pull Mode'))}</h3>
                    <button class="import-dialog-close" id="githubPullModeClose" type="button">&times;</button>
                </div>
                <div class="import-dialog-body github-confirm-body">
                    <div class="github-confirm-message github-pull-mode-message">
                        ${pullMessageHtml}
                    </div>
                    <div class="github-pull-mode-actions">
                        <button id="githubPullSnapshot" type="button" class="import-mode-option github-pull-mode-option${defaultMode === 'snapshot' ? ' is-selected' : ''}">
                            <span class="import-mode-radio" aria-hidden="true"></span>
                            <span class="import-mode-option-main">
                                <span class="import-mode-option-title">${escapeHtml(t('导入快照包', 'Snapshot Package Import'))}</span>
                                <span class="import-mode-option-desc">${escapeHtml(t('相当于增量式导入：按快照包导入，并用分组框包裹（默认）。', 'Equivalent to incremental-style import: load as a snapshot package and wrap it in a group frame. (Default)'))}</span>
                            </span>
                        </button>
                        <button id="githubPullOverwrite" type="button" class="import-mode-option github-pull-mode-option${defaultMode === 'overwrite' ? ' is-selected' : ''}">
                            <span class="import-mode-radio" aria-hidden="true"></span>
                            <span class="import-mode-option-main">
                                <span class="import-mode-option-title">${escapeHtml(t('全量覆盖', 'Full Overwrite'))}</span>
                                <span class="import-mode-option-desc">${escapeHtml(t('清空本地目标，写入导入包内容。可通过「备份」撤销。', 'Clears current local target and writes the imported package in. Undo via Backup.'))}</span>
                            </span>
                        </button>
                    </div>
                    <div class="github-pull-mode-footer">
                        <button id="githubPullCancel" type="button" class="import-mode-btn import-mode-btn-cancel">${escapeHtml(t('取消', 'Cancel'))}</button>
                        <button id="githubPullConfirm" type="button" class="import-mode-btn import-mode-btn-confirm">${escapeHtml(t('确定', 'OK'))}</button>
                    </div>
                </div>
            </div>
        `;
        getOverlayContainer().appendChild(dialog);
        return new Promise((resolve) => {
            let selectedMode = defaultMode;
            const cleanup = (value) => {
                try { dialog.remove(); } catch (_) { }
                resolve(value);
            };
            const closeBtn = dialog.querySelector('#githubPullModeClose');
            const snapshotBtn = dialog.querySelector('#githubPullSnapshot');
            const overwriteBtn = dialog.querySelector('#githubPullOverwrite');
            const cancelBtn = dialog.querySelector('#githubPullCancel');
            const confirmBtn = dialog.querySelector('#githubPullConfirm');
            const setSelectedMode = (mode) => {
                selectedMode = mode === 'overwrite' ? 'overwrite' : 'snapshot';
                if (snapshotBtn) snapshotBtn.classList.toggle('is-selected', selectedMode === 'snapshot');
                if (overwriteBtn) overwriteBtn.classList.toggle('is-selected', selectedMode === 'overwrite');
            };
            if (closeBtn) closeBtn.addEventListener('click', () => cleanup(null));
            if (snapshotBtn) snapshotBtn.addEventListener('click', () => setSelectedMode('snapshot'));
            if (overwriteBtn) overwriteBtn.addEventListener('click', () => setSelectedMode('overwrite'));
            if (cancelBtn) cancelBtn.addEventListener('click', () => cleanup(null));
            if (confirmBtn) confirmBtn.addEventListener('click', () => cleanup(selectedMode));
            dialog.addEventListener('click', (event) => {
                if (event.target === dialog) cleanup(null);
            });
            dialog.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cleanup(null);
                } else if (event.key === 'Enter') {
                    event.preventDefault();
                    cleanup(selectedMode);
                }
            });
        });
    }

    async function pull() {
        if (operationRunning) {
            showToast(t('已有 GitHub 操作正在执行。', 'A GitHub operation is already running.'), 'warning');
            return;
        }
        operationRunning = true;
        activeAbortController = new AbortController();
        const signal = activeAbortController.signal;
        let rootPath = '';
        try {
            const api = getApi();
            if (!api) throw new Error('GitHub API unavailable.');
            const config = await ensureReadyConfig('pull');
            if (!config) {
                return;
            }
            rootPath = getRemoteRootPath(config);

            showToast(t('正在读取远端包...', 'Reading remote package...'), 'info', 2400);

            let connection = null;
            let listResult = null;

            if (config.branch) {
                try {
                    listResult = await api.listRepoFiles({
                        token: config.token,
                        owner: config.owner,
                        repo: config.repo,
                        branch: config.branch,
                        rootPath,
                        signal
                    });
                    if (listResult && listResult.success === true) {
                        connection = {
                            success: true,
                            branchExists: true,
                            resolvedBranch: config.branch
                        };
                    }
                } catch (err) {
                    if (err && (err.code === 'GITHUB_OPERATION_CANCELLED' || err.name === 'AbortError')) throw err;
                    ;
                }
            }

            if (!connection || !listResult || listResult.success !== true) {
                connection = await api.testRepoConnection({
                    ...getRepoParams(config),
                    basePath: '',
                    signal
                });
                if (!connection || connection.success !== true) {
                    throw new Error(connection && connection.error ? connection.error : t('GitHub 连接失败', 'GitHub connection failed'));
                }
                if (connection.branchExists === false) {
                    throw new Error(t('目标分支不存在，无法拉取。请先推送一次或换一个分支。', 'Target branch does not exist. Push once first or choose another branch.'));
                }

                listResult = await api.listRepoFiles({
                    token: config.token,
                    owner: config.owner,
                    repo: config.repo,
                    branch: connection.resolvedBranch || config.branch,
                    rootPath,
                    signal
                });
                if (!listResult || listResult.success !== true) {
                    throw new Error(listResult && listResult.error ? listResult.error : t('读取远端路径失败', 'Failed to read remote path'));
                }
            }

            const classification = classifyRemoteRoot(listResult, rootPath);
            if (classification.kind === 'missing' || classification.kind === 'empty') {
                throw new Error(t('远端路径没有可拉取的 .canvas 包。', 'Remote path has no .canvas package to pull.'));
            }
            if (!classification.canvasFiles.length) {
                throw new Error(t('远端路径已有文件，但没有识别到 .canvas 包。', 'Remote path has files but no recognizable .canvas package.'));
            }

            // Fetch latest commit details for UI display and history recording
            let commitInfo = null;
            if (typeof api.getRepoCommit === 'function') {
                try {
                    commitInfo = await api.getRepoCommit({
                        token: config.token,
                        owner: config.owner,
                        repo: config.repo,
                        ref: connection.resolvedBranch || config.branch,
                        signal
                    });
                } catch (commitErr) {
                    if (commitErr && (commitErr.code === 'GITHUB_OPERATION_CANCELLED' || commitErr.name === 'AbortError')) throw commitErr;
                    console.warn('[Pull] Failed to fetch latest commit details:', commitErr);
                }
            }

            const mode = await choosePullMode(config, rootPath, classification.files.length, commitInfo);
            if (!mode) {
                return;
            }

            showProgressDialog(t('GitHub 拉取中...', 'GitHub Pull...'));
            updateProgress(10, t('正在下载远端文件...', 'Downloading remote files...'));

            let folderFiles = null;

            // Attempt to pull via ZIPball first to optimize network requests (unless targeted pull is explicitly configured)
            if (config.pullMethod !== 'targeted' && typeof api.getRepoZipball === 'function' && typeof __unzipStore === 'function') {
                try {
                    updateProgress(15, t('正在获取远端 ZIP 压缩包...', 'Requesting remote ZIP archive...'));
                    const zipResult = await api.getRepoZipball({
                        token: config.token,
                        owner: config.owner,
                        repo: config.repo,
                        branch: connection.resolvedBranch || config.branch,
                        signal
                    });
                    if (zipResult && zipResult.success === true && zipResult.bytes) {
                        updateProgress(40, t('正在解析 ZIP 压缩包...', 'Parsing ZIP archive...'));
                        const zipFiles = await __unzipStore(zipResult.bytes.buffer);

                        // Find the zip root folder prefix generated by GitHub (owner-repo-sha)
                        let zipRoot = '';
                        for (const key of zipFiles.keys()) {
                            const parts = key.split('/');
                            if (parts.length > 0 && parts[0]) {
                                zipRoot = parts[0];
                                break;
                            }
                        }

                        if (zipRoot) {
                            const normalizedRootPath = normalizeRepoPath(rootPath);
                            const zipPrefix = normalizedRootPath ? `${zipRoot}/${normalizedRootPath}/` : `${zipRoot}/`;
                            folderFiles = new Map();

                            for (const [name, bytes] of zipFiles.entries()) {
                                if (name.startsWith(zipPrefix) && !name.endsWith('/')) {
                                    const repoPath = name.slice(zipRoot.length + 1);
                                    folderFiles.set(normalizeRepoPath(repoPath), bytes);
                                }
                            }
                            ;
                        }
                    }
                } catch (zipErr) {
                    if (zipErr && (zipErr.code === 'GITHUB_OPERATION_CANCELLED' || zipErr.name === 'AbortError')) throw zipErr;
                    console.error('[Pull ZIP] ZIPball pulling failed, falling back to sequential download:', zipErr);
                    folderFiles = null;
                }
            }

            // Fallback to sequential downloading if ZIPball fails or is unavailable
            if (!folderFiles) {
                ;
                folderFiles = await downloadRemoteFilesToFolderMap({
                    api,
                    config,
                    branch: connection.resolvedBranch || config.branch,
                    files: classification.files,
                    signal
                });
            }

            const importFn = global.importCanvasGithubFolderPackage ||
                (global.BookmarkCanvasPackageTransferBridge && global.BookmarkCanvasPackageTransferBridge.importCanvasGithubFolderPackage);
            if (typeof importFn !== 'function') throw new Error('Canvas import package bridge unavailable.');
            
            updateProgress(80, mode === 'overwrite' ? t('正在覆盖导入...', 'Importing with overwrite...') : t('正在快照导入...', 'Importing snapshot...'));
            await importFn(folderFiles, getPathLeaf(config.remoteRoot), {
                importMode: mode,
                threshold: config.overwriteThreshold,
                willReloadAfterImport: true,
                deferRuntimeApply: true,
                deferRuntimeRender: true
            });
            const note = mode === 'overwrite'
                ? t('已完成 GitHub 拉取：覆盖导入。', 'GitHub pull complete: overwrite import.')
                : t('已完成 GitHub 拉取：快照包导入。', 'GitHub pull complete: snapshot import.');
            
            const pulledSha = (commitInfo && commitInfo.sha) || connection.branchHeadSha || null;
            const pulledCommitMessage = (commitInfo && commitInfo.message) || '';
            const pulledCommitDescription = (commitInfo && commitInfo.description) || '';

            updateProgress(95, t('正在保存同步状态...', 'Saving sync status...'));
            await saveLastOperation({
                type: 'pull',
                result: 'success',
                path: rootPath,
                branch: connection.resolvedBranch || config.branch,
                sha: pulledSha,
                message: note,
                commitMessage: pulledCommitMessage,
                commitDescription: pulledCommitDescription
            });
            await saveLastPullRemotePath({
                path: rootPath,
                branch: connection.resolvedBranch || config.branch,
                sha: pulledSha,
                commitMessage: pulledCommitMessage,
                commitDescription: pulledCommitDescription
            });
            await closeProgressDialog(800, true);
            showToast(note, 'success', 5000);
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } catch (error) {
            await closeProgressDialog(0, false);
            const msg = (error && error.message) || String(error);
            const isCancelled = error && (error.code === 'GITHUB_OPERATION_CANCELLED' || error.name === 'AbortError');
            if (isCancelled) {
                const cancelNote = t('操作已取消。', 'Operation cancelled.');
                try { await saveLastOperation({ type: 'pull', result: 'cancelled', path: rootPath, error: cancelNote }); } catch (_) { }
                showToast(cancelNote, 'info', 4000);
            } else {
                try { await saveLastOperation({ type: 'pull', result: 'failed', path: rootPath, error: msg }); } catch (_) { }
                showToast(`${t('拉取失败：', 'Pull failed: ')}${msg}`, 'error', 7000);
            }
        } finally {
            operationRunning = false;
            activeAbortController = null;
        }
    }

    global.BookmarkCanvasGithubTransfer = {
        loadConfig,
        saveConfig,
        showConfigDialog,
        push,
        pull,
        normalizeRepoPath,
        getRemoteRootPath
    };
})(window);
