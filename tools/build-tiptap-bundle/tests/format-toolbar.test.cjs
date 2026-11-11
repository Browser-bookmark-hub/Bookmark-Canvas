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
function click(button) {
  assert.ok(button, 'toolbar button exists');
  button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  button.click();
}
const popover = element => element.querySelector('.md-format-popover');
const toggle = element => element.querySelector('[data-action="md-format-toggle"]');

for (const selected of [false, true]) {
  test(`blank first format click opens once from ${selected ? 'selected' : 'observation'} state`, () => {
    const { node, element } = window.createBlankFixture();
    if (selected) window.selectMdNode(node.id);
    assert.equal(node.isEditing, undefined);
    assert.equal(element.__tiptapInstance, undefined);
    assert.equal(popover(element), null);
    click(toggle(element));
    assert.equal(node.isEditing, true);
    assert.equal(popover(element).classList.contains('open'), true);
    assert.equal(toggle(element).classList.contains('active'), true);
    assert.ok(element.__tiptapInstance);
    const instance = element.__tiptapInstance;
    click(toggle(element));
    assert.equal(popover(element).classList.contains('open'), false);
    click(toggle(element));
    assert.equal(popover(element).classList.contains('open'), true);
    assert.equal(element.__tiptapInstance, instance);
    element.__exitEditMode();
    click(toggle(element));
    assert.equal(popover(element).classList.contains('open'), true);
    assert.notEqual(element.__tiptapInstance, instance);
  });
}

test('blank entry still auto-opens and the close button closes without toggling back', () => {
  const { element } = window.createBlankFixture();
  element.__enterEditMode();
  assert.equal(popover(element).classList.contains('open'), true);
  click(element.querySelector('[data-action="md-format-close"]'));
  assert.equal(popover(element).classList.contains('open'), false);
});

test('temporary note auto-opens on edit, then manual toggling works on the first click', () => {
  const fixture = window.createTempDescriptionFixture({ id: 'temp-toolbar', descriptionMd: 'note' });
  assert.equal(popover(fixture.nodeElement), null);
  fixture.enterEditingDescription();
  assert.equal(popover(fixture.nodeElement).classList.contains('open'), true);
  click(toggle(fixture.nodeElement));
  assert.equal(popover(fixture.nodeElement).classList.contains('open'), false);
  click(toggle(fixture.nodeElement));
  assert.equal(popover(fixture.nodeElement).classList.contains('open'), true);
  fixture.descEditorApi.openFormatPopover();
  assert.equal(popover(fixture.nodeElement).classList.contains('open'), true);
  click(fixture.nodeElement.querySelector('[data-action="md-format-close"]'));
  assert.equal(popover(fixture.nodeElement).classList.contains('open'), false);
  fixture.exitEditingDescription({ commit: true });
  fixture.enterEditingDescription();
  assert.equal(popover(fixture.nodeElement).classList.contains('open'), true);
  assert.equal(window.sectionSaves.length, 0);
});

test('permanent note auto-opens on edit and supports closing and reopening', () => {
  const card = window.document.createElement('div');
  card.className = 'permanent-bookmark-section';
  card.innerHTML = '<div class="permanent-section-tip-container"><div class="permanent-section-tip"></div><div class="permanent-section-tip-controls"><button class="permanent-section-tip-close"></button></div></div>';
  window.document.body.append(card);
  window.bindPermanentSectionTipBehavior(card);
  card.querySelector('.permanent-section-tip').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  assert.equal(popover(card).classList.contains('open'), true);
  click(toggle(card));
  assert.equal(popover(card).classList.contains('open'), false);
  click(toggle(card));
  assert.equal(popover(card).classList.contains('open'), true);
  window.__cleanupCanvasNodeTiptapInstances(card, { commit: true });
  assert.equal(popover(card).classList.contains('open'), false);
});

test('fullscreen temporary note stays manual and does not auto-open its format popover', () => {
  const fixture = window.createTempDescriptionFixture({ id: 'temp-fullscreen-toolbar', descriptionMd: 'note' });
  fixture.nodeElement.classList.add('canvas-node-maximized');
  fixture.enterEditingDescription();
  assert.equal(popover(fixture.nodeElement), null);
  click(toggle(fixture.nodeElement));
  assert.equal(popover(fixture.nodeElement).classList.contains('open'), true);
});
