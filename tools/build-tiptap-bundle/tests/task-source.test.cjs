const assert = require('node:assert/strict');
const { beforeEach, afterEach, test } = require('node:test');
const loadCanvasRuntime = require('./helpers/load-canvas-runtime.cjs');

let runtime;
beforeEach(() => { runtime = loadCanvasRuntime(); });
afterEach(() => { runtime.close(); });

test('quoted tasks use parser source positions rather than toggling a later task', () => {
  const source = '> - [ ] quoted task\n\n- [ ] ordinary task';
  assert.equal(runtime.window.__toggleMarkdownTaskAtIndex(source, 0, true), '> - [x] quoted task\n\n- [ ] ordinary task');
  assert.equal(runtime.window.__toggleMarkdownTaskAtIndex(source, 1, true), '> - [ ] quoted task\n\n- [x] ordinary task');
});

test('nested lists, ordered markers and code fences maintain DOM task order', () => {
  const source = '````md\n```\n- [ ] not a task\n````\n\n> 1. [ ] parent\n>    - [x] child\n\n- normal\n- [ ] last';
  const changed = runtime.window.__toggleMarkdownTaskAtIndex(source, 1, false);
  assert.equal(changed, source.replace('>    - [x] child', '>    - [ ] child'));
  assert.equal(runtime.window.__toggleMarkdownTaskAtIndex(source, 2, true), source.replace('- [ ] last', '- [x] last'));
  assert.equal(runtime.window.__toggleMarkdownTaskAtIndex(source, 99, true), source);
});

test('HTML task lists cannot shift the Markdown index to a different item', () => {
  const source = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>HTML task</p></li></ul>\n\n- [ ] ordinary';
  const changed = runtime.window.__toggleMarkdownTaskAtIndex(source, 0, true);
  const html = runtime.window.CanvasTiptapEngine.renderStaticHTML(changed);
  const holder = runtime.window.document.createElement('div');
  holder.innerHTML = html;
  assert.deepEqual(Array.from(holder.querySelectorAll('li[data-type="taskItem"]'), li => li.getAttribute('data-checked')), ['true', 'false']);
});

test('missing parser fails closed instead of altering a guessed source line', () => {
  runtime.window.CanvasTiptapEngine = null;
  const source = '> - [ ] quote\n\n- [ ] ordinary';
  assert.equal(runtime.window.__toggleMarkdownTaskAtIndex(source, 0, true), source);
});
