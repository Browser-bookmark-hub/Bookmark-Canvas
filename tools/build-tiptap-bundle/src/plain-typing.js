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
      'Mod-\\': () => this.editor.can().setPlainTyping() && this.editor.commands.setPlainTyping(),
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
