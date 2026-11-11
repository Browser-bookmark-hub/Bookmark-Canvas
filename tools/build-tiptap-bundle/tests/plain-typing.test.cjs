const assert = require('node:assert/strict');
const { beforeEach, afterEach, test } = require('node:test');
const loadCanvasRuntime = require('./helpers/load-canvas-runtime.cjs');

let runtime;
let window;
let instances;
beforeEach(() => {
  runtime = loadCanvasRuntime({ platform: 'Win32' });
  window = runtime.window;
  instances = [];
});
afterEach(() => {
  window.document.querySelectorAll('.md-canvas-node, .temp-canvas-node, .permanent-bookmark-section')
    .forEach(card => window.__cleanupCanvasNodeTiptapInstances(card));
  instances.forEach(instance => instance.destroy());
  runtime.close();
});

function create(source = '', options = {}) {
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const instance = window.CanvasTiptapEngine.create(container, { initialMarkdown: source, ...options });
  instances.push(instance);
  return instance;
}
function shortcut(editor, options = {}) {
  const event = new window.KeyboardEvent('keydown', {
    key: '\\', code: 'Backslash', keyCode: 220, ctrlKey: true,
    bubbles: true, cancelable: true, ...options,
  });
  editor.view.dom.dispatchEvent(event);
  return event;
}
function type(editor, text) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, character));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(character));
  }
}
function assertPlainState(editor) {
  assert.notEqual(editor.state.storedMarks, null, 'plain typing must explicitly suppress inheritance');
  assert.equal(editor.state.storedMarks.length, 0);
}

for (const mark of ['bold', 'italic', 'underline', 'highlight', 'strike', 'code', 'textStyle', 'link']) {
  test(`Ctrl+\\ stops ${mark} without changing existing text or cursor`, () => {
    const instance = create();
    const editor = instance.rawEditor;
    const attrs = mark === 'textStyle' ? { color: '#fb464c' } : mark === 'link' ? { href: 'https://example.com' } : {};
    editor.commands.setMark(mark, attrs);
    type(editor, '已有');
    const { doc, selection } = editor.state;
    const source = instance.getMarkdown();
    const html = instance.getHTML();
    let updates = 0;
    let selectionUpdates = 0;
    editor.on('update', () => { updates++; });
    editor.on('selectionUpdate', () => { selectionUpdates++; });
    assert.equal(shortcut(editor).defaultPrevented, true);
    assertPlainState(editor);
    assert.ok(editor.state.doc === doc);
    assert.ok(editor.state.selection.eq(selection));
    assert.equal(instance.getMarkdown(), source);
    assert.equal(instance.getHTML(), html);
    assert.equal(updates, 0);
    assert.equal(selectionUpdates, 0);
    type(editor, '普通  继续');
    assert.equal(editor.getText(), '已有普通  继续');
    assert.equal(editor.state.doc.firstChild.firstChild.marks[0].type.name, mark);
    assert.equal(editor.state.doc.firstChild.lastChild.marks.length, 0);
    assert.equal(editor.state.doc.firstChild.lastChild.text, '普通  继续');
    if (mark === 'link') assert.equal(editor.state.doc.firstChild.firstChild.marks[0].attrs.href, 'https://example.com');
  });
}

test('the shortcut clears combined pending formats, including a link, in one step', () => {
  const instance = create('<p><a href="https://example.com"><strong><em><mark><u><s><span style="color:#fb464c">已有</span></s></u></mark></em></strong></a></p>');
  const editor = instance.rawEditor;
  editor.commands.setTextSelection(3);
  assert.ok(editor.state.selection.$from.marks().length > 3);
  const doc = editor.state.doc;
  assert.equal(shortcut(editor).defaultPrevented, true);
  assertPlainState(editor);
  assert.ok(editor.state.doc === doc);
  type(editor, '普通');
  assert.equal(editor.state.doc.firstChild.lastChild.marks.length, 0);
  assert.equal(editor.state.doc.firstChild.firstChild.marks.length, doc.firstChild.firstChild.marks.length);
});

