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
  runtime.window.__postProcessCanvasObservationDom(container);

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
  runtime.window.__postProcessCanvasObservationDom(container);

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

  // Calling postProcessCanvasObservationDom should not throw
  assert.doesNotThrow(() => {
    runtime.window.__postProcessCanvasObservationDom(container);
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
  runtime.window.__postProcessCanvasObservationDom(container);

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
  runtime.window.__postProcessCanvasObservationDom(container);

  const diagram = container.querySelector('.pele-diagram-container');
  assert.ok(diagram, 'Expected .pele-diagram-container');

  const converted = runtime.window.__htmlToMarkdown(container.innerHTML);
  assert.match(converted, /```mermaid\s*\nflowchart TD\s*\n\s*A --> B\s*\n```/);
});

test('__sanitizeCanvasRichTextHtml preserves data-mermaid-source attribute and SVG markup', () => {
  const rawHtml = '<div class="pele-diagram-container" data-mermaid-source="flowchart TD\n  A --> B"><svg class="pele" viewBox="0 0 100 100"><g><rect width="10" height="10" fill="#fff"></rect><text>Test Node</text></g></svg></div>';
  const sanitized = runtime.window.__sanitizeCanvasRichTextHtml(rawHtml);
  assert.match(sanitized, /data-mermaid-source="flowchart TD\s*A --> B"/);
  assert.match(sanitized, /<svg class="pele"/);
  assert.match(sanitized, /<rect/);
  assert.match(sanitized, /<text>/);
});

test('__resolveMarkdownSourceFromEditorHtml preserves Mermaid code block without loss', () => {
  const originalMd = '```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```';
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  container.innerHTML = runtime.window.__buildTiptapObservationDom(originalMd);
  runtime.window.__postProcessCanvasObservationDom(container);

  const diagram = container.querySelector('.pele-diagram-container');
  assert.ok(diagram, 'Rendered diagram should exist');
  assert.ok(diagram.getAttribute('data-mermaid-source'));

  // Simulate editor save cycle using __resolveMarkdownSourceFromEditorHtml
  const resolvedMd = runtime.window.__resolveMarkdownSourceFromEditorHtml(container.innerHTML, originalMd);
  assert.match(resolvedMd, /```mermaid\s*\nflowchart TD\s*\n\s*A\[Start\] --> B\[End\]\s*\n```/);
});

test('renderCanvasMermaidDiagrams protects active editors and does not mutate DOM while editing', () => {
  const container = runtime.window.document.createElement('div');
  container.contentEditable = 'true';
  container.innerHTML = '<pre><code class="language-mermaid">flowchart TD\n  A --> B</code></pre>';
  runtime.window.document.body.append(container);

  runtime.window.renderCanvasMermaidDiagrams(container);
  assert.equal(container.querySelectorAll('.pele-diagram-container').length, 0, 'Should not render diagrams in contentEditable container');

  container.contentEditable = 'false';
  container.__tiptapInstance = {}; // Simulate active TipTap instance
  runtime.window.renderCanvasMermaidDiagrams(container);
  assert.equal(container.querySelectorAll('.pele-diagram-container').length, 0, 'Should not render diagrams when __tiptapInstance is present');

  // Ancestor element passed, but pre is inside an active contentEditable child
  const parent = runtime.window.document.createElement('div');
  const editableChild = runtime.window.document.createElement('div');
  editableChild.contentEditable = 'true';
  editableChild.innerHTML = '<pre><code class="language-mermaid">flowchart TD\n  A --> B</code></pre>';
  parent.append(editableChild);
  runtime.window.document.body.append(parent);
  runtime.window.renderCanvasMermaidDiagrams(parent);
  assert.equal(parent.querySelectorAll('.pele-diagram-container').length, 0, 'Should not render diagrams when pre is inside contentEditable child');
});

