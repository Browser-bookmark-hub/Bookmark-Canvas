const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_CONTENTS_JSON_MAX_BYTES = 1024 * 1024;
const GITHUB_CONTENTS_HARD_LIMIT_BYTES = 100 * 1024 * 1024;
const GITHUB_BLOB_CREATE_CONCURRENCY = 4;
const GITHUB_REQUEST_TIMEOUT_MS = 60 * 1000;

function normalizeGitHubToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return '';
  return raw.replace(/^(?:Bearer|token)\s+/i, '').trim();
}

function buildGitHubAuthHeader(token) {
  const normalizedToken = normalizeGitHubToken(token);
  if (!normalizedToken) return null;
  return `Bearer ${normalizedToken}`;
}

const GITHUB_ERROR_STAGE_LABELS_ZH = {
  'resolve-branch': '解析分支',
  'read-ref': '读取分支引用',
  'read-head-commit': '读取 HEAD Commit',
  'create-blob': '创建 Blob',
  'create-tree': '创建 Tree',
  'create-commit': '创建 Commit',
  'create-ref': '创建分支引用',
  'update-ref': '更新分支引用',
  'merge-branches': '合并分支',
  'delete-ref': '删除分支引用'
};

function formatGitHubErrorStage(stage) {
  const key = String(stage || '').trim();
  if (!key) return '';
  return GITHUB_ERROR_STAGE_LABELS_ZH[key] || key;
}

