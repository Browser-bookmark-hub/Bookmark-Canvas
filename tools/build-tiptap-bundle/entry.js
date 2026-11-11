import {
    Editor,
    Extension,
    createDocument,
    elementFromString,
    getHTMLFromFragment,
    getSchemaByResolvedExtensions,
    resolveExtensions,
} from '@tiptap/core';
import CanvasStarterKit from './src/canvas-starter-kit.js';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import Text from '@tiptap/extension-text';
import { TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Transform } from '@tiptap/pm/transform';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import markdownItMark from 'markdown-it-mark';
import taskListPlugin from 'markdown-it-task-lists';
import CanvasDetails from './src/canvas-details.js';
import CanvasTable from './src/canvas-table.js';
import SingleInlineFormat from './src/single-inline-format.js';
import PlainTyping from './src/plain-typing.js';

/**
 * 专为 Bookmark Canvas 深度定制的 Markdown 增强扩展
 */

const SAFE_ALIGN_RE = /^(left|center|right|justify)$/;
function sanitizeAlignValue(value) {
    const align = String(value || '').trim().toLowerCase();
    return SAFE_ALIGN_RE.test(align) ? align : '';
}

function sanitizeCssColor(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/["'<>\\;]|javascript:|expression\s*\(|url\s*\(/i.test(raw)) return '';
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
    if (/^(?:rgb|rgba|hsl|hsla)\(\s*[-+.\d%\s,/]+\)$/i.test(raw)) return raw;
    if (/^[a-z]{1,32}$/i.test(raw)) return raw;
    return '';
}

function isCjkCodePoint(cp) {
    return (
        (cp >= 0x4E00 && cp <= 0x9FFF) ||
        (cp >= 0x3400 && cp <= 0x4DBF) ||
        (cp >= 0x3040 && cp <= 0x30FF) ||
        (cp >= 0xAC00 && cp <= 0xD7AF) ||
        (cp >= 0x20000 && cp <= 0x2FA1F)
    );
}

// 0. 幂等守卫 & 中文标点加粗/脚注兼容性增强：
// - 防止 tiptap-markdown 重复挂载插件
// - 支持 **注意：**请先备份 等紧邻中文的 `*` 强调边界
// - 防止 [^1]: 脚注定义被 CommonMark reference 规则吞并成乱码链接
const MarkdownParserDedupe = Extension.create({
    name: 'markdownParserDedupe',
    priority: 5000,
    addStorage() {
        return {
            markdown: {
                parse: {
                    setup(md) {
                        if (!md) return;
                        if (typeof md.use === 'function' && !md.__canvasUseWrapped) {
                            md.__canvasUseWrapped = true;
                            const loadedPlugins = new Set();
                            const origUse = md.use.bind(md);
                            md.use = function wrappedMarkdownItUse(plugin, ...args) {
                                if (args.length === 0 && typeof plugin === 'function') {
                                    if (loadedPlugins.has(plugin)) return md;
                                    loadedPlugins.add(plugin);
                                }
                                return origUse(plugin, ...args);
                            };
                        }
                        try {
                            const StateProto = md.inline && md.inline.State && md.inline.State.prototype;
                            if (StateProto && typeof StateProto.scanDelims === 'function' && !StateProto.__canvasCjkDelims) {
                                StateProto.__canvasCjkDelims = true;
                                const origScanDelims = StateProto.scanDelims;
                                StateProto.scanDelims = function canvasScanDelims(start, canSplitWord) {
                                    const res = origScanDelims.call(this, start, canSplitWord);
                                    if (!res || this.src.charCodeAt(start) !== 0x2A /* * */) return res;
                                    let pos = start;
                                    while (pos < this.posMax && this.src.charCodeAt(pos) === 0x2A) pos++;
                                    const lastCp = start > 0 ? this.src.codePointAt(start - 1) : 0x20;
                                    const actualLastCp = (lastCp >= 0xDC00 && lastCp <= 0xDFFF && start > 1)
                                        ? this.src.codePointAt(start - 2)
                                        : lastCp;
                                    const nextCp = pos < this.posMax ? this.src.codePointAt(pos) : 0x20;
                                    if (!res.can_close && actualLastCp > 0x20 && isCjkCodePoint(nextCp)) {
                                        res.can_close = true;
                                    }
                                    if (!res.can_open && nextCp > 0x20 && isCjkCodePoint(actualLastCp)) {
                                        res.can_open = true;
                                    }
                                    return res;
                                };
                            }
                        } catch (_) { }
                        try {
                            const rules = md.block && md.block.ruler && md.block.ruler.__rules__;
                            const refRule = Array.isArray(rules) ? rules.find(r => r && r.name === 'reference') : null;
                            if (refRule && typeof refRule.fn === 'function' && !refRule.fn.__canvasFootnoteGuard) {
                                const origRef = refRule.fn;
                                const wrappedRef = function canvasReferenceWithoutFootnotes(state, startLine, endLine, silent) {
                                    const pos = state.bMarks[startLine] + state.tShift[startLine];
                                    if (state.src.charCodeAt(pos) === 0x5B && state.src.charCodeAt(pos + 1) === 0x5E) {
                                        return false;
                                    }
                                    return origRef.call(this, state, startLine, endLine, silent);
                                };
                                wrappedRef.__canvasFootnoteGuard = true;
                                refRule.fn = wrappedRef;
                                md.block.ruler.__cache__ = null;
                            }
                        } catch (_) { }
                    },
                },
            },
        };
    },
});

// 1. 高亮扩展：支持 Obsidian 格式的 ==高亮== 与自定义背景色 <mark>（防属性注入）
const CustomHighlight = Highlight.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            color: {
                default: null,
                parseHTML: (element) => {
                    const raw = (element.getAttribute && element.getAttribute('data-color')) ||
                        (element.style && element.style.backgroundColor);
                    return sanitizeCssColor(raw) || null;
                },
                renderHTML: (attributes) => {
                    const safe = sanitizeCssColor(attributes && attributes.color);
                    if (!safe) return {};
                    return {
                        'data-color': safe,
                        style: `background-color: ${safe}; color: inherit`,
                    };
                },
            },
        };
    },
    addStorage() {
        return {
            markdown: {
                serialize: {
                    open(state, mark) {
                        const safeColor = sanitizeCssColor(mark && mark.attrs && mark.attrs.color);
                        if (safeColor) {
                            return `<mark style="background-color: ${safeColor}">`;
                        }
                        return '==';
                    },
                    close(state, mark) {
                        const safeColor = sanitizeCssColor(mark && mark.attrs && mark.attrs.color);
                        if (safeColor) {
                            return '</mark>';
                        }
                        return '==';
                    },
                    expelEnclosingWhitespace: true,
                },
                parse: {
                    setup(md) {
                        if (typeof md.use === 'function' && !md.__canvasMarkLoaded) {
                            md.__canvasMarkLoaded = true;
                            md.use(markdownItMark);
                        }
                    },
                },
            },
        };
    },
});