test('rendered diagrams secure hyperlinks and stop pointerdown event propagation', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  // Diagram with link
  const source = '```mermaid\nflowchart TD\n  A[Google] --> B\n  click A "https://google.com"\n```';
  container.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__postProcessCanvasObservationDom(container);

  const diagram = container.querySelector('.pele-diagram-container');
  assert.ok(diagram, 'Expected .pele-diagram-container');

  const links = diagram.querySelectorAll('a[href]');
  if (links.length > 0) {
    links.forEach((link) => {
      assert.equal(link.getAttribute('target'), '_blank');
      assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
    });
  }

  // Pointerdown event propagation test
  let eventBubbled = false;
  container.addEventListener('pointerdown', () => {
    eventBubbled = true;
  });

  const pointerEvent = new runtime.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  diagram.dispatchEvent(pointerEvent);
  assert.equal(eventBubbled, false, 'pointerdown should stopPropagation on .pele-diagram-container');
});

test('__applyHeadingCollapse alone does not execute Pele diagram rendering', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  const source = '```mermaid\nflowchart TD\n  A --> B\n```';
  container.innerHTML = runtime.window.__buildTiptapObservationDom(source);

  // Call __applyHeadingCollapse directly - should NOT convert pre to .pele-diagram-container
  runtime.window.__applyHeadingCollapse(container);
  assert.equal(container.querySelectorAll('.pele-diagram-container').length, 0, '__applyHeadingCollapse should be decoupled from diagram rendering');

  // Calling __postProcessCanvasObservationDom should convert it
  runtime.window.__postProcessCanvasObservationDom(container);
  assert.equal(container.querySelectorAll('.pele-diagram-container').length, 1, '__postProcessCanvasObservationDom should convert it');
});

test('__isViewportLowDetailEffective implements dual-track OR logic for pure markdown and bookmark boards', () => {
  const CanvasState = runtime.window.CanvasState;

  // Disabled globally
  CanvasState.lowDetailEnabled = false;
  assert.equal(runtime.window.__isViewportLowDetailEffective(), false, 'Should be false when globally disabled');
  CanvasState.lowDetailEnabled = true;

  // Explicit 'off'
  CanvasState.viewportLowDetailEnabled = 'off';
  assert.equal(runtime.window.__isViewportLowDetailEffective(), false, 'Should be false when mode is off');

  // Explicit 'on'
  CanvasState.viewportLowDetailEnabled = 'on';
  assert.equal(runtime.window.__isViewportLowDetailEffective(), true, 'Should be true when mode is on');

  // 'auto' mode
  CanvasState.viewportLowDetailEnabled = 'auto';

  // Case 1: Low load (5 columns, 20 bookmarks) -> false
  runtime.window.__canvasTotalStats = { totalColumnCount: 5, totalBookmarkCount: 20, totalFolderCount: 0 };
  assert.equal(runtime.window.__isViewportLowDetailEffective(), false, 'Low load should not activate LOD');

  // Case 2: Deep bookmark board (5 columns, 120 bookmarks >= 100) -> true
  runtime.window.__canvasTotalStats = { totalColumnCount: 5, totalBookmarkCount: 120, totalFolderCount: 0 };
  assert.equal(runtime.window.__isViewportLowDetailEffective(), true, 'High bookmark count should activate LOD');

  // Case 3: Pure Markdown mindmap canvas (26 cards >= 15 columns, 0 bookmarks) -> true
  runtime.window.__canvasTotalStats = { totalColumnCount: 26, totalBookmarkCount: 0, totalFolderCount: 0 };
  assert.equal(runtime.window.__isViewportLowDetailEffective(), true, 'Pure Markdown/Mermaid card board (>= 15 columns) should activate LOD');
});

