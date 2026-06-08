/*
 * Obsidian-flavored Markdown helpers layered on top of marked.js
 * Enables callouts, wiki-style links, highlight syntax and safer link handling
 */
(function attachObsidianMarkdown(global) {
  const marked = global.marked;
  if (!marked) {
    console.error('[ObsidianMarkdown] marked.js not loaded');
    return;
  }

  const escapeHtml = (str = '') =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const allowedProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:', 'obsidian:']);

  const normalizeExternalHref = (href = '') => {
    const h = String(href || '').trim();
    if (!h) return '';
    if (h.startsWith('#')) return h;
    // Obsidian-style: treat "www.xxx" as an external link -> "http://www.xxx"
    if (/^www\./i.test(h)) return `http://${h}`;
    // Protocol-relative URL
    if (h.startsWith('//')) return `https:${h}`;
    return h;
  };

  const sanitizeHref = (href = '') => {
    const normalized = normalizeExternalHref(href);
    if (!normalized) return null;
    if (normalized.startsWith('#')) return normalized;
    try {
      const url = new URL(normalized, 'https://dummy.local');
      return allowedProtocols.has(url.protocol) ? normalized : null;
    } catch (_) {
      return null;
    }
  };

  const renderer = new marked.Renderer();
  const baseLink = renderer.link.bind(renderer);
  renderer.link = function safeLink(href, title, text) {
    const safeHref = sanitizeHref(href);
    if (!safeHref) return text;
    const html = baseLink(safeHref, title, text);
    return html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
  };

  const baseImage = renderer.image.bind(renderer);
  renderer.image = function safeImage(href, title, text) {
    if (href && String(href).startsWith('data:image/')) {
      return baseImage(href, title, text);
    }
    const safeHref = sanitizeHref(href);
    if (!safeHref) return text || '';
    return baseImage(safeHref, title, text);
  };

  const allowedTags = new Set([
    'font',
    'span',
    'u',
    'mark',
    'strong',
    'em',
    'b',
    'i',
    'del',
    's',
    'sub',
    'sup',
    'br',
    'center',
    'p',
    'img'
  ]);
  const allowedAttrs = new Set(['color', 'style', 'class', 'align', 'src', 'alt', 'width', 'height']);

  const sanitizeStyle = (style = '') => {
    const out = [];
    String(style || '').split(';').forEach((decl) => {
      const parts = decl.split(':');
      if (parts.length < 2) return;
      const prop = String(parts.shift() || '').trim().toLowerCase();
      const value = parts.join(':').trim();
      if (!prop || !value) return;
      if (!/^(color|background-color|text-align|font-weight|font-style|text-decoration)$/.test(prop)) return;
      if (/javascript:|expression\s*\(|url\s*\(/i.test(value)) return;
      out.push(`${prop}: ${value}`);
    });
    return out.join('; ');
  };

  const sanitizeColorValue = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/javascript:|expression\s*\(|url\s*\(/i.test(raw)) return '';
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
    if (/^(?:rgb|rgba|hsl|hsla)\(\s*[-+.\d%]+(?:\s*,\s*[-+.\d%]+){2,3}\s*\)$/i.test(raw)) return raw;
    if (/^[a-z]+$/i.test(raw)) return raw;
    return '';
  };

  // Render a small Obsidian-style HTML subset used by blank cards and section descriptions.
  renderer.html = function safeHtml(html) {
    const tagPattern = /<(\/?)([\w]+)([^>]*)>/g;
    return String(html || '').replace(tagPattern, (match, slash, tag, attrs) => {
      const tagLower = tag.toLowerCase();
      if (!allowedTags.has(tagLower)) return escapeHtml(match);

      if (attrs && !slash) {
        const safeAttrs = [];
        attrs.replace(/(\w+)\s*=\s*["']([^"']*)["']/g, (attrMatch, name, value) => {
          const attrName = String(name || '').toLowerCase();
          if (!allowedAttrs.has(attrName)) return '';
          let safeValue = String(value || '');
          if (attrName === 'style') {
            safeValue = sanitizeStyle(safeValue);
            if (!safeValue) return '';
          } else if (attrName === 'color') {
            safeValue = sanitizeColorValue(safeValue);
            if (!safeValue) return '';
          } else if (attrName === 'align') {
            safeValue = safeValue.trim().toLowerCase();
            if (!/^(left|center|right|justify)$/.test(safeValue)) return '';
          } else if (attrName === 'src') {
            safeValue = safeValue.trim();
            if (safeValue.startsWith('data:image/')) {
              // Allow data:image
            } else {
              try {
                const u = new URL(safeValue, 'https://dummy.local');
                const ok = u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'blob:' || u.protocol === 'chrome-extension:';
                if (!ok) return '';
              } catch (_) {
                return '';
              }
            }
          } else if (attrName === 'width' || attrName === 'height') {
            safeValue = safeValue.trim().toLowerCase();
            if (!/^\d+(?:px|%)?$/i.test(safeValue) && safeValue !== 'auto') return '';
          }
          safeAttrs.push(` ${attrName}="${safeValue.replace(/"/g, '&quot;')}"`);
          return '';
        });
        return `<${tagLower}${safeAttrs.join('')}>`;
      }

      return `<${slash}${tagLower}>`;
    });
  };

  const CALL_OUT_ICONS = {
    note: '📝',
    info: '💡',
    tip: '✨',
    success: '✅',
    question: '❓',
    warning: '⚠️',
    danger: '⛔',
    bug: '🐞',
    example: '📌',
    quote: '💬'
  };

  const renderCallout = (token, options) => {
    const type = (token.calloutType || 'note').toLowerCase();
    const title = token.calloutTitle ? escapeHtml(token.calloutTitle) : type.toUpperCase();
    const bodyTokens = Array.isArray(token.tokens) ? token.tokens : [];
    const body = marked.parser(bodyTokens, options || marked.defaults);
    const icon = CALL_OUT_ICONS[type] || CALL_OUT_ICONS.note;
    const collapsed = token.calloutState === 'collapsed';
    const expandedAttr = collapsed ? 'false' : 'true';
    return `
      <div class="md-callout md-callout-${type}${collapsed ? ' collapsed' : ''}" data-callout="${type}">
        <div class="md-callout-header">
          <button type="button" class="md-callout-toggle" aria-expanded="${expandedAttr}" aria-label="Toggle callout"></button>
          <span class="md-callout-icon" aria-hidden="true">${icon}</span>
          <span class="md-callout-title">${title}</span>
        </div>
        <div class="md-callout-body">${body}</div>
      </div>
    `;
  };

  marked.setOptions({
    gfm: true,
    breaks: true,
    mangle: false,
    smartLists: true,
    headerIds: false,
    renderer
  });

  const highlightExtension = {
    name: 'highlight',
    level: 'inline',
    start(src) {
      return src.indexOf('==');
    },
    tokenizer(src) {
      const match = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
      if (match) {
        return {
          type: 'highlight',
          raw: match[0],
          text: match[1]
        };
      }
    },
    renderer(token) {
      return `<mark>${marked.parseInline(token.text)}</mark>`;
    }
  };

  const wikiLinkExtension = {
    name: 'wikilink',
    level: 'inline',
    start(src) {
      return src.indexOf('[[');
    },
    tokenizer(src) {
      const match = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src);
      if (match) {
        return {
          type: 'wikilink',
          raw: match[0],
          target: match[1].trim(),
          alias: (match[2] || match[1]).trim()
        };
      }
    },
    renderer(token) {
      const target = escapeHtml(token.target || '');
      const label = escapeHtml(token.alias || token.target || '');
      return `<span class="md-wikilink" data-wikilink="${target}">${label}</span>`;
    }
  };

  const calloutExtension = {
    name: 'callout',
    level: 'block',
    start(src) {
      const match = src.match(/\s{0,3}>\s*\[!/);
      return match ? match.index : undefined;
    },
    tokenizer(src) {
      const cap = /^ {0,3}>\s*\[!([A-Za-z0-9_-]+)\](\+|\-)?\s*([^\n]*)\s*(?:\n|$)((?: {0,3}>\s?.*(?:\n|$))*)/.exec(src);
      if (!cap) return;
      const [, type, state, titleText, rest] = cap;
      const remaining = (rest || '').replace(/^ {0,3}>\s?/gm, '');
      return {
        type: 'callout',
        raw: cap[0],
        calloutType: type.toLowerCase(),
        calloutState: state === '-' ? 'collapsed' : 'expanded',
        calloutTitle: titleText || '',
        text: remaining,
        tokens: this.lexer.blockTokens(remaining || '')
      };
    },
    renderer(token) {
      return renderCallout(token, this.options);
    }
  };

  const invertedSetextExtension = {
    name: 'invertedSetext',
    level: 'block',
    start(src) {
      return src.match(/^(?![ \t\n]+)([^\n]+)\n\s*(-{3,}|={3,})\s*(?:\n+|$)/)?.index;
    },
    tokenizer(src) {
      const rule = /^(?![ \t\n]+)([^\n]+)\n\s*(-{3,}|={3,})\s*(?:\n+|$)/;
      const match = rule.exec(src);
      if (match) {
        const text = match[1];
        const marker = match[2];
        // Setext: '=' (3+) -> H1, '-' (3+) -> H2
        const depth = marker.startsWith('=') ? 1 : 2;
        
        return {
          type: 'heading',
          raw: match[0],
          depth: depth,
          text: text.trim(),
          tokens: this.lexer.inlineTokens(text.trim())
        };
      }
    }
  };

  marked.use({ extensions: [highlightExtension, wikiLinkExtension, calloutExtension, invertedSetextExtension] });

  const handleCalloutToggle = (event) => {
    const toggle = event.target.closest('.md-callout-toggle');
    if (!toggle) return;
    const callout = toggle.closest('.md-callout');
    if (!callout) return;
    callout.classList.toggle('collapsed');
    const expanded = !callout.classList.contains('collapsed');
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  };

  document.addEventListener('click', handleCalloutToggle);

  global.ObsidianMarkdown = { sanitizeHref };
})(typeof window !== 'undefined' ? window : globalThis);
