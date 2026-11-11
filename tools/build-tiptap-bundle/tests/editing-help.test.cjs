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

function createFixture(kind, source = 'original') {
  if (kind === 'blank') {
    const { element: card } = window.createBlankFixture(source);
    card.__enterEditMode();
    return { card, instance: card.__tiptapInstance, commit: () => card.__exitEditMode() };
  }
  if (kind === 'temporary') {
    const fixture = window.createTempDescriptionFixture({ id: 'temp-help', descriptionMd: source });
    fixture.enterEditingDescription();
    return { card: fixture.nodeElement, instance: fixture.descriptionText.__tiptapInstance, commit: () => fixture.exitEditingDescription({ commit: true }) };
  }
  const card = window.document.createElement('div');
  card.className = 'permanent-bookmark-section';
  if (kind === 'copy') card.dataset.permanentSectionCopyId = 'help-copy';
  window.localStorage.setItem(kind === 'copy' ? 'test-copy-tip:help-copy' : 'test-main-tip', source);
  card.innerHTML = '<div class="permanent-section-tip-container"><div class="permanent-section-tip"></div><div class="permanent-section-tip-controls"><button class="permanent-section-tip-close"></button></div></div>';
  window.document.body.append(card);
  window.bindPermanentSectionTipBehavior(card);
  card.querySelector('.permanent-section-tip').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  return { card, instance: card.querySelector('.permanent-section-tip').__tiptapInstance, commit: () => card.__commitDescriptionEdit() };
}
function click(button) {
  button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
}
function key(target, options = {}) {
  const event = new window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
const helpButton = card => card.querySelector('[data-action="md-editing-help"]');
const panel = () => window.document.querySelector('.md-editing-help-popover');
const frames = () => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
const blurDelay = () => new Promise(resolve => setTimeout(resolve, 150));
const saves = () => window.sectionSaves.length + window.tipSaves.length + window.manifestSaves.length;

for (const kind of ['blank', 'temporary', 'permanent', 'copy']) {
  test(`${kind}: help sits next to close and does not change selection, pending formats or source`, async () => {
    const { card, instance, commit } = createFixture(kind);
    await frames();
    const button = helpButton(card);
    assert.equal(button.nextElementSibling.dataset.action, 'md-format-close');
    assert.equal(button.getAttribute('aria-label'), '编辑说明');
    const editor = instance.rawEditor;
    for (const selected of [false, true]) {
      editor.commands.setTextSelection(selected ? { from: 1, to: 4 } : 3);
      if (!selected) editor.commands.setBold();
      const { doc, selection, storedMarks } = editor.state;
      const source = instance.getMarkdown();
      click(button);
      assert.equal(button.getAttribute('aria-expanded'), 'true');
      assert.equal(button.getAttribute('aria-controls'), panel().id);
      assert.equal(panel().getAttribute('aria-modal'), 'false');
      assert.doesNotMatch(panel().textContent, /普通输入按钮|边界普通/);
      assert.equal(panel().querySelector('h3').textContent, '编辑说明');
      assert.equal(panel().querySelector('table'), null);
      assert.deepEqual(Array.from(panel().querySelectorAll('li:not(.md-editing-help-plain-row)'), row => [
        row.querySelector('.md-editing-help-label').textContent,
        row.querySelector('kbd').textContent,
        row.querySelector('code').textContent,
      ]), [
        ['加粗', 'Ctrl/Cmd+B', '**文字**'], ['斜体', 'Ctrl/Cmd+I', '*文字*'],
        ['下划线', 'Ctrl/Cmd+U', '<u>文字</u>'], ['高亮', 'Ctrl/Cmd+Shift+H', '==文字=='],
        ['行内代码', 'Ctrl/Cmd+E', '`文字`'],
      ]);
      const plain = panel().querySelector('.md-editing-help-plain-row');
      assert.deepEqual(Array.from(plain.querySelectorAll('kbd'), key => key.textContent), ['Ctrl/Cmd+\\', '→']);
      assert.equal(plain.children[1].textContent, 'Ctrl/Cmd+\\');
      assert.equal(plain.children[2].className, 'md-editing-help-syntax-slot');
      assert.equal(plain.querySelector('.md-editing-help-syntax-slot kbd').textContent, '→');
      assert.equal(panel().querySelectorAll('li > .md-editing-help-syntax-slot').length, 6);
      assert.equal(plain.querySelector('.md-editing-help-condition').textContent, '片段末尾');
      assert.equal(panel().querySelector('code u'), null, 'syntax examples stay literal, not live HTML');
      assert.equal(panel().querySelector('.md-editing-help-note'), null);
      assert.equal(panel().querySelectorAll('.md-editing-help-plain-typing').length, 1);
      assert.equal(panel().querySelector('.md-editing-help-plain-typing').textContent, '恢复普通输入');
      assert.doesNotMatch(panel().textContent, /取消格式粘连/);
      assert.doesNotMatch(panel().textContent, /Ctrl：Windows\/Linux|需不选中文字，已有文字不变/);
      assert.doesNotMatch(panel().textContent, /格式粘连怎么办/);
      assert.doesNotMatch(panel().textContent, /Esc 可能取消编辑|双空格/);
      assert.doesNotMatch(panel().textContent, /格式按钮作用于|行内格式工具默认单选|再点已启用的格式按钮|默认字体颜色|粘贴和导入|关闭工具窗只/);
      click(panel());
      panel().focus();
      await blurDelay();
      assert.equal(instance.isDestroyed, false);
      const event = key(panel());
      assert.equal(event.defaultPrevented, true);
      assert.equal(panel(), null);
      assert.ok(window.document.activeElement === button);
      assert.ok(editor.state.doc === doc);
      assert.ok(editor.state.selection.eq(selection));
      assert.ok(editor.state.storedMarks === storedMarks);
      assert.equal(instance.getMarkdown(), source);
      assert.equal(saves(), 0);
    }
    commit();
    assert.equal(saves(), 0);
  });

  test(`${kind}: closing the toolbar and tearing down remove help without ending editing early`, async () => {
    const { card, instance } = createFixture(kind);
    click(helpButton(card));
    click(card.querySelector('[data-action="md-format-close"]'));
    assert.equal(panel(), null);
    assert.equal(instance.isDestroyed, false);
    click(card.querySelector('[data-action="md-format-toggle"]'));
    click(helpButton(card));
    window.__cleanupCanvasNodeTiptapInstances(card);
    assert.equal(panel(), null);
    assert.equal(instance.isDestroyed, true);
    await frames();
    assert.equal(panel(), null);
    assert.equal(saves(), 0);
  });

  test(`${kind}: an outside nonfocusable click still commits after focusing help`, async () => {
    const { card, instance } = createFixture(kind);
    instance.rawEditor.commands.insertContent('CHANGED');
    await frames();
    click(helpButton(card));
    panel().focus();
    await blurDelay();
    assert.equal(instance.isDestroyed, false);
    const outside = window.document.createElement('div');
    window.document.body.append(outside);
    click(outside);
    await blurDelay();
    assert.equal(panel(), null);
    assert.equal(instance.isDestroyed, true);
    assert.ok(saves() > 0);
    const source = kind === 'blank'
      ? runtime.run('CanvasState.mdNodes[0].text')
      : kind === 'temporary'
        ? window.sectionSaves.at(-1).descriptionMd
        : window.localStorage.getItem(kind === 'copy' ? 'test-copy-tip:help-copy' : 'test-main-tip');
    assert.match(source, /CHANGED/);
  });

  test(`${kind}: keyboard focus leaving help commits without stealing outside focus`, async () => {
    const { card, instance } = createFixture(kind);
    await frames();
    click(helpButton(card));
    panel().focus();
    const outside = window.document.createElement('button');
    window.document.body.append(outside);
    outside.focus();
    assert.equal(panel(), null);
    assert.equal(instance.isDestroyed, true);
    assert.ok(window.document.activeElement === outside);
    assert.equal(saves(), 0);
  });
}

test('help Escape is consumed before temporary-note cancellation, except during composition', async () => {
  const { card, instance } = createFixture('temporary');
  await frames();
  click(helpButton(card));
  const dom = instance.rawEditor.view.dom;
  const composing = key(dom, { isComposing: true });
  assert.equal(composing.defaultPrevented, false);
  assert.ok(panel());
  assert.equal(instance.isDestroyed, false);
  const event = key(dom);
  assert.equal(event.defaultPrevented, true);
  assert.equal(panel(), null);
  assert.equal(instance.isDestroyed, false);
  assert.equal(saves(), 0);
});

test('keyboard activation focuses readable help and returns to its button', async () => {
  const { card, instance } = createFixture('temporary');
  await frames();
  const button = helpButton(card);
  button.focus();
  button.click();
  assert.ok(window.document.activeElement === panel());
  assert.equal(panel().getAttribute('role'), 'dialog');
  assert.equal(panel().querySelectorAll('ul > li').length, 6);
  assert.equal(panel().querySelectorAll('table, thead, tbody').length, 0);
  assert.equal(panel().querySelector('ul').getAttribute('aria-labelledby'), panel().querySelector('h3').id);
  key(panel());
  assert.ok(window.document.activeElement === button);
  assert.equal(instance.isDestroyed, false);
});

test('help repositions within narrow viewports and supplies English copy', () => {
  runtime.run("window.currentLang = 'en';");
  Object.defineProperty(window, 'innerWidth', { value: 320 });
  Object.defineProperty(window, 'innerHeight', { value: 400 });
  const { card } = createFixture('temporary');
  const button = helpButton(card);
  button.getBoundingClientRect = () => ({ left: 290, right: 314, width: 24, top: 4, bottom: 28 });
  click(button);
  const help = panel();
  help.getBoundingClientRect = () => ({ width: 300, height: 260 });
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(button.getAttribute('aria-label'), 'Editing help');
  assert.equal(help.querySelector('h3').textContent, 'Editing help');
  assert.equal(help.querySelector('table'), null);
  assert.deepEqual(Array.from(help.querySelectorAll('li:not(.md-editing-help-plain-row)'), row => [
    row.querySelector('.md-editing-help-label').textContent, row.querySelector('kbd').textContent,
    row.querySelector('code').textContent,
  ]), [
    ['Bold', 'Ctrl/Cmd+B', '**text**'], ['Italic', 'Ctrl/Cmd+I', '*text*'],
    ['Underline', 'Ctrl/Cmd+U', '<u>text</u>'], ['Highlight', 'Ctrl/Cmd+Shift+H', '==text=='],
    ['Inline code', 'Ctrl/Cmd+E', '`text`'],
  ]);
  const plain = help.querySelector('.md-editing-help-plain-row');
  assert.deepEqual(Array.from(plain.querySelectorAll('kbd'), key => key.textContent), ['Ctrl/Cmd+\\', '→']);
  assert.equal(plain.children[1].textContent, 'Ctrl/Cmd+\\');
  assert.equal(plain.querySelector('.md-editing-help-syntax-slot kbd').textContent, '→');
  assert.equal(help.querySelector('.md-editing-help-condition').textContent, 'at end');
  assert.equal(help.querySelector('.md-editing-help-condition').title, 'At the end of a formatted span');
  assert.equal(help.querySelector('.md-editing-help-note'), null);
  assert.equal(help.querySelector('.md-editing-help-plain-typing').textContent, 'Plain typing');
  assert.doesNotMatch(help.textContent, /stop format carryover/);
  assert.doesNotMatch(help.textContent, /Ctrl: Windows\/Linux; Cmd: Mac/);
  assert.doesNotMatch(help.textContent, /Stop sticky formatting/);
  assert.doesNotMatch(help.textContent, /==highlighted text==|Esc may cancel editing|Double spaces/);
  assert.doesNotMatch(help.textContent, /Inline format tools are single-choice|Default font color|Closing the toolbar/);
  assert.equal(help.style.left, '160px');
  assert.equal(help.style.top, '32px');
  assert.equal(help.style.transform, 'translate(-50%, 0)');
});

test('repeated help toggles remove every global listener, including after owner removal', async () => {
  const { card } = createFixture('temporary');
  const active = new Set();
  const originals = [window.document, window].map(target => {
    const add = target.addEventListener;
    const remove = target.removeEventListener;
    target.addEventListener = function(type, listener, options) {
      if (['onDocDown', 'onKeyDown', 'onFocusIn', 'position'].includes(listener.name)) active.add(listener);
      return add.call(this, type, listener, options);
    };
    target.removeEventListener = function(type, listener, options) {
      active.delete(listener);
      return remove.call(this, type, listener, options);
    };
    return { target, add, remove };
  });
  try {
    for (let i = 0; i < 5; i++) {
      click(helpButton(card));
      assert.equal(active.size, 4);
      click(helpButton(card));
      assert.equal(active.size, 0);
    }
    click(helpButton(card));
    card.remove();
    await Promise.resolve();
    assert.equal(panel(), null);
    assert.equal(active.size, 0);
  } finally {
    originals.forEach(({ target, add, remove }) => {
      target.addEventListener = add;
      target.removeEventListener = remove;
    });
  }
});

for (const [mark, shortcut, shiftKey] of [
  ['highlight', 'H', true], ['bold', 'b', false], ['italic', 'i', false],
  ['underline', 'u', false], ['code', 'e', false],
]) {
  test(`existing ${mark} shortcut still stops subsequent formatting without changing preceding text`, () => {
    const { instance } = createFixture('temporary', '');
    const editor = instance.rawEditor;
    editor.commands.setMark(mark);
    editor.view.dispatch(editor.state.tr.insertText('格式'));
    assert.equal(instance.isActive(mark), true);
    const doc = editor.state.doc;
    const selection = editor.state.selection;
    const event = key(editor.view.dom, {
      key: shortcut, code: `Key${shortcut.toUpperCase()}`, keyCode: shortcut.toUpperCase().charCodeAt(0),
      ctrlKey: true, shiftKey,
    });
    assert.equal(event.defaultPrevented, true);
    assert.equal(instance.isActive(mark), false);
    assert.ok(editor.state.doc === doc);
    assert.ok(editor.state.selection.eq(selection));
    editor.view.dispatch(editor.state.tr.insertText('后文'));
    assert.equal(editor.getText(), '格式后文');
    assert.equal(editor.state.doc.firstChild.firstChild.marks[0].type.name, mark);
    assert.equal(editor.state.doc.firstChild.lastChild.text, '后文');
    assert.equal(editor.state.doc.firstChild.lastChild.marks.length, 0);
  });
}