for (const source of [
  '<h2 style="text-align: center"><mark>标题</mark></h2>',
  '<blockquote><p><strong>引用</strong></p></blockquote>',
  '- *列表*',
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p><mark>待办</mark></p></li></ul>',
  '<table><tbody><tr><td><p><strong>单元格</strong></p></td><td><p>保留</p></td></tr></tbody></table>',
  '```js\nconst value = 1;\n```',
]) {
  test(`plain typing preserves block structure: ${source.slice(0, 35)}`, () => {
    const instance = create(source);
    const editor = instance.rawEditor;
    let position;
    editor.state.doc.descendants((node, pos) => {
      if (position === undefined && node.isText) position = pos + node.nodeSize;
    });
    editor.commands.setTextSelection(position);
    const before = editor.state.doc;
    assert.equal(shortcut(editor).defaultPrevented, true);
    assert.ok(editor.state.doc === before);
    assertPlainState(editor);
    type(editor, '追加');
    const reloaded = create(instance.getMarkdown());
    assert.equal(JSON.stringify(reloaded.rawEditor.getJSON()), JSON.stringify(editor.getJSON()));
    assert.equal(editor.state.selection.$from.parent.type.name, before.resolve(position).parent.type.name);
  });
}

test('the command can be checked without mutating pending formats or selection', () => {
  const editor = create().rawEditor;
  editor.commands.setHighlight();
  const state = editor.state;
  assert.equal(editor.can().setPlainTyping(), true);
  assert.ok(editor.state === state);
  assert.equal(editor.isActive('highlight'), true);
});

test('the shortcut does not clear a selection or move its endpoints', () => {
  const editor = create('**选中文字**').rawEditor;
  editor.commands.setTextSelection({ from: 1, to: 5 });
  const state = editor.state;
  assert.equal(editor.can().setPlainTyping(), false);
  assert.equal(shortcut(editor).defaultPrevented, false);
  assert.ok(editor.state.doc === state.doc);
  assert.ok(editor.state.selection.eq(state.selection));
  assert.equal(editor.state.storedMarks, state.storedMarks);
});

test('node selections and read-only editors are not changed', () => {
  const editor = create('<p>文字</p><hr>').rawEditor;
  editor.commands.setNodeSelection(editor.state.doc.firstChild.nodeSize);
  const doc = editor.state.doc;
  assert.equal(editor.commands.setPlainTyping(), false);
  assert.equal(shortcut(editor).defaultPrevented, false);
  assert.ok(editor.state.doc === doc);
  const readOnly = create('==只读==', { editable: false }).rawEditor;
  readOnly.commands.setTextSelection(2);
  assert.equal(readOnly.commands.setPlainTyping(), false);
  assert.equal(shortcut(readOnly).defaultPrevented, false);
  assert.equal(readOnly.isActive('highlight'), true);
});