function extractGitHubErrorMessagesFromResponse(response) {
  const parts = [];
  if (!response) return parts;

  if (typeof response === 'string') {
    const text = response.trim();
    if (!text) return parts;
    try {
      const parsed = JSON.parse(text);
      return extractGitHubErrorMessagesFromResponse(parsed);
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
    const prefix = prefixParts.length ? `${prefixParts.join('.')}: ` : '';
    const body = msg || code;
    const text = `${prefix}${body}`.trim();
    if (text) parts.push(text);
  });

  const seen = new Set();
  return parts.filter((text) => {
    const normalized = String(text || '').trim();
    if (!normalized) return false;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function buildGitHubValidationFailureDetails(error) {
  const message = String((error && error.message) || '').trim();
  const responseParts = extractGitHubErrorMessagesFromResponse(error && error.response);
  const details = [];
  if (message) details.push(message);
  responseParts.forEach((part) => {
    if (!part) return;
    if (part === message) return;
    details.push(part);
  });
  return details.length ? details.join(' | ') : (message || 'Validation Failed');
}

function toHeaderMap(headers) {
  const map = {};
  if (!headers || typeof headers.forEach !== 'function') return map;
  headers.forEach((value, key) => {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!normalizedKey) return;
    map[normalizedKey] = String(value || '').trim();
  });
  return map;
}

function parseGitHubRateLimitContext(error) {
  const headers = (error && error.headers && typeof error.headers === 'object')
    ? error.headers
    : {};
  const remainingRaw = headers['x-ratelimit-remaining'];
  const resetRaw = headers['x-ratelimit-reset'];
  const retryAfterRaw = headers['retry-after'];

  const remaining = Number(remainingRaw);
  const resetEpoch = Number(resetRaw);
  const retryAfter = Number(retryAfterRaw);

  const responseParts = extractGitHubErrorMessagesFromResponse(error && error.response);
  const responseText = responseParts.join(' | ');
  const messageText = String(
    responseText || (error && error.message) || ''
  ).toLowerCase();

  const secondaryLimited = /secondary rate limit|abuse detection/i.test(messageText);
  const primaryLimited = Number.isFinite(remaining) && remaining === 0;
  const hasRetryAfter = Number.isFinite(retryAfter) && retryAfter > 0;

  const resetAtMs = Number.isFinite(resetEpoch) && resetEpoch > 0 ? (resetEpoch * 1000) : 0;
  const waitSecondsByReset = resetAtMs > 0
    ? Math.max(0, Math.ceil((resetAtMs - Date.now()) / 1000))
    : 0;
  const waitSeconds = hasRetryAfter
    ? Math.max(1, Math.ceil(retryAfter))
    : waitSecondsByReset;

  return {
    isRateLimited: secondaryLimited || primaryLimited || hasRetryAfter,
    secondaryLimited,
    primaryLimited,
    remaining: Number.isFinite(remaining) ? remaining : null,
    waitSeconds
  };
}

function buildGitHub403AccessDetail(error) {
  const responseParts = extractGitHubErrorMessagesFromResponse(error && error.response);
  const detail = responseParts.find((text) => {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'forbidden') return false;
    if (normalized.includes('secondary rate limit')) return false;
    if (normalized.includes('abuse detection')) return false;
    return true;
  }) || '';

  if (!detail) return '';
  return detail.length > 160 ? `${detail.slice(0, 157)}...` : detail;
}

function normalizeGitHubError(error) {
  if (!error) return '未知错误';

  const stage = error && typeof error.stage === 'string' ? error.stage : '';
  const stageLabel = formatGitHubErrorStage(stage);
  const stagePrefix = stageLabel ? `${stageLabel}失败：` : '';

  if (String(error && error.code || '') === 'GITHUB_FETCH_TIMEOUT') {
    const timeoutMs = Number(error && error.timeoutMs);
    const timeoutHint = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? `（>${Math.round(timeoutMs / 1000)} 秒）`
      : '';
    return `${stagePrefix}GitHub 请求超时${timeoutHint}，请检查网络后重试`;
  }

  const status = Number(error.status);
  if (status === 401) return `${stagePrefix}GitHub Token 无效或无权限（401）`;
  if (status === 403) {
    const rateLimit = parseGitHubRateLimitContext(error);
    if (rateLimit.isRateLimited) {
      if (rateLimit.secondaryLimited) {
        if (rateLimit.waitSeconds > 0) {
          return `${stagePrefix}GitHub 次级速率限制（403），请约 ${rateLimit.waitSeconds} 秒后重试`;
        }
        return `${stagePrefix}GitHub 次级速率限制（403），请降低请求频率后重试`;
      }
      if (rateLimit.primaryLimited) {
        if (rateLimit.waitSeconds > 0) {
          return `${stagePrefix}GitHub 主速率限制（403），剩余配额=0，请约 ${rateLimit.waitSeconds} 秒后重试`;
        }
        return `${stagePrefix}GitHub 主速率限制（403），剩余配额=0`;
      }
      if (rateLimit.waitSeconds > 0) {
        return `${stagePrefix}GitHub 速率限制（403），请约 ${rateLimit.waitSeconds} 秒后重试`;
      }
      return `${stagePrefix}GitHub 速率限制（403）`;
    }

    const accessDetail = buildGitHub403AccessDetail(error);
    if (accessDetail) {
      return `${stagePrefix}GitHub 拒绝访问（403）：${accessDetail}`;
    }
    return `${stagePrefix}GitHub 拒绝访问（403）`;
  }
  if (status === 404) {
    if (stage === 'read-ref') return `${stagePrefix}分支不存在（404）`;
    if (stage === 'create-ref') return `${stagePrefix}默认分支不存在或仓库为空（404）`;
    return `${stagePrefix}仓库不存在或无权限（404）`;
  }
  if (status === 409) return `${stagePrefix}分支不存在或发生冲突（409）`;
  if (status === 413) return `${stagePrefix}文件过大（413）`;
  if (status === 422) {
    return `${stagePrefix}请求校验失败（422）：${buildGitHubValidationFailureDetails(error)}`;
  }

  const message = error.message || '未知错误';
  return stagePrefix ? `${stagePrefix}${message}` : message;
}

function encodeGitHubPath(path) {
  return String(path || '')
    .split('/')
    .filter((s) => s.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function textToBase64(content) {
  const text = String(content == null ? '' : content);
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function githubRequestRaw(url, { method = 'GET', headers = {}, body, timeoutMs = GITHUB_REQUEST_TIMEOUT_MS } = {}) {
  const normalizedMethod = String(method || 'GET').trim().toUpperCase();
  const requestHeaders = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    ...(normalizedMethod === 'GET'
      ? {
          'Cache-Control': 'no-cache, no-store, max-age=0',
          Pragma: 'no-cache'
        }
      : {}),
    ...headers
  };

  const doFetch = async (effectiveHeaders) => {
    const controller = (typeof AbortController === 'function')
      ? new AbortController()
      : null;
    const requestTimeoutMs = Math.max(1000, Number(timeoutMs) || GITHUB_REQUEST_TIMEOUT_MS);
    let timeoutId = null;
    if (controller) {
      timeoutId = setTimeout(() => {
        try {
          controller.abort();
        } catch (_) {
          // Ignore abort errors; fetch handles final rejection.
        }
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
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      json = null;
    }

    return { response, text, json, headers: toHeaderMap(response.headers) };
  };

  let result = await doFetch(requestHeaders);

  const authHeader = typeof requestHeaders.Authorization === 'string'
    ? requestHeaders.Authorization
    : '';
  const authToken = normalizeGitHubToken(authHeader);
  const shouldRetryWithTokenHeader =
    result.response.status === 401 &&
    /^Bearer\s+/i.test(authHeader) &&
    !!authToken;

  if (shouldRetryWithTokenHeader) {
    result = await doFetch({
      ...requestHeaders,
      Authorization: `token ${authToken}`
    });
  }

  return result;
}

async function githubRequestJson(url, { method = 'GET', headers = {}, body } = {}) {
  const result = await githubRequestRaw(url, { method, headers, body });

  if (!result.response.ok) {
    const error = new Error(
      (result.json && typeof result.json.message === 'string' && result.json.message) ||
        `${result.response.status} ${result.response.statusText}`.trim()
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
      (result.json && typeof result.json.message === 'string' && result.json.message) ||
        `${result.response.status} ${result.response.statusText}`.trim()
    );
    error.status = result.response.status;
    error.response = result.json || result.text;
    error.headers = result.headers || {};
    throw error;
  }

  return result.text || '';
}


export async function getRepoBranchHeadSignal({ token, owner, repo, branch, path = '' }) {
  const authHeader = buildGitHubAuthHeader(token);
  if (!authHeader) {
    return { success: false, error: 'GitHub Token 未配置', repoNotConfigured: true };
  }

  const trimmedOwner = String(owner || '').trim();
  const trimmedRepo = String(repo || '').trim();
  const trimmedPath = String(path || '').trim().replace(/^\/+|\/+$/g, '');
  if (!trimmedOwner || !trimmedRepo) {
    return { success: false, error: '仓库未配置', repoNotConfigured: true };
  }

  try {
    const resolvedBranch = await resolveGitHubBranchOrDefault({
      authHeader,
      owner: trimmedOwner,
      repo: trimmedRepo,
      branch
    });

    if (trimmedPath) {
      const commits = await githubRequestJson(
        `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/commits?sha=${encodeURIComponent(resolvedBranch)}&path=${encodeURIComponent(trimmedPath)}&per_page=1`,
        { headers: { Authorization: authHeader } }
      );

      const latestCommit = Array.isArray(commits) && commits.length > 0 ? commits[0] : null;
      const commitSha = latestCommit && latestCommit.sha ? String(latestCommit.sha) : '';
      const commitInfo = latestCommit && typeof latestCommit.commit === 'object' && latestCommit.commit
        ? latestCommit.commit
        : null;
      const commitMeta = (commitInfo && typeof commitInfo.committer === 'object' && commitInfo.committer)
        || (commitInfo && typeof commitInfo.author === 'object' && commitInfo.author)
        || null;
      const committedAtRaw = commitMeta && typeof commitMeta.date === 'string' ? Date.parse(commitMeta.date) : 0;

      return {
        success: true,
        branch: resolvedBranch,
        path: trimmedPath,
        revisionSha: commitSha,
        committedAt: Number.isFinite(committedAtRaw) ? committedAtRaw : 0
      };
    }

    const json = await githubRequestJson(
      `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/git/ref/heads/${encodeURIComponent(resolvedBranch)}`,
      { headers: { Authorization: authHeader } }
    );

    const objectInfo = json && typeof json.object === 'object' && json.object ? json.object : null;
    const commitSha = objectInfo && objectInfo.sha ? String(objectInfo.sha) : '';

    return {
      success: true,
      branch: resolvedBranch,
      path: trimmedPath,
      revisionSha: commitSha,
      committedAt: 0
    };
  } catch (error) {
    return { success: false, error: normalizeGitHubError(error) };
  }
}

export async function getRepoInfo({ token, owner, repo }) {
  const authHeader = buildGitHubAuthHeader(token);
  if (!authHeader) {
    return { success: false, error: 'GitHub Token 未配置' };
  }

  const trimmedOwner = String(owner || '').trim();
  const trimmedRepo = String(repo || '').trim();
  if (!trimmedOwner || !trimmedRepo) {
    return { success: false, error: '仓库未配置' };
  }

  try {
    const json = await githubRequestJson(
      `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}`,
      {
        headers: { Authorization: authHeader }
      }
    );

    const permissions = json && typeof json.permissions === 'object' && json.permissions ? json.permissions : null;

    return {
      success: true,
      repo: {
        id: json && json.id ? String(json.id) : null,
        fullName: json && json.full_name ? String(json.full_name) : `${trimmedOwner}/${trimmedRepo}`,
        defaultBranch: json && json.default_branch ? String(json.default_branch) : null,
        private: json && json.private === true,
        htmlUrl: json && json.html_url ? String(json.html_url) : null,
        permissions: permissions
          ? {
              pull: permissions.pull === true,
              push: permissions.push === true,
              admin: permissions.admin === true
            }
          : null
      }
    };
  } catch (error) {
    return { success: false, error: normalizeGitHubError(error) };
  }
}

export async function testRepoConnection({ token, owner, repo, branch, basePath }) {
  const authHeader = buildGitHubAuthHeader(token);
  if (!authHeader) {
    return { success: false, error: 'GitHub Token 未配置' };
  }

  const trimmedOwner = String(owner || '').trim();
  const trimmedRepo = String(repo || '').trim();
  if (!trimmedOwner || !trimmedRepo) {
    return { success: false, error: '仓库未配置' };
  }

  try {
    const repoInfo = await githubRequestJson(
      `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}`,
      {
        headers: { Authorization: authHeader }
      }
    );

    const defaultBranch =
      repoInfo && typeof repoInfo.default_branch === 'string' ? repoInfo.default_branch : null;
    const resolvedBranch = (branch || '').trim() || defaultBranch || null;

    let branchExists = null;
    let branchWillBeCreated = false;
    if (resolvedBranch) {
      try {
        await githubRequestJson(
          `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/git/ref/heads/${encodeURIComponent(resolvedBranch)}`,
          { headers: { Authorization: authHeader } }
        );
        branchExists = true;
      } catch (error) {
        if (Number(error?.status) === 404) {
          branchExists = false;
          branchWillBeCreated = true;
        } else {
          throw error;
        }
      }
    }

    let basePathExists = null;
    const trimmedBasePath = String(basePath || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (trimmedBasePath && resolvedBranch && branchExists !== false) {
      try {
        await githubRequestJson(
          `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/${encodeGitHubPath(trimmedBasePath)}?ref=${encodeURIComponent(resolvedBranch)}`,
          { headers: { Authorization: authHeader } }
        );
        basePathExists = true;
      } catch (error) {
        if (Number(error?.status) === 404) {
          basePathExists = false;
        } else {
          throw error;
        }
      }
    }

    const permissions =
      repoInfo && typeof repoInfo.permissions === 'object' && repoInfo.permissions ? repoInfo.permissions : null;

    return {
      success: true,
      repo: {
        id: repoInfo && repoInfo.id ? String(repoInfo.id) : null,
        fullName: repoInfo && repoInfo.full_name ? String(repoInfo.full_name) : `${trimmedOwner}/${trimmedRepo}`,
        defaultBranch,
        private: repoInfo && repoInfo.private === true,
        htmlUrl: repoInfo && repoInfo.html_url ? String(repoInfo.html_url) : null,
        permissions: permissions
          ? {
              pull: permissions.pull === true,
              push: permissions.push === true,
              admin: permissions.admin === true
            }
          : null
      },
      resolvedBranch,
      basePathExists,
      branchExists,
      branchWillBeCreated
    };
  } catch (error) {
    return { success: false, error: normalizeGitHubError(error) };
  }
}

export async function upsertRepoFile({ token, owner, repo, branch, path, message, contentBase64 }) {
  const authHeader = buildGitHubAuthHeader(token);
  if (!authHeader) {
    return { success: false, error: 'GitHub Token 未配置', repoNotConfigured: true };
  }

  const trimmedOwner = String(owner || '').trim();
  const trimmedRepo = String(repo || '').trim();
  if (!trimmedOwner || !trimmedRepo) {
    return { success: false, error: '仓库未配置', repoNotConfigured: true };
  }

  const trimmedPath = String(path || '').trim().replace(/^\/+/, '');
  if (!trimmedPath) {
    return { success: false, error: '缺少文件路径' };
  }

  const trimmedBranch = String(branch || '').trim();

  const safeMessage = String(message || '').trim() || `Bookmark Backup: ${trimmedPath}`;
  const safeContentBase64 = String(contentBase64 || '').trim();
  if (!safeContentBase64) {
    return { success: false, error: '缺少文件内容' };
  }

  const encodedPath = encodeGitHubPath(trimmedPath);
  const urlBase = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/${encodedPath}`;

  let existingSha = null;
  try {
    const existingUrl = trimmedBranch ? `${urlBase}?ref=${encodeURIComponent(trimmedBranch)}` : urlBase;
    const existing = await githubRequestJson(existingUrl, {
      headers: { Authorization: authHeader }
    });
    if (existing && typeof existing === 'object' && existing.sha && existing.type === 'file') {
      existingSha = String(existing.sha);
    }
  } catch (error) {
    if (Number(error?.status) !== 404) {
      return { success: false, error: normalizeGitHubError(error) };
    }
  }

  const payload = {
    message: safeMessage,
    content: safeContentBase64
  };
  if (trimmedBranch) {
    payload.branch = trimmedBranch;
  }
  if (existingSha) {
    payload.sha = existingSha;
  }

  try {
    const json = await githubRequestJson(urlBase, {
      method: 'PUT',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const content = json && typeof json.content === 'object' && json.content ? json.content : null;
    const commit = json && typeof json.commit === 'object' && json.commit ? json.commit : null;

    return {
      success: true,
      created: !existingSha,
      path: content && content.path ? String(content.path) : trimmedPath,
      htmlUrl: content && content.html_url ? String(content.html_url) : null,
      fileSha: content && content.sha ? String(content.sha) : null,
      commitSha: commit && commit.sha ? String(commit.sha) : null
    };
  } catch (error) {
    return { success: false, error: normalizeGitHubError(error) };
  }
}

export async function getRepoFile({ token, owner, repo, branch, path }) {
  const authHeader = buildGitHubAuthHeader(token);
  if (!authHeader) {
    return { success: false, error: 'GitHub Token 未配置', repoNotConfigured: true };
  }

  const trimmedOwner = String(owner || '').trim();
  const trimmedRepo = String(repo || '').trim();
  if (!trimmedOwner || !trimmedRepo) {
    return { success: false, error: '仓库未配置', repoNotConfigured: true };
  }

  const trimmedPath = String(path || '').trim().replace(/^\/+/, '');
  if (!trimmedPath) {
    return { success: false, error: '缺少文件路径' };
  }

  const trimmedBranch = String(branch || '').trim();
  const encodedPath = encodeGitHubPath(trimmedPath);
  const url = trimmedBranch
    ? `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/${encodedPath}?ref=${encodeURIComponent(trimmedBranch)}`
    : `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/${encodedPath}`;

  try {
    const json = await githubRequestJson(url, {
      headers: { Authorization: authHeader }
    });

    if (!json || typeof json !== 'object' || json.type !== 'file') {
      return { success: false, error: '目标路径不是文件' };
    }

    const inlineBase64 = typeof json.content === 'string'
      ? json.content.replace(/\s+/g, '')
      : '';
    const fileSize = Number.isFinite(Number(json.size)) ? Number(json.size) : 0;

    if (fileSize > GITHUB_CONTENTS_HARD_LIMIT_BYTES) {
      return {
        success: false,
        error: '云端文件超过 100MB 限制，请拆分同步文件',
        path: json.path ? String(json.path) : trimmedPath,
        size: fileSize
      };
    }

    let contentBase64 = inlineBase64;
    let encoding = json.encoding ? String(json.encoding) : 'base64';
    let fetchedVia = 'json';

    const shouldFallbackToRaw = !contentBase64 && fileSize > 0;
    if (shouldFallbackToRaw) {
      const blobSha = json.sha ? String(json.sha) : '';
      const repoApiBase = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}`;

      if (blobSha) {
        try {
          const blobJson = await githubRequestJson(`${repoApiBase}/git/blobs/${encodeURIComponent(blobSha)}`, {
            headers: { Authorization: authHeader }
          });
          const blobEncoding = blobJson && blobJson.encoding ? String(blobJson.encoding) : '';
          const blobContent = blobJson && typeof blobJson.content === 'string'
            ? blobJson.content.replace(/\s+/g, '')
            : '';

          if (blobContent && /^base64$/i.test(blobEncoding || 'base64')) {
            contentBase64 = blobContent;
            encoding = 'base64';
            fetchedVia = 'git-blob';
          }
        } catch (_) {
          // Fallback to raw media type below.
        }
      }

      if (!contentBase64) {
        const rawText = await githubRequestText(url, {
          headers: {
            Authorization: authHeader,
            Accept: 'application/vnd.github.raw'
          }
        });
        contentBase64 = textToBase64(rawText);
        encoding = 'base64';
        fetchedVia = 'raw';
      }
    }

    return {
      success: true,
      path: json.path ? String(json.path) : trimmedPath,
      sha: json.sha ? String(json.sha) : null,
      contentBase64,
      encoding,
      size: fileSize,
      fetchedVia,
      largeFileCompat: fileSize > GITHUB_CONTENTS_JSON_MAX_BYTES
    };
  } catch (error) {
    if (Number(error?.status) === 404) {
      return { success: false, notFound: true, error: '云端文件不存在' };
    }
    return { success: false, error: normalizeGitHubError(error) };
  }
}

export async function getRepoBlobBySha({ token, owner, repo, sha }) {
  const authHeader = buildGitHubAuthHeader(token);
  if (!authHeader) {
    return { success: false, error: 'GitHub Token 未配置', repoNotConfigured: true };
  }

  const trimmedOwner = String(owner || '').trim();
  const trimmedRepo = String(repo || '').trim();
  if (!trimmedOwner || !trimmedRepo) {
    return { success: false, error: '仓库未配置', repoNotConfigured: true };
  }

  const trimmedSha = String(sha || '').trim();
  if (!trimmedSha) {
    return { success: false, error: '缺少 Blob SHA' };
  }

  const blobUrl = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/git/blobs/${encodeURIComponent(trimmedSha)}`;
  try {
    const blobJson = await githubRequestJson(blobUrl, {
      headers: { Authorization: authHeader }
    });

    const blobEncoding = blobJson && blobJson.encoding ? String(blobJson.encoding) : '';
    const blobContent = blobJson && typeof blobJson.content === 'string'
      ? blobJson.content.replace(/\s+/g, '')
      : '';
    const blobSize = Number.isFinite(Number(blobJson && blobJson.size)) ? Number(blobJson.size) : 0;

    if (blobSize > GITHUB_CONTENTS_HARD_LIMIT_BYTES) {
      return {
        success: false,
        error: '云端文件超过 100MB 限制，请拆分同步文件',
        sha: trimmedSha,
        size: blobSize
      };
    }

    if (!blobContent || !/^base64$/i.test(blobEncoding || 'base64')) {
      return {
        success: false,
        error: '无法读取 Blob 内容',
        sha: trimmedSha
      };
    }

    return {
      success: true,
      sha: trimmedSha,
      contentBase64: blobContent,
      encoding: 'base64',
      size: blobSize
    };
  } catch (error) {
    if (Number(error?.status) === 404) {
      return { success: false, notFound: true, error: '云端 Blob 不存在' };
    }
    return { success: false, error: normalizeGitHubError(error) };
  }
}

export async function deleteRepoFile({ token, owner, repo, branch, path, message }) {
  const authHeader = buildGitHubAuthHeader(token);
  if (!authHeader) {
    return { success: false, error: 'GitHub Token 未配置', repoNotConfigured: true };
  }

  const trimmedOwner = String(owner || '').trim();
  const trimmedRepo = String(repo || '').trim();
  if (!trimmedOwner || !trimmedRepo) {
    return { success: false, error: '仓库未配置', repoNotConfigured: true };
  }

  const trimmedPath = String(path || '').trim().replace(/^\/+/, '');
  if (!trimmedPath) {
    return { success: false, error: '缺少文件路径' };
  }

  const trimmedBranch = String(branch || '').trim();
  const encodedPath = encodeGitHubPath(trimmedPath);
  const urlBase = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/${encodedPath}`;

  let existingSha = '';
  try {
    const existingUrl = trimmedBranch ? `${urlBase}?ref=${encodeURIComponent(trimmedBranch)}` : urlBase;
    const existing = await githubRequestJson(existingUrl, {
      headers: { Authorization: authHeader }
    });

    if (!existing || typeof existing !== 'object' || existing.type !== 'file' || !existing.sha) {
      return { success: false, error: '目标路径不是文件' };
    }

    existingSha = String(existing.sha);
  } catch (error) {
    if (Number(error?.status) === 404) {
      return { success: true, notFound: true, path: trimmedPath };
    }
    return { success: false, error: normalizeGitHubError(error) };
  }

  const safeMessage = String(message || '').trim() || `Bookmark Backup: delete ${trimmedPath}`;
  const payload = {
    message: safeMessage,
    sha: existingSha
  };
  if (trimmedBranch) {
    payload.branch = trimmedBranch;
  }

  try {
    const json = await githubRequestJson(urlBase, {
      method: 'DELETE',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const commit = json && typeof json.commit === 'object' && json.commit ? json.commit : null;
    return {
      success: true,
      deleted: true,
      path: trimmedPath,
      commitSha: commit && commit.sha ? String(commit.sha) : null
    };
  } catch (error) {
    return { success: false, error: normalizeGitHubError(error) };
  }
}

async function listRepoFilesRecursivelyByContents({ authHeader, owner, repo, ref, rootPath }) {
  const trimmedOwner = String(owner || '').trim();
  const trimmedRepo = String(repo || '').trim();
  const normalizedRootPath = String(rootPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/');

  if (!normalizedRootPath) {
    return { success: true, rootPath: '', files: [] };
  }

  const safeRef = String(ref || '').trim();
  const urlPrefix = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/contents/`;

  const buildUrl = (path) => {
    const encodedPath = encodeGitHubPath(path);
    const base = `${urlPrefix}${encodedPath}`;
    return safeRef ? `${base}?ref=${encodeURIComponent(safeRef)}` : base;
  };

  const files = [];
  const pendingDirs = [normalizedRootPath];
  const visitedDirs = new Set();
  const maxConcurrent = 6;

  const processDir = async (dirPath) => {
    const normalizedDirPath = String(dirPath || '').trim();
    if (!normalizedDirPath) return;

    const url = buildUrl(normalizedDirPath);
    let json = null;
    try {
      json = await githubRequestJson(url, {
        headers: { Authorization: authHeader }
      });
    } catch (error) {
      if (Number(error?.status) === 404) {
        // Treat missing folders as empty instead of hard-failing the sync.
        return;
      }
      throw error;
    }

    if (!json) return;

    if (Array.isArray(json)) {
      json.forEach((entry) => {
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
          return;
        }

        if (type === 'dir') {
          if (!visitedDirs.has(pathText)) {
            pendingDirs.push(pathText);
          }
        }
      });
      return;
    }

    if (typeof json === 'object') {
      const type = String(json.type || '').trim();
      const pathText = String(json.path || '').trim();
      if (!pathText) return;

      if (type === 'file') {
        files.push({
          path: pathText,
          sha: json.sha ? String(json.sha) : '',
          size: Number.isFinite(Number(json.size)) ? Number(json.size) : 0
        });
        return;
      }

      if (type === 'dir') {
        if (!visitedDirs.has(pathText)) {
          pendingDirs.push(pathText);
        }
      }
    }
  };

  while (pendingDirs.length) {
    const batch = [];
    while (batch.length < maxConcurrent && pendingDirs.length) {
      const dirPath = String(pendingDirs.shift() || '').trim();
      if (!dirPath || visitedDirs.has(dirPath)) continue;
      visitedDirs.add(dirPath);
      batch.push(processDir(dirPath));
    }
    if (batch.length) {
      await Promise.all(batch);
    }
  }

  return {
    success: true,
    rootPath: normalizedRootPath,
    files
  };
}

export async function listRepoFiles({ token, owner, repo, branch, rootPath }) {
  const authHeader = buildGitHubAuthHeader(token);
  if (!authHeader) {
    return { success: false, error: 'GitHub Token 未配置', repoNotConfigured: true };
  }

  const trimmedOwner = String(owner || '').trim();
  const trimmedRepo = String(repo || '').trim();
  if (!trimmedOwner || !trimmedRepo) {
    return { success: false, error: '仓库未配置', repoNotConfigured: true };
  }

  const rawBranch = String(branch || '').trim();
  const trimmedBranch = rawBranch || 'HEAD';
  const contentsRef = /^HEAD$/i.test(rawBranch) ? '' : rawBranch;
  const normalizedRootPath = String(rootPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/');

  if (normalizedRootPath) {
    try {
      const result = await listRepoFilesRecursivelyByContents({
        authHeader,
        owner: trimmedOwner,
        repo: trimmedRepo,
        ref: contentsRef,
        rootPath: normalizedRootPath
      });

      if (!result || result.success !== true) {
        return { success: false, error: '列出同步文件失败' };
      }

      return {
        success: true,
        rootPath: normalizedRootPath,
        files: Array.isArray(result.files) ? result.files : [],
        truncated: false
      };
    } catch (error) {
      return { success: false, error: normalizeGitHubError(error) };
    }
  }

  const treeUrl = `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(trimmedOwner)}/${encodeURIComponent(trimmedRepo)}/git/trees/${encodeURIComponent(trimmedBranch)}?recursive=1`;

  try {
    const json = await githubRequestJson(treeUrl, {
      headers: { Authorization: authHeader }
    });

    const treeItems = Array.isArray(json && json.tree) ? json.tree : [];
    const rootPrefix = normalizedRootPath ? `${normalizedRootPath}/` : '';
    const files = [];

    treeItems.forEach((entry) => {
      if (!entry || entry.type !== 'blob') return;
      const pathText = String(entry.path || '').trim();
      if (!pathText) return;

      if (normalizedRootPath) {
        if (pathText !== normalizedRootPath && !pathText.startsWith(rootPrefix)) {
          return;
        }
      }

      files.push({
        path: pathText,
        sha: entry.sha ? String(entry.sha) : '',
        size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : 0
      });
    });

    return {
      success: true,
      rootPath: normalizedRootPath,
      files,
      truncated: json && json.truncated === true
    };
  } catch (error) {
    return { success: false, error: normalizeGitHubError(error) };
  }
}

async function resolveGitHubBranchOrDefault({ authHeader, owner, repo, branch }) {
  const trimmedBranch = String(branch || '').trim();
  if (trimmedBranch) return trimmedBranch;

  const repoInfo = await githubRequestJson(
    `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    { headers: { Authorization: authHeader } }
  );

  const defaultBranch = repoInfo && typeof repoInfo.default_branch === 'string'
    ? repoInfo.default_branch.trim()
    : '';

  if (!defaultBranch) {
    throw new Error('分支未配置');
  }

  return defaultBranch;
}


function isGitHubReferenceAlreadyExistsError(error) {
  const status = Number(error && error.status);
  if (status !== 422) return false;

  const message = String((error && error.message) || '').toLowerCase();
  const responseParts = extractGitHubErrorMessagesFromResponse(error && error.response);
  const combined = `${message} ${responseParts.join(' ')}`.toLowerCase();
  return combined.includes('reference already exists');
}

function shouldRetryGitHubRefUpdate(error) {
  const status = Number(error && error.status);
  if (status !== 422 && status !== 409) return false;

  const message = String((error && error.message) || '').toLowerCase();
  const responseParts = extractGitHubErrorMessagesFromResponse(error && error.response);
  const combined = `${message} ${responseParts.join(' ')}`.toLowerCase();

  if (!combined) return false;
  if (combined.includes('protected branch')) return false;
  if (combined.includes('branch is protected')) return false;
  if (combined.includes('required status checks')) return false;
  if (combined.includes('pull request')) return false;

  return combined.includes('fast forward') ||
    combined.includes('reference update failed') ||
    combined.includes('cannot lock ref');
}

function isGitHubProtectedBranchMergeError(error) {
  const status = Number(error && error.status);
  if (status !== 403 && status !== 405 && status !== 422) return false;

  const message = String((error && error.message) || '').toLowerCase();
  const responseParts = extractGitHubErrorMessagesFromResponse(error && error.response);
  const combined = `${message} ${responseParts.join(' ')}`.toLowerCase();

  if (status === 405) return true;
  if (!combined) return false;
  if (combined.includes('protected branch')) return true;
  if (combined.includes('branch is protected')) return true;
  if (combined.includes('required status checks')) return true;
  if (combined.includes('pull request')) return true;
  return false;
}

function shouldFallbackInlineTreeContent(error) {
  const status = Number(error && error.status);
  if (status === 413) return true;
  if (status !== 422) return false;

  const message = String((error && error.message) || '').toLowerCase();
  const responseParts = extractGitHubErrorMessagesFromResponse(error && error.response);
  const combined = `${message} ${responseParts.join(' ')}`.toLowerCase();

  if (!combined) return false;
  return combined.includes('too large')
    || combined.includes('too_large')
    || combined.includes('maximum')
    || combined.includes('exceed')
    || combined.includes('content is too long')
    || combined.includes('payload');
}

function normalizeTempBranchPrefix(prefixRaw) {
  const raw = String(prefixRaw || '').trim().replace(/^\/+|\/+$/g, '');
  const normalized = raw
    .split('/')
    .map((segment) => String(segment || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('/');
  return normalized || 'canvas-sync';
}

function buildTempBranchName(prefixRaw) {
  const prefix = normalizeTempBranchPrefix(prefixRaw);
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${prefix}/${stamp}-${nonce}`;
}

export async function applyRepoFilesBatch({ token, owner, repo, branch, message, changes }) {
  const authHeader = buildGitHubAuthHeader(token);
  if (!authHeader) {
    return { success: false, error: 'GitHub Token 未配置', repoNotConfigured: true };
  }

  const trimmedOwner = String(owner || '').trim();
  const trimmedRepo = String(repo || '').trim();
  if (!trimmedOwner || !trimmedRepo) {
    return { success: false, error: '仓库未配置', repoNotConfigured: true };
  }

  const rawChanges = Array.isArray(changes) ? changes : [];
  if (!rawChanges.length) {
    return { success: false, error: '缺少变更列表' };
  }

  const changeByPath = new Map();
  rawChanges.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const rawPath = String(entry.path || '').trim().replace(/^\/+/, '');
    if (!rawPath) return;
    const isDelete = entry.delete === true || entry.deleted === true;
    changeByPath.set(rawPath, {
      path: rawPath,
      delete: isDelete,
      content: isDelete ? null : String(entry.content == null ? '' : entry.content)
    });
  });

  const normalizedChanges = Array.from(changeByPath.values());
  if (!normalizedChanges.length) {
    return { success: false, error: '缺少有效文件路径' };
  }

  const safeMessage = String(message || '').trim() || `Bookmark Canvas Sync: batch apply (${normalizedChanges.length})`;

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
      resolvedBranch = await resolveGitHubBranchOrDefault({
        authHeader,
        owner: trimmedOwner,
        repo: trimmedRepo,
        branch
      });
    } catch (error) {
      throw annotateStage(error, 'resolve-branch');
    }

    if (!resolvedBranch) {
      return { success: false, error: '分支未配置' };
    }

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
            blobJson = await githubRequestJson(
              `${repoApiBase}/git/blobs`,
              {
                method: 'POST',
                headers: {
                  Authorization: authHeader,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  content: entry.content || '',
                  encoding: 'utf-8'
                })
              }
            );
          } catch (error) {
            throw annotateStage(error, 'create-blob', { path: entry.path });
          }

          const blobSha = blobJson && blobJson.sha ? String(blobJson.sha) : '';
          if (!blobSha) {
            const failed = new Error('创建 Blob 失败');
            failed.path = entry.path;
            failed.stage = 'create-blob';
            throw failed;
          }

          blobShaByPath[entry.path] = blobSha;
          fileShas[entry.path] = blobSha;
        }
      });

      await Promise.all(workers);
      blobShasPrepared = true;
    };

    const buildTreeEntries = (mode = 'inline') => normalizedChanges.map((entry) => {
      if (entry.delete) {
        return {
          path: entry.path,
          mode: '100644',
          type: 'blob',
          sha: null
        };
      }

      if (mode === 'inline') {
        return {
          path: entry.path,
          mode: '100644',
          type: 'blob',
          content: entry.content || ''
        };
      }

      const blobSha = String(blobShaByPath[entry.path] || '');
      if (!blobSha) {
        throw annotateStage(new Error('创建 Blob 失败'), 'create-blob', { path: entry.path });
      }
      return {
        path: entry.path,
        mode: '100644',
        type: 'blob',
        sha: blobSha
      };
    });

    const fillFileShasFromTree = (treeJson) => {
      const treeEntries = Array.isArray(treeJson && treeJson.tree) ? treeJson.tree : [];
      if (!treeEntries.length || !uploadEntries.length) return;

      const shaByPath = {};
      treeEntries.forEach((entry) => {
        const path = String(entry && entry.path || '').trim();
        const sha = String(entry && entry.sha || '').trim();
        if (!path || !sha) return;
        if (String(entry && entry.type || '') !== 'blob') return;
        shaByPath[path] = sha;
      });

      uploadEntries.forEach((entry) => {
        const sha = String(shaByPath[entry.path] || '').trim();
        if (!sha) return;
        fileShas[entry.path] = sha;
      });
    };

    const readCommitTreeSha = async (headSha) => {
      let commitJson = null;
      try {
        commitJson = await githubRequestJson(
          `${commitsUrl}/${encodeURIComponent(headSha)}`,
          { headers: { Authorization: authHeader } }
        );
      } catch (error) {
        throw annotateStage(error, 'read-head-commit');
      }

      return commitJson && commitJson.tree && commitJson.tree.sha ? String(commitJson.tree.sha) : '';
    };

    const createTree = async (baseTreeSha = '', treeEntriesInput = []) => {
      const entries = Array.isArray(treeEntriesInput) ? treeEntriesInput : [];
      const payload = {
        tree: baseTreeSha
          ? entries
          : entries.filter((entry) => entry && (entry.sha || typeof entry.content === 'string'))
      };
      if (baseTreeSha) {
        payload.base_tree = baseTreeSha;
      }

      if (!payload.tree.length) {
        const error = new Error('目标分支不存在，且当前变更无法创建初始提交');
        error.status = 404;
        throw annotateStage(error, 'create-ref');
      }

      try {
        return await githubRequestJson(
          treesUrl,
          {
            method: 'POST',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          }
        );
      } catch (error) {
        throw annotateStage(error, 'create-tree');
      }
    };

    const createCommit = async (treeSha, parentSha = '') => {
      const payload = {
        message: safeMessage,
        tree: treeSha,
        parents: parentSha ? [parentSha] : []
      };
      try {
        return await githubRequestJson(
          commitsUrl,
          {
            method: 'POST',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          }
        );
      } catch (error) {
        throw annotateStage(error, 'create-commit');
      }
    };

    const createBranchRef = async (branchName, commitSha) => {
      try {
        return await githubRequestJson(
          refsUrl,
          {
            method: 'POST',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              ref: `refs/heads/${branchName}`,
              sha: commitSha
            })
          }
        );
      } catch (error) {
        throw annotateStage(error, 'create-ref', { branch: branchName });
      }
    };

    const updateBranchRef = async (commitSha) => {
      try {
        await githubRequestJson(
          refUpdateUrl,
          {
            method: 'PATCH',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              sha: commitSha,
              force: false
            })
          }
        );
      } catch (error) {
        throw annotateStage(error, 'update-ref');
      }
    };

    const tryReadBranchHeadFromBranchApi = async () => {
      try {
        const branchJson = await githubRequestJson(branchInfoUrl, {
          headers: { Authorization: authHeader }
        });

        const commitInfo = branchJson && typeof branchJson.commit === 'object'
          ? branchJson.commit
          : null;
        const headSha = commitInfo && commitInfo.sha ? String(commitInfo.sha) : '';
        if (!headSha) return null;

        const nestedTreeSha = commitInfo
          && commitInfo.commit
          && commitInfo.commit.tree
          && commitInfo.commit.tree.sha
          ? String(commitInfo.commit.tree.sha)
          : '';
        const baseTreeSha = nestedTreeSha || await readCommitTreeSha(headSha);
        if (!baseTreeSha) return null;

        return {
          headSha,
          baseTreeSha,
          initialCommit: false,
          branchCreated: false
        };
      } catch (error) {
        if (Number(error && error.status) === 404) return null;
        throw annotateStage(error, 'read-ref');
      }
    };

    const ensureBranchHead = async (initialTreeEntries = []) => {
      const branchApiHeadInfo = await tryReadBranchHeadFromBranchApi();
      if (branchApiHeadInfo) {
        return branchApiHeadInfo;
      }

      let refJson = null;
      try {
        refJson = await githubRequestJson(refReadUrl, {
          headers: { Authorization: authHeader }
        });
      } catch (error) {
        if (Number(error && error.status) !== 404) {
          throw annotateStage(error, 'read-ref');
        }

        let defaultBranch = '';
        try {
          const repoInfo = await githubRequestJson(
            repoApiBase,
            { headers: { Authorization: authHeader } }
          );
          defaultBranch = repoInfo && typeof repoInfo.default_branch === 'string'
            ? repoInfo.default_branch.trim()
            : '';
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
                if (!isGitHubReferenceAlreadyExistsError(createError)) {
                  throw createError;
                }
              }

              refJson = await githubRequestJson(refReadUrl, {
                headers: { Authorization: authHeader }
              });
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
          if (!initialTreeSha) {
            return { headSha: '', baseTreeSha: '', initialCommit: false, branchCreated: false };
          }

          const initialCommitJson = await createCommit(initialTreeSha, '');
          const initialCommitSha = initialCommitJson && initialCommitJson.sha ? String(initialCommitJson.sha) : '';
          if (!initialCommitSha) {
            return { headSha: '', baseTreeSha: '', initialCommit: false, branchCreated: false };
          }

          try {
            await createBranchRef(resolvedBranch, initialCommitSha);
          } catch (createError) {
            if (!isGitHubReferenceAlreadyExistsError(createError)) {
              throw createError;
            }
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
      if (!headSha) {
        return { headSha: '', baseTreeSha: '', initialCommit: false, branchCreated: false };
      }

      const baseTreeSha = await readCommitTreeSha(headSha);
      return {
        headSha,
        baseTreeSha,
        initialCommit: false,
        branchCreated: false
      };
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const maxAttempts = 6;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) {
        const baseDelayMs = 250;
        const maxDelayMs = 2000;
        const jitterMs = Math.floor(Math.random() * 200);
        const backoffMs = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
        await sleep(backoffMs + jitterMs);
      }

      let treeMode = preferInlineTreeContent ? 'inline' : 'blob-sha';
      let treeEntriesForAttempt = [];
      if (treeMode === 'blob-sha') {
        await ensureBlobShas();
      }
      treeEntriesForAttempt = buildTreeEntries(treeMode);

      let headInfo = null;
      try {
        headInfo = await ensureBranchHead(treeEntriesForAttempt);
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
      if (!headSha) {
        return { success: false, error: '读取分支 HEAD 失败' };
      }
      if (!baseTreeSha) {
        return { success: false, error: '读取分支 Tree 失败' };
      }

      let treeJson = null;
      try {
        treeJson = await createTree(baseTreeSha, treeEntriesForAttempt);
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
      if (!newTreeSha) {
        return { success: false, error: '创建 Tree 失败' };
      }

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
      if (!commitSha) {
        return { success: false, error: '创建 Commit 失败' };
      }

      try {
        await updateBranchRef(commitSha);
      } catch (error) {
        const isLastAttempt = attempt >= (maxAttempts - 1);
        if (!isLastAttempt && shouldRetryGitHubRefUpdate(error)) {
          continue;
        }
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
