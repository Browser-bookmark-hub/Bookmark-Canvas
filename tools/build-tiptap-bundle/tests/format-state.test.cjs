const assert = require('node:assert/strict');
const { beforeEach, afterEach, test } = require('node:test');
const loadCanvasRuntime = require('./helpers/load-canvas-runtime.cjs');

let runtime;
let window;
beforeEach(() => {
  runtime = loadCanvasRuntime();
  window = runtime.window;
});
afterEach(() => {
  window.document.querySelectorAll('.md-canvas-node').forEach(card => window.__cleanupMdNodeElementLifecycle(card));
  window.document.querySelectorAll('.temp-canvas-node, .permanent-bookmark-section').forEach(card => window.__cleanupCanvasNodeTiptapInstances(card));
  runtime.close();
});

function createFixture(kind, source = '') {
  if (kind === 'blank') {
    const { element } = window.createBlankFixture(source);
    element.__enterEditMode();
    return { card: element, instance: element.__tiptapInstance };
  }
  if (kind === 'temporary') {
    const fixture = window.createTempDescriptionFixture({ id: 'temp-format', descriptionMd: source });
    fixture.enterEditingDescription();
    return { card: fixture.nodeElement, instance: fixture.descriptionText.__tiptapInstance };
  }
  const card = window.document.createElement('div');
  card.className = 'permanent-bookmark-section';
  if (kind === 'copy') card.dataset.permanentSectionCopyId = 'format-copy';
  const key = kind === 'copy' ? 'test-copy-tip:format-copy' : 'test-main-tip';
  window.localStorage.setItem(key, source);
  card.innerHTML = '<div class="permanent-section-tip-container"><div class="permanent-section-tip"></div><div class="permanent-section-tip-controls"><button class="permanent-section-tip-close"></button></div></div>';
  window.document.body.append(card);
  window.bindPermanentSectionTipBehavior(card);
  const text = card.querySelector('.permanent-section-tip');
  text.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  return { card, instance: text.__tiptapInstance };
}
function click(button) {
  assert.ok(button, 'button exists');
  button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  button.click();
}
function assertActive(button, expected) {
  assert.equal(button.dataset.formatActive, String(expected));
  assert.equal(button.getAttribute('aria-pressed'), String(expected));
}
function type(editor, text) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, character));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(character));
  }
}

for (const kind of ['blank', 'temporary', 'permanent', 'copy']) {
  test(`${kind}: clicking a format button stays highlighted after mouseout and toggles off`, () => {
    const { card, instance } = createFixture(kind);
    const editor = instance.rawEditor;
    for (const [action, mark] of [
      ['md-insert-bold', 'bold'], ['md-insert-italic', 'italic'],
      ['md-insert-underline', 'underline'], ['md-insert-highlight', 'highlight'],
      ['md-insert-strike', 'strike'], ['md-insert-code', 'code'],
    ]) {
      const button = card.querySelector(`[data-action="${action}"]`);
      assertActive(button, false);
      click(button);
      button.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));
      assertActive(button, true);
      assert.equal(instance.isActive(mark), true);
      // A pending mark is UI/input state, not a document modification.
      assert.equal(editor.getText(), '');
      click(button);
      assertActive(button, false);
      assert.equal(instance.isActive(mark), false);
    }
  });

  test(`${kind}: stored-mark-only transactions synchronize without moving the cursor`, () => {
    const { card, instance } = createFixture(kind);
    const editor = instance.rawEditor;
    const button = card.querySelector('[data-action="md-insert-highlight"]');
    let selectionEvents = 0;
    editor.on('selectionUpdate', () => { selectionEvents++; });
    editor.commands.toggleHighlight();
    assert.equal(selectionEvents, 0);
    assertActive(button, true);
    editor.commands.toggleHighlight();
    assertActive(button, false);
    assert.equal(window.sectionSaves.length + window.tipSaves.length + window.manifestSaves.length, 0);
  });

  test(`${kind}: selecting a new inline tool turns off the old one in both UI and document`, () => {
    const { card, instance } = createFixture(kind, '文字');
    const editor = instance.rawEditor;
    editor.commands.setTextSelection({ from: 1, to: 3 });
    const bold = card.querySelector('[data-action="md-insert-bold"]');
    const highlight = card.querySelector('[data-action="md-insert-highlight"]');
    const italic = card.querySelector('[data-action="md-insert-italic"]');
    click(bold);
    assertActive(bold, true);
    click(highlight);
    assertActive(bold, false);
    assertActive(highlight, true);
    assert.equal(editor.getHTML(), '<p><mark>文字</mark></p>');
    click(italic);
    assertActive(highlight, false);
    assertActive(italic, true);
    assert.equal(editor.getHTML(), '<p><em>文字</em></p>');
    const copied = editor.view.serializeForClipboard(editor.state.selection.content());
    assert.equal(window.CanvasTiptapEngine.renderStaticHTML(copied.text), '<p><em>文字</em></p>');
    if (kind === 'blank') card.__exitEditMode();
    else card.__commitDescriptionEdit();
    const stored = kind === 'blank'
      ? runtime.run(`CanvasState.mdNodes.find(node => node.id === ${JSON.stringify(card.id)}).text`)
      : kind === 'temporary'
        ? window.sectionSaves.at(-1).descriptionMd
        : window.localStorage.getItem(kind === 'copy' ? 'test-copy-tip:format-copy' : 'test-main-tip');
    assert.equal(window.CanvasTiptapEngine.renderStaticHTML(stored), '<p><em>文字</em></p>');
  });
}

