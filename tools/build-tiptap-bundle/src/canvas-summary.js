import { Node } from '@tiptap/core';

/** Keep native disclosure titles editable without flattening them into paragraphs. */
export default Node.create({
  name: 'canvasSummary',
  content: 'inline*',
  defining: true,
  parseHTML() {
    return [{ tag: 'summary' }];
  },
  renderHTML() {
    return ['summary', 0];
  },
});
