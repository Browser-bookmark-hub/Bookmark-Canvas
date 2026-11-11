import { commands, createChainableState, Extension, getMarkType } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import clearCompetingInlineFormats from './clear-competing-inline-formats.js';
import inlineFormatNames from './inline-format-names.js';

/** Make the latest explicit inline-format command replace the previous format. */
export default Extension.create({
  name: 'singleInlineFormat',
  priority: 10, // Override the core setMark command after the built-in commands extension.
  addCommands() {
    return {
      setMark: (typeOrName, attributes = {}) => props => {
        const type = getMarkType(typeOrName, props.state.schema);
        if (!inlineFormatNames.includes(type.name) || (type.name === 'textStyle' && !attributes.color)) {
          return commands.setMark(type, attributes)(props);
        }
        const { tr } = props;
        // can() must reflect replacement (including leaving inline code), but
        // must neither mutate the document nor clear formats in an invalid block.
        const preview = EditorState.create({
          doc: tr.doc,
          selection: tr.selection,
          storedMarks: tr.storedMarks,
        }).tr;
        clearCompetingInlineFormats(preview, type);
        const allowed = commands.setMark(type, attributes)({
          ...props,
          tr: preview,
          state: createChainableState({ state: props.state, transaction: preview }),
          dispatch: undefined,
        });
        if (!allowed || !props.dispatch) return allowed;
        clearCompetingInlineFormats(tr, type);
        // Refresh the chainable state's cached document/marks before core setMark.
        void props.state.tr;
        return commands.setMark(type, attributes)(props);
      },
    };
  },
});