test('isCanvasVirtualizationEnabled and __isViewportLowDetailEffective support independent dual-track thresholds (Option B)', () => {
  const CanvasState = runtime.window.CanvasState;

  CanvasState.lowDetailEnabled = true;
  CanvasState.viewportLowDetailEnabled = 'auto';
  CanvasState.virtualizationEnabled = 'auto';

  // 1. Virtualization basic modes
  CanvasState.virtualizationEnabled = 'off';
  assert.equal(runtime.window.isCanvasVirtualizationEnabled(), false, 'Should be false when virtualization is off');
  CanvasState.virtualizationEnabled = 'on';
  assert.equal(runtime.window.isCanvasVirtualizationEnabled(), true, 'Should be true when virtualization is on');
  CanvasState.virtualizationEnabled = 'auto';

  // 2. Default thresholds: columns = 15, nodes = 100 for both
  CanvasState.viewportLowDetailMinColumns = 15;
  CanvasState.viewportLowDetailMinLoadedNodes = 100;
  CanvasState.virtualizationMinColumns = 15;
  CanvasState.virtualizationMinLoadedNodes = 100;

  // 20 columns, 50 nodes -> satisfies columns (20 >= 15) for both
  runtime.window.__canvasTotalStats = { totalColumnCount: 20, totalBookmarkCount: 50, totalFolderCount: 0 };
  assert.equal(runtime.window.__isViewportLowDetailEffective(), true);
  assert.equal(runtime.window.isCanvasVirtualizationEnabled(), true);

  // 3. Option B: Configure independent thresholds for LOD and Virtualization
  // Raise LOD thresholds high: columns = 30, nodes = 200
  CanvasState.viewportLowDetailMinColumns = 30;
  CanvasState.viewportLowDetailMinLoadedNodes = 200;
  // Keep Virtualization thresholds default: columns = 15, nodes = 100

  // 20 columns, 150 nodes:
  // - For LOD: 20 < 30 cols AND 150 < 200 nodes -> false
  // - For Virtualization: 20 >= 15 cols OR 150 >= 100 nodes -> true
  assert.equal(runtime.window.__isViewportLowDetailEffective(), false, 'LOD should be false under stricter LOD thresholds');
  assert.equal(runtime.window.isCanvasVirtualizationEnabled(), true, 'Virtualization should remain true under independent lower thresholds');

  // Now raise Virtualization thresholds high: columns = 50, nodes = 500
  CanvasState.virtualizationMinColumns = 50;
  CanvasState.virtualizationMinLoadedNodes = 500;
  assert.equal(runtime.window.isCanvasVirtualizationEnabled(), false, 'Virtualization should be false under stricter virtualization thresholds');

  // Trigger Virtualization only by node count (600 nodes >= 500, but 10 columns < 50)
  runtime.window.__canvasTotalStats = { totalColumnCount: 10, totalBookmarkCount: 600, totalFolderCount: 0 };
  assert.equal(runtime.window.isCanvasVirtualizationEnabled(), true, 'Virtualization triggered by node count track alone');
});

test('Pele dark theme stylesheets optimize rectangles, kanban cards and badge text', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.resolve(__dirname, '../../../Bookmark-Canvas-main/history_html/canvas_obsidian_style.css'), 'utf-8');

  // Verify dark theme does not mistakenly set --pele-bg to pure white (#ffffff)
  const darkBlock = css.match(/\[data-theme="dark"\]\s+\.pele-diagram-container\s*\{([^}]+)\}/);
  assert.ok(darkBlock, 'Dark theme block for .pele-diagram-container should exist');
  assert.doesNotMatch(darkBlock[1], /--pele-bg:\s*#ffffff/, '--pele-bg should not be white in dark mode');

  // Verify high contrast badge text protection
  assert.match(css, /\.pele-period\s*>\s*text/, 'Timeline period text selector should exist');
  assert.match(css, /\.pele-branch\s*>\s*text/, 'GitGraph branch text selector should exist');
  assert.match(css, /\.pele-sequence-number\s*>\s*text/, 'Sequence number text selector should exist');

  // Verify kanban card dark theme styling
  assert.match(css, /\[data-theme="dark"\]\s+\.pele-diagram-container\s+\.pele-kanban\s+\.pele-card\s*>\s*rect/, 'Kanban card should have dark mode fill rule');
});

