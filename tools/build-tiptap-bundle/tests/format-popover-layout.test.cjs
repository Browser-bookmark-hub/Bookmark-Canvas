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
  window.document.querySelectorAll('.md-canvas-node, .temp-canvas-node, .permanent-bookmark-section')
    .forEach(card => window.__cleanupCanvasNodeTiptapInstances(card));
  runtime.close();
});
const frames = () => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
const rect = (left, top, width, height) => ({ left, right: left + width, top, bottom: top + height, width, height });
function click(button) {
  assert.ok(button);
  button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  button.click();
}
function nativeLayer(pop) {
  const matches = pop.matches.bind(pop);
  let opened = false;
  pop.showPopover = () => { opened = true; };
  pop.hidePopover = () => { opened = false; };
  pop.matches = selector => selector === ':popover-open' ? opened : matches(selector);
  return () => opened;
}
function fixture(kind = 'blank') {
  if (kind === 'blank') {
    const { element: card } = window.createBlankFixture();
    card.classList.add('canvas-node-maximized');
    card.__enterEditMode();
    return { card, editor: card.querySelector('.md-canvas-editor'), toolbar: card.querySelector('.md-node-toolbar') };
  }
  if (kind === 'temporary') {
    const f = window.createTempDescriptionFixture({ id: 'layout-temp', descriptionMd: 'note' });
    f.nodeElement.classList.add('canvas-node-maximized');
    f.enterEditingDescription();
    return { card: f.nodeElement, editor: f.descriptionText, toolbar: f.descriptionControls };
  }
  const card = window.document.createElement('div');
  card.className = 'permanent-bookmark-section canvas-node-maximized';
  if (kind === 'copy') card.dataset.permanentSectionCopyId = 'layout-copy';
  card.innerHTML = '<div class="permanent-section-tip-container"><div class="permanent-section-tip"></div><div class="permanent-section-tip-controls"><button class="permanent-section-tip-close"></button></div></div>';
  window.document.body.append(card);
  window.bindPermanentSectionTipBehavior(card);
  const editor = card.querySelector('.permanent-section-tip');
  editor.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  return { card, editor, toolbar: card.querySelector('.permanent-section-tip-controls') };
}

for (const kind of ['blank', 'temporary', 'permanent', 'copy']) {
  test(`${kind}: fullscreen format toolbar can open, format text, close and reopen without replacing the editor`, () => {
    const { card, editor } = fixture(kind);
    assert.equal(card.querySelector('.md-format-popover'), null, 'fullscreen does not introduce auto-opening');
    const instance = editor.__tiptapInstance;
    click(card.querySelector('[data-action="md-format-toggle"]'));
    const pop = card.querySelector('.md-format-popover');
    const isTopLayer = nativeLayer(pop);
    pop.__formatLayout.open();
    assert.equal(pop.classList.contains('open'), true);
    assert.equal(isTopLayer(), true);
    assert.equal(pop.getAttribute('popover'), 'manual');
    click(pop.querySelector('[data-action="md-insert-bold"]'));
    assert.equal(instance.isActive('bold'), true);
    assert.ok(editor.__tiptapInstance === instance);
    click(pop.querySelector('[data-action="md-format-close"]'));
    assert.equal(isTopLayer(), false);
    assert.equal(pop.classList.contains('open'), false);
    click(card.querySelector('[data-action="md-format-toggle"]'));
    assert.equal(isTopLayer(), true);
    assert.ok(editor.__tiptapInstance === instance);
  });
}

function measuredLayout() {
  const workspace = window.document.createElement('div');
  workspace.id = 'canvasWorkspace';
  window.document.body.append(workspace);
  let bounds = rect(160, 40, 760, 600);
  workspace.getBoundingClientRect = () => bounds;
  const f = fixture('temporary');
  click(f.card.querySelector('[data-action="md-format-toggle"]'));
  const pop = f.card.querySelector('.md-format-popover');
  const row = pop.querySelector('.md-format-row');
  const isTopLayer = nativeLayer(pop);
  Object.defineProperty(pop, 'offsetWidth', { configurable: true, get: () => Math.min(
    pop.dataset.density === 'compact' ? 440 : 500,
    parseFloat(pop.style.maxWidth) || 500,
  ) });
  Object.defineProperty(pop, 'offsetHeight', { get: () => row.style.flexWrap === 'wrap' ? 68 : 34 });
  pop.getBoundingClientRect = () => rect(0, 0, pop.offsetWidth, pop.offsetHeight);
  f.card.querySelector('.temp-node-description-container').getBoundingClientRect = () => rect(180, 80, 260, 50);
  pop.__formatLayout.open();
  return { ...f, pop, row, workspace, isTopLayer, setBounds: value => { bounds = value; } };
}

