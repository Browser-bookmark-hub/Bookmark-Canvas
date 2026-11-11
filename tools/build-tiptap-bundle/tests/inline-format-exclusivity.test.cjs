const assert = require('node:assert/strict');
const { beforeEach, afterEach, test } = require('node:test');
const loadCanvasRuntime = require('./helpers/load-canvas-runtime.cjs');

const formats = ['bold', 'italic', 'underline', 'highlight', 'strike', 'code', 'textStyle'];
const attrs = name => name === 'textStyle' ? { color: '#fb464c' } : {};
const json = value => JSON.parse(JSON.stringify(value));
let runtime;
let window;
let instances;
beforeEach(() => {
  runtime = loadCanvasRuntime();
  window = runtime.window;
  instances = [];
});
afterEach(() => {
  instances.forEach(instance => instance.destroy());
  runtime.close();
});
function create(source = '') {
  const host = window.document.createElement('div');
  window.document.body.append(host);
  const instance = window.CanvasTiptapEngine.create(host, { initialMarkdown: source });
  instances.push(instance);
  return instance;
}
function groupMarks(marks) {
  return Array.from(marks).filter(mark => formats.includes(mark.type.name)).map(mark => mark.type.name);
}
function type(editor, text) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    if (!editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, character))) {
      editor.view.dispatch(editor.state.tr.insertText(character));
    }
  }
}
function paste(editor, mime, value) {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    getData: type => type === mime ? value : '',
    items: [],
    files: [],
  } });
  editor.view.dom.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true, 'paste is handled by the production clipboard parser');
}

test('every selected inline format replaces every previous format, including leaving code', () => {
  const instance = create();
  const editor = instance.rawEditor;
  for (const previous of formats) {
    for (const next of formats) {
      instance.setMarkdown('文字');
      editor.commands.setTextSelection({ from: 1, to: 3 });
      assert.equal(editor.commands.setMark(previous, attrs(previous)), true);
      const before = editor.getHTML();
      assert.equal(editor.can().setMark(next, attrs(next)), true, `${previous} → ${next}`);
      assert.equal(editor.getHTML(), before, 'capability checks must not clear marks');
      assert.equal(editor.commands.setMark(next, attrs(next)), true, `${previous} → ${next}`);
      assert.deepEqual(groupMarks(editor.state.doc.firstChild.firstChild.marks), [next], `${previous} → ${next}`);
      assert.equal(editor.getText(), '文字');
    }
  }
});

test('pending input has only the latest format and switching does not alter preceding text', () => {
  const instance = create();
  const editor = instance.rawEditor;
  for (const previous of formats) {
    for (const next of formats) {
      instance.setMarkdown('');
      editor.commands.setMark(previous, attrs(previous));
      type(editor, '前');
      editor.commands.setMark(next, attrs(next));
      assert.deepEqual(groupMarks(editor.state.storedMarks || editor.state.selection.$from.marks()), [next]);
      type(editor, '后');
      const textNodes = [];
      editor.state.doc.descendants(node => { if (node.isText) textNodes.push(node); });
      assert.equal(editor.getText(), '前后');
      if (previous === next) assert.deepEqual(groupMarks(textNodes[0].marks), [next]);
      else {
        assert.deepEqual(groupMarks(textNodes[0].marks), [previous]);
        assert.deepEqual(groupMarks(textNodes[1].marks), [next]);
      }
    }
  }
});

test('changing one selected range preserves old combinations outside it and preserves links', () => {
  const source = '<p><strong><em>before</em></strong> <a href="https://example.com"><strong><u>target</u></strong></a> <strong><em>after</em></strong></p>';
  const instance = create(source);
  const editor = instance.rawEditor;
  assert.equal(instance.getMarkdown(), source, 'opening legacy data does not rewrite it');
  editor.commands.setTextSelection({ from: 8, to: 14 });
  editor.commands.setHighlight();
  const target = editor.state.doc.firstChild.child(2);
  assert.equal(target.text, 'target');
  assert.deepEqual(Array.from(target.marks, mark => mark.type.name), ['link', 'highlight']);
  assert.deepEqual(groupMarks(editor.state.doc.firstChild.firstChild.marks), ['bold', 'italic']);
  assert.deepEqual(groupMarks(editor.state.doc.firstChild.lastChild.marks), ['bold', 'italic']);
  assert.match(editor.getHTML(), /href="https:\/\/example.com"/);
});

