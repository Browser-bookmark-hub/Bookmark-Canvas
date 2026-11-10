import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import markdownItMark from 'markdown-it-mark';

/**
 * 专为 Bookmark Canvas 深度定制的 Markdown 增强扩展
 */

// 1. 高亮扩展：支持 Obsidian 格式的 ==高亮== 与自定义背景色 <mark>
const CustomHighlight = Highlight.extend({
    addStorage() {
        return {
            markdown: {
                serialize: {
                    open(state, mark) {
                        if (mark && mark.attrs && mark.attrs.color) {
                            return `<mark style="background-color: ${mark.attrs.color}">`;
                        }
                        return '==';
                    },
                    close(state, mark) {
                        if (mark && mark.attrs && mark.attrs.color) {
                            return '</mark>';
                        }
                        return '==';
                    },
                    expelEnclosingWhitespace: true,
                },
                parse: {
                    setup(md) {
                        if (typeof md.use === 'function') {
                            md.use(markdownItMark);
                        }
                    },
                },
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

// 3. 段落扩展：保留对齐属性（居中、居右等转换为 HTML5 style 标签，默认靠左保持原生 markdown）
const CustomParagraph = Paragraph.extend({
    addStorage() {
        return {
            markdown: {
                serialize(state, node) {
                    const align = node.attrs && node.attrs.textAlign;
                    if (align && align !== 'left') {
                        state.write(`<p style="text-align: ${align}">`);
                        state.renderInline(node);
                        state.write('</p>');
                        state.closeBlock(node);
                    } else {
                        state.renderInline(node);
                        state.closeBlock(node);
                    }
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
                    const align = node.attrs && node.attrs.textAlign;
                    const level = (node.attrs && node.attrs.level) || 1;
                    if (align && align !== 'left') {
                        state.write(`<h${level} style="text-align: ${align}">`);
                        state.renderInline(node, false);
                        state.write(`</h${level}>`);
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

/**
 * CanvasTiptapEngine - Headless Editor Bridge for Bookmark Canvas
 * 
 * 专为 Bookmark Canvas 画布量身定制的无头 Markdown 富文本编辑器驱动引擎：
 * 1. 采用工业级 ProseMirror + Tiptap 2 架构，彻底消灭手动操作 DOM 带来的“吞字符”、光标丢失、IME 合成截断问题；
 * 2. 具备完整的双向 Markdown 解析与序列化能力；
 * 3. 100% 契合原有格式工具栏、字号、调色板、对齐方式、快捷键；
 * 4. 保持无头设计，对卡片原有布局与样式零侵入。
 */
class CanvasTiptapInstance {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.isDestroyed = false;

        const initialContent = options.initialMarkdown || options.content || '';
        const isEditable = options.editable !== false;

        this.editor = new Editor({
            element: container,
            editable: isEditable,
            autofocus: options.autofocus || false,
            content: initialContent,
            extensions: [
                StarterKit.configure({
                    paragraph: false, // 由 CustomParagraph 接管以支持 textAlign
                    heading: false,   // 由 CustomHeading 接管以支持 textAlign
                    underline: false, // 由 CustomUnderline 接管以支持 Markdown <u> 序列化，杜绝 Duplicate extension 警告
                    codeBlock: {
                        enableTabIndentation: true, // 启用 Tab / Shift-Tab 缩进
                        tabSize: 4,
                        exitOnTripleEnter: true,
                        exitOnArrowDown: true,
                    },
                    history: {
                        depth: 300,
                        newGroupDelay: 300,
                    },
                    link: {
                        openOnClick: false,
                    },
                    dropcursor: false,
                    gapcursor: false,
                }),
                CustomParagraph,
                CustomHeading.configure({
                    levels: [1, 2, 3, 4, 5, 6],
                }),
                TextAlign.configure({
                    types: ['heading', 'paragraph'],
                    alignments: ['left', 'center', 'right', 'justify'],
                    defaultAlignment: 'left',
                }),
                TextStyle,
                Color,
                CustomHighlight.configure({
                    multicolor: true,
                }),
                CustomUnderline,
                TaskList,
                TaskItem.configure({
                    nested: true,
                }),
                Markdown.configure({
                    html: true,
                    transformPastedText: true,
                    transformCopiedText: true,
                    breaks: true, // 保持换行符合习惯
                }),
            ],
            onUpdate: ({ editor }) => {
                if (typeof this.options.onUpdate === 'function') {
                    try {
                        const markdown = editor.storage.markdown ? editor.storage.markdown.getMarkdown() : editor.getText();
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
        });
    }

    get rawEditor() {
        return this.editor;
    }

    getMarkdown() {
        if (!this.editor || this.isDestroyed) return '';
        try {
            if (this.editor.storage && this.editor.storage.markdown && typeof this.editor.storage.markdown.getMarkdown === 'function') {
                return this.editor.storage.markdown.getMarkdown();
            }
            return this.editor.getText() || '';
        } catch (e) {
            console.warn('[CanvasTiptapEngine] getMarkdown error:', e);
            return this.editor.getText() || '';
        }
    }

    setMarkdown(markdown, emitUpdate = false) {
        if (!this.editor || this.isDestroyed) return;
        try {
            this.editor.commands.setContent(markdown || '', {
                emitUpdate: !!emitUpdate,
            });
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

    setEditable(editable) {
        if (!this.editor || this.isDestroyed) return;
        this.editor.setEditable(!!editable);
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
        const safe = String(color || '').trim();
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
    version: '2.0.0',
    create(container, options = {}) {
        return new CanvasTiptapInstance(container, options);
    },
    destroy(instance) {
        if (instance && typeof instance.destroy === 'function') {
            instance.destroy();
        }
    }
};

if (typeof window !== 'undefined') {
    window.CanvasTiptapEngine = CanvasTiptapEngine;
}

export default CanvasTiptapEngine;
