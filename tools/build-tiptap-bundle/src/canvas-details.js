import { Node, getHTMLFromFragment } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import CanvasSummary from './canvas-summary.js';

/** Preserve legacy disclosure blocks, including their open state and rich body. */
export default Node.create({
  name: 'canvasDetails',
  group: 'block',
  content: 'canvasSummary block*',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: element => element.hasAttribute('open'),
        renderHTML: attrs => attrs.open ? { open: '' } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'details' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['details', HTMLAttributes, 0];
  },
  addExtensions() {
    return [CanvasSummary];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          state.write(getHTMLFromFragment(Fragment.from(node), node.type.schema));
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});
