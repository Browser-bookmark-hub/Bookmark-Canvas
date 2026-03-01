const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_CONTENTS_JSON_MAX_BYTES = 1024 * 1024;
const GITHUB_CONTENTS_HARD_LIMIT_BYTES = 100 * 1024 * 1024;

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

function normalizeGitHubError(error) {
  if (!error) return '未知错误';

  const status = Number(error.status);
  if (status === 401) return 'GitHub Token 无效或无权限（401）';
  if (status === 403) return 'GitHub 拒绝访问或触发速率限制（403）';
  if (status === 404) return '仓库不存在或无权限（404）';
  if (status === 409) return '分支不存在或发生冲突（409）';
  if (status === 413) return '文件过大（413）';
  if (status === 422) return '请求校验失败（422）';

  return error.message || '未知错误';
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

async function githubRequestRaw(url, { method = 'GET', headers = {}, body } = {}) {
  const requestHeaders = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    ...headers
  };

  const doFetch = async (effectiveHeaders) => {
    const response = await fetch(url, {
      method,
      headers: effectiveHeaders,
      body
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_) {
      json = null;
    }

    return { response, text, json };
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
    throw error;
  }

  return result.text || '';
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

    let basePathExists = null;
    const trimmedBasePath = String(basePath || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (trimmedBasePath && resolvedBranch) {
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
      basePathExists
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
      const rawText = await githubRequestText(url, {
        headers: {
          Authorization: authHeader,
          Accept: 'application/vnd.github.raw+json'
        }
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

  const trimmedBranch = String(branch || '').trim() || 'HEAD';
  const normalizedRootPath = String(rootPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/');

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