test('clicking mermaid diagram activates selection and renders 3-button floating toolbar', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  const source = '```mermaid\nflowchart TD\n  A --> B\n```';
  container.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__postProcessCanvasObservationDom(container);

  const diagram = container.querySelector('.pele-diagram-container');
  assert.ok(diagram, 'Expected .pele-diagram-container');

  // Initially not selected
  assert.equal(diagram.classList.contains('pele-selected'), false);
  assert.equal(diagram.querySelector('.pele-diagram-toolbar'), null);

  // Click diagram to select
  diagram.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(diagram.classList.contains('pele-selected'), true);

  const toolbar = diagram.querySelector('.pele-diagram-toolbar');
  assert.ok(toolbar, 'Toolbar should be mounted inside selected diagram');

  const previewBtn = toolbar.querySelector('.pele-btn-preview');
  const editBtn = toolbar.querySelector('.pele-btn-edit');
  const closeBtn = toolbar.querySelector('.pele-btn-close');

  assert.ok(previewBtn, 'Preview button should exist');
  assert.ok(editBtn, 'Edit button should exist');
  assert.ok(closeBtn, 'Close button should exist');

  // Verify pure SVG icon rendering without plain text labels
  assert.ok(previewBtn.querySelector('svg'), 'Preview button should render SVG icon');
  assert.match(previewBtn.title, /预览大图/);
  assert.ok(editBtn.querySelector('svg'), 'Edit button should render SVG icon');
  assert.match(editBtn.title, /编辑源码/);
  assert.ok(closeBtn.querySelector('svg'), 'Close button should render SVG icon');
  assert.match(closeBtn.title, /退出/);

  // Clicking close button deselects
  closeBtn.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(diagram.classList.contains('pele-selected'), false);
  assert.equal(diagram.querySelector('.pele-diagram-toolbar'), null);
});

test('clicking edit button invokes parent card edit method across different container types', () => {
  const root = runtime.window.document.createElement('div');
  runtime.window.document.body.append(root);

  // Case 1: inside permanent-section-tip
  const permCard = runtime.window.document.createElement('div');
  permCard.className = 'permanent-bookmark-section';
  const tipContainer = runtime.window.document.createElement('div');
  tipContainer.className = 'permanent-section-tip';
  let tipEditCalled = false;
  tipContainer.__enterEditingTip = () => { tipEditCalled = true; };
  permCard.append(tipContainer);
  root.append(permCard);

  const source = '```mermaid\nflowchart TD\n  A --> B\n```';
  tipContainer.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__postProcessCanvasObservationDom(tipContainer);

  const diagram1 = tipContainer.querySelector('.pele-diagram-container');
  diagram1.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const editBtn1 = diagram1.querySelector('.pele-btn-edit');
  editBtn1.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(tipEditCalled, true, 'Permanent tip edit method should be called');

  // Case 2: inside temp-node-description
  const tempCard = runtime.window.document.createElement('div');
  tempCard.className = 'temp-canvas-node';
  const descContainer = runtime.window.document.createElement('div');
  descContainer.className = 'temp-node-description';
  let descEditCalled = false;
  descContainer.__enterEditingDescription = () => { descEditCalled = true; };
  tempCard.append(descContainer);
  root.append(tempCard);

  descContainer.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__postProcessCanvasObservationDom(descContainer);

  const diagram2 = descContainer.querySelector('.pele-diagram-container');
  diagram2.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const editBtn2 = diagram2.querySelector('.pele-btn-edit');
  editBtn2.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(descEditCalled, true, 'Temp node description edit method should be called');

  // Case 3: inside md-canvas-node
  const mdCard = runtime.window.document.createElement('div');
  mdCard.className = 'canvas-node';
  let mdEditCalled = false;
  mdCard.__enterEditMode = () => { mdEditCalled = true; };
  root.append(mdCard);

  mdCard.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__postProcessCanvasObservationDom(mdCard);

  const diagram3 = mdCard.querySelector('.pele-diagram-container');
  diagram3.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const editBtn3 = diagram3.querySelector('.pele-btn-edit');
  editBtn3.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(mdEditCalled, true, 'Markdown node edit method should be called');
});

