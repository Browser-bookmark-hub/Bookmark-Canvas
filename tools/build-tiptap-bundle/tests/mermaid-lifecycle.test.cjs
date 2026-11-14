const assert = require('node:assert/strict');
const { beforeEach, afterEach, test } = require('node:test');
const loadCanvasRuntime = require('./helpers/load-canvas-runtime.cjs');

let runtime;
let engine;
let instances;

beforeEach(() => {
  runtime = loadCanvasRuntime();
  engine = runtime.window.CanvasTiptapEngine;
  instances = [];
});

afterEach(() => {
  instances.forEach((instance) => instance.destroy());
  runtime.close();
});

test('pele engine is loaded on window with render and mount methods', () => {
  assert.ok(runtime.window.pele, 'window.pele should be defined');
  assert.equal(typeof runtime.window.pele.render, 'function');
  assert.equal(typeof runtime.window.pele.mount, 'function');
});

test('flowchart mermaid block is compiled to SVG diagram in observation mode', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  const source = '```mermaid\nflowchart TD\n  A --> B\n```';
  container.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__applyHeadingCollapse(container);

  const diagram = container.querySelector('.pele-diagram-container');
  assert.ok(diagram, 'Expected .pele-diagram-container in observation DOM');
  assert.equal(diagram.getAttribute('data-mermaid-source'), 'flowchart TD\n  A --> B');

  const svg = diagram.querySelector('svg.pele');
  assert.ok(svg, 'Expected <svg class="pele"> inside diagram container');
  assert.ok(svg.classList.contains('pele-flowchart'), 'Expected pele-flowchart class on SVG');
});

test('multiple mermaid diagrams in one card render independently', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  const source = [
    '# First Chart',
    '```mermaid',
    'flowchart LR',
    '  Step1 --> Step2',
    '```',
    '# Second Chart',
    '```mermaid',
    'sequenceDiagram',
    '  Alice->>Bob: Hello',
    '```',
  ].join('\n');

  container.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__applyHeadingCollapse(container);

  const diagrams = container.querySelectorAll('.pele-diagram-container');
  assert.equal(diagrams.length, 2, 'Expected 2 rendered mermaid diagrams');
  assert.ok(diagrams[0].querySelector('svg.pele-flowchart'));
  assert.ok(diagrams[1].querySelector('svg.pele-sequence'));
});

test('syntax errors degrade gracefully with error badge and preserved pre block', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  const source = '```mermaid\ninvalid diagram syntax here\n```';
  container.innerHTML = runtime.window.__buildTiptapObservationDom(source);

  // Calling applyHeadingCollapse should not throw
  assert.doesNotThrow(() => {
    runtime.window.__applyHeadingCollapse(container);
  });

  const pre = container.querySelector('pre');
  assert.ok(pre, '<pre> block should remain intact on syntax error');
  const badge = pre.querySelector('.pele-diagram-error-badge');
  assert.ok(badge, 'Expected .pele-diagram-error-badge appended to pre');
  assert.match(badge.textContent, /Mermaid:/);
});

test('mermaid code blocks preserve 100% clean markdown round-trip in editor', () => {
  const source = '```mermaid\nflowchart TD\n  A[Start] --> B{Decision}\n  B -- Yes --> C[OK]\n```';
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  const instance = engine.create(container, { initialMarkdown: source });
  instances.push(instance);

  const markdown = instance.getMarkdown();
  assert.equal(markdown.trim(), source.trim());
});

test('diagrams under collapsible headings fold and unfold correctly', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  const source = [
    '# Flow Section',
    '```mermaid',
    'flowchart TD',
    '  A --> B',
    '```',
    '# Next Section',
    'Some text',
  ].join('\n');

  container.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__applyHeadingCollapse(container);

  const heading1 = container.querySelector('h1');
  assert.equal(heading1.getAttribute('data-md-collapsible'), 'true');

  const diagram = container.querySelector('.pele-diagram-container');
  assert.ok(!diagram.classList.contains('md-heading-hidden'));

  // Collapse heading 1
  heading1.setAttribute('data-md-collapsed', 'true');
  runtime.window.__applyHeadingCollapse(container);
  assert.ok(diagram.classList.contains('md-heading-hidden'), 'Diagram should be hidden when heading is collapsed');

  // Expand heading 1
  heading1.removeAttribute('data-md-collapsed');
  runtime.window.__applyHeadingCollapse(container);
  assert.ok(!diagram.classList.contains('md-heading-hidden'), 'Diagram should be visible when heading is expanded');
});

test('__htmlToMarkdown converts rendered .pele-diagram-container back into pristine mermaid code block', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  const source = '```mermaid\nflowchart TD\n  A --> B\n```';
  container.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__applyHeadingCollapse(container);

  const diagram = container.querySelector('.pele-diagram-container');
  assert.ok(diagram, 'Expected .pele-diagram-container');

  const converted = runtime.window.__htmlToMarkdown(container.innerHTML);
  assert.match(converted, /```mermaid\s*\nflowchart TD\s*\n\s*A --> B\s*\n```/);
});