// 1b. 待办列表扩展：混排 `- 普通项` 与 `- [ ] 待办` 时自动拆分组，避免首行凭空生成空 `- [ ]`
const CustomTaskList = TaskList.extend({
    addStorage() {
        return {
            markdown: {
                serialize(state, node) {
                    const marker = (this.editor && this.editor.storage && this.editor.storage.markdown && this.editor.storage.markdown.options && this.editor.storage.markdown.options.bulletListMarker) || '-';
                    return state.renderList(node, '  ', () => `${marker} `);
                },
                parse: {
                    setup(md) {
                        md.use(taskListPlugin);
                    },
                    updateDOM(element) {
                        const lists = [...element.querySelectorAll('.contains-task-list')];
                        lists.forEach((list) => {
                            const items = Array.from(list.children || []).filter(c => c && c.tagName === 'LI');
                            const hasTask = items.some(li => li.classList && li.classList.contains('task-list-item'));
                            const hasRegular = items.some(li => !li.classList || !li.classList.contains('task-list-item'));
                            if (!hasTask || !hasRegular || !list.parentNode) {
                                list.setAttribute('data-type', 'taskList');
                                return;
                            }
                            const doc = list.ownerDocument || document;
                            const frag = doc.createDocumentFragment();
                            let currentUl = null;
                            let currentIsTask = null;
                            items.forEach((li) => {
                                const isTask = !!(li.classList && li.classList.contains('task-list-item'));
                                if (!currentUl || currentIsTask !== isTask) {
                                    currentUl = doc.createElement('ul');
                                    if (isTask) {
                                        currentUl.className = 'contains-task-list';
                                        currentUl.setAttribute('data-type', 'taskList');
                                    }
                                    frag.appendChild(currentUl);
                                    currentIsTask = isTask;
                                }
                                currentUl.appendChild(li);
                            });
                            list.parentNode.replaceChild(frag, list);
                        });
                    },
                },
            },
        };
    },
});

