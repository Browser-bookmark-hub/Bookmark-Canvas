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
  window.document.querySelectorAll('.temp-canvas-node, .permanent-bookmark-section').forEach(card => window.__cleanupCanvasNodeTiptapInstances(card));
  runtime.close();
});
const waitForBlur = () => new Promise(resolve => setTimeout(resolve, 150));
const waitForFocus = () => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
function note(source = 'original') {
  const fixture = window.createTempDescriptionFixture({ id: `note-${window.document.querySelectorAll('.temp-canvas-node').length}`, descriptionMd: source });
  fixture.enterEditingDescription();
  fixture.descriptionText.__tiptapInstance.rawEditor.view.dom.focus();
  return fixture;
}
function focusOutside() {
  const button = window.document.createElement('button');
  window.document.body.append(button);
  button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  button.focus();
}

test('clicking outside commits a temporary note and destroys its editor', async () => {
  const fixture = note();
  fixture.descriptionText.__tiptapInstance.rawEditor.commands.insertContent('CHANGED');
  assert.equal(window.sectionSaves.length, 0);
  await waitForFocus();
  focusOutside();
  await waitForBlur();
  assert.equal(fixture.isEditing(), false);
  assert.equal(fixture.descEditorApi.isTiptapActive(), false);
  assert.equal(window.sectionSaves.length, 1);
  assert.match(window.sectionSaves[0].descriptionMd, /CHANGED/);
});

test('pressing Escape commits a temporary note safely and destroys its editor', () => {
  const fixture = note();
  fixture.descriptionText.__tiptapInstance.rawEditor.commands.insertContent('COMMITTED_ON_ESC');
  assert.equal(window.sectionSaves.length, 0);
  const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  fixture.descriptionText.dispatchEvent(event);
  assert.equal(fixture.isEditing(), false);
  assert.equal(fixture.descEditorApi.isTiptapActive(), false);
  assert.equal(window.sectionSaves.length, 1);
  assert.match(window.sectionSaves[0].descriptionMd, /COMMITTED_ON_ESC/);
});

test('toolbar focus is retained, but a later outside click commits even with an open popover', async () => {
  const fixture = note();
  fixture.descriptionText.__tiptapInstance.rawEditor.commands.insertContent('changed');
  await waitForFocus();
  const popover = window.document.createElement('div');
  popover.className = 'md-format-popover open';
  fixture.descriptionControls.append(popover);
  fixture.descriptionControls.querySelector('button').focus();
  await waitForBlur();
  assert.equal(fixture.isEditing(), true);
  fixture.descriptionText.__tiptapInstance.rawEditor.view.dom.focus();
  focusOutside();
  await waitForBlur();
  assert.equal(fixture.isEditing(), false);
  assert.equal(window.sectionSaves.length, 1);
});

test('opening and closing an unchanged disclosure note does not rewrite its source', () => {
  const source = '<details open><summary>Title</summary><p><strong>Body</strong></p></details>';
  const fixture = note(source);
  fixture.exitEditingDescription({ commit: true });
  assert.equal(fixture.section.descriptionMd, source);
  assert.equal(window.sectionSaves.length, 0);
  assert.ok(fixture.descriptionText.querySelector('details[open] strong'));
});

test('clearing a note stays cleared after blur and reload', async () => {
  const fixture = note();
  fixture.clearTempDescription();
  await waitForFocus();
  focusOutside();
  await waitForBlur();
  assert.equal(fixture.section.descriptionMd, '');
  assert.equal(window.sectionSaves.at(-1).descriptionMd, '');
  assert.equal(fixture.descriptionText.textContent, '');
});

test('virtualization commits a pending temporary draft before destroying the editor', () => {
  const fixture = note();
  const instance = fixture.descriptionText.__tiptapInstance;
  instance.rawEditor.commands.insertContent('saved');
  window.__cleanupCanvasNodeTiptapInstances(fixture.nodeElement, { commit: true });
  assert.equal(instance.isDestroyed, true);
  assert.equal(window.sectionSaves.length, 1);
  assert.match(window.sectionSaves[0].descriptionMd, /saved/);
});

test('deletion teardown destroys an editor without resurrecting it through a save', () => {
  const fixture = note();
  const instance = fixture.descriptionText.__tiptapInstance;
  instance.rawEditor.commands.insertContent('discard');
  window.__cleanupCanvasNodeTiptapInstances(fixture.nodeElement);
  assert.equal(instance.isDestroyed, true);
  assert.equal(window.sectionSaves.length, 0);
  assert.equal(fixture.nodeElement.__commitDescriptionEdit, null);
});

test('a nonfocusable canvas click commits a note even after focusing its toolbar', async () => {
  const fixture = note();
  fixture.descriptionText.__tiptapInstance.rawEditor.commands.insertContent('changed');
  await waitForFocus();
  fixture.descriptionControls.querySelector('button').focus();
  await waitForBlur();
  const canvas = window.document.createElement('div');
  window.document.body.append(canvas);
  canvas.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  await waitForBlur();
  assert.equal(fixture.isEditing(), false);
  assert.equal(window.sectionSaves.length, 1);
});

test('virtualized permanent cards remove document listeners on every teardown', () => {
  const active = new Set();
  const add = window.document.addEventListener;
  const remove = window.document.removeEventListener;
  window.document.addEventListener = function(type, listener, options) {
    if (type === 'mousedown' && listener.name === 'onPermanentDocMouseDown') active.add(listener);
    return add.call(this, type, listener, options);
  };
  window.document.removeEventListener = function(type, listener, options) {
    if (type === 'mousedown') active.delete(listener);
    return remove.call(this, type, listener, options);
  };
  try {
    for (let i = 0; i < 5; i++) {
      const card = window.document.createElement('div');
      card.className = 'permanent-bookmark-section';
      card.id = `permanent-section-copy-${i}`;
      card.innerHTML = '<div class="permanent-section-tip-container"><div class="permanent-section-tip"></div><div class="permanent-section-tip-controls"><button class="permanent-section-tip-close"></button></div></div>';
      window.document.body.append(card);
      window.bindPermanentSectionTipBehavior(card);
      assert.equal(active.size, 1);
      window.__cleanupCanvasNodeTiptapInstances(card);
      card.remove();
      assert.equal(active.size, 0);
      assert.equal(card.__permanentTipDocMouseDown, null);
    }
  } finally {
    window.document.addEventListener = add;
    window.document.removeEventListener = remove;
  }
});

test('permanent notes retain rich disclosures when edited and committed', () => {
  const card = window.document.createElement('div');
  card.className = 'permanent-bookmark-section';
  card.innerHTML = '<div class="permanent-section-tip-container"><div class="permanent-section-tip"></div><div class="permanent-section-tip-controls"><button class="permanent-section-tip-close"></button></div></div>';
  window.document.body.append(card);
  window.localStorage.setItem('test-main-tip', '<details open><summary>Title</summary><p><strong>Body</strong></p></details>');
  window.bindPermanentSectionTipBehavior(card);
  const text = card.querySelector('.permanent-section-tip');
  text.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  const instance = text.__tiptapInstance;
  assert.ok(instance);
  instance.rawEditor.commands.insertContentAt(instance.rawEditor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: 'After' }] });
  window.__cleanupCanvasNodeTiptapInstances(card, { commit: true });
  const source = window.localStorage.getItem('test-main-tip');
  assert.match(source, /<details open(?:="")?>/);
  assert.match(source, /<strong>Body<\/strong>/);
  assert.match(source, /After/);
  assert.equal(instance.isDestroyed, true);
});