test('preview button opens canvas mermaid lightbox with zoom/pan controls and keyboard shortcuts', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  const source = '```mermaid\nflowchart TD\n  Start[Begin] --> Finish[End]\n```';
  container.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__postProcessCanvasObservationDom(container);

  const diagram = container.querySelector('.pele-diagram-container');
  diagram.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));

  const previewBtn = diagram.querySelector('.pele-btn-preview');
  assert.ok(previewBtn);

  // Click preview button
  previewBtn.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));

  const overlay = runtime.window.document.querySelector('.canvas-mermaid-lightbox-overlay');
  assert.ok(overlay, 'Lightbox overlay should be created');
  assert.ok(overlay.classList.contains('active'), 'Overlay should have active class');

  const viewport = overlay.querySelector('.canvas-mermaid-lightbox-viewport');
  const content = overlay.querySelector('.canvas-mermaid-lightbox-content');
  const clonedSvg = content.querySelector('svg.pele');
  assert.ok(clonedSvg, 'Cloned SVG should be mounted in lightbox content');

  // Verify header action buttons
  const helpBtn = overlay.querySelector('.canvas-mermaid-lightbox-btn[data-action="help"]');
  const resetBtn = overlay.querySelector('.canvas-mermaid-lightbox-btn[data-action="reset"], .canvas-mermaid-lightbox-btn[data-action="locate"]');
  const zoomInBtn = overlay.querySelector('.canvas-mermaid-lightbox-btn[data-action="zoom-in"]');
  const zoomOutBtn = overlay.querySelector('.canvas-mermaid-lightbox-btn[data-action="zoom-out"]');
  const closeBtn = overlay.querySelector('.canvas-mermaid-lightbox-btn[data-action="close"]');

  assert.ok(helpBtn, 'Help/Explanation button should exist');
  assert.ok(resetBtn, 'Locate/Reset button should exist');
  assert.ok(zoomInBtn, 'Zoom In button should exist');
  assert.ok(zoomOutBtn, 'Zoom Out button should exist');
  assert.ok(closeBtn, 'Close button should exist');
  assert.equal(helpBtn.nextElementSibling, zoomInBtn, 'Help button should be placed immediately to the left of Zoom In button');

  // Test toggling help popover
  const popover = overlay.querySelector('.canvas-mermaid-lightbox-help-popover');
  assert.ok(popover, 'Help popover element should exist');
  assert.equal(popover.style.display, 'none');
  helpBtn.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(popover.style.display, 'block');
  helpBtn.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(popover.style.display, 'none');

  // Reset to 1:1
  resetBtn.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(overlay.__getScale(), 1, 'Reset button should set scale to 1');

  // Zoom in
  const prevScale = overlay.__getScale();
  zoomInBtn.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.ok(overlay.__getScale() > prevScale, 'Zoom In should increase scale');

  // Zoom out
  zoomOutBtn.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.ok(Math.abs(overlay.__getScale() - prevScale) < 0.05, 'Zoom Out should decrease scale back');

  // Keyboard Escape closes lightbox
  const escEvent = new runtime.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  runtime.window.dispatchEvent(escEvent);
  assert.equal(overlay.classList.contains('active'), false, 'Escape should close lightbox overlay');
});