// 1c. 文本扩展：保护 Obsidian 语法（[[wikilink]]、> [!callout]、[^1]）在纯文本序列化时不转义方括号
const CustomText = Text.extend({
    addStorage() {
        return {
            markdown: {
                serialize(state, node, parent) {
                    const isCodeContext = !!(
                        (parent && parent.type && parent.type.spec && parent.type.spec.code) ||
                        (node && Array.isArray(node.marks) && node.marks.some(m => m && m.type && m.type.name === 'code'))
                    );
                    const rawText = String(node && node.text ? node.text : '');
                    const escapedText = isCodeContext ? rawText : rawText
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                    const beforeLen = typeof state.out === 'string' ? state.out.length : 0;
                    state.text(escapedText, !isCodeContext);
                    if (!isCodeContext && typeof state.out === 'string' && state.out.length > beforeLen) {
                        let appended = state.out.slice(beforeLen);
                        appended = appended
                            .replace(/\\\[\\\[([^\]\n]+)\\\]\\\]/g, '[[$1]]')
                            .replace(/\\\[\^([^\]\n]+)\\\]/g, '[^$1]')
                            .replace(/\\\[!([A-Za-z0-9_-]+)\\\]/g, '[!$1]');
                        state.out = state.out.slice(0, beforeLen) + appended;
                    }
                },
                parse: {},
            },
        };
    },
});

// 2. 下划线扩展：双向无损支持 <u>下划线</u>
const CustomUnderline = Underline.extend({
    addStorage() {
        return {
            markdown: {
                serialize: {
                    open: '<u>',
                    close: '</u>',
                    expelEnclosingWhitespace: true,
                },
                parse: {},
            },
        };
    },
});

const EMPTY_PARAGRAPH_PRESERVE_PARENTS = new Set(['doc', 'blockquote', 'listItem', 'taskItem']);

// 3. 段落扩展：保留对齐属性与块间空行；兼容历史 <center> 与 <p align="...">
const CustomParagraph = Paragraph.extend({
    parseHTML() {
        return [{ tag: 'p' }, { tag: 'center' }];
    },
    addStorage() {
        return {
            markdown: {
                serialize(state, node, parent) {
                    const align = sanitizeAlignValue(node.attrs && node.attrs.textAlign);
                    if (align && align !== 'left') {
                        const html = getHTMLFromFragment(node.content, node.type.schema);
                        state.write(`<p style="text-align: ${align}">${html}</p>`);
                        state.closeBlock(node);
                        return;
                    }
                    // 保留段落之间的主动空行（覆盖文档、引用块、列表项与待办项的中间与末尾空行；排除单段空容器以免污染空卡片或 - / > 空项）
                    if (
                        node.content.size === 0 &&
                        parent &&
                        parent.type &&
                        EMPTY_PARAGRAPH_PRESERVE_PARENTS.has(parent.type.name) &&
                        parent.childCount > 1
                    ) {
                        state.write('<p></p>');
                        state.closeBlock(node);
                        return;
                    }
                    state.renderInline(node);
                    state.closeBlock(node);
                },
                parse: {},
            },
        };
    },
});

// 4. 标题扩展：保留对齐属性
const CustomHeading = Heading.extend({
    addStorage() {
        return {
            markdown: {
                serialize(state, node) {
                    const align = sanitizeAlignValue(node.attrs && node.attrs.textAlign);
                    const level = Math.max(1, Math.min(6, Number(node.attrs && node.attrs.level) || 1));
                    if (align && align !== 'left') {
                        const html = getHTMLFromFragment(node.content, node.type.schema);
                        state.write(`<h${level} style="text-align: ${align}">${html}</h${level}>`);
                        state.closeBlock(node);
                    } else {
                        state.write(state.repeat('#', level) + ' ');
                        state.renderInline(node, false);
                        state.closeBlock(node);
                    }
                },
                parse: {},
            },
        };
    },
});

