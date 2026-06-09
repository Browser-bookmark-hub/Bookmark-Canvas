(function (global) {
    'use strict';

    const GITHUB_API_BASE_URL = 'https://api.github.com';
    const GITHUB_API_VERSION = '2022-11-28';
    const GITHUB_BLOB_CREATE_CONCURRENCY = 4;
    const GITHUB_REQUEST_TIMEOUT_MS = 60 * 1000;

    function normalizeGitHubToken(token) {
        const raw = String(token || '').trim();
        if (!raw) return '';
        return raw.replace(/^(?:Bearer|token)\s+/i, '').trim();
    }

    function buildGitHubAuthHeader(token) {
        const normalized = normalizeGitHubToken(token);
        return normalized ? `Bearer ${normalized}` : null;
    }

    const STAGE_LABELS_ZH = {
        'resolve-branch': '解析分支',
        'read-ref': '读取分支引用',
        'read-head-commit': '读取 HEAD Commit',
        'create-blob': '创建 Blob',
        'create-tree': '创建 Tree',
        'create-commit': '创建 Commit',
        'create-ref': '创建分支引用',
        'update-ref': '更新分支引用'
    };

    function formatStage(stage) {
        const key = String(stage || '').trim();
        return key ? (STAGE_LABELS_ZH[key] || key) : '';
    }

    function extractGitHubErrorMessagesFromResponse(response) {
        const parts = [];
        if (!response) return parts;
        if (typeof response === 'string') {
            const text = response.trim();
            if (!text) return parts;
            try {
                return extractGitHubErrorMessagesFromResponse(JSON.parse(text));
            } catch (_) {
                parts.push(text.slice(0, 300));
                return parts;
            }
        }
        if (typeof response !== 'object') return parts;
        if (typeof response.message === 'string' && response.message.trim()) {
            parts.push(response.message.trim());
        }
        const errors = Array.isArray(response.errors) ? response.errors : [];
        errors.forEach((entry) => {
            if (!entry) return;
            if (typeof entry === 'string') {
                const text = entry.trim();
                if (text) parts.push(text);
                return;
            }
            if (typeof entry !== 'object') return;
            const msg = typeof entry.message === 'string' ? entry.message.trim() : '';
            const code = typeof entry.code === 'string' ? entry.code.trim() : '';
            const resource = typeof entry.resource === 'string' ? entry.resource.trim() : '';
            const field = typeof entry.field === 'string' ? entry.field.trim() : '';
            const prefixParts = [];
            if (resource) prefixParts.push(resource);
            if (field) prefixParts.push(field);
            const text = `${prefixParts.length ? `${prefixParts.join('.')}: ` : ''}${msg || code}`.trim();
            if (text) parts.push(text);
        });
        const seen = new Set();
        return parts.filter((item) => {
            const text = String(item || '').trim();
            if (!text || seen.has(text)) return false;
            seen.add(text);
            return true;
        });
    }

    function buildGitHubValidationFailureDetails(error) {
        const message = String(error && error.message || '').trim();
        const responseParts = extractGitHubErrorMessagesFromResponse(error && error.response);
        const details = [];
        if (message) details.push(message);
        responseParts.forEach((part) => {
            if (part && part !== message) details.push(part);
        });
        return details.length ? details.join(' | ') : (message || 'Validation Failed');
    }

    function toHeaderMap(headers) {
        const map = {};
        if (!headers || typeof headers.forEach !== 'function') return map;
        headers.forEach((value, key) => {
            const normalizedKey = String(key || '').trim().toLowerCase();
            if (normalizedKey) map[normalizedKey] = String(value || '').trim();
        });
        return map;
    }

    function parseGitHubRateLimitContext(error) {
        const headers = error && error.headers && typeof error.headers === 'object' ? error.headers : {};
        const remaining = Number(headers['x-ratelimit-remaining']);
        const resetEpoch = Number(headers['x-ratelimit-reset']);
        const retryAfter = Number(headers['retry-after']);
        const responseText = extractGitHubErrorMessagesFromResponse(error && error.response).join(' | ');
        const messageText = String(responseText || error && error.message || '').toLowerCase();
        const secondaryLimited = /secondary rate limit|abuse detection/i.test(messageText);
        const primaryLimited = Number.isFinite(remaining) && remaining === 0;
        const hasRetryAfter = Number.isFinite(retryAfter) && retryAfter > 0;
        const resetAtMs = Number.isFinite(resetEpoch) && resetEpoch > 0 ? resetEpoch * 1000 : 0;
        const waitSecondsByReset = resetAtMs > 0 ? Math.max(0, Math.ceil((resetAtMs - Date.now()) / 1000)) : 0;
        return {
            isRateLimited: secondaryLimited || primaryLimited || hasRetryAfter,
            secondaryLimited,
            primaryLimited,
            waitSeconds: hasRetryAfter ? Math.max(1, Math.ceil(retryAfter)) : waitSecondsByReset
        };
    }

    function buildGitHub403AccessDetail(error) {
        const responseParts = extractGitHubErrorMessagesFromResponse(error && error.response);
        const detail = responseParts.find((text) => {
            const normalized = String(text || '').trim().toLowerCase();
            if (!normalized || normalized === 'forbidden') return false;
            if (normalized.includes('secondary rate limit') || normalized.includes('abuse detection')) return false;
            return true;
        }) || '';
        return detail.length > 160 ? `${detail.slice(0, 157)}...` : detail;
    }

    function normalizeGitHubError(error) {
        if (!error) return '未知错误';
        const stage = typeof error.stage === 'string' ? error.stage : '';
        const stageLabel = formatStage(stage);
        const stagePrefix = stageLabel ? `${stageLabel}失败：` : '';

        if (String(error.code || '') === 'GITHUB_FETCH_TIMEOUT') {
            const timeoutMs = Number(error.timeoutMs);
            const hint = Number.isFinite(timeoutMs) && timeoutMs > 0 ? `（>${Math.round(timeoutMs / 1000)} 秒）` : '';
            return `${stagePrefix}GitHub 请求超时${hint}，请检查网络后重试`;
        }

        const status = Number(error.status);
        if (status === 401) return `${stagePrefix}GitHub Token 无效或无权限（401）`;
        if (status === 403) {
            const rate = parseGitHubRateLimitContext(error);
            if (rate.isRateLimited) {
                if (rate.secondaryLimited) {
                    return rate.waitSeconds > 0
                        ? `${stagePrefix}GitHub 次级速率限制（403），请约 ${rate.waitSeconds} 秒后重试`
                        : `${stagePrefix}GitHub 次级速率限制（403），请降低请求频率后重试`;
                }
                if (rate.primaryLimited) {
                    return rate.waitSeconds > 0
                        ? `${stagePrefix}GitHub 主速率限制（403），剩余配额=0，请约 ${rate.waitSeconds} 秒后重试`
                        : `${stagePrefix}GitHub 主速率限制（403），剩余配额=0`;
                }
                return rate.waitSeconds > 0
                    ? `${stagePrefix}GitHub 速率限制（403），请约 ${rate.waitSeconds} 秒后重试`
                    : `${stagePrefix}GitHub 速率限制（403）`;
            }
            const detail = buildGitHub403AccessDetail(error);
            return detail ? `${stagePrefix}GitHub 拒绝访问（403）：${detail}` : `${stagePrefix}GitHub 拒绝访问（403）`;
        }
        if (status === 404) {
            if (stage === 'read-ref') return `${stagePrefix}分支不存在（404）`;
            if (stage === 'create-ref') return `${stagePrefix}默认分支不存在或仓库为空（404）`;
            return `${stagePrefix}仓库不存在、文件不存在或无权限（404）`;
        }
        if (status === 409) return `${stagePrefix}分支不存在或发生冲突（409）`;
        if (status === 413) return `${stagePrefix}请求内容过大（413）`;
        if (status === 422) return `${stagePrefix}请求校验失败（422）：${buildGitHubValidationFailureDetails(error)}`;
        const message = error.message || '未知错误';
        return stagePrefix ? `${stagePrefix}${message}` : message;
    }

    function encodeGitHubPath(path) {
        return String(path || '')
            .split('/')
            .filter((segment) => segment.length > 0)
            .map((segment) => encodeURIComponent(segment))
            .join('/');
    }

    function textToBase64(content) {
        const bytes = new TextEncoder().encode(String(content == null ? '' : content));
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    function base64ToUint8Array(base64) {
        const clean = String(base64 || '').replace(/\s+/g, '');
        if (!clean) return new Uint8Array();
        const binary = atob(clean);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function decodeContentsApiJsonText(text) {
        const raw = String(text || '').trim();
        if (!raw || raw[0] !== '{') return null;
        try {
            const json = JSON.parse(raw);
            if (!json || typeof json !== 'object') return null;
            if (String(json.type || '') !== 'file') return null;
            const contentBase64 = typeof json.content === 'string' ? json.content.replace(/\s+/g, '') : '';
            const encoding = String(json.encoding || 'base64').toLowerCase();
            const size = Number.isFinite(Number(json.size)) ? Number(json.size) : 0;
            if (encoding !== 'base64') return null;
            if (!contentBase64 && size > 0) return null;
            return {
                path: json.path ? String(json.path) : '',
                sha: json.sha ? String(json.sha) : null,
                contentBytes: base64ToUint8Array(contentBase64),
                encoding: 'base64',
                size
            };
        } catch (_) {
            return null;
        }
    }

    async function githubRequestRaw(url, { method = 'GET', headers = {}, body, timeoutMs = GITHUB_REQUEST_TIMEOUT_MS } = {}) {
        const normalizedMethod = String(method || 'GET').trim().toUpperCase();
        const requestHeaders = {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': GITHUB_API_VERSION,
            ...(normalizedMethod === 'GET'
                ? { 'Cache-Control': 'no-cache, no-store, max-age=0', Pragma: 'no-cache' }
                : {}),
            ...headers
        };

        const doFetch = async (effectiveHeaders) => {
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            const requestTimeoutMs = Math.max(1000, Number(timeoutMs) || GITHUB_REQUEST_TIMEOUT_MS);
            let timeoutId = null;
            if (controller) {
                timeoutId = setTimeout(() => {
                    try { controller.abort(); } catch (_) { }
                }, requestTimeoutMs);
            }

            let response = null;
            try {
                response = await fetch(url, {
                    method: normalizedMethod,
                    headers: effectiveHeaders,
                    body,
                    cache: normalizedMethod === 'GET' ? 'no-store' : 'default',
                    signal: controller ? controller.signal : undefined
                });
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    const timeoutError = new Error('GitHub request timed out');
                    timeoutError.code = 'GITHUB_FETCH_TIMEOUT';
                    timeoutError.timeoutMs = requestTimeoutMs;
                    throw timeoutError;
                }
                throw error;
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
            }

            const text = await response.text();
            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
            return { response, text, json, headers: toHeaderMap(response.headers) };
        };

        let result = await doFetch(requestHeaders);
        const authHeader = typeof requestHeaders.Authorization === 'string' ? requestHeaders.Authorization : '';
        const authToken = normalizeGitHubToken(authHeader);
        if (result.response.status === 401 && /^Bearer\s+/i.test(authHeader) && authToken) {
            result = await doFetch({ ...requestHeaders, Authorization: `token ${authToken}` });
        }
        return result;
    }

    async function githubRequestJson(url, { method = 'GET', headers = {}, body } = {}) {
        const result = await githubRequestRaw(url, { method, headers, body });
        if (!result.response.ok) {
            const error = new Error(
                result.json && typeof result.json.message === 'string' && result.json.message
                    ? result.json.message
                    : `${result.response.status} ${result.response.statusText}`.trim()
            );
            error.status = result.response.status;
            error.response = result.json || result.text;
            error.headers = result.headers || {};
            throw error;
        }
        return result.json;
    }

    async function githubRequestText(url, { method = 'GET', headers = {}, body } = {}) {
        const result = await githubRequestRaw(url, { method, headers, body });
        if (!result.response.ok) {
            const error = new Error(
                result.json && typeof result.json.message === 'string' && result.json.message
                    ? result.json.message
                    : `${result.response.status} ${result.response.statusText}`.trim()
            );
            error.status = result.response.status;
            error.response = result.json || result.text;
            error.headers = result.headers || {};
            throw error;
        }
        return result.text || '';
    }

    async function resolveGitHubBranchOrDefault({ authHeader, owner, repo, branch }) {
        const trimmedBranch = String(branch || '').trim();
        if (trimmedBranch) return trimmedBranch;
        const repoInfo = await githubRequestJson(
            `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
            { headers: { Authorization: authHeader } }
        );
        const defaultBranch = repoInfo && typeof repoInfo.default_branch === 'string' ? repoInfo.default_branch.trim() : '';
        if (!defaultBranch) throw new Error('分支未配置');
        return defaultBranch;
    }

    async function testRepoConnection({ token, owner, repo, branch, basePath }) {
        const authHeader = buildGitHubAuthHeader(token);
        if (!authHeader) return { success: false, error: 'GitHub Token 未配置' };
        const trimmedOwner = String(owner || '').trim();
        const trimmedRepo = String(repo || '').trim();
        if (!trimmedOwner || !trimmedRepo) return { success: false, error: '仓库未配置' };

        try {
            const repoInfo = await githubRequestJson(
                `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}`,
                { headers: { Authorization: authHeader } }
            );
            const defaultBranch = repoInfo && typeof repoInfo.default_branch === 'string' ? repoInfo.default_branch : null;
            const resolvedBranch = String(branch || '').trim() || defaultBranch || null;
            let branchExists = null;
            let branchWillBeCreated = false;

            let branchHeadSha = null;
            if (resolvedBranch) {
                try {
                    const refInfo = await githubRequestJson(
                        `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/git/ref/heads/${encodeURIComponent(resolvedBranch)}`,
                        { headers: { Authorization: authHeader } }
                    );
                    branchExists = true;
                    if (refInfo && refInfo.object && refInfo.object.sha) {
                        branchHeadSha = String(refInfo.object.sha);
                    }
                } catch (error) {
                    if (Number(error && error.status) === 404) {
                        branchExists = false;
                        branchWillBeCreated = true;
                    } else {
                        throw error;
                    }
                }
            }

            let basePathExists = null;
            const trimmedBasePath = normalizeRepoPath(basePath);
            if (trimmedBasePath && resolvedBranch && branchExists !== false) {
                try {
                    await githubRequestJson(
                        `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/${encodeGitHubPath(trimmedBasePath)}?ref=${encodeURIComponent(resolvedBranch)}`,
                        { headers: { Authorization: authHeader } }
                    );
                    basePathExists = true;
                } catch (error) {
                    if (Number(error && error.status) === 404) {
                        basePathExists = false;
                    } else {
                        throw error;
                    }
                }
            }

            const permissions = repoInfo && typeof repoInfo.permissions === 'object' && repoInfo.permissions
                ? repoInfo.permissions
                : null;
            return {
                success: true,
                repo: {
                    id: repoInfo && repoInfo.id ? String(repoInfo.id) : null,
                    fullName: repoInfo && repoInfo.full_name ? String(repoInfo.full_name) : `${trimmedOwner}/${trimmedRepo}`,
                    defaultBranch,
                    private: repoInfo && repoInfo.private === true,
                    htmlUrl: repoInfo && repoInfo.html_url ? String(repoInfo.html_url) : null,
                    permissions: permissions ? {
                        pull: permissions.pull === true,
                        push: permissions.push === true,
                        admin: permissions.admin === true
                    } : null
                },
                resolvedBranch,
                basePathExists,
                branchExists,
                branchWillBeCreated,
                branchHeadSha
            };
        } catch (error) {
            return { success: false, error: normalizeGitHubError(error) };
        }
    }

    function normalizeRepoPath(path) {
        return String(path || '')
            .trim()
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .replace(/\/+$/, '')
            .replace(/\/+/g, '/');
    }

    async function listRepoFilesByTree({ authHeader, owner, repo, ref, rootPath }) {
        const normalizedRootPath = normalizeRepoPath(rootPath);
        const treeRef = String(ref || '').trim() || 'HEAD';
        const json = await githubRequestJson(
            `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(treeRef)}?recursive=1`,
            { headers: { Authorization: authHeader } }
        );

        const files = [];
        const prefix = normalizedRootPath ? `${normalizedRootPath}/` : '';
        let rootExists = !normalizedRootPath;
        (Array.isArray(json && json.tree) ? json.tree : []).forEach((entry) => {
            if (!entry || typeof entry !== 'object') return;
            const pathText = normalizeRepoPath(entry.path);
            if (!pathText) return;
            const type = String(entry.type || '').trim();
            if (normalizedRootPath) {
                if (pathText === normalizedRootPath && type === 'tree') {
                    rootExists = true;
                    return;
                }
                if (!pathText.startsWith(prefix)) return;
                rootExists = true;
            }
            if (type !== 'blob') return;
            files.push({
                path: pathText,
                sha: entry.sha ? String(entry.sha) : '',
                size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : 0
            });
        });

        return {
            success: true,
            rootPath: normalizedRootPath,
            rootExists,
            files,
            truncated: json && json.truncated === true
        };
    }

    async function listRepoFilesRecursivelyByContents({ authHeader, owner, repo, ref, rootPath }) {
        const normalizedRootPath = normalizeRepoPath(rootPath);
        if (!normalizedRootPath) return { success: true, rootPath: '', rootExists: true, files: [] };
        const buildUrl = (path) => {
            const base = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGitHubPath(path)}`;
            return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
        };

        const files = [];
        const pendingDirs = [normalizedRootPath];
        const visitedDirs = new Set();
        let rootExists = true;
        const maxConcurrent = 6;

        const processDir = async (dirPath) => {
            let json = null;
            try {
                json = await githubRequestJson(buildUrl(dirPath), { headers: { Authorization: authHeader } });
            } catch (error) {
                if (Number(error && error.status) === 404) {
                    if (dirPath === normalizedRootPath) rootExists = false;
                    return;
                }
                throw error;
            }
            const entries = Array.isArray(json) ? json : [json];
            entries.forEach((entry) => {
                if (!entry || typeof entry !== 'object') return;
                const type = String(entry.type || '').trim();
                const pathText = String(entry.path || '').trim();
                if (!pathText) return;
                if (type === 'file') {
                    files.push({
                        path: pathText,
                        sha: entry.sha ? String(entry.sha) : '',
                        size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : 0
                    });
                } else if (type === 'dir' && !visitedDirs.has(pathText)) {
                    pendingDirs.push(pathText);
                }
            });
        };

        while (pendingDirs.length) {
            const batch = [];
            while (batch.length < maxConcurrent && pendingDirs.length) {
                const dirPath = normalizeRepoPath(pendingDirs.shift());
                if (!dirPath || visitedDirs.has(dirPath)) continue;
                visitedDirs.add(dirPath);
                batch.push(processDir(dirPath));
            }
            if (batch.length) await Promise.all(batch);
        }

        return { success: true, rootPath: normalizedRootPath, rootExists, files };
    }

    async function listRepoFiles({ token, owner, repo, branch, rootPath }) {
        const authHeader = buildGitHubAuthHeader(token);
        if (!authHeader) return { success: false, error: 'GitHub Token 未配置', repoNotConfigured: true };
        const trimmedOwner = String(owner || '').trim();
        const trimmedRepo = String(repo || '').trim();
        if (!trimmedOwner || !trimmedRepo) return { success: false, error: '仓库未配置', repoNotConfigured: true };

        const rawBranch = String(branch || '').trim();
        const normalizedRootPath = normalizeRepoPath(rootPath);
        try {
            const treeResult = await listRepoFilesByTree({
                authHeader,
                owner: trimmedOwner,
                repo: trimmedRepo,
                ref: rawBranch,
                rootPath: normalizedRootPath
            });
            if (!treeResult.truncated || !normalizedRootPath) return treeResult;

            if (normalizedRootPath) {
                return await listRepoFilesRecursivelyByContents({
                    authHeader,
                    owner: trimmedOwner,
                    repo: trimmedRepo,
                    ref: rawBranch,
                    rootPath: normalizedRootPath
                });
            }
            return treeResult;
        } catch (error) {
            return { success: false, error: normalizeGitHubError(error) };
        }
    }

    async function getRepoFileRaw({ token, owner, repo, branch, path }) {
        const authHeader = buildGitHubAuthHeader(token);
        if (!authHeader) return { success: false, error: 'GitHub Token 未配置', repoNotConfigured: true };
        const trimmedOwner = String(owner || '').trim();
        const trimmedRepo = String(repo || '').trim();
        const trimmedPath = normalizeRepoPath(path);
        if (!trimmedOwner || !trimmedRepo) return { success: false, error: '仓库未配置', repoNotConfigured: true };
        if (!trimmedPath) return { success: false, error: '缺少文件路径' };

        const encodedPath = encodeGitHubPath(trimmedPath);
        const trimmedBranch = String(branch || '').trim();
        const url = trimmedBranch
            ? `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/${encodedPath}?ref=${encodeURIComponent(trimmedBranch)}`
            : `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/${encodedPath}`;

        try {
            const rawText = await githubRequestText(url, {
                headers: { Authorization: authHeader, Accept: 'application/vnd.github.raw' }
            });
            const wrapped = decodeContentsApiJsonText(rawText);
            if (wrapped) {
                return {
                    success: true,
                    path: normalizeRepoPath(wrapped.path || trimmedPath) || trimmedPath,
                    sha: wrapped.sha,
                    contentBytes: wrapped.contentBytes,
                    encoding: wrapped.encoding,
                    size: wrapped.size,
                    fetchedVia: 'raw-json-wrapper'
                };
            }
            const bytes = new TextEncoder().encode(rawText || '');
            return {
                success: true,
                path: trimmedPath,
                contentBytes: bytes,
                encoding: 'utf-8',
                size: bytes.byteLength,
                fetchedVia: 'raw'
            };
        } catch (error) {
            if (Number(error && error.status) === 404) return { success: false, notFound: true, error: '云端文件不存在' };
            return { success: false, error: normalizeGitHubError(error) };
        }
    }

    async function getRepoFile({ token, owner, repo, branch, path }) {
        const authHeader = buildGitHubAuthHeader(token);
        if (!authHeader) return { success: false, error: 'GitHub Token 未配置', repoNotConfigured: true };
        const trimmedOwner = String(owner || '').trim();
        const trimmedRepo = String(repo || '').trim();
        const trimmedPath = normalizeRepoPath(path);
        if (!trimmedOwner || !trimmedRepo) return { success: false, error: '仓库未配置', repoNotConfigured: true };
        if (!trimmedPath) return { success: false, error: '缺少文件路径' };

        const encodedPath = encodeGitHubPath(trimmedPath);
        const trimmedBranch = String(branch || '').trim();
        const url = trimmedBranch
            ? `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/${encodedPath}?ref=${encodeURIComponent(trimmedBranch)}`
            : `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/${encodedPath}`;

        try {
            const json = await githubRequestJson(url, { headers: { Authorization: authHeader } });
            if (!json || typeof json !== 'object' || json.type !== 'file') {
                return { success: false, error: '目标路径不是文件' };
            }

            let contentBase64 = typeof json.content === 'string' ? json.content.replace(/\s+/g, '') : '';
            let encoding = json.encoding ? String(json.encoding) : 'base64';
            let fetchedVia = 'json';

            if (!contentBase64 && json.sha) {
                try {
                    const blobJson = await githubRequestJson(
                        `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/git/blobs/${encodeURIComponent(String(json.sha))}`,
                        { headers: { Authorization: authHeader } }
                    );
                    const blobEncoding = blobJson && blobJson.encoding ? String(blobJson.encoding) : '';
                    const blobContent = blobJson && typeof blobJson.content === 'string' ? blobJson.content.replace(/\s+/g, '') : '';
                    if (blobContent && /^base64$/i.test(blobEncoding || 'base64')) {
                        contentBase64 = blobContent;
                        encoding = 'base64';
                        fetchedVia = 'git-blob';
                    }
                } catch (_) { }
            }

            if (!contentBase64 && Number(json.size) > 0) {
                const rawText = await githubRequestText(url, {
                    headers: { Authorization: authHeader, Accept: 'application/vnd.github.raw' }
                });
                contentBase64 = textToBase64(rawText);
                encoding = 'base64';
                fetchedVia = 'raw';
            }

            return {
                success: true,
                path: json.path ? String(json.path) : trimmedPath,
                sha: json.sha ? String(json.sha) : null,
                contentBase64,
                contentBytes: base64ToUint8Array(contentBase64),
                encoding,
                size: Number.isFinite(Number(json.size)) ? Number(json.size) : 0,
                fetchedVia
            };
        } catch (error) {
            if (Number(error && error.status) === 404) return { success: false, notFound: true, error: '云端文件不存在' };
            return { success: false, error: normalizeGitHubError(error) };
        }
    }

    function isGitHubReferenceAlreadyExistsError(error) {
        if (Number(error && error.status) !== 422) return false;
        const message = String(error && error.message || '').toLowerCase();
        const responseParts = extractGitHubErrorMessagesFromResponse(error && error.response);
        return `${message} ${responseParts.join(' ')}`.toLowerCase().includes('reference already exists');
    }

    function shouldRetryGitHubRefUpdate(error) {
        const status = Number(error && error.status);
        if (status !== 422 && status !== 409) return false;
        const message = String(error && error.message || '').toLowerCase();
        const responseParts = extractGitHubErrorMessagesFromResponse(error && error.response);
        const combined = `${message} ${responseParts.join(' ')}`.toLowerCase();
        if (!combined) return false;
        if (combined.includes('protected branch') || combined.includes('branch is protected')) return false;
        if (combined.includes('required status checks') || combined.includes('pull request')) return false;
        return combined.includes('fast forward') ||
            combined.includes('reference update failed') ||
            combined.includes('cannot lock ref');
    }

    function shouldFallbackInlineTreeContent(error) {
        const status = Number(error && error.status);
        if (status === 413) return true;
        if (status !== 422) return false;
        const message = String(error && error.message || '').toLowerCase();
        const responseParts = extractGitHubErrorMessagesFromResponse(error && error.response);
        const combined = `${message} ${responseParts.join(' ')}`.toLowerCase();
        return combined.includes('too large') ||
            combined.includes('too_large') ||
            combined.includes('maximum') ||
            combined.includes('exceed') ||
            combined.includes('content is too long') ||
            combined.includes('payload');
    }

    async function applyRepoFilesBatch({ token, owner, repo, branch, message, changes }) {
        const authHeader = buildGitHubAuthHeader(token);
        if (!authHeader) return { success: false, error: 'GitHub Token 未配置', repoNotConfigured: true };
        const trimmedOwner = String(owner || '').trim();
        const trimmedRepo = String(repo || '').trim();
        if (!trimmedOwner || !trimmedRepo) return { success: false, error: '仓库未配置', repoNotConfigured: true };

        const rawChanges = Array.isArray(changes) ? changes : [];
        if (!rawChanges.length) return { success: false, error: '缺少变更列表' };
        const changeByPath = new Map();
        rawChanges.forEach((entry) => {
            if (!entry || typeof entry !== 'object') return;
            const rawPath = normalizeRepoPath(entry.path);
            if (!rawPath) return;
            const isDelete = entry.delete === true || entry.deleted === true;
            changeByPath.set(rawPath, {
                path: rawPath,
                delete: isDelete,
                content: isDelete ? null : String(entry.content == null ? '' : entry.content)
            });
        });
        const normalizedChanges = Array.from(changeByPath.values());
        if (!normalizedChanges.length) return { success: false, error: '缺少有效文件路径' };
        const safeMessage = String(message || '').trim() || `Bookmark Canvas: push package (${normalizedChanges.length})`;

        try {
            const annotateStage = (error, stage, extra = null) => {
                if (!error || typeof error !== 'object') return error;
                error.stage = stage;
                if (extra && typeof extra === 'object') {
                    Object.keys(extra).forEach((key) => {
                        try { error[key] = extra[key]; } catch (_) { }
                    });
                }
                return error;
            };

            let resolvedBranch = '';
            try {
                resolvedBranch = await resolveGitHubBranchOrDefault({ authHeader, owner: trimmedOwner, repo: trimmedRepo, branch });
            } catch (error) {
                throw annotateStage(error, 'resolve-branch');
            }
            if (!resolvedBranch) return { success: false, error: '分支未配置' };

            const repoApiBase = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}`;
            const branchInfoUrl = `${repoApiBase}/branches/${encodeURIComponent(resolvedBranch)}`;
            const refReadUrl = `${repoApiBase}/git/ref/heads/${encodeURIComponent(resolvedBranch)}`;
            const refUpdateUrl = `${repoApiBase}/git/refs/heads/${encodeURIComponent(resolvedBranch)}`;
            const refsUrl = `${repoApiBase}/git/refs`;
            const commitsUrl = `${repoApiBase}/git/commits`;
            const treesUrl = `${repoApiBase}/git/trees`;

            const fileShas = {};
            const blobShaByPath = {};
            const uploadEntries = [];
            let updatedCount = 0;
            let deletedCount = 0;
            normalizedChanges.forEach((entry) => {
                if (entry.delete) {
                    deletedCount += 1;
                    return;
                }
                updatedCount += 1;
                uploadEntries.push(entry);
            });

            let preferInlineTreeContent = uploadEntries.length > 0;
            let blobShasPrepared = false;

            const ensureBlobShas = async () => {
                if (blobShasPrepared || !uploadEntries.length) return;
                let cursor = 0;
                const workerCount = Math.max(1, Math.min(GITHUB_BLOB_CREATE_CONCURRENCY, uploadEntries.length));
                const workers = Array.from({ length: workerCount }, async () => {
                    while (true) {
                        const index = cursor;
                        cursor += 1;
                        if (index >= uploadEntries.length) break;
                        const entry = uploadEntries[index];
                        let blobJson = null;
                        try {
                            blobJson = await githubRequestJson(`${repoApiBase}/git/blobs`, {
                                method: 'POST',
                                headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ content: entry.content || '', encoding: 'utf-8' })
                            });
                        } catch (error) {
                            throw annotateStage(error, 'create-blob', { path: entry.path });
                        }
                        const blobSha = blobJson && blobJson.sha ? String(blobJson.sha) : '';
                        if (!blobSha) throw annotateStage(new Error('创建 Blob 失败'), 'create-blob', { path: entry.path });
                        blobShaByPath[entry.path] = blobSha;
                        fileShas[entry.path] = blobSha;
                    }
                });
                await Promise.all(workers);
                blobShasPrepared = true;
            };

            const buildTreeEntries = (mode = 'inline') => normalizedChanges.map((entry) => {
                if (entry.delete) return { path: entry.path, mode: '100644', type: 'blob', sha: null };
                if (mode === 'inline') return { path: entry.path, mode: '100644', type: 'blob', content: entry.content || '' };
                const blobSha = String(blobShaByPath[entry.path] || '');
                if (!blobSha) throw annotateStage(new Error('创建 Blob 失败'), 'create-blob', { path: entry.path });
                return { path: entry.path, mode: '100644', type: 'blob', sha: blobSha };
            });

            const fillFileShasFromTree = (treeJson) => {
                const shaByPath = {};
                (Array.isArray(treeJson && treeJson.tree) ? treeJson.tree : []).forEach((entry) => {
                    const path = String(entry && entry.path || '').trim();
                    const sha = String(entry && entry.sha || '').trim();
                    if (path && sha && String(entry && entry.type || '') === 'blob') shaByPath[path] = sha;
                });
                uploadEntries.forEach((entry) => {
                    const sha = String(shaByPath[entry.path] || '').trim();
                    if (sha) fileShas[entry.path] = sha;
                });
            };

            const readCommitTreeSha = async (headSha) => {
                try {
                    const commitJson = await githubRequestJson(`${commitsUrl}/${encodeURIComponent(headSha)}`, {
                        headers: { Authorization: authHeader }
                    });
                    return commitJson && commitJson.tree && commitJson.tree.sha ? String(commitJson.tree.sha) : '';
                } catch (error) {
                    throw annotateStage(error, 'read-head-commit');
                }
            };

            const createTree = async (baseTreeSha = '', treeEntriesInput = []) => {
                const entries = Array.isArray(treeEntriesInput) ? treeEntriesInput : [];
                const payload = {
                    tree: baseTreeSha ? entries : entries.filter((entry) => entry && (entry.sha || typeof entry.content === 'string'))
                };
                if (baseTreeSha) payload.base_tree = baseTreeSha;
                if (!payload.tree.length) {
                    const error = new Error('目标分支不存在，且当前变更无法创建初始提交');
                    error.status = 404;
                    throw annotateStage(error, 'create-ref');
                }
                try {
                    return await githubRequestJson(treesUrl, {
                        method: 'POST',
                        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                } catch (error) {
                    throw annotateStage(error, 'create-tree');
                }
            };

            const createCommit = async (treeSha, parentSha = '') => {
                try {
                    return await githubRequestJson(commitsUrl, {
                        method: 'POST',
                        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: safeMessage, tree: treeSha, parents: parentSha ? [parentSha] : [] })
                    });
                } catch (error) {
                    throw annotateStage(error, 'create-commit');
                }
            };

            const createBranchRef = async (branchName, commitSha) => {
                try {
                    return await githubRequestJson(refsUrl, {
                        method: 'POST',
                        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commitSha })
                    });
                } catch (error) {
                    throw annotateStage(error, 'create-ref', { branch: branchName });
                }
            };

            const updateBranchRef = async (commitSha) => {
                try {
                    await githubRequestJson(refUpdateUrl, {
                        method: 'PATCH',
                        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sha: commitSha, force: false })
                    });
                } catch (error) {
                    throw annotateStage(error, 'update-ref');
                }
            };

            const tryReadBranchHeadFromBranchApi = async () => {
                try {
                    const branchJson = await githubRequestJson(branchInfoUrl, { headers: { Authorization: authHeader } });
                    const commitInfo = branchJson && typeof branchJson.commit === 'object' ? branchJson.commit : null;
                    const headSha = commitInfo && commitInfo.sha ? String(commitInfo.sha) : '';
                    if (!headSha) return null;
                    const nestedTreeSha = commitInfo && commitInfo.commit && commitInfo.commit.tree && commitInfo.commit.tree.sha
                        ? String(commitInfo.commit.tree.sha)
                        : '';
                    const baseTreeSha = nestedTreeSha || await readCommitTreeSha(headSha);
                    return baseTreeSha ? { headSha, baseTreeSha, initialCommit: false, branchCreated: false } : null;
                } catch (error) {
                    if (Number(error && error.status) === 404) return null;
                    throw annotateStage(error, 'read-ref');
                }
            };

            const ensureBranchHead = async (initialTreeEntries = []) => {
                const branchApiHeadInfo = await tryReadBranchHeadFromBranchApi();
                if (branchApiHeadInfo) return branchApiHeadInfo;

                let refJson = null;
                try {
                    refJson = await githubRequestJson(refReadUrl, { headers: { Authorization: authHeader } });
                } catch (error) {
                    if (Number(error && error.status) !== 404) throw annotateStage(error, 'read-ref');
                    let defaultBranch = '';
                    try {
                        const repoInfo = await githubRequestJson(repoApiBase, { headers: { Authorization: authHeader } });
                        defaultBranch = repoInfo && typeof repoInfo.default_branch === 'string' ? repoInfo.default_branch.trim() : '';
                    } catch (repoError) {
                        throw annotateStage(repoError, 'resolve-branch');
                    }

                    if (defaultBranch && defaultBranch !== resolvedBranch) {
                        try {
                            const defaultRefJson = await githubRequestJson(
                                `${repoApiBase}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
                                { headers: { Authorization: authHeader } }
                            );
                            const defaultHeadSha = defaultRefJson && defaultRefJson.object && defaultRefJson.object.sha
                                ? String(defaultRefJson.object.sha)
                                : '';
                            if (defaultHeadSha) {
                                try {
                                    await createBranchRef(resolvedBranch, defaultHeadSha);
                                } catch (createError) {
                                    if (!isGitHubReferenceAlreadyExistsError(createError)) throw createError;
                                }
                                refJson = await githubRequestJson(refReadUrl, { headers: { Authorization: authHeader } });
                            }
                        } catch (defaultRefError) {
                            if (Number(defaultRefError && defaultRefError.status) !== 404) {
                                throw annotateStage(defaultRefError, 'create-ref', { branch: resolvedBranch, fromBranch: defaultBranch });
                            }
                        }
                    }

                    if (!refJson) {
                        const initialTreeJson = await createTree('', initialTreeEntries);
                        fillFileShasFromTree(initialTreeJson);
                        const initialTreeSha = initialTreeJson && initialTreeJson.sha ? String(initialTreeJson.sha) : '';
                        if (!initialTreeSha) return { headSha: '', baseTreeSha: '', initialCommit: false, branchCreated: false };
                        const initialCommitJson = await createCommit(initialTreeSha, '');
                        const initialCommitSha = initialCommitJson && initialCommitJson.sha ? String(initialCommitJson.sha) : '';
                        if (!initialCommitSha) return { headSha: '', baseTreeSha: '', initialCommit: false, branchCreated: false };
                        try {
                            await createBranchRef(resolvedBranch, initialCommitSha);
                        } catch (createError) {
                            if (!isGitHubReferenceAlreadyExistsError(createError)) throw createError;
                        }
                        return {
                            headSha: '',
                            baseTreeSha: '',
                            initialCommit: true,
                            branchCreated: true,
                            treeSha: initialTreeSha,
                            commitSha: initialCommitSha
                        };
                    }
                }

                const headSha = refJson && refJson.object && refJson.object.sha ? String(refJson.object.sha) : '';
                if (!headSha) return { headSha: '', baseTreeSha: '', initialCommit: false, branchCreated: false };
                const baseTreeSha = await readCommitTreeSha(headSha);
                return { headSha, baseTreeSha, initialCommit: false, branchCreated: false };
            };

            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const maxAttempts = 6;
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                if (attempt > 0) {
                    const backoffMs = Math.min(250 * Math.pow(2, attempt - 1), 2000);
                    await sleep(backoffMs + Math.floor(Math.random() * 200));
                }

                let treeMode = preferInlineTreeContent ? 'inline' : 'blob-sha';
                if (treeMode === 'blob-sha') await ensureBlobShas();
                const treeEntries = buildTreeEntries(treeMode);

                let headInfo = null;
                try {
                    headInfo = await ensureBranchHead(treeEntries);
                } catch (error) {
                    if (treeMode === 'inline' && shouldFallbackInlineTreeContent(error)) {
                        preferInlineTreeContent = false;
                        attempt -= 1;
                        continue;
                    }
                    throw error;
                }

                if (headInfo && headInfo.initialCommit) {
                    return {
                        success: true,
                        branch: resolvedBranch,
                        baseSha: '',
                        treeSha: headInfo.treeSha || null,
                        commitSha: headInfo.commitSha || null,
                        updated: updatedCount,
                        deleted: deletedCount,
                        fileShas,
                        branchCreated: true,
                        initialCommit: true
                    };
                }

                const headSha = headInfo && headInfo.headSha ? String(headInfo.headSha) : '';
                const baseTreeSha = headInfo && headInfo.baseTreeSha ? String(headInfo.baseTreeSha) : '';
                if (!headSha) return { success: false, error: '读取分支 HEAD 失败' };
                if (!baseTreeSha) return { success: false, error: '读取分支 Tree 失败' };

                let treeJson = null;
                try {
                    treeJson = await createTree(baseTreeSha, treeEntries);
                } catch (error) {
                    if (treeMode === 'inline' && shouldFallbackInlineTreeContent(error)) {
                        preferInlineTreeContent = false;
                        attempt -= 1;
                        continue;
                    }
                    throw error;
                }

                fillFileShasFromTree(treeJson);
                const newTreeSha = treeJson && treeJson.sha ? String(treeJson.sha) : '';
                if (!newTreeSha) return { success: false, error: '创建 Tree 失败' };
                if (newTreeSha === baseTreeSha) {
                    return {
                        success: true,
                        branch: resolvedBranch,
                        baseSha: headSha,
                        treeSha: newTreeSha,
                        commitSha: headSha,
                        updated: 0,
                        deleted: 0,
                        fileShas,
                        noChanges: true
                    };
                }

                const newCommitJson = await createCommit(newTreeSha, headSha);
                const commitSha = newCommitJson && newCommitJson.sha ? String(newCommitJson.sha) : '';
                if (!commitSha) return { success: false, error: '创建 Commit 失败' };

                try {
                    await updateBranchRef(commitSha);
                } catch (error) {
                    if (attempt < maxAttempts - 1 && shouldRetryGitHubRefUpdate(error)) continue;
                    throw error;
                }

                return {
                    success: true,
                    branch: resolvedBranch,
                    baseSha: headSha,
                    treeSha: newTreeSha,
                    commitSha,
                    updated: updatedCount,
                    deleted: deletedCount,
                    fileShas
                };
            }
            return { success: false, error: '更新分支引用失败' };
        } catch (error) {
            return { success: false, error: normalizeGitHubError(error) };
        }
    }

    global.BookmarkCanvasGithubRepoApi = {
        GITHUB_API_BASE_URL,
        GITHUB_API_VERSION,
        normalizeGitHubToken,
        buildGitHubAuthHeader,
        normalizeGitHubError,
        encodeGitHubPath,
        textToBase64,
        base64ToUint8Array,
        githubRequestRaw,
        githubRequestJson,
        githubRequestText,
        testRepoConnection,
        listRepoFiles,
        getRepoFileRaw,
        getRepoFile,
        applyRepoFilesBatch
    };
})(window);
