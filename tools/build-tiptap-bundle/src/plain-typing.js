import { Extension } from '@tiptap/core';
import { keydownHandler } from '@tiptap/pm/keymap';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import inlineFormatNames from './inline-format-names.js';

const exitFormatNames = [...inlineFormatNames, 'link'];
// Do not interpret a physical right arrow as a logical boundary in mixed/RTL text.
const bidiText = /[\u0590-\u08ff\u200e\u200f\u202a-\u202e\u2066-\u2069\ufb1d-\ufdff\ufe70-\ufeff]/u;

/** Stop inline formatting for subsequent typing without editing existing content. */
export default Extension.create({
  name: 'plainTyping',
  priority: 1100,
  addCommands() {
    return {
      setPlainTyping: () => ({ editor, tr, dispatch }) => {
        if (!editor.isEditable || editor.view.composing || !(tr.selection instanceof TextSelection) || !tr.selection.empty) {
          return false;
        }
        if (dispatch) {
          // null would inherit the adjacent text's marks again; [] explicitly opts out.
          tr.setStoredMarks([]).setMeta('addToHistory', false);
        }
        return true;
      },
      // 「恢复普通输入」在 Mermaid 代码块内：跳到图下方的一行继续普通输入；下方没有可输入的行时新建一个段落。
      // 普通代码块不受影响（仍只清空待输入格式，不改块结构）。
      exitCodeBlockBelow: () => ({ editor, tr, dispatch }) => {
        if (!editor.isEditable || editor.view.composing) return false;
        const { $from, $to } = tr.selection;
        if (!$from.parent.type.spec.code || !$from.sameParent($to)) return false;
        if (String($from.parent.attrs.language || '').toLowerCase() !== 'mermaid') return false;
        const after = $from.after();
        const next = tr.doc.nodeAt(after);
        const fillType = (next && next.isTextblock)
          ? null
          : $from.node(-1).contentMatchAt($from.indexAfter(-1)).defaultType;
        if (!(next && next.isTextblock) && !(fillType && fillType.isTextblock)) return false;
        if (dispatch) {
          if (fillType) tr.insert(after, fillType.createAndFill());
          tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView();
        }
        return true;
      },
      exitInlineFormatAtEnd: () => ({ editor, tr, dispatch }) => {
        const { selection, storedMarks } = tr;
        if (!editor.isEditable || editor.view.composing || !(selection instanceof TextSelection) || !selection.empty) return false;
        const { $from } = selection;
        if ($from.parent.type.spec.code) return false;
        const before = $from.nodeBefore;
        if (!before?.isText) return false;
        const after = $from.nodeAfter;
        const marks = storedMarks ?? $from.marks();
        const endsHere = marks.some(mark => exitFormatNames.includes(mark.type.name)
          && mark.isInSet(before.marks) && !mark.isInSet(after?.marks || []));
        if (!endsHere) return false;
        if (bidiText.test($from.parent.textContent)) return false;
        const dom = editor.view.domAtPos($from.pos).node;
        const element = dom.nodeType === 1 ? dom : dom.parentElement;
        const view = editor.view.dom.ownerDocument.defaultView;
        if (view.getComputedStyle(element).direction === 'rtl' || view.getComputedStyle(editor.view.dom).direction === 'rtl') return false;
        if (dispatch) tr.setStoredMarks([]).setMeta('addToHistory', false);
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const handleShortcut = keydownHandler({
      'Mod-\\': () => (this.editor.can().exitCodeBlockBelow() && this.editor.commands.exitCodeBlockBelow())
        || (this.editor.can().setPlainTyping() && this.editor.commands.setPlainTyping()),
    });
    return [new Plugin({
      props: {
        handleKeyDown: (view, event) => {
          if (event.isComposing || event.keyCode === 229 || view.composing || event.altKey || event.shiftKey || (event.ctrlKey && event.metaKey)) {
            return false;
          }
          if (event.key === 'ArrowRight') {
            if (event.ctrlKey || event.metaKey) return false;
            return this.editor.can().exitInlineFormatAtEnd() && this.editor.commands.exitInlineFormatAtEnd();
          }
          return handleShortcut(view, event);
        },
      },
    })];
  },
});