test('typed syntax uses recognized editor state: incomplete delimiters never turn on a button', () => {
  const { card, instance } = createFixture('temporary');
  const editor = instance.rawEditor;
  const button = card.querySelector('[data-action="md-insert-highlight"]');
  type(editor, '==高亮');
  assertActive(button, false);
  type(editor, '==');
  assert.equal(editor.getHTML(), '<p><mark>高亮</mark></p>');
  assertActive(button, false); // closed Markdown mark does not affect next input
  editor.commands.setTextSelection(2);
  assertActive(button, true);
  editor.commands.setTextSelection(3);
  type(editor, '内');
  assertActive(button, true);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.unsetHighlight();
  assertActive(button, false);
});

test('undo/redo of formatting updates the button even if the selection does not change', () => {
  const { card, instance } = createFixture('temporary', 'text');
  const editor = instance.rawEditor;
  const button = card.querySelector('[data-action="md-insert-bold"]');
  editor.commands.setTextSelection({ from: 1, to: 5 });
  editor.commands.toggleBold();
  assertActive(button, true);
  editor.commands.undo();
  assertActive(button, false);
  editor.commands.redo();
  assertActive(button, true);
});

test('an explicit empty pending-mark set must not inherit the highlighted text on its left', () => {
  const { card, instance } = createFixture('temporary', '==marked==');
  const editor = instance.rawEditor;
  const button = card.querySelector('[data-action="md-insert-highlight"]');
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  assertActive(button, true);
  editor.commands.unsetHighlight();
  assertActive(button, false);
  type(editor, '普通');
  assert.equal(editor.getHTML(), '<p><mark>marked</mark>普通</p>');
  assertActive(button, false);
});

test('heading/list/alignment state remains visible after their menus close', () => {
  const { card, instance } = createFixture('temporary', 'text');
  const editor = instance.rawEditor;
  const heading = card.querySelector('[data-action="md-heading-toggle"]');
  assertActive(heading, false);
  click(heading);
  assert.equal(heading.classList.contains('active'), true); // menu is open
  assertActive(heading, false); // opening a menu did not apply a heading
  click(card.querySelector('[data-action="md-heading-apply"][data-level="h2"]'));
  assert.equal(heading.classList.contains('active'), false);
  assertActive(heading, true);
  click(heading);
  assertActive(card.querySelector('[data-action="md-heading-apply"][data-level="h2"]'), true);
  click(heading);
  editor.commands.setParagraph();
  assertActive(heading, false);
  const list = card.querySelector('[data-action="md-list-toggle"]');
  click(list);
  click(card.querySelector('[data-action="md-list-apply"][data-type="task"]'));
  assert.equal(list.classList.contains('active'), false);
  assertActive(list, true);
  const align = card.querySelector('[data-action="md-align-toggle"]');
  click(align);
  click(card.querySelector('[data-action="md-align-apply"][data-align="center"]'));
  assert.equal(align.classList.contains('active'), false);
  assertActive(align, true);
  editor.commands.setTextAlign('left');
  assertActive(align, false);
});

test('first menu opening initializes its options from already applied formats', () => {
  const { card, instance } = createFixture('temporary', '## Heading');
  click(card.querySelector('[data-action="md-heading-toggle"]'));
  assertActive(card.querySelector('[data-action="md-heading-apply"][data-level="h2"]'), true);
  instance.rawEditor.commands.setParagraph();
  instance.rawEditor.commands.setTextAlign('right');
  click(card.querySelector('[data-action="md-align-toggle"]'));
  assertActive(card.querySelector('[data-action="md-align-apply"][data-align="right"]'), true);
});

test('font color indicator uses the effective mark, not the open palette or last clicked swatch', () => {
  const { card, instance } = createFixture('temporary', 'text');
  const editor = instance.rawEditor;
  const button = card.querySelector('[data-action="md-fontcolor-toggle"]');
  assertActive(button, false);
  click(button);
  assertActive(button, false);
  const palette = window.document.querySelector('.md-fontcolor-popover.open');
  click(palette.querySelector('[data-action="md-fontcolor-apply"][data-color="#fb464c"]'));
  assert.equal(button.classList.contains('active'), false);
  assertActive(button, true);
  editor.commands.unsetColor();
  assertActive(button, false);
});