// 5. 对齐扩展：兼容 style="text-align: ..." 与历史 <p align="..."> / <center>
const CustomTextAlign = TextAlign.extend({
    addGlobalAttributes() {
        return [
            {
                types: this.options.types,
                attributes: {
                    textAlign: {
                        default: this.options.defaultAlignment,
                        parseHTML: (element) => {
                            const styleAlign = sanitizeAlignValue(element.style && element.style.textAlign);
                            const attrAlign = sanitizeAlignValue(element.getAttribute && element.getAttribute('align'));
                            const isCenterTag = element.tagName && element.tagName.toLowerCase() === 'center';
                            const alignment = styleAlign || attrAlign || (isCenterTag ? 'center' : '');
                            return this.options.alignments.includes(alignment) ? alignment : this.options.defaultAlignment;
                        },
                        renderHTML: (attributes) => {
                            const safe = sanitizeAlignValue(attributes && attributes.textAlign);
                            if (!safe || !this.options.alignments.includes(safe) || safe === this.options.defaultAlignment) {
                                return {};
                            }
                            return { style: `text-align: ${safe}` };
                        },
                    },
                },
            },
        ];
    },
});

// 6. 字体样式与颜色扩展：双向兼容历史 <font color="..."> 与 style="color: ..."
const CustomTextStyle = TextStyle.extend({
    parseHTML() {
        return [
            ...(this.parent?.() || []),
            {
                tag: 'font[color]',
                consuming: false,
                getAttrs: (element) => {
                    const raw = element.getAttribute && element.getAttribute('color');
                    return sanitizeCssColor(raw) ? {} : false;
                },
            },
        ];
    },
});

