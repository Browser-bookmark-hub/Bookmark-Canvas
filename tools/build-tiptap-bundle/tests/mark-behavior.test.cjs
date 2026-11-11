const assert = require('node:assert/strict');
const { beforeEach, afterEach, test } = require('node:test');
const loadCanvasRuntime = require('./helpers/load-canvas-runtime.cjs');

let runtime;
let instance;
let editor;
beforeEach(() => {
  runtime = loadCanvasRuntime();
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  instance = runtime.window.CanvasTiptapEngine.create(container, { initialMarkdown: '' });
  editor = instance.rawEditor;
});
afterEach(() => {
  instance.destroy();
  runtime.close();
});

function type(text) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, character));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(character));
  }
}

test('typed highlight delimiters finish the mark and following text stays plain', () => {
  type('==高亮==');
  assert.equal(editor.getHTML(), '<p><mark>高亮</mark></p>');
  assert.equal(instance.isActive('highlight'), false);
  type('后续');
  assert.equal(editor.getHTML(), '<p><mark>高亮</mark>后续</p>');
});

test('immediate Backspace reverses automatic Markdown conversion using the native input rule', () => {
  type('==高亮==');
  const event = new runtime.window.KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(editor.getHTML(), '<p>==高亮==</p>');
});

test('button marks affect next input without a selection event; spaces do not clear them', () => {
  let selectionUpdates = 0;
  editor.on('selectionUpdate', () => { selectionUpdates++; });
  editor.commands.toggleHighlight();
  assert.equal(instance.isActive('highlight'), true);
  assert.equal(selectionUpdates, 0);
  type('开启  继续');
  assert.equal(editor.getHTML(), '<p><mark>开启  继续</mark></p>');
  editor.commands.toggleHighlight();
  type('普通');
  assert.equal(editor.getHTML(), '<p><mark>开启  继续</mark>普通</p>');
});