test('one replacement is one undo step and redo restores only the new format', () => {
  const instance = create('**原文**');
  const editor = instance.rawEditor;
  editor.commands.setTextSelection({ from: 1, to: 3 });
  editor.commands.setHighlight();
  assert.equal(editor.getHTML(), '<p><mark>原文</mark></p>');
  editor.commands.undo();
  assert.equal(editor.getHTML(), '<p><strong>原文</strong></p>');
  editor.commands.redo();
  assert.equal(editor.getHTML(), '<p><mark>原文</mark></p>');
});

test('typed delimiter conversion may combine with existing formatting and supports native Backspace', () => {
  for (const [syntax, expected] of [
    ['==高亮==', 'highlight'], ['**加粗**', 'bold'], ['*斜体*', 'italic'],
    ['~~删除~~', 'strike'], ['`代码`', 'code'],
  ]) {
    const instance = create();
    const editor = instance.rawEditor;
    editor.commands.setUnderline();
    type(editor, syntax);
    const expectedMarks = expected === 'code' ? ['code'] : [expected, 'underline'];
    assert.deepEqual(groupMarks(editor.state.doc.firstChild.firstChild.marks).sort(), expectedMarks.sort(), syntax);
    assert.deepEqual(json(create(instance.getMarkdown()).rawEditor.getJSON()), json(editor.getJSON()));
    const backspace = new window.KeyboardEvent('keydown', { key: 'Backspace', keyCode: 8, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(backspace);
    assert.equal(backspace.defaultPrevented, true);
    assert.equal(editor.getText(), syntax);
    assert.deepEqual(groupMarks(editor.state.doc.firstChild.firstChild.marks), ['underline']);
  }
});

test('HTML and text clipboard paths both reload the same single-format content', () => {
  const instance = create('复制文字');
  const editor = instance.rawEditor;
  editor.commands.setTextSelection({ from: 1, to: 5 });
  for (const name of formats) {
    editor.commands.setMark(name, attrs(name));
    const markdown = instance.getMarkdown();
    const html = editor.getHTML();
    const converted = window.__htmlToMarkdown(html);
    const slice = editor.state.selection.content();
    const clipboardText = editor.view.someProp('clipboardTextSerializer', serialize => serialize(slice, editor.view));
    for (const copied of [markdown, converted, clipboardText]) {
      const reloaded = create(copied);
      // CSS serialization may normalize #hex into rgb(); rendered content must
      // be identical, not necessarily the spelling of a color attribute.
      assert.equal(reloaded.getHTML(), html, `${name}: ${copied}`);
    }
    const destination = create();
    paste(destination.rawEditor, 'text/html', html);
    assert.equal(destination.getHTML(), html, `${name}: rich HTML paste`);
    const plainDestination = create();
    paste(plainDestination.rawEditor, 'text/plain', clipboardText);
    assert.equal(plainDestination.getHTML(), html, `${name}: Markdown paste`);
  }
});

test('partial clipboard selection contains only the newest format and does not lose adjacent text', () => {
  const instance = create('0123456789');
  const editor = instance.rawEditor;
  editor.commands.setTextSelection({ from: 2, to: 5 });
  editor.commands.setBold();
  editor.commands.setHighlight();
  const copied = editor.view.serializeForClipboard(editor.state.selection.content());
  assert.equal(copied.text, '==123==');
  const destination = create();
  paste(destination.rawEditor, 'text/html', copied.dom.innerHTML);
  assert.equal(destination.getHTML(), '<p><mark>123</mark></p>');
  assert.equal(editor.getHTML(), '<p>0<mark>123</mark>456789</p>');
});

test('block types, alignment and invalid code-block operations are not changed', () => {
  const instance = create('<h2 style="text-align: center"><strong>标题</strong></h2>');
  const editor = instance.rawEditor;
  editor.commands.setTextSelection({ from: 1, to: 3 });
  editor.commands.setHighlight();
  assert.equal(editor.state.doc.firstChild.type.name, 'heading');
  assert.equal(editor.state.doc.firstChild.attrs.level, 2);
  assert.equal(editor.state.doc.firstChild.attrs.textAlign, 'center');
  assert.deepEqual(groupMarks(editor.state.doc.firstChild.firstChild.marks), ['highlight']);
  instance.setMarkdown('```\ncode\n```');
  editor.commands.setTextSelection({ from: 1, to: 5 });
  const before = json(editor.getJSON());
  assert.equal(editor.can().setHighlight(), false);
  assert.equal(editor.commands.setHighlight(), false);
  assert.deepEqual(json(editor.getJSON()), before);
});

test('explicit HTML and Markdown combinations survive paste; tool operations alone enforce single selection', () => {
  const source = '<p><strong><em>legacy</em></strong></p>';
  const instance = create(source);
  const editor = instance.rawEditor;
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  paste(editor, 'text/html', '<p><a href="https://example.com"><span style="color: red"><strong><em><mark>new</mark></em></strong></span></a></p>');
  const nodes = [];
  editor.state.doc.descendants(node => { if (node.isText) nodes.push(node); });
  assert.deepEqual(groupMarks(nodes[0].marks), ['bold', 'italic']);
  assert.equal(nodes[0].text, 'legacy');
  assert.deepEqual(groupMarks(nodes[1].marks), ['textStyle', 'bold', 'italic', 'highlight']);
  assert.equal(nodes[1].text, 'new');
  assert.equal(nodes[1].marks.some(mark => mark.type.name === 'link'), true);
  const markdownPaste = create();
  paste(markdownPaste.rawEditor, 'text/plain', '**==new==**');
  assert.deepEqual(groupMarks(markdownPaste.rawEditor.state.doc.firstChild.firstChild.marks), ['bold', 'highlight']);
  markdownPaste.rawEditor.commands.setTextSelection({ from: 1, to: 4 });
  const selectedCopy = markdownPaste.rawEditor.view.serializeForClipboard(markdownPaste.rawEditor.state.selection.content());
  assert.equal(create(selectedCopy.text).getHTML(), markdownPaste.getHTML());
  assert.equal(create(markdownPaste.getMarkdown()).getHTML(), markdownPaste.getHTML());
  markdownPaste.rawEditor.commands.setItalic();
  assert.equal(markdownPaste.getHTML(), '<p><em>new</em></p>');
});

test('clearing color or toggling the active format off does not enable an older format', () => {
  const instance = create('**text**');
  const editor = instance.rawEditor;
  editor.commands.setTextSelection({ from: 1, to: 5 });
  editor.commands.setColor('#fb464c');
  assert.deepEqual(groupMarks(editor.state.doc.firstChild.firstChild.marks), ['textStyle']);
  editor.commands.unsetColor();
  assert.deepEqual(groupMarks(editor.state.doc.firstChild.firstChild.marks), []);
  editor.commands.setHighlight();
  editor.commands.toggleHighlight();
  assert.deepEqual(groupMarks(editor.state.doc.firstChild.firstChild.marks), []);
});

test('formatting in a table changes only the selected cell and preserves columns after reload', () => {
  const instance = create('| A | B |\n| --- | --- |\n| x \\| y | z |');
  const editor = instance.rawEditor;
  let from;
  let to;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === 'x | y') { from = pos; to = pos + node.nodeSize; }
  });
  editor.commands.setTextSelection({ from, to });
  editor.commands.setBold();
  editor.commands.setHighlight();
  const reloaded = create(instance.getMarkdown());
  assert.deepEqual(json(reloaded.rawEditor.getJSON()), json(editor.getJSON()));
  const cells = reloaded.container.querySelectorAll('td');
  assert.equal(cells[0].textContent, 'x | y');
  assert.equal(cells[0].querySelector('mark').textContent, 'x | y');
  assert.equal(cells[0].querySelector('strong'), null);
  assert.equal(cells[1].innerHTML, '<p>z</p>');
});

test('native format keyboard shortcuts use the same single-format command path', () => {
  const instance = create('text');
  const editor = instance.rawEditor;
  editor.commands.setTextSelection({ from: 1, to: 5 });
  const shortcut = (key, shiftKey = false) => {
    const event = new window.KeyboardEvent('keydown', {
      key, code: 'Key' + key.toUpperCase(), keyCode: key.toUpperCase().charCodeAt(0),
      ctrlKey: true, shiftKey, bubbles: true, cancelable: true,
    });
    editor.view.dom.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  };
  shortcut('b');
  assert.equal(editor.getHTML(), '<p><strong>text</strong></p>');
  shortcut('H', true);
  assert.equal(editor.getHTML(), '<p><mark>text</mark></p>');
  shortcut('i');
  assert.equal(editor.getHTML(), '<p><em>text</em></p>');
});