const CustomColor = Color.extend({
    addOptions() {
        return {
            ...this.parent?.(),
            types: ['textStyle'],
        };
    },
    addGlobalAttributes() {
        return [
            {
                types: this.options.types,
                attributes: {
                    color: {
                        default: null,
                        parseHTML: (element) => {
                            const styleColor = element.style && element.style.color;
                            const attrColor = element.getAttribute && element.getAttribute('color');
                            const raw = String(styleColor || attrColor || '').replace(/['"]+/g, '');
                            return sanitizeCssColor(raw) || null;
                        },
                        renderHTML: (attributes) => {
                            const safe = sanitizeCssColor(attributes && attributes.color);
                            if (!safe) return {};
                            return { style: `color: ${safe}` };
                        },
                    },
                },
            },
        ];
    },
});

// 7. 兜底 Tab 键守卫：列表中优先由 ListItem / TaskItem / CodeBlock / Table 接管；
// 若已到顶层第一项或处于普通段落，阻止浏览器默认 Tab 跳焦触发 onBlur 意外退出编辑态
const CanvasTabHandler = Extension.create({
    name: 'canvasTabHandler',
    priority: 50,
    addKeyboardShortcuts() {
        return {
            Tab: () => {
                if (this.editor.commands.sinkListItem('listItem')) return true;
                if (this.editor.commands.sinkListItem('taskItem')) return true;
                return true;
            },
            'Shift-Tab': () => {
                if (this.editor.commands.liftListItem('listItem')) return true;
                if (this.editor.commands.liftListItem('taskItem')) return true;
                return true;
            },
        };
    },
});

function buildCanvasTiptapExtensions(options = {}) {
    const forStatic = !!(options && options.forStatic);
    const list = [
        MarkdownParserDedupe,
        CanvasStarterKit.configure({
            paragraph: false, // 由 CustomParagraph 接管以支持 textAlign 与空行保留
            heading: false,   // 由 CustomHeading 接管以支持 textAlign
            underline: false, // 由 CustomUnderline 接管以支持 Markdown <u> 序列化
            text: false,      // 由 CustomText 接管以支持 Obsidian [[wikilink]] / [!callout] / [^1]
            codeBlock: {
                enableTabIndentation: true,
                tabSize: 4,
                exitOnTripleEnter: true,
                exitOnArrowDown: true,
            },
            undoRedo: {
                depth: 300,
                newGroupDelay: 300,
            },
            trailingNode: false,
            link: {
                openOnClick: false,
                protocols: ['obsidian', 'chrome-extension', 'http', 'https', 'mailto'],
            },
            dropcursor: false,
            gapcursor: true,
        }),
        CustomText,
        SingleInlineFormat,
        PlainTyping,
        CanvasDetails,
        CustomParagraph,
        CustomHeading.configure({
            levels: [1, 2, 3, 4, 5, 6],
        }),
        CustomTextAlign.configure({
            types: ['heading', 'paragraph'],
            alignments: ['left', 'center', 'right', 'justify'],
            defaultAlignment: 'left',
        }),
        CustomTextStyle,
        CustomColor,
        CustomHighlight.configure({
            multicolor: true,
        }),
        CustomUnderline,
        CustomTaskList,
        TaskItem.configure({
            nested: true,
            onReadOnlyChecked: () => true,
        }),
        Image.configure({
            allowBase64: true,
            inline: true,
        }),
        CanvasTable.configure({
            resizable: true,
        }),
        TableRow,
        TableHeader,
        TableCell,
    ];
    if (!forStatic) {
        list.push(
            CanvasTabHandler,
            Placeholder.configure({
                placeholder: ({ node }) => {
                    if (node && node.type && node.type.name === 'heading') return '';
                    return (options && options.placeholder) || '';
                },
                showOnlyWhenEditable: true,
            })
        );
    }
    list.push(
        Markdown.configure({
            html: true,
            linkify: true,
            transformPastedText: true,
            transformCopiedText: true,
            breaks: true, // 保持换行符合习惯
        })
    );
    return list;
}

let cachedStaticRenderer = null;
function getStaticMarkdownRenderer() {
    if (cachedStaticRenderer) return cachedStaticRenderer;
    const rawExtensions = buildCanvasTiptapExtensions({ forStatic: true });
    const resolvedExtensions = resolveExtensions(rawExtensions);
    const schema = getSchemaByResolvedExtensions(resolvedExtensions);
    const markdownExt = resolvedExtensions.find((ext) => ext.name === 'markdown');
    if (!markdownExt || !markdownExt.config || typeof markdownExt.config.onBeforeCreate !== 'function') {
        throw new Error('Markdown extension not found for static renderer');
    }
    const mockEditor = {
        schema,
        extensionManager: { extensions: resolvedExtensions },
        options: { content: '' },
        storage: {},
    };
    markdownExt.config.onBeforeCreate.call({
        editor: mockEditor,
        options: markdownExt.options,
    });
    cachedStaticRenderer = {
        schema,
        parser: mockEditor.storage.markdown.parser,
        serializer: mockEditor.storage.markdown.serializer,
    };
    return cachedStaticRenderer;
}

/**
 * CanvasTiptapEngine - Headless Editor Bridge for Bookmark Canvas
 *
 * 专为 Bookmark Canvas 画布量身定制的无头 Markdown 富文本编辑器驱动引擎（TipTap 3 + ProseMirror）：
 * 1. 采用工业级 ProseMirror + TipTap 3 架构，彻底消灭手动操作 DOM 带来的“吞字符”、光标丢失、IME 合成截断问题；
 * 2. 具备完整的双向 Markdown 解析与序列化能力，同时提供零 Editor 实例开销的同构静态 HTML 渲染；
 * 3. 100% 契合原有格式工具栏、字号、调色板、对齐方式、快捷键；
 * 4. 保持无头设计，对卡片原有布局与样式零侵入。
 */
class CanvasTiptapInstance {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.isDestroyed = false;
        this.initialMarkdown = null;
        this.initialDocument = null;

        const initialContent = options.initialMarkdown || options.content || '';
        const isEditable = options.editable !== false;

        this.editor = new Editor({
            element: container,
            editable: isEditable,
            autofocus: options.autofocus || false,
            content: initialContent,
            extensions: buildCanvasTiptapExtensions({ placeholder: options.placeholder || '' }),
            onUpdate: ({ editor }) => {
                if (typeof this.options.onUpdate === 'function') {
                    try {
                        const markdown = this.getMarkdown();
                        if (typeof markdown !== 'string') return;
                        const html = editor.getHTML();
                        this.options.onUpdate(markdown, html, editor);
                    } catch (e) {
                        console.warn('[CanvasTiptapEngine] onUpdate error:', e);
                    }
                }
            },
            onFocus: ({ editor, event }) => {
                if (typeof this.options.onFocus === 'function') {
                    this.options.onFocus(editor, event);
                }
            },
            onBlur: ({ editor, event }) => {
                if (typeof this.options.onBlur === 'function') {
                    this.options.onBlur(editor, event);
                }
            },
            onSelectionUpdate: ({ editor }) => {
                if (typeof this.options.onSelectionUpdate === 'function') {
                    this.options.onSelectionUpdate(editor);
                }
            },
            onTransaction: ({ editor, transaction, appendedTransactions = [] }) => {
                const formatStateChanged = [transaction, ...appendedTransactions].some(tr =>
                    tr.docChanged || tr.selectionSet || tr.storedMarksSet
                );
                if (formatStateChanged && typeof this.options.onStateUpdate === 'function') {
                    this.options.onStateUpdate(editor);
                }
            },
        });
        this.initialMarkdown = typeof initialContent === 'string' ? initialContent : null;
        this.initialDocument = this.editor.state.doc;
    }

    get rawEditor() {
        return this.editor;
    }

    getMarkdown() {
        if (!this.editor || this.isDestroyed) return null;
        try {
            // Merely opening an editor (or undoing back to its starting document)
            // must not rewrite source formatting or unsupported legacy syntax.
            if (this.initialMarkdown !== null && this.editor.state.doc.eq(this.initialDocument)) {
                return this.initialMarkdown;
            }
            if (this.editor.storage && this.editor.storage.markdown && typeof this.editor.storage.markdown.getMarkdown === 'function') {
                return this.editor.storage.markdown.getMarkdown();
            }
            return null;
        } catch (e) {
            console.warn('[CanvasTiptapEngine] getMarkdown error:', e);
            return null;
        }
    }

    setMarkdown(markdown, emitUpdate = false) {
        if (!this.editor || this.isDestroyed) return;
        try {
            this.editor.commands.setContent(markdown || '', {
                emitUpdate: !!emitUpdate,
            });
            if (!emitUpdate) {
                this.initialMarkdown = String(markdown || '');
                this.initialDocument = this.editor.state.doc;
            }
        } catch (e) {
            console.warn('[CanvasTiptapEngine] setMarkdown error:', e);
        }
    }

    getHTML() {
        if (!this.editor || this.isDestroyed) return '';
        return this.editor.getHTML();
    }

    setHTML(html, emitUpdate = false) {
        if (!this.editor || this.isDestroyed) return;
        this.initialMarkdown = null;
        this.editor.commands.setContent(html || '', {
            emitUpdate: !!emitUpdate,
        });
    }

    getText() {
        if (!this.editor || this.isDestroyed) return '';
        return this.editor.getText();
    }

    isEmpty() {
        if (!this.editor || this.isDestroyed) return true;
        return this.editor.isEmpty;
    }

    isFocused() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.isFocused;
    }

    focus(pos = null, options = {}) {
        if (!this.editor || this.isDestroyed) return;
        const container = this.container;
        const savedScrollTop = container ? container.scrollTop : 0;
        const savedScrollLeft = container ? container.scrollLeft : 0;
        try {
            const focusOpts = { scrollIntoView: false, ...options };
            if (pos !== null && pos !== undefined) {
                this.editor.commands.focus(pos, focusOpts);
            } else {
                this.editor.commands.focus(null, focusOpts);
            }
        } catch (_) { }
        if (container) {
            container.scrollTop = savedScrollTop;
            container.scrollLeft = savedScrollLeft;
            requestAnimationFrame(() => {
                if (this.isDestroyed || !container || !container.isConnected) return;
                if (container.scrollTop !== savedScrollTop) container.scrollTop = savedScrollTop;
                if (container.scrollLeft !== savedScrollLeft) container.scrollLeft = savedScrollLeft;
            });
        }
    }

    focusAtCoords(coords, options = {}) {
        if (!this.editor || this.isDestroyed || !this.editor.view) return false;
        const container = this.container;
        const savedScrollTop = container ? container.scrollTop : 0;
        const savedScrollLeft = container ? container.scrollLeft : 0;
        let success = false;
        try {
            const view = this.editor.view;
            if (view && coords && typeof coords.left === 'number' && typeof coords.top === 'number') {
                const posObj = view.posAtCoords({ left: coords.left, top: coords.top });
                if (posObj && typeof posObj.pos === 'number') {
                    const focusOpts = { scrollIntoView: false, ...options };
                    this.editor.commands.focus(posObj.pos, focusOpts);
                    success = true;
                }
            }
        } catch (_) { }
        if (!success) {
            this.focus(null, options);
        } else if (container) {
            container.scrollTop = savedScrollTop;
            container.scrollLeft = savedScrollLeft;
            requestAnimationFrame(() => {
                if (this.isDestroyed || !container || !container.isConnected) return;
                if (container.scrollTop !== savedScrollTop) container.scrollTop = savedScrollTop;
                if (container.scrollLeft !== savedScrollLeft) container.scrollLeft = savedScrollLeft;
            });
        }
        return success;
    }

    getPosAtCoords(coords) {
        if (!this.editor || this.isDestroyed || !this.editor.view) return null;
        try {
            if (coords && typeof coords.left === 'number' && typeof coords.top === 'number') {
                const posObj = this.editor.view.posAtCoords({ left: coords.left, top: coords.top });
                return posObj ? posObj.pos : null;
            }
        } catch (_) { }
        return null;
    }

    blur() {
        if (!this.editor || this.isDestroyed) return;
        try {
            this.editor.commands.blur();
        } catch (_) { }
    }

    setEditable(editable, emitUpdate = false) {
        if (!this.editor || this.isDestroyed) return;
        this.editor.setEditable(!!editable, !!emitUpdate);
    }

    // --- 格式控制适配接口（无缝对接原有悬浮格式条） ---

    toggleBold() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().toggleBold().run();
    }

    toggleItalic() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().toggleItalic().run();
    }

    toggleUnderline() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().toggleUnderline().run();
    }

    toggleStrike() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().toggleStrike().run();
    }

    toggleCode() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().toggleCode().run();
    }

    toggleCodeBlock() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().toggleCodeBlock().run();
    }

    toggleHighlight(color) {
        if (!this.editor || this.isDestroyed) return false;
        if (color) {
            return this.editor.chain().focus().toggleHighlight({ color }).run();
        }
        return this.editor.chain().focus().toggleHighlight().run();
    }

    setColor(color) {
        if (!this.editor || this.isDestroyed) return false;
        const safe = sanitizeCssColor(color);
        if (!safe) return false;
        return this.editor.chain().focus().setColor(safe).run();
    }

    unsetColor() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().unsetColor().run();
    }

    toggleHeading(level = 1) {
        if (!this.editor || this.isDestroyed) return false;
        const validLevel = Math.max(1, Math.min(6, Number(level) || 1));
        return this.editor.chain().focus().toggleHeading({ level: validLevel }).run();
    }

    setParagraph() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().setParagraph().run();
    }

    insertContent(content) {
        if (!this.editor || this.isDestroyed) return false;
        try {
            return this.editor.chain().focus().insertContent(content).run();
        } catch (_) {
            return false;
        }
    }

    setImage(options = {}) {
        if (!this.editor || this.isDestroyed) return false;
        const attrs = typeof options === 'string' ? { src: options } : options;
        if (!attrs || !attrs.src) return false;
        return this.editor.chain().focus().setImage(attrs).run();
    }

    setLink(options = {}) {
        if (!this.editor || this.isDestroyed) return false;
        const attrs = typeof options === 'string' ? { href: options } : options;
        if (!attrs || !attrs.href) return false;
        return this.editor.chain().focus().setLink(attrs).run();
    }

    unsetLink() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().unsetLink().run();
    }

    insertTable(options = { rows: 3, cols: 3, withHeaderRow: true }) {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().insertTable(options).run();
    }

    toggleBulletList() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().toggleBulletList().run();
    }

    toggleOrderedList() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().toggleOrderedList().run();
    }

    toggleTaskList() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().toggleTaskList().run();
    }

    toggleBlockquote() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().toggleBlockquote().run();
    }

    setHorizontalRule() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().setHorizontalRule().run();
    }

    setTextAlign(alignment = 'left') {
        if (!this.editor || this.isDestroyed) return false;
        const safeAlign = /^(left|center|right|justify)$/.test(alignment) ? alignment : 'left';
        return this.editor.chain().focus().setTextAlign(safeAlign).run();
    }

    undo() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().undo().run();
    }

    redo() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.chain().focus().redo().run();
    }

    canUndo() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.can().undo();
    }

    canRedo() {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.can().redo();
    }

    isActive(name, attrs = {}) {
        if (!this.editor || this.isDestroyed) return false;
        return this.editor.isActive(name, attrs);
    }

    destroy() {
        if (this.isDestroyed) return;
        this.isDestroyed = true;
        try {
            if (this.editor) {
                this.editor.destroy();
                this.editor = null;
            }
        } catch (e) {
            console.warn('[CanvasTiptapEngine] destroy error:', e);
        }
    }
}