test('composition and additional modifiers are not intercepted', () => {
  const editor = create().rawEditor;
  editor.commands.setBold();
  for (const options of [{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { shiftKey: true }, { metaKey: true }, { ctrlKey: false }]) {
    assert.equal(shortcut(editor, options).defaultPrevented, false);
    assert.equal(editor.isActive('bold'), true);
  }
  editor.view.input.composing = true;
  assert.equal(editor.commands.setPlainTyping(), false);
  assert.equal(shortcut(editor).defaultPrevented, false);
  assert.equal(editor.isActive('bold'), true);
  editor.view.input.composing = false;
});

test('the shortcut works when a layout exposes a backslash through keyCode fallback', () => {
  const editor = create().rawEditor;
  editor.commands.setHighlight();
  assert.equal(shortcut(editor, { key: '¥', code: 'IntlYen' }).defaultPrevented, true);
  assertPlainState(editor);
});

for (const platform of ['MacIntel', 'Linux x86_64']) {
  test(`${platform}: the platform shortcut works only inside the editor`, () => {
    const otherRuntime = loadCanvasRuntime({ platform });
    const otherWindow = otherRuntime.window;
    const container = otherWindow.document.createElement('div');
    otherWindow.document.body.append(container);
    const instance = otherWindow.CanvasTiptapEngine.create(container, { initialMarkdown: '' });
    try {
      const editor = instance.rawEditor;
      editor.commands.setHighlight();
      const key = { key: '\\', code: 'Backslash', keyCode: 220, bubbles: true, cancelable: true,
        ctrlKey: platform !== 'MacIntel', metaKey: platform === 'MacIntel' };
      const outside = new otherWindow.KeyboardEvent('keydown', key);
      otherWindow.document.body.dispatchEvent(outside);
      assert.equal(outside.defaultPrevented, false);
      assert.equal(editor.isActive('highlight'), true);
      const inside = new otherWindow.KeyboardEvent('keydown', key);
      editor.view.dom.dispatchEvent(inside);
      assert.equal(inside.defaultPrevented, true);
      assertPlainState(editor);
    } finally {
      instance.destroy();
      otherRuntime.close();
    }
  });
}

test('plain typing is idempotent and does not add a content undo step', () => {
  const editor = create().rawEditor;
  editor.commands.setHighlight();
  type(editor, '文字');
  const doc = editor.state.doc;
  for (let i = 0; i < 3; i++) {
    assert.equal(shortcut(editor).defaultPrevented, true);
    assertPlainState(editor);
    assert.ok(editor.state.doc === doc);
  }
  assert.equal(editor.commands.undo(), true);
  assert.equal(editor.getText(), '');
  assert.equal(editor.commands.redo(), true);
  assert.equal(editor.getHTML(), '<p><mark>文字</mark></p>');
});

for (const kind of ['blank', 'temporary', 'permanent', 'copy']) {
  test(`${kind}: shortcut updates toolbar state immediately without persisting unchanged content`, () => {
    const source = '<p><strong><mark><span style="color:#fb464c">已有</span></mark></strong></p>';
    let card;
    let instance;
    let commit;
    if (kind === 'blank') {
      card = window.createBlankFixture(source).element;
      card.__enterEditMode();
      instance = card.__tiptapInstance;
      commit = () => card.__exitEditMode();
    } else if (kind === 'temporary') {
      const fixture = window.createTempDescriptionFixture({ id: 'plain-typing-note', descriptionMd: source });
      fixture.enterEditingDescription();
      card = fixture.nodeElement;
      instance = fixture.descriptionText.__tiptapInstance;
      commit = () => fixture.exitEditingDescription({ commit: true });
    } else {
      card = window.document.createElement('div');
      card.className = 'permanent-bookmark-section';
      if (kind === 'copy') card.dataset.permanentSectionCopyId = 'plain-typing-copy';
      const key = kind === 'copy' ? 'test-copy-tip:plain-typing-copy' : 'test-main-tip';
      window.localStorage.setItem(key, source);
      card.innerHTML = '<div class="permanent-section-tip-container"><div class="permanent-section-tip"></div><div class="permanent-section-tip-controls"><button class="permanent-section-tip-close"></button></div></div>';
      window.document.body.append(card);
      window.bindPermanentSectionTipBehavior(card);
      card.querySelector('.permanent-section-tip').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
      instance = card.querySelector('.permanent-section-tip').__tiptapInstance;
      commit = () => card.__commitDescriptionEdit();
    }
    const editor = instance.rawEditor;
    editor.commands.setTextSelection(3);
    for (const action of ['md-insert-bold', 'md-insert-highlight', 'md-fontcolor-toggle']) {
      assert.equal(card.querySelector(`[data-action="${action}"]`).getAttribute('aria-pressed'), 'true');
    }
    assert.equal(shortcut(editor).defaultPrevented, true);
    assertPlainState(editor);
    for (const action of ['md-insert-bold', 'md-insert-highlight', 'md-fontcolor-toggle']) {
      assert.equal(card.querySelector(`[data-action="${action}"]`).getAttribute('aria-pressed'), 'false');
    }
    assert.equal(instance.getMarkdown(), source);
    assert.equal(instance.isDestroyed, false);
    commit();
    assert.equal(window.sectionSaves.length + window.tipSaves.length + window.manifestSaves.length, 0);
  });
}