test('measured workspace width switches normal/compact density and wraps only below the 80% limit', () => {
  const { pop, row, setBounds } = measuredLayout();
  assert.equal(pop.dataset.density, 'normal');
  assert.equal(pop.style.transform, 'scale(1)');
  assert.equal(row.style.flexWrap, 'nowrap');
  setBounds(rect(160, 40, 450, 600));
  pop.__formatLayout.update();
  assert.equal(pop.dataset.density, 'compact');
  assert.equal(pop.style.transform, `scale(${434 / 440})`);
  assert.equal(row.style.flexWrap, 'nowrap');
  setBounds(rect(160, 40, 300, 600));
  pop.__formatLayout.update();
  assert.equal(pop.style.transform, 'scale(0.8)');
  assert.equal(row.style.flexWrap, 'wrap');
  assert.equal(parseFloat(pop.style.left), 168);
  assert.equal(parseFloat(pop.style.maxWidth) * 0.8, 284);
  assert.equal(parseFloat(pop.style.top), 136, 'fullscreen note prefers below its anchor');
  setBounds(rect(160, 40, 760, 600));
  pop.__formatLayout.update();
  assert.equal(pop.dataset.density, 'normal');
  assert.equal(row.style.flexWrap, 'nowrap');
});

test('compact button sizing is measured before wrapping, keeping the close button on one line', () => {
  const { pop, row, setBounds } = measuredLayout();
  Object.defineProperty(pop, 'offsetWidth', { get: () => Math.min(
    pop.dataset.density === 'compact' ? 350 : 410,
    parseFloat(pop.style.maxWidth) || 410,
  ) });
  setBounds(rect(160, 40, 300, 600));
  for (let i = 0; i < 3; i++) {
    pop.__formatLayout.update();
    assert.equal(pop.dataset.density, 'compact');
    assert.equal(row.style.flexWrap, 'nowrap');
    assert.equal(pop.style.transform, `scale(${284 / 350})`);
  }
  assert.ok(pop.querySelector('[data-action="md-format-close"]'));
  setBounds(rect(160, 40, 760, 600));
  pop.__formatLayout.update();
  assert.equal(pop.dataset.density, 'normal');
  assert.equal(pop.style.transform, 'scale(1)');
});

test('fullscreen switching and resizing recompute bounds without changing the selection or content', async () => {
  const { card, editor, pop, setBounds } = measuredLayout();
  const state = editor.__tiptapInstance.rawEditor.state;
  card.querySelector('.temp-node-description-container').getBoundingClientRect = () => rect(180, 120, 260, 50);
  card.classList.remove('canvas-node-maximized');
  window.dispatchEvent(new window.CustomEvent('canvas-maximized-state-change'));
  await frames();
  assert.equal(parseFloat(pop.style.top), 80, 'normal note fits above its anchor');
  setBounds(rect(160, 40, 300, 600));
  window.dispatchEvent(new window.Event('resize'));
  await frames();
  assert.equal(pop.dataset.density, 'compact');
  assert.ok(editor.__tiptapInstance.rawEditor.state.doc === state.doc);
  assert.ok(editor.__tiptapInstance.rawEditor.state.selection.eq(state.selection));
  assert.equal(window.sectionSaves.length, 0);
});

test('layout compensates inherited CSS zoom without changing the card zoom setting', () => {
  const { card, pop } = measuredLayout();
  card.style.setProperty('--canvas-node-layout-zoom', '1.3');
  pop.getBoundingClientRect = () => rect(0, 0, pop.offsetWidth * 1.3, pop.offsetHeight * 1.3);
  pop.__formatLayout.update();
  assert.ok(Math.abs(Number(pop.style.zoom) - 1 / 1.3) < 0.0001);
  assert.equal(card.style.getPropertyValue('--canvas-node-layout-zoom'), '1.3');
});