test('canvas mermaid lightbox isolates events and supports wheel pan and Ctrl+wheel zoom', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  const source = '```mermaid\nflowchart TD\n  NodeA --> NodeB\n```';
  container.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__postProcessCanvasObservationDom(container);

  const diagram = container.querySelector('.pele-diagram-container');
  runtime.window.__openCanvasMermaidLightbox(diagram);

  const overlay = runtime.window.document.querySelector('.canvas-mermaid-lightbox-overlay');
  assert.ok(overlay.classList.contains('active'));
  const viewport = overlay.querySelector('.canvas-mermaid-lightbox-viewport');

  // Verify event isolation: events inside overlay must not bubble to document.body
  let bodyReceivedWheel = false;
  runtime.window.document.body.addEventListener('wheel', () => { bodyReceivedWheel = true; });
  let bodyReceivedPointer = false;
  runtime.window.document.body.addEventListener('pointerdown', () => { bodyReceivedPointer = true; });

  const wheelEvt = new runtime.window.WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true });
  viewport.dispatchEvent(wheelEvt);
  assert.equal(bodyReceivedWheel, false, 'Wheel events inside lightbox must be stopped from reaching body/canvas');

  const pointerEvt = new runtime.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
  viewport.dispatchEvent(pointerEvt);
  assert.equal(bodyReceivedPointer, false, 'Pointer events inside lightbox must be stopped from reaching body/canvas');

  // Plain wheel pan: translateY should change by -deltaY
  const transBefore = overlay.__getTranslate();
  const panWheel = new runtime.window.WheelEvent('wheel', { deltaX: 20, deltaY: 30, bubbles: true, cancelable: true });
  viewport.dispatchEvent(panWheel);
  const transAfter = overlay.__getTranslate();
  assert.equal(transAfter.x, transBefore.x - 20, 'Horizontal wheel should pan translateX');
  assert.equal(transAfter.y, transBefore.y - 30, 'Vertical wheel should pan translateY');

  // Ctrl+wheel zoom: scale should change
  const scaleBefore = overlay.__getScale();
  const zoomWheel = new runtime.window.WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
  viewport.dispatchEvent(zoomWheel);
  assert.ok(overlay.__getScale() > scaleBefore, 'Ctrl+wheel should zoom in diagram');

  // Double click fits to view
  const dblClick = new runtime.window.MouseEvent('dblclick', { bubbles: true, cancelable: true });
  viewport.dispatchEvent(dblClick);
  assert.ok(overlay.__getScale() > 0, 'Double click triggers fitToView');

  // Clean close
  overlay.__closeLightbox();
  assert.equal(overlay.classList.contains('active'), false);
});

test('canvas mermaid lightbox supports mouse dragging across buttons and dynamic shortcut hint', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  const source = '```mermaid\nflowchart TD\n  Alpha --> Beta\n```';
  container.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__postProcessCanvasObservationDom(container);

  const diagram = container.querySelector('.pele-diagram-container');
  runtime.window.__openCanvasMermaidLightbox(diagram);

  const overlay = runtime.window.document.querySelector('.canvas-mermaid-lightbox-overlay');
  assert.ok(overlay.classList.contains('active'));
  const viewport = overlay.querySelector('.canvas-mermaid-lightbox-viewport');
  const hint = overlay.querySelector('.canvas-mermaid-lightbox-hint');

  // Verify hint contains default zoom shortcut text
  assert.ok(hint.textContent.includes('Ctrl') || hint.textContent.includes('⌘'), 'Hint should display Ctrl or Cmd by default');

  // Test left click drag pan
  const tBefore = overlay.__getTranslate();
  viewport.dispatchEvent(new runtime.window.MouseEvent('pointerdown', { clientX: 100, clientY: 100, button: 0, bubbles: true }));
  viewport.dispatchEvent(new runtime.window.MouseEvent('pointermove', { clientX: 160, clientY: 180, bubbles: true }));
  viewport.dispatchEvent(new runtime.window.MouseEvent('pointerup', { clientX: 160, clientY: 180, bubbles: true }));
  const tAfterLeft = overlay.__getTranslate();
  assert.equal(tAfterLeft.x, tBefore.x + 60, 'Left click drag should update translateX');
  assert.equal(tAfterLeft.y, tBefore.y + 80, 'Left click drag should update translateY');

  // Test right click drag pan (Mac Ctrl+click simulation button 2)
  viewport.dispatchEvent(new runtime.window.MouseEvent('pointerdown', { clientX: 200, clientY: 200, button: 2, ctrlKey: true, bubbles: true }));
  viewport.dispatchEvent(new runtime.window.MouseEvent('pointermove', { clientX: 230, clientY: 250, bubbles: true }));
  viewport.dispatchEvent(new runtime.window.MouseEvent('pointerup', { clientX: 230, clientY: 250, bubbles: true }));
  const tAfterRight = overlay.__getTranslate();
  assert.equal(tAfterRight.x, tAfterLeft.x + 30, 'Right-click or Mac Ctrl+click drag should pan translateX');
  assert.equal(tAfterRight.y, tAfterLeft.y + 50, 'Right-click or Mac Ctrl+click drag should pan translateY');

  // Test custom shortcut update: change ctrlKey to 'Alt'
  runtime.window.canvasShortcuts.ctrlKey = 'Alt';
  runtime.window.dispatchEvent(new runtime.window.CustomEvent('canvas-shortcuts-updated', { detail: runtime.window.canvasShortcuts }));
  assert.ok(hint.textContent.includes('Option') || hint.textContent.includes('Alt'), 'Hint should update to Option/Alt when ctrlKey is customized');

  // Reset shortcut back
  runtime.window.canvasShortcuts.ctrlKey = 'Control';

  // Clean close
  overlay.__closeLightbox();
  assert.equal(overlay.classList.contains('active'), false);
});

