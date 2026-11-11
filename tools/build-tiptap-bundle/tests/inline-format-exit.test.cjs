const assert = require('node:assert/strict');
const { beforeEach, afterEach, test } = require('node:test');
const loadCanvasRuntime = require('./helpers/load-canvas-runtime.cjs');

let runtime;
let window;
let instances;
beforeEach(() => {
  runtime = loadCanvasRuntime();
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
function arrow(editor, options = {}) {
  const event = new window.KeyboardEvent('keydown', {
    key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true, ...options,
  });
  editor.view.dom.dispatchEvent(event);
  return event;
}
function handled(editor, options = {}) {
  const event = new window.KeyboardEvent('keydown', {
    key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, ...options,
  });
  return !!editor.view.someProp('handleKeyDown', handler => handler(editor.view, event));
}
function type(editor, text) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    if (!editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, character))) {
      editor.view.dispatch(editor.state.tr.insertText(character));
    }
  }
}
const formats = [
  ['bold', {}], ['italic', {}], ['underline', {}], ['highlight', {}], ['strike', {}], ['code', {}],
  ['textStyle', { color: 'rgb(251, 70, 76)' }], ['link', { href: 'https://example.com' }],
];

for (const [mark, attrs] of formats) {
  for (const trailing of ['', '后文']) {
    test(`Right Arrow exits ${mark} at ${trailing ? 'an inline boundary' : 'the paragraph end'} without inserting characters`, () => {
      const instance = create('原文' + trailing);
      const editor = instance.rawEditor;
      editor.commands.setTextSelection({ from: 1, to: 3 });
      editor.commands.setMark(mark, attrs);
      editor.commands.setTextSelection(3);
      const { doc, selection } = editor.state;
      const source = instance.getMarkdown();
      let updates = 0;
      let selectionUpdates = 0;
      editor.on('update', () => { updates++; });
      editor.on('selectionUpdate', () => { selectionUpdates++; });
      assert.equal(arrow(editor).defaultPrevented, true);
      assert.equal(editor.state.storedMarks.length, 0);
      assert.ok(editor.state.doc === doc);
      assert.ok(editor.state.selection.eq(selection));
      assert.equal(instance.getMarkdown(), source);
      assert.equal(updates, 0);
      assert.equal(selectionUpdates, 0);
      assert.equal(handled(editor), false, 'a second arrow must resume native navigation');
      type(editor, '普通');
      assert.equal(editor.getText(), '原文普通' + trailing);
      assert.equal(editor.state.doc.firstChild.firstChild.marks[0].type.name, mark);
      assert.equal(editor.state.doc.firstChild.lastChild.marks.length, 0);
      const reloaded = create(instance.getMarkdown());
      assert.equal(JSON.stringify(reloaded.rawEditor.getJSON()), JSON.stringify(editor.getJSON()));
    });
  }
}

test('a combined span boundary exits all pending marks but leaves the document and URL intact', () => {
  const instance = create('<p><a href="https://example.com"><strong><mark>组合</mark></strong></a>后文</p>');
  const editor = instance.rawEditor;
  editor.commands.setTextSelection(3);
  const doc = editor.state.doc;
  assert.equal(editor.can().exitInlineFormatAtEnd(), true);
  assert.ok(editor.state.doc === doc);
  arrow(editor);
  assert.equal(editor.state.storedMarks.length, 0);
  assert.ok(editor.state.doc === doc);
  type(editor, '普通');
  const before = editor.state.doc.firstChild.firstChild;
  assert.ok(before.marks.some(mark => mark.type.name === 'link' && mark.attrs.href === 'https://example.com'));
  assert.equal(editor.state.doc.firstChild.lastChild.marks.length, 0);
});

test('a mark interval ends even when another mark continues across the boundary', () => {
  const editor = create('<p><strong><mark>高亮</mark>加粗</strong></p>').rawEditor;
  editor.commands.setTextSelection(3);
  assert.equal(handled(editor), true);
  type(editor, '普通');
  assert.equal(editor.getHTML(), '<p><strong><mark>高亮</mark></strong>普通<strong>加粗</strong></p>');
});

