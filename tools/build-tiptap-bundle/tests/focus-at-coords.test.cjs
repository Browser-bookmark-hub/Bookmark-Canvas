const assert = require('node:assert/strict');
const { beforeEach, afterEach, test } = require('node:test');
const loadCanvasRuntime = require('./helpers/load-canvas-runtime.cjs');

let runtime;
let instance;
let editor;
let warnedMessages = [];
let origWarn;

beforeEach(() => {
  warnedMessages = [];
  origWarn = console.warn;
  console.warn = (...args) => {
    warnedMessages.push(args.map(a => String(a)).join(' '));
    origWarn.apply(console, args);
  };

  runtime = loadCanvasRuntime();
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  instance = runtime.window.CanvasTiptapEngine.create(container, {
    initialMarkdown: 'First paragraph\n\nSecond paragraph',
  });
  editor = instance.rawEditor;
});

afterEach(() => {
  console.warn = origWarn;
  if (instance) instance.destroy();
  if (runtime) runtime.close();
});

test('focusAtCoords with non-inline boundary pos resolves safely without TextSelection warning', () => {
  const view = editor.view;
  const doc = editor.state.doc;

  // Simulate clicking at padding/doc boundary (pos 0: doc root)
  const origPosAtCoords = view.posAtCoords.bind(view);
  view.posAtCoords = () => ({ pos: 0, inside: -1 });

  const success = instance.focusAtCoords({ left: 10, top: 10 });
  assert.equal(success, true);

  const sel = editor.state.selection;
  assert.ok(sel.$from.parent.inlineContent, 'Selection anchor must point into an inline content node');

  const textSelectionWarnings = warnedMessages.filter(msg =>
    msg.includes('TextSelection endpoint not pointing into a node with inline content')
  );
  assert.equal(textSelectionWarnings.length, 0, 'Must not emit TextSelection warning');

  view.posAtCoords = origPosAtCoords;
});

test('focusAtCoords between paragraphs resolves to nearest textblock without warning', () => {
  const view = editor.view;
  const doc = editor.state.doc;

  // Find a position between paragraphs where depth == 0
  let boundaryPos = null;
  for (let i = 0; i <= doc.content.size; i++) {
    if (doc.resolve(i).depth === 0 && i > 0 && i < doc.content.size) {
      boundaryPos = i;
      break;
    }
  }
  assert.ok(boundaryPos !== null, 'Must have a boundary position between blocks');

  const origPosAtCoords = view.posAtCoords.bind(view);
  view.posAtCoords = () => ({ pos: boundaryPos, inside: -1 });

  const success = instance.focusAtCoords({ left: 50, top: 50 });
  assert.equal(success, true);

  const sel = editor.state.selection;
  assert.ok(sel.$from.parent.inlineContent, 'Selection must point into an inline node');

  const textSelectionWarnings = warnedMessages.filter(msg =>
    msg.includes('TextSelection endpoint not pointing into a node with inline content')
  );
  assert.equal(textSelectionWarnings.length, 0, 'Must not emit TextSelection warning');

  view.posAtCoords = origPosAtCoords;
});

test('focus(numericPos) with doc-level position does not trigger TextSelection warning', () => {
  const doc = editor.state.doc;
  // Test boundary positions (0, middle boundary, end)
  const boundaryPositions = [0, doc.content.size];
  for (let i = 0; i <= doc.content.size; i++) {
    if (doc.resolve(i).depth === 0) boundaryPositions.push(i);
  }

  for (const pos of boundaryPositions) {
    instance.focus(pos);
    const sel = editor.state.selection;
    assert.ok(
      sel.$from.parent.inlineContent || !sel.empty,
      `Selection at pos ${pos} must be safely resolved`
    );
  }

  const textSelectionWarnings = warnedMessages.filter(msg =>
    msg.includes('TextSelection endpoint not pointing into a node with inline content')
  );
  assert.equal(textSelectionWarnings.length, 0, 'Must not emit TextSelection warning on focus(num)');
});

test('focusAtCoords with null pos falls back gracefully to default focus', () => {
  const view = editor.view;
  const origPosAtCoords = view.posAtCoords.bind(view);
  view.posAtCoords = () => null;

  const success = instance.focusAtCoords({ left: -999, top: -999 });
  assert.equal(success, false);

  const textSelectionWarnings = warnedMessages.filter(msg =>
    msg.includes('TextSelection endpoint not pointing into a node with inline content')
  );
  assert.equal(textSelectionWarnings.length, 0);

  view.posAtCoords = origPosAtCoords;
});
