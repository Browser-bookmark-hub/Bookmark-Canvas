const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../../../Bookmark-Canvas-main/history_html/bookmark_canvas_module.js'), 'utf8');
const extract = (name) => {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start);
  if (start < 0 || end < 0) throw new Error(`Missing function: ${name}`);
  return source.slice(start, end + 2);
};
const constLine = (name) => {
  const m = source.match(new RegExp(`^const ${name} = .*;$`, 'm'));
  if (!m) throw new Error(`Missing const: ${name}`);
  return m[0];
};

function load({ windowsLike = false, physicalCtrl = false, rate = 1 } = {}) {
  const context = vm.createContext({ Math, Number });
  vm.runInContext([
    `const CANVAS_RUNTIME_WINDOWS_LIKE = ${windowsLike};`,
    `const CanvasState = { physicalModifiers: { Control: ${physicalCtrl} }, isCtrlPressed: false };`,
    `function getCanvasTrackpadZoomRate() { return ${rate}; }`,
    constLine('DISCRETE_WHEEL_EVENT_DELTA_MIN'),
    constLine('TRACKPAD_ZOOM_BASE_SENSITIVITY'),
    constLine('TRACKPAD_ZOOM_MAX_LOG_STEP'),
    extract('__isLikelyCanvasDiscreteWheelEvent'),
    extract('__isCanvasTouchpadPinch'),
    extract('getCanvasTrackpadZoomFactor'),
    'this.api = { __isCanvasTouchpadPinch, getCanvasTrackpadZoomFactor };',
  ].join('\n'), context);
  return context.api;
}

test('synthesized trackpad pinch (fractional ctrl+wheel) is treated as pinch', () => {
  const api = load();
  assert.equal(api.__isCanvasTouchpadPinch({ ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: -3.25 }), true);
});

test('mechanical ctrl+wheel notch is not treated as pinch even if the physical Ctrl key was missed', () => {
  const api = load();
  assert.equal(api.__isCanvasTouchpadPinch({ ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: 100 }), false);
  assert.equal(api.__isCanvasTouchpadPinch({ ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: -120 }), false);
  assert.equal(load({ windowsLike: true }).__isCanvasTouchpadPinch({ ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: 10 }), false);
  assert.equal(load({ physicalCtrl: true }).__isCanvasTouchpadPinch({ ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: -3.25 }), false);
});

test('trackpad zoom factor is linear in log space with a per-event safety cap', () => {
  const api = load();
  assert.ok(Math.abs(api.getCanvasTrackpadZoomFactor(5) - Math.exp(0.06)) < 1e-12);
  assert.ok(Math.abs(api.getCanvasTrackpadZoomFactor(-5) - Math.exp(-0.06)) < 1e-12);
  assert.ok(Math.abs(api.getCanvasTrackpadZoomFactor(1000) - 1.35) < 1e-12, 'Abnormal deltas must be capped');
  assert.ok(Math.abs(api.getCanvasTrackpadZoomFactor(-1000) - 1 / 1.35) < 1e-12);
  assert.ok(Math.abs(load({ rate: 3 }).getCanvasTrackpadZoomFactor(100) - 1.35) < 1e-12);
});