test('identical formats on adjacent differently marked text are not a span end', () => {
  const editor = create('<p><strong>左边<em>右边</em></strong></p>').rawEditor;
  editor.commands.setTextSelection(3);
  assert.equal(editor.can().exitInlineFormatAtEnd(), false);
  assert.equal(handled(editor), false);
  assert.equal(editor.isActive('bold'), true);
});

test('ordinary movement inside or before a formatted span does not stop its format', () => {
  const editor = create('**强调文字**').rawEditor;
  for (const position of [1, 2, 3, 4]) {
    editor.commands.setTextSelection(position);
    const state = editor.state;
    assert.equal(handled(editor), false);
    assert.ok(editor.state === state);
  }
});

test('adjacent links with different URLs are separate format intervals', () => {
  const editor = create('<p><a href="https://example.com/one">左边</a><a href="https://example.com/two">右边</a></p>').rawEditor;
  editor.commands.setTextSelection(3);
  assert.equal(handled(editor), true);
  type(editor, '普通');
  assert.equal(editor.state.doc.firstChild.child(1).text, '普通');
  assert.equal(editor.state.doc.firstChild.child(1).marks.length, 0);
  assert.equal(editor.state.doc.firstChild.firstChild.marks[0].attrs.href, 'https://example.com/one');
  assert.equal(editor.state.doc.firstChild.lastChild.marks[0].attrs.href, 'https://example.com/two');
});

test('completed typed Markdown already in plain state does not intercept the next arrow', () => {
  const editor = create().rawEditor;
  type(editor, '==高亮==');
  assert.equal(editor.isActive('highlight'), false);
  const doc = editor.state.doc;
  assert.equal(handled(editor), false);
  assert.ok(editor.state.doc === doc);
});

for (const source of [
  '<h2 style="text-align: center"><mark>标题</mark></h2>',
  '<blockquote><p><strong>引用</strong></p></blockquote>',
  '- *列表*',
  '<table><tbody><tr><td><p><strong>单元格</strong></p></td></tr></tbody></table>',
]) {
  test(`Right Arrow changes only pending marks inside a block: ${source.slice(0, 30)}`, () => {
    const editor = create(source).rawEditor;
    let position;
    editor.state.doc.descendants((node, pos) => {
      if (position === undefined && node.isText) position = pos + node.nodeSize;
    });
    editor.commands.setTextSelection(position);
    const doc = editor.state.doc;
    const parentType = editor.state.selection.$from.parent.type.name;
    assert.equal(handled(editor), true);
    assert.ok(editor.state.doc === doc);
    type(editor, '普通');
    assert.equal(editor.state.selection.$from.parent.type.name, parentType);
    assert.equal(editor.state.selection.$from.nodeBefore.marks.length, 0);
  });
}

test('plain text, an empty document and a newly toggled format without preceding formatted text do not intercept arrows', () => {
  for (const source of ['', '普通']) {
    const editor = create(source).rawEditor;
    editor.commands.focus('end');
    assert.equal(handled(editor), false);
    editor.commands.setHighlight();
    assert.equal(handled(editor), false);
    assert.equal(editor.isActive('highlight'), true);
  }
});