const CanvasTiptapEngine = {
    isAvailable: true,
    version: '3.0.0',
    create(container, options = {}) {
        return new CanvasTiptapInstance(container, options);
    },
    destroy(instance) {
        if (instance && typeof instance.destroy === 'function') {
            instance.destroy();
        }
    },
    toggleMarkdownTaskAtIndex(markdown, targetIndex, checked) {
        const raw = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n');
        if (!Number.isInteger(targetIndex) || targetIndex < 0) return raw;
        try {
            const { schema, parser, serializer } = getStaticMarkdownRenderer();
            const doc = createDocument(parser.parse(raw), schema);
            const tasks = [];
            doc.descendants((node, pos) => {
                if (node.type.name === 'taskItem') tasks.push({ node, pos });
            });
            const task = tasks[targetIndex];
            if (!task || task.node.attrs.checked === !!checked) return raw;
            const tokens = parser.md.parse(raw, {}).filter(token =>
                token.type === 'list_item_open' &&
                /(?:^|\s)task-list-item(?:\s|$)/.test(token.attrGet('class') || '')
            );
            if (tokens.length === tasks.length && tokens[targetIndex].map) {
                const lines = raw.split('\n');
                const line = tokens[targetIndex].map[0];
                const marker = lines[line].match(/\[[ xX]\](?=[ \t]|$)/);
                if (marker) {
                    const offset = marker.index + 1;
                    lines[line] = lines[line].slice(0, offset) + (checked ? 'x' : ' ') + lines[line].slice(offset + 1);
                    return lines.join('\n');
                }
            }
            // HTML task lists have no Markdown token map. Update the parsed node
            // instead of accidentally toggling an unrelated Markdown source line.
            const updated = new Transform(doc).setNodeMarkup(task.pos, undefined, {
                ...task.node.attrs, checked: !!checked,
            }).doc;
            return serializer.serialize(updated);
        } catch (error) {
            console.warn('[CanvasTiptapEngine] task toggle error:', error);
            return raw;
        }
    },
    renderStaticHTML(markdown) {
        const raw = String(markdown == null ? '' : markdown);
        if (!raw.trim()) return '';
        try {
            const { schema, parser } = getStaticMarkdownRenderer();
            const parsedHtml = parser.parse(raw);
            if (!parsedHtml) return '';
            const doc = createDocument(parsedHtml, schema);
            if (!doc) return '';
            const isDocVisuallyEmpty =
                doc.childCount === 1 &&
                doc.firstChild &&
                doc.firstChild.type &&
                doc.firstChild.type.name === 'paragraph' &&
                doc.firstChild.content.size === 0;
            return isDocVisuallyEmpty ? '' : getHTMLFromFragment(doc.content, schema);
        } catch (e) {
            console.warn('[CanvasTiptapEngine] renderStaticHTML error:', e);
            return null;
        }
    },
};

if (typeof window !== 'undefined') {
    window.CanvasTiptapEngine = CanvasTiptapEngine;
}

export default CanvasTiptapEngine;