test('clicking outside of diagram deselects it', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  const source = '```mermaid\nflowchart TD\n  X --> Y\n```';
  container.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__postProcessCanvasObservationDom(container);

  const diagram = container.querySelector('.pele-diagram-container');
  runtime.window.__selectCanvasMermaidDiagram(diagram);
  assert.equal(diagram.classList.contains('pele-selected'), true);

  // Mousedown outside on body
  const outsideEvent = new runtime.window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  runtime.window.document.body.dispatchEvent(outsideEvent);
  assert.equal(diagram.classList.contains('pele-selected'), false, 'Clicking outside should deselect diagram');
});

test('clicking already selected diagram or double clicking diagram triggers edit mode with focused code block', () => {
  const root = runtime.window.document.createElement('div');
  runtime.window.document.body.append(root);

  const card = runtime.window.document.createElement('div');
  card.className = 'canvas-node';
  let editCalledWith = null;
  card.__enterEditMode = (opts) => { editCalledWith = opts; };
  root.append(card);

  const source = '```mermaid\nflowchart TD\n  A --> B\n```';
  card.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__postProcessCanvasObservationDom(card);

  const diagram = card.querySelector('.pele-diagram-container');

  // 1. First click selects the diagram and mounts toolbar
  diagram.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(diagram.classList.contains('pele-selected'), true);
  assert.ok(diagram.querySelector('.pele-diagram-toolbar'));
  assert.equal(editCalledWith, null, 'First click should only select diagram, not trigger edit');

  // 2. Second click on selected diagram triggers parent edit mode with diagram target info
  diagram.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.ok(editCalledWith, 'Second click on selected diagram should trigger parent edit');
  assert.equal(editCalledWith.source, 'flowchart TD\n  A --> B');

  // Reset
  editCalledWith = null;
  runtime.window.__selectCanvasMermaidDiagram(diagram);

  // 3. Double click also triggers edit mode
  diagram.dispatchEvent(new runtime.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  assert.ok(editCalledWith, 'Double click on diagram should trigger parent edit');
});

test('renderCanvasMermaidDiagrams normalizes capitalized diagram keywords (e.g. Mindmap, Flowchart)', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);

  // Test Mindmap with capitalized keyword
  const source = '```mermaid\nMindmap\n  root((Root))\n    Child\n```';
  container.innerHTML = runtime.window.__buildTiptapObservationDom(source);
  runtime.window.__postProcessCanvasObservationDom(container);

  const diagram = container.querySelector('.pele-diagram-container');
  assert.ok(diagram, 'Diagram should render even with capitalized Mindmap keyword');
  assert.equal(diagram.getAttribute('data-mermaid-source'), 'Mindmap\n  root((Root))\n    Child');
});