test('native popover and layout listeners are removed on close and teardown', async () => {
  const { card, pop, isTopLayer, setBounds } = measuredLayout();
  click(pop.querySelector('[data-action="md-format-close"]'));
  assert.equal(isTopLayer(), false);
  const previous = pop.style.cssText;
  setBounds(rect(160, 40, 300, 600));
  window.dispatchEvent(new window.Event('resize'));
  await frames();
  assert.equal(pop.style.cssText, previous);
  click(card.querySelector('[data-action="md-format-toggle"]'));
  assert.equal(isTopLayer(), true);
  assert.equal(pop.dataset.density, 'compact');
  window.__cleanupCanvasNodeTiptapInstances(card);
  assert.equal(isTopLayer(), false);
  assert.equal(pop.classList.contains('open'), false);
});

test('removing the owning card closes the native layer even without an explicit teardown', async () => {
  const { card, pop, isTopLayer } = measuredLayout();
  assert.equal(isTopLayer(), true);
  card.remove();
  await Promise.resolve();
  assert.equal(isTopLayer(), false);
  const previous = pop.style.cssText;
  window.dispatchEvent(new window.Event('resize'));
  await frames();
  assert.equal(pop.style.cssText, previous);
});

test('older engines retain DOM-local positioning rather than viewport coordinates inside a transformed toolbar', () => {
  const { pop, toolbar, setBounds } = measuredLayout();
  pop.__formatLayout.close();
  delete pop.showPopover;
  Object.defineProperty(toolbar, 'offsetWidth', { value: 200 });
  toolbar.getBoundingClientRect = () => rect(120, 20, 400, 80);
  setBounds(rect(160, 40, 300, 600));
  pop.__formatLayout.open();
  assert.equal(pop.style.position, 'absolute');
  assert.equal(parseFloat(pop.style.left), 24);
  assert.equal(parseFloat(pop.style.top), 58);
});

test('submenu coordinates account for the scaled parent and stay within the workspace', () => {
  const { pop, workspace } = measuredLayout();
  workspace.getBoundingClientRect = () => rect(160, 40, 300, 600);
  pop.getBoundingClientRect = () => rect(168, 120, 400, 28);
  const submenu = window.document.createElement('div');
  Object.defineProperty(submenu, 'offsetWidth', { value: 120 });
  Object.defineProperty(submenu, 'offsetHeight', { value: 40 });
  pop.append(submenu);
  const button = pop.querySelector('button');
  button.getBoundingClientRect = () => rect(170, 124, 20, 20);
  window.__positionCanvasFormatSubmenu(submenu, button, pop);
  assert.equal(submenu.classList.contains('open'), false);
  const center = 168 + parseFloat(submenu.style.left) * 0.8;
  assert.ok(center - 120 * 0.8 / 2 >= 168);
});

test('ResizeObserver follows workspace size changes and disconnects when the toolbar closes', async () => {
  const observers = [];
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); }
    disconnect() { this.targets.clear(); }
  };
  const { card, pop, workspace, setBounds } = measuredLayout();
  const observer = observers.find(item => item.targets.has(workspace));
  assert.ok(observer, 'workspace is observed, not just window resize');
  setBounds(rect(160, 40, 300, 600));
  observer.callback();
  await frames();
  assert.equal(pop.dataset.density, 'compact');
  click(card.querySelector('[data-action="md-format-close"]'));
  assert.ok(observers.every(item => item.targets.size === 0));
});

for (const kind of ['blank', 'temporary', 'permanent', 'copy']) {
  test(`${kind}: teardown also removes the external font palette and its native layer`, () => {
    const { card } = fixture(kind);
    click(card.querySelector('[data-action="md-format-toggle"]'));
    const button = card.querySelector('[data-action="md-fontcolor-toggle"]');
    click(button);
    const palette = window.document.querySelector('.md-fontcolor-popover.open');
    const isTopLayer = nativeLayer(palette);
    window.__positionCanvasFloatingPopoverAboveButton(palette, button);
    assert.equal(isTopLayer(), true);
    window.__cleanupCanvasNodeTiptapInstances(card);
    assert.equal(isTopLayer(), false);
    assert.equal(palette.isConnected, false);
  });
}
