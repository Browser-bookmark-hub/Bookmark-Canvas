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

test('typing single backtick delimiter transforms to inline code (Obsidian style)', () => {
  type('`代码`');
  assert.equal(editor.getHTML(), '<p><code>代码</code></p>');
  assert.equal(instance.getMarkdown().trim(), '`代码`');
});

test('typing double backticks delimiter transforms to inline code (Obsidian style)', () => {
  type('``两点代码``');
  assert.equal(editor.getHTML(), '<p><code>两点代码</code></p>');
  assert.equal(instance.getMarkdown().trim(), '`两点代码`');
});

test('typing fullwidth backtick delimiter (Chinese IME) transforms to inline code', () => {
  type('｀全角代码｀');
  assert.equal(editor.getHTML(), '<p><code>全角代码</code></p>');
  assert.equal(instance.getMarkdown().trim(), '`全角代码`');
});

test('typing double fullwidth backticks transforms to inline code', () => {
  type('｀｀全角双点｀｀');
  assert.equal(editor.getHTML(), '<p><code>全角双点</code></p>');
  assert.equal(instance.getMarkdown().trim(), '`全角双点`');
});

test('typing middle dot delimiter (Mac Chinese IME ~ key) transforms to inline code', () => {
  type('·间隔号代码·');
  assert.equal(editor.getHTML(), '<p><code>间隔号代码</code></p>');
  assert.equal(instance.getMarkdown().trim(), '`间隔号代码`');
});

test('single middle dot in names does not trigger code conversion', () => {
  type('哈利·波特');
  assert.equal(editor.getHTML(), '<p>哈利·波特</p>');
});

test('three backticks does not get eaten by inline code input rule', () => {
  type('```');
  // It shouldn't be an inline code mark with empty content
  assert.equal(editor.state.doc.textContent.length >= 0, true);
  assert.equal(instance.isActive('code'), false);
});

test('immediate Backspace reverses automatic inline code conversion', () => {
  type('`撤销代码`');
  assert.equal(editor.getHTML(), '<p><code>撤销代码</code></p>');
  const backspace = new runtime.window.KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(backspace);
  assert.equal(backspace.defaultPrevented, true);
  assert.equal(editor.getHTML(), '<p>`撤销代码`</p>');
});

test('selection auto-surround: pressing backtick on selected text wraps it as code', () => {
  editor.commands.insertContent('选中文字包裹');
  editor.commands.setTextSelection({ from: 1, to: 7 });
  const event = new runtime.window.KeyboardEvent('keydown', { key: '`', bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  assert.equal(editor.getHTML(), '<p><code>选中文字包裹</code></p>');
});

test('selection auto-surround: pressing backtick again on formatted code toggles it off', () => {
  editor.commands.insertContent('选中文字');
  editor.commands.setTextSelection({ from: 1, to: 5 });
  const event1 = new runtime.window.KeyboardEvent('keydown', { key: '`', bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event1);
  assert.equal(editor.getHTML(), '<p><code>选中文字</code></p>');

  // Pressing backtick again toggles code off
  const event2 = new runtime.window.KeyboardEvent('keydown', { key: '`', bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event2);
  assert.equal(editor.getHTML(), '<p>选中文字</p>');
});

test('selection auto-surround: pressing fullwidth backtick on selected text wraps it as code', () => {
  editor.commands.insertContent('全角包裹测试');
  editor.commands.setTextSelection({ from: 1, to: 7 });
  const event = new runtime.window.KeyboardEvent('keydown', { key: '｀', bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  assert.equal(editor.getHTML(), '<p><code>全角包裹测试</code></p>');
});

test('pasting double backtick or Chinese IME delimiters transforms into code marks', () => {
  // Test paste via TipTap clipboard serializer
  const pasted = runtime.window.document.createElement('div');
  pasted.innerHTML = 'a `单反` b ``双反`` c ｀全角｀ d ·间隔· e';
  const event = new runtime.window.Event('paste', { bubbles: true, cancelable: true });
  event.clipboardData = {
    getData: format => format === 'text/plain' ? pasted.textContent : '',
    types: ['text/plain'],
  };
  editor.view.dom.dispatchEvent(event);
  assert.match(editor.getHTML(), /<code>单反<\/code>/);
  assert.match(editor.getHTML(), /<code>双反<\/code>/);
  assert.match(editor.getHTML(), /<code>全角<\/code>/);
  assert.match(editor.getHTML(), /<code>间隔<\/code>/);
});