test('modified arrows, input-method composition and non-right arrows are never treated as format exits', () => {
  const editor = create('==高亮==').rawEditor;
  editor.commands.setTextSelection(3);
  for (const options of [
    { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true },
    { isComposing: true }, { keyCode: 229 }, { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ]) {
    assert.equal(handled(editor, options), false);
    assert.equal(editor.isActive('highlight'), true);
  }
  editor.view.input.composing = true;
  assert.equal(editor.can().exitInlineFormatAtEnd(), false);
  assert.equal(handled(editor), false);
  editor.view.input.composing = false;
});

test('a nonempty selection, node selection and read-only editor do not use the exit command', () => {
  const editor = create('`代码`\n\n---').rawEditor;
  editor.commands.setTextSelection({ from: 1, to: 3 });
  const selection = editor.state.selection;
  assert.equal(editor.can().exitInlineFormatAtEnd(), false);
  assert.equal(handled(editor), false);
  assert.ok(editor.state.selection.eq(selection));
  editor.commands.setNodeSelection(editor.state.doc.firstChild.nodeSize);
  const doc = editor.state.doc;
  assert.equal(editor.can().exitInlineFormatAtEnd(), false);
  handled(editor); // Native ProseMirror may navigate out of a selected node.
  assert.ok(editor.state.doc === doc);
  const readOnly = create('`只读`', { editable: false }).rawEditor;
  readOnly.commands.setTextSelection(3);
  assert.equal(readOnly.can().exitInlineFormatAtEnd(), false);
  assert.equal(handled(readOnly), false);
});

test('code blocks keep native navigation rather than exiting their block style', () => {
  const editor = create('```js\nconst n = 1;\n```').rawEditor;
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  const source = editor.getHTML();
  assert.equal(handled(editor), false);
  assert.equal(editor.getHTML(), source);
});

test('mixed/RTL text and explicitly RTL editing contexts keep their native navigation', () => {
  for (const source of ['**שלום**', '**مرحبا**', '**mixed שלום**']) {
    const editor = create(source).rawEditor;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    assert.equal(handled(editor), false);
  }
  const editor = create('**English**').rawEditor;
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.view.dom.style.direction = 'rtl';
  assert.equal(handled(editor), false);
});

test('the arrow exit adds no content undo step, characters or hidden nodes', () => {
  const editor = create().rawEditor;
  editor.commands.setHighlight();
  type(editor, '强调');
  const doc = editor.state.doc;
  arrow(editor);
  assert.ok(editor.state.doc === doc);
  assert.equal(editor.getText(), '强调');
  assert.equal(editor.commands.undo(), true);
  assert.equal(editor.getText(), '');
  assert.equal(editor.commands.redo(), true);
  assert.equal(editor.getHTML(), '<p><mark>强调</mark></p>');
});

for (const kind of ['blank', 'temporary', 'permanent', 'copy']) {
  test(`${kind}: Right Arrow updates the toolbar without saving or ending editing`, () => {
    let card;
    let instance;
    let commit;
    if (kind === 'blank') {
      card = window.createBlankFixture('==文字==').element;
      card.__enterEditMode();
      instance = card.__tiptapInstance;
      commit = () => card.__exitEditMode();
    } else if (kind === 'temporary') {
      const f = window.createTempDescriptionFixture({ id: 'arrow-note', descriptionMd: '==文字==' });
      f.enterEditingDescription();
      card = f.nodeElement;
      instance = f.descriptionText.__tiptapInstance;
      commit = () => f.exitEditingDescription({ commit: true });
    } else {
      card = window.document.createElement('div');
      card.className = 'permanent-bookmark-section';
      if (kind === 'copy') card.dataset.permanentSectionCopyId = 'arrow-copy';
      window.localStorage.setItem(kind === 'copy' ? 'test-copy-tip:arrow-copy' : 'test-main-tip', '==文字==');
      card.innerHTML = '<div class="permanent-section-tip-container"><div class="permanent-section-tip"></div><div class="permanent-section-tip-controls"><button class="permanent-section-tip-close"></button></div></div>';
      window.document.body.append(card);
      window.bindPermanentSectionTipBehavior(card);
      const text = card.querySelector('.permanent-section-tip');
      text.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
      instance = text.__tiptapInstance;
      commit = () => card.__commitDescriptionEdit();
    }
    const editor = instance.rawEditor;
    editor.commands.setTextSelection(3);
    const button = card.querySelector('[data-action="md-insert-highlight"]');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    arrow(editor);
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(instance.isDestroyed, false);
    assert.equal(instance.getMarkdown(), '==文字==');
    commit();
    assert.equal(window.sectionSaves.length + window.tipSaves.length + window.manifestSaves.length, 0);
  });
}
