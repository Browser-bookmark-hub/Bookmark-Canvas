import { getHTMLFromFragment } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import { Fragment } from '@tiptap/pm/model';

/** Serialize simple tables as GFM; keep richer tables as lossless HTML. */
export default Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          let simple = node.childCount > 0;
          node.forEach((row, _offset, rowIndex) => {
            row.forEach(cell => {
              const paragraph = cell.firstChild;
              if (cell.type.name !== (rowIndex === 0 ? 'tableHeader' : 'tableCell') ||
                  cell.attrs.colspan > 1 || cell.attrs.rowspan > 1 || cell.attrs.colwidth || cell.attrs.align ||
                  cell.childCount !== 1 || paragraph.type.name !== 'paragraph' ||
                  (paragraph.attrs.textAlign && paragraph.attrs.textAlign !== 'left')) {
                simple = false;
              }
            });
          });
          if (!simple) {
            state.write(getHTMLFromFragment(Fragment.from(node), node.type.schema));
            state.closeBlock(node);
            return;
          }
          const wasInTable = state.inTable;
          state.inTable = true;
          node.forEach((row, _offset, rowIndex) => {
            state.write('| ');
            row.forEach((cell, _cellOffset, columnIndex) => {
              if (columnIndex) state.write(' | ');
              // Give each cell its own mark/whitespace bookkeeping. Changing the
              // outer output offsets can corrupt tiptap-markdown's pending marks.
              const cellState = new state.constructor(state.nodes, state.marks, state.options);
              cellState.inTable = true;
              cellState.render(cell.firstChild);
              // Escape the entire cell, including code spans and link destinations.
              state.write(cellState.out.replace(/\|/g, '\\|'));
            });
            state.write(' |');
            state.ensureNewLine();
            if (rowIndex === 0) {
              state.write(`| ${Array(row.childCount).fill('---').join(' | ')} |`);
              state.ensureNewLine();
            }
          });
          state.inTable = wasInTable;
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});
