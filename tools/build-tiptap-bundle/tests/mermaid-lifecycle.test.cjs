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

test('__sanitizeCanvasRichTextHtml restores rendered diagrams to mermaid source code blocks and drops SVG', () => {
  const rawHtml = '<div class="pele-diagram-container pele-selected" data-mermaid-source="flowchart TD\n  A --> B"><svg class="pele" viewBox="0 0 100 100"><g><rect width="10" height="10" fill="#fff"></rect><text>Test Node</text></g></svg><div class="pele-diagram-toolbar"><button>x</button></div></div>';
  const sanitized = runtime.window.__sanitizeCanvasRichTextHtml(rawHtml);
  assert.equal(sanitized, '<pre><code class="language-mermaid">flowchart TD\n  A --&gt; B</code></pre>');
  assert.equal(
    sanitized,
    runtime.window.__sanitizeCanvasRichTextHtml(runtime.window.__buildTiptapObservationInnerHtml('```mermaid\nflowchart TD\n  A --> B\n```')),
    'Restored block must match the observation markup rendered from the source'
  );
});

test('__sanitizeCanvasRichTextHtml rejects raw SVG / foreignObject markup', () => {
  const sanitized = runtime.window.__sanitizeCanvasRichTextHtml('<p>a</p><svg><use href="https://evil.test/x.svg#a"></use><foreignObject><img src="x" onerror="alert(1)"></foreignObject></svg>');
  assert.doesNotMatch(sanitized, /<svg|<use|foreignobject|onerror/i);
});

test('mermaid error badge and toolbar never leak into saved markdown', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  container.innerHTML = runtime.window.__buildTiptapObservationDom('```mermaid\ninvalid diagram syntax here\n```');
  runtime.window.__postProcessCanvasObservationDom(container);
  assert.ok(container.querySelector('.pele-diagram-error-badge'));
  const md = runtime.window.__resolveMarkdownSourceFromEditorHtml(container.innerHTML, '');
  assert.doesNotMatch(md, /Mermaid:/);
  assert.match(md, /```mermaid\s*\ninvalid diagram syntax here\s*\n```/);
  assert.doesNotMatch(runtime.window.__htmlToMarkdown(container.innerHTML), /Mermaid:/);
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
  runtime.window.__canvasAutoTriggerStats = { totalColumnCount: 5, loadedNodeCount: 20 };
  assert.equal(runtime.window.__isViewportLowDetailEffective(), false, 'Low load should not activate LOD');

  // Case 2: Deep bookmark board (5 columns, 120 bookmarks >= 100) -> true
  runtime.window.__canvasAutoTriggerStats = { totalColumnCount: 5, loadedNodeCount: 120 };
  assert.equal(runtime.window.__isViewportLowDetailEffective(), true, 'High bookmark count should activate LOD');

  // Case 3: Pure Markdown mindmap canvas (26 cards >= 15 columns, 0 bookmarks) -> true
  runtime.window.__canvasAutoTriggerStats = { totalColumnCount: 26, loadedNodeCount: 0 };
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
  runtime.window.__canvasAutoTriggerStats = { totalColumnCount: 20, loadedNodeCount: 50 };
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
  runtime.window.__canvasAutoTriggerStats = { totalColumnCount: 10, loadedNodeCount: 600 };
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




test('__normalizeMermaidDiagramKeyword only fixes the diagram declaration line', () => {
  const normalize = runtime.window.__normalizeMermaidDiagramKeyword;
  assert.equal(normalize('Mindmap\n  root'), 'mindmap\n  root');
  assert.equal(normalize('%% comment\n\n  SequenceDiagram\n  Pie->>Alice: hi\nTimeline->>Alice: x'),
    '%% comment\n\n  sequenceDiagram\n  Pie->>Alice: hi\nTimeline->>Alice: x');
  assert.equal(normalize('---\ntitle: Graph\n---\nFLOWCHART TD\n  Graph --> B'), '---\ntitle: Graph\n---\nflowchart TD\n  Graph --> B');
  assert.equal(normalize('StateDiagram-v2\n  [*] --> S'), 'stateDiagram-v2\n  [*] --> S');
  assert.equal(normalize('unknownThing\nPie'), 'unknownThing\nPie');
  assert.equal(normalize('mindmap\n  root((R))\n    Mindmap 结构\n    Mindmaps'), 'mindmap\n  root((R))\n    \u200BMindmap 结构\n    Mindmaps');
  assert.equal(normalize('flowchart TD\n  Mindmap --> B'), 'flowchart TD\n  Mindmap --> B', 'Only mindmap bodies are escaped');
});

test('mindmap child node whose text starts with "Mindmap" renders instead of raising a Pele parse error', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  const raw = 'mindmap\n  root((Root))\n    Mindmap 结构\n    Child';
  container.innerHTML = runtime.window.__buildTiptapObservationDom('```mermaid\n' + raw + '\n```');
  runtime.window.__postProcessCanvasObservationDom(container);
  const diagram = container.querySelector('.pele-diagram-container');
  assert.ok(diagram, 'Diagram should render');
  assert.equal(container.querySelector('.pele-diagram-error-badge'), null);
  assert.equal(diagram.getAttribute('data-mermaid-source'), raw, 'Stored source keeps the original text without zero-width spaces');
});

test('editing a diagram focuses its own code block when a card has several diagrams', () => {
  const sources = ['flowchart TD\n  A --> B', 'flowchart TD\n  C --> D', 'flowchart TD\n  A --> B'];
  const markdown = sources.map(src => '```mermaid\n' + src + '\n```').join('\n\n');
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  const instance = engine.create(container, { initialMarkdown: markdown });
  instances.push(instance);
  const focusedBlock = () => {
    const { $from } = instance.editor.state.selection;
    return { text: $from.parent.textContent, start: $from.start() };
  };

  assert.equal(runtime.window.__focusTiptapMermaidCodeBlock(instance, { source: sources[1], diagramIndex: 1 }), true);
  assert.equal(focusedBlock().text, sources[1]);

  runtime.window.__focusTiptapMermaidCodeBlock(instance, { source: sources[0], diagramIndex: 0 });
  const first = focusedBlock();
  runtime.window.__focusTiptapMermaidCodeBlock(instance, { source: sources[2], diagramIndex: 2 });
  const third = focusedBlock();
  assert.equal(third.text, sources[2]);
  assert.ok(third.start > first.start, 'Identical sources must be disambiguated by diagram index');

  assert.equal(runtime.window.__focusTiptapMermaidCodeBlock(instance, { source: 'pie\n  "x": 1', diagramIndex: -1 }), false,
    'Unknown source without index must not jump to an arbitrary mermaid block');
});

test('__triggerDiagramParentEdit passes focusAtCoords-compatible coords and the diagram index', () => {
  const card = runtime.window.document.createElement('div');
  card.className = 'canvas-node';
  let target = null;
  card.__enterEditMode = (opts) => { target = opts; };
  runtime.window.document.body.append(card);
  card.innerHTML = runtime.window.__buildTiptapObservationDom('```mermaid\nflowchart TD\n  A --> B\n```\n\n```mermaid\nflowchart TD\n  C --> D\n```');
  runtime.window.__postProcessCanvasObservationDom(card);

  const diagrams = card.querySelectorAll('.pele-diagram-container');
  assert.equal(diagrams.length, 2);
  runtime.window.__triggerDiagramParentEdit(diagrams[1]);
  assert.ok(target);
  assert.equal(target.diagramIndex, 1);
  assert.equal(target.source, 'flowchart TD\n  C --> D');
  assert.equal(typeof target.coords.left, 'number');
  assert.equal(typeof target.coords.top, 'number');
});

test('loaded tree node count keeps the last loaded count of unloaded cards and drops deleted cards', () => {
  const { document, CanvasState } = runtime.window;
  const makeSection = (id, n) => {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'temp-canvas-node';
    el.innerHTML = Array.from({ length: n }, (_, i) => `<div class="tree-item" data-node-type="${i % 5 === 0 ? 'folder' : 'bookmark'}"></div>`).join('');
    document.body.append(el);
    return el;
  };
  CanvasState.tempSections = [{ id: 'temp-a' }, { id: 'temp-b' }];
  const a = makeSection('temp-a', 60);
  makeSection('temp-b', 50);
  const perm = document.createElement('div');
  perm.id = 'permanentSection';
  perm.className = 'permanent-bookmark-section';
  perm.innerHTML = '<div class="tree-item"></div>'.repeat(30);
  document.body.append(perm);

  assert.equal(runtime.window.__collectCanvasLoadedTreeNodeCount(), 140);

  // Lazy loading unloads temp-a (tree emptied, then card removed): count must not drop, otherwise auto-trigger flips back and forth
  a.innerHTML = '';
  CanvasState.unloadedTempSectionTrees.add('temp-a');
  assert.equal(runtime.window.__collectCanvasLoadedTreeNodeCount(), 140);
  a.remove();
  perm.classList.add('permanent-tree-unloaded');
  perm.innerHTML = '';
  assert.equal(runtime.window.__collectCanvasLoadedTreeNodeCount(), 140);

  // Deleted card no longer counts
  CanvasState.tempSections = [{ id: 'temp-b' }];
  assert.equal(runtime.window.__collectCanvasLoadedTreeNodeCount(), 80);
  // Rich-text lists in a card note are not bookmark tree nodes
  const empty = document.createElement('div');
  empty.id = 'temp-empty';
  empty.className = 'temp-canvas-node';
  empty.innerHTML = '<div class="temp-node-description"><ul>' + '<li>note</li>'.repeat(30) + '</ul></div>';
  document.body.append(empty);
  CanvasState.tempSections = [{ id: 'temp-b' }, { id: 'temp-empty' }];
  assert.equal(runtime.window.__collectCanvasLoadedTreeNodeCount(), 80);
});

test('lightbox: interrupting a smooth zoom keeps the anchor point still', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  container.innerHTML = runtime.window.__buildTiptapObservationDom('```mermaid\nflowchart TD\n  A --> B\n```');
  runtime.window.__postProcessCanvasObservationDom(container);
  runtime.window.__openCanvasMermaidLightbox(container.querySelector('.pele-diagram-container'));
  const overlay = runtime.window.document.querySelector('.canvas-mermaid-lightbox-overlay');
  const viewport = overlay.querySelector('.canvas-mermaid-lightbox-viewport');

  const anchor = { x: 200, y: 150 };
  const contentPointAt = () => {
    const s = overlay.__getScale();
    const t = overlay.__getTranslate();
    return { x: (anchor.x - t.x) / s, y: (anchor.y - t.y) / s };
  };
  const before = contentPointAt();
  viewport.dispatchEvent(new runtime.window.WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: anchor.x, clientY: anchor.y, bubbles: true, cancelable: true }));
  const targetScale = overlay.__getScale();
  // Pointer down mid-animation cancels the smooth zoom
  viewport.dispatchEvent(new runtime.window.MouseEvent('pointerdown', { clientX: 10, clientY: 10, button: 0, bubbles: true }));
  viewport.dispatchEvent(new runtime.window.MouseEvent('pointerup', { clientX: 10, clientY: 10, bubbles: true }));
  assert.equal(overlay.__getScale(), targetScale);
  const after = contentPointAt();
  assert.ok(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6, 'Content under the zoom anchor must not jump');
  overlay.__closeLightbox();
});

test('lightbox is modal for keyboard: canvas shortcuts are blocked, modifier keys still pass', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  container.innerHTML = runtime.window.__buildTiptapObservationDom('```mermaid\nflowchart TD\n  A --> B\n```');
  runtime.window.__postProcessCanvasObservationDom(container);
  runtime.window.__openCanvasMermaidLightbox(container.querySelector('.pele-diagram-container'));
  const overlay = runtime.window.document.querySelector('.canvas-mermaid-lightbox-overlay');

  const received = [];
  const onDocKey = (e) => received.push(e.key);
  runtime.window.document.addEventListener('keydown', onDocKey, true);
  const press = key => runtime.window.document.body.dispatchEvent(new runtime.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  press('Delete');
  press('z');
  press('ArrowLeft');
  press('Control');
  press('Shift');
  assert.deepEqual(received, ['Control', 'Shift']);

  overlay.__closeLightbox();
  press('Delete');
  assert.deepEqual(received, ['Control', 'Shift', 'Delete'], 'Keys reach the canvas again after closing');
  runtime.window.document.removeEventListener('keydown', onDocKey, true);
});

const openTestLightbox = () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  container.innerHTML = runtime.window.__buildTiptapObservationDom('```mermaid\nflowchart TD\n  A --> B\n```');
  runtime.window.__postProcessCanvasObservationDom(container);
  runtime.window.__openCanvasMermaidLightbox(container.querySelector('.pele-diagram-container'));
  const overlay = runtime.window.document.querySelector('.canvas-mermaid-lightbox-overlay');
  const viewport = overlay.querySelector('.canvas-mermaid-lightbox-viewport');
  const wheel = (init) => viewport.dispatchEvent(new runtime.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 200, clientY: 150, ...init }));
  return { overlay, wheel };
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('lightbox: releasing the zoom modifier stops zooming at once; normal scrolling resumes right after the guard window', async () => {
  const { overlay, wheel } = openTestLightbox();
  const startScale = overlay.__getScale();
  wheel({ deltaY: -8.5, ctrlKey: true });
  const target = overlay.__getScale();
  assert.ok(target > startScale, 'Ctrl+swipe queues a zoom-in');

  runtime.window.dispatchEvent(new runtime.window.KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true }));
  const frozen = overlay.__getScale();
  assert.ok(frozen < target, 'Releasing Ctrl stops the remaining zoom instead of finishing it');

  // A continuous scroll stream right after release (no gaps): blocked for 300ms only, then pans normally
  const t0 = overlay.__getTranslate();
  const start = Date.now();
  let pannedAt = null;
  while (Date.now() - start < 700) {
    const before = overlay.__getTranslate().y;
    wheel({ deltaY: 10 });
    if (pannedAt === null && overlay.__getTranslate().y !== before) pannedAt = Date.now() - start;
    await sleep(16);
  }
  assert.ok(pannedAt !== null, 'Normal scrolling resumes without needing another zoom');
  assert.ok(pannedAt >= 280 && pannedAt < 450, `Resumes once the 300ms guard ends (resumed at ${pannedAt}ms)`);
  assert.ok(overlay.__getTranslate().y < t0.y);
  assert.equal(overlay.__getScale(), frozen, 'No further zoom after release');
  overlay.__closeLightbox();
});

test('lightbox: a custom zoom key (Alt) gets the same release cut-off and scrolling recovers afterwards', async () => {
  const { window } = runtime;
  const state = window.CanvasState;
  window.canvasShortcuts.ctrlKey = 'Alt';
  state.physicalModifiers = { Control: false, Alt: true, Shift: false, Meta: false };
  try {
    const { overlay, wheel } = openTestLightbox();
    wheel({ deltaY: -10, altKey: true });
    await sleep(30);
    const zoomed = renderedScale(overlay);
    window.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Alt', code: 'AltLeft', bubbles: true }));
    state.physicalModifiers.Alt = false;
    // Inertia tail still flagged altKey: ignored, no further zoom
    for (let i = 0; i < 25; i++) { wheel({ deltaY: -8, altKey: true }); await sleep(16); }
    assert.equal(renderedScale(overlay), zoomed);
    // After the tail pauses, plain scrolling works again
    await sleep(200);
    const t = overlay.__getTranslate();
    wheel({ deltaY: 30 });
    assert.equal(overlay.__getTranslate().y, t.y - 30);
    overlay.__closeLightbox();
  } finally {
    window.canvasShortcuts.ctrlKey = 'Control';
    delete state.physicalModifiers;
  }
});

test('lightbox: zoom stream that loses its modifier mid-gesture never turns into a pan (keyup not yet received)', async () => {
  const { overlay, wheel } = openTestLightbox();
  wheel({ deltaY: -6.25, ctrlKey: true });
  await sleep(16);
  wheel({ deltaY: -6.25, ctrlKey: true });
  await sleep(16);
  wheel({ deltaY: 12 }); // first event without the modifier: zoom stops here
  const t0 = overlay.__getTranslate();
  const frozen = overlay.__getScale();
  for (let i = 0; i < 10; i++) {
    await sleep(16);
    wheel({ deltaY: 12 });
  }
  assert.deepEqual(overlay.__getTranslate(), t0, 'Events within 300ms after the last zoom neither pan nor keep zooming');
  assert.equal(overlay.__getScale(), frozen);

  // Physically pressing the modifier again inside the same stream resumes zooming
  runtime.window.CanvasState.physicalModifiers = { Control: true };
  const before = overlay.__getScale();
  await sleep(16);
  wheel({ deltaY: -6.25, ctrlKey: true });
  assert.ok(overlay.__getScale() > before);
  delete runtime.window.CanvasState.physicalModifiers;
  overlay.__closeLightbox();
});

test('editing a diagram selects its host blank card so the card toolbar shows with the text toolbar', () => {
  const { document, CanvasState } = runtime.window;
  const card = document.createElement('div');
  card.id = 'md-node-host-test';
  card.className = 'md-canvas-node';
  let editCalled = false;
  card.__enterEditMode = () => { editCalled = true; };
  document.body.append(card);
  card.innerHTML = runtime.window.__buildTiptapObservationDom('```mermaid\nflowchart TD\n  A --> B\n```');
  runtime.window.__postProcessCanvasObservationDom(card);

  runtime.window.__triggerDiagramParentEdit(card.querySelector('.pele-diagram-container'));
  assert.equal(editCalled, true);
  assert.ok(card.classList.contains('selected'), 'Host card should be selected');
  assert.equal(CanvasState.selectedMdNodeId, 'md-node-host-test');
});

const renderedScale = (overlay) => {
  const m = overlay.querySelector('.canvas-mermaid-lightbox-content').style.transform.match(/scale\(([^)]+)\)/);
  return m ? Number(m[1]) : NaN;
};

test('lightbox: modifier scroll zoom is applied directly (like the main canvas on macOS), no catch-up animation', async () => {
  const { overlay, wheel } = openTestLightbox();
  wheel({ deltaY: -12.5, ctrlKey: true });
  await sleep(16);
  wheel({ deltaY: -12.5, ctrlKey: true });
  const target = overlay.__getScale();
  await sleep(40);
  assert.ok(Math.abs(renderedScale(overlay) - target) < 1e-9, 'The next frame shows exactly the requested scale');
  await sleep(80);
  assert.ok(Math.abs(renderedScale(overlay) - target) < 1e-9, 'Nothing keeps moving once input stops');
  overlay.__closeLightbox();
});

test('lightbox: only Windows/Linux discrete wheel notches use the smooth zoom path', async () => {
  runtime.window.__isCanvasDiscreteWheelEvent = () => true;
  const { overlay, wheel } = openTestLightbox();
  const start = renderedScale(overlay);
  wheel({ deltaY: -120, ctrlKey: true });
  const target = overlay.__getScale();
  await sleep(20);
  const mid = renderedScale(overlay);
  assert.ok(mid > start && mid < target, 'Discrete notch eases toward the target');
  runtime.window.dispatchEvent(new runtime.window.KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true }));
  const frozen = renderedScale(overlay);
  await sleep(60);
  assert.equal(renderedScale(overlay), frozen, 'Releasing Ctrl freezes the eased zoom immediately');
  overlay.__closeLightbox();
  delete runtime.window.__isCanvasDiscreteWheelEvent;
});

test('editor live preview: mermaid renders when the caret is outside the block and shows source when inside', () => {
  const { document } = runtime.window;
  const container = document.createElement('div');
  document.body.append(container);
  const markdown = 'Intro text\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nOutro text';
  const instance = engine.create(container, { initialMarkdown: markdown });
  instances.push(instance);
  const editor = instance.editor;
  const pre = () => container.querySelector('pre');
  const preview = () => container.querySelector('.mermaid-live-preview');
  const focusText = (needle) => {
    let target = null;
    editor.state.doc.descendants((node, pos) => {
      if (target === null && node.isText && node.text.includes(needle)) target = pos + 1;
    });
    editor.commands.setTextSelection(target);
  };
  const codeBlockPos = () => {
    let p = null;
    editor.state.doc.descendants((node, pos) => { if (p === null && node.type.name === 'codeBlock') p = pos; });
    return p;
  };

  focusText('Outro');
  assert.ok(preview(), 'Diagram preview is shown while the caret is elsewhere');
  assert.ok(preview().querySelector('svg.pele-flowchart'));
  assert.ok(pre().classList.contains('mermaid-live-source-hidden'), 'Source is hidden');

  editor.commands.setTextSelection(codeBlockPos() + 3);
  assert.equal(preview(), null, 'Caret inside the block shows the source');
  assert.equal(pre().classList.contains('mermaid-live-source-hidden'), false);

  // Edit the source, then move away: the new source is rendered again
  const blockEnd = codeBlockPos() + editor.state.doc.nodeAt(codeBlockPos()).nodeSize - 1;
  editor.view.dispatch(editor.state.tr.insertText('\n  B --> C', blockEnd));
  assert.equal(preview(), null, 'Still editing inside the block');
  focusText('Intro');
  assert.ok(preview(), 'Moving the caret out re-renders the diagram');
  assert.match(preview().innerHTML, />C</, 'Preview reflects the edited source');

  // Clicking the preview twice (select, then click the selected diagram) puts the caret into the code block
  const click = el => el.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  click(preview());
  assert.ok(preview().classList.contains('pele-selected'));
  click(preview());
  assert.equal(preview(), null);
  assert.equal(editor.state.selection.$from.parent.type.name, 'codeBlock');

  // Preview is view-only: never serialized
  focusText('Outro');
  assert.ok(preview());
  assert.equal(instance.getMarkdown().trim(), 'Intro text\n\n```mermaid\nflowchart TD\n  A --> B\n  B --> C\n```\n\nOutro text');
  assert.doesNotMatch(editor.getHTML(), /mermaid-live|<svg/);
  const cleaned = runtime.window.__getCleanHtmlForStorage(container);
  assert.doesNotMatch(cleaned, /mermaid-live|<svg/);
});

test('editor live preview: invalid source shows an error preview that can be clicked to edit', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  const instance = engine.create(container, { initialMarkdown: 'Text\n\n```mermaid\nnot a diagram\n```' });
  instances.push(instance);
  instance.editor.commands.setTextSelection(2);
  const preview = container.querySelector('.mermaid-live-preview');
  assert.ok(preview);
  assert.match(preview.textContent, /Mermaid:/);
  preview.dispatchEvent(new runtime.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  assert.equal(container.querySelector('.mermaid-live-preview'), null);
  assert.equal(instance.getMarkdown().trim(), 'Text\n\n```mermaid\nnot a diagram\n```');
});

const pressPlainTyping = (editor) => {
  const event = new runtime.window.KeyboardEvent('keydown', {
    key: '\\', code: 'Backslash', keyCode: 220, ctrlKey: true, bubbles: true, cancelable: true,
  });
  editor.view.dom.dispatchEvent(event);
  return event;
};
const caretInCode = (editor) => {
  let pos = null;
  editor.state.doc.descendants((node, p) => { if (pos === null && node.type.name === 'codeBlock') pos = p; });
  editor.commands.setTextSelection(pos + 2);
};

test('plain typing (Ctrl/Cmd+\\) inside a mermaid block at the end of the card opens a new line below', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  const instance = engine.create(container, { initialMarkdown: 'Intro\n\n```mermaid\nflowchart TD\n  A --> B\n```' });
  instances.push(instance);
  const editor = instance.editor;
  caretInCode(editor);
  assert.equal(pressPlainTyping(editor).defaultPrevented, true);
  assert.equal(editor.state.selection.$from.parent.type.name, 'paragraph');
  assert.equal(editor.state.doc.lastChild.type.name, 'paragraph');
  assert.ok(container.querySelector('.mermaid-live-preview'), 'Leaving the block renders the diagram again');
  editor.view.dispatch(editor.state.tr.insertText('After'));
  assert.equal(instance.getMarkdown().trim(), 'Intro\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nAfter');
});

test('plain typing inside a code block jumps to the existing line below instead of adding another', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  const instance = engine.create(container, { initialMarkdown: '```mermaid\nflowchart TD\n  A --> B\n```\n\nBelow' });
  instances.push(instance);
  const editor = instance.editor;
  const childCount = editor.state.doc.childCount;
  caretInCode(editor);
  pressPlainTyping(editor);
  assert.equal(editor.state.doc.childCount, childCount);
  assert.equal(editor.state.selection.$from.parent.textContent, 'Below');
  assert.equal(editor.state.selection.$from.parentOffset, 0);
});

test('clicking the empty area below a trailing mermaid diagram starts a new paragraph there', () => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  const instance = engine.create(container, { initialMarkdown: 'Intro\n\n```mermaid\nflowchart TD\n  A --> B\n```' });
  instances.push(instance);
  const editor = instance.editor;
  editor.commands.setTextSelection(2);
  assert.ok(container.querySelector('.mermaid-live-preview'));
  const click = new runtime.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientY: 500 });
  editor.view.dom.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(editor.state.doc.lastChild.type.name, 'paragraph');
  assert.equal(editor.state.selection.$from.parent, editor.state.doc.lastChild);
  assert.ok(container.querySelector('.mermaid-live-preview'), 'Diagram stays rendered');

  // Doc not ending with a code block: native behaviour, nothing inserted
  // (ProseMirror's own mousedown hit-tests via elementFromPoint, which jsdom lacks)
  runtime.window.document.elementFromPoint = () => null;
  const count = editor.state.doc.childCount;
  editor.view.dom.dispatchEvent(new runtime.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientY: 500 }));
  assert.equal(editor.state.doc.childCount, count);
});

const pressKey = (editor, key, init = {}) => {
  const event = new runtime.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  editor.view.dom.dispatchEvent(event);
  return event;
};
const createLiveEditor = (markdown) => {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  const instance = engine.create(container, { initialMarkdown: markdown });
  instances.push(instance);
  // jsdom has no text layout; in the browser ProseMirror measures whether the caret is on the first/last visual line
  instance.editor.view.endOfTextblock = () => true;
  return { container, instance, editor: instance.editor };
};
const textPos = (editor, needle, atEnd = false) => {
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (found === null && node.isText && node.text.includes(needle)) found = pos + (atEnd ? node.text.length : 0);
  });
  return found;
};

test('arrow keys move into a rendered mermaid diagram from above, below, left and right', () => {
  const source = 'flowchart TD\n  A --> B';
  const { container, editor } = createLiveEditor('Intro\n\n```mermaid\n' + source + '\n```\n\nOutro');
  const inCode = () => editor.state.selection.$from.parent.type.name === 'codeBlock';
  const offset = () => editor.state.selection.$from.parentOffset;

  for (const [key, start, expectOffset] of [
    ['ArrowDown', () => textPos(editor, 'Intro') + 2, 0],
    ['ArrowRight', () => textPos(editor, 'Intro', true), 0],
    ['ArrowUp', () => textPos(editor, 'Outro') + 2, source.length],
    ['ArrowLeft', () => textPos(editor, 'Outro'), source.length],
  ]) {
    editor.commands.setTextSelection(start());
    assert.ok(container.querySelector('.mermaid-live-preview'), `${key}: diagram rendered before moving`);
    assert.equal(pressKey(editor, key).defaultPrevented, true, `${key} is handled`);
    assert.ok(inCode(), `${key} puts the caret into the mermaid source`);
    assert.equal(offset(), expectOffset, `${key} enters at the near edge of the source`);
    assert.equal(container.querySelector('.mermaid-live-preview'), null, `${key}: source is shown`);
  }
});

test('arrow keys keep native behaviour when not at a block edge or when the neighbour is not a rendered diagram', () => {
  const { editor } = createLiveEditor('Intro\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n```js\nconst a = 1;\n```');
  editor.commands.setTextSelection(textPos(editor, 'Intro') + 2);
  assert.equal(pressKey(editor, 'ArrowRight').defaultPrevented, false, 'Not at the end of the line');
  assert.equal(pressKey(editor, 'ArrowDown', { shiftKey: true }).defaultPrevented, false, 'Shift extends selection natively');
  editor.view.endOfTextblock = () => false;
  assert.equal(pressKey(editor, 'ArrowDown').defaultPrevented, false, 'Not on the last visual line');

  // From inside the js block, ArrowUp at the top goes into the rendered diagram above it
  editor.view.endOfTextblock = () => true;
  editor.commands.setTextSelection(textPos(editor, 'const') + 1);
  assert.equal(pressKey(editor, 'ArrowUp').defaultPrevented, true);
  assert.equal(String(editor.state.selection.$from.parent.attrs.language), 'mermaid');

  // Already showing source (caret inside): ArrowUp to Intro is native, not intercepted by us
  editor.commands.setTextSelection(textPos(editor, 'flowchart') + 1);
  assert.equal(pressKey(editor, 'ArrowUp').defaultPrevented, false);
});

test('arrow keys step from one diagram source straight into the next rendered diagram', () => {
  const { editor } = createLiveEditor('```mermaid\nflowchart TD\n  A --> B\n```\n\n```mermaid\nflowchart TD\n  C --> D\n```');
  editor.commands.setTextSelection(textPos(editor, 'A --> B', true));
  pressKey(editor, 'ArrowRight');
  assert.equal(editor.state.selection.$from.parent.textContent, 'flowchart TD\n  C --> D');
  assert.equal(editor.state.selection.$from.parentOffset, 0);
});

test('editing state: clicking a rendered diagram selects it and shows the same three buttons as read-only mode', () => {
  const { container, editor } = createLiveEditor('Intro\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nOutro');
  editor.commands.setTextSelection(textPos(editor, 'Outro') + 2);
  const selectionBefore = editor.state.selection.from;
  const preview = () => container.querySelector('.mermaid-live-preview');
  const mouse = (el, type) => {
    const ev = new runtime.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
    el.dispatchEvent(ev);
    return ev;
  };

  assert.equal(mouse(preview(), 'mousedown').defaultPrevented, true, 'Mousedown keeps editor focus and caret');
  mouse(preview(), 'click');
  assert.ok(preview(), 'Diagram stays rendered after the first click');
  assert.ok(preview().classList.contains('pele-selected'));
  const buttons = preview().querySelectorAll('.pele-diagram-toolbar .pele-diagram-toolbar-btn');
  assert.deepEqual(Array.from(buttons, b => b.getAttribute('aria-label')), ['预览大图', '编辑源码', '退出']);
  assert.equal(editor.state.selection.from, selectionBefore, 'Selecting the diagram does not move the caret');
  assert.equal(mouse(preview().querySelector('.pele-btn-edit'), 'mousedown').defaultPrevented, true, 'Toolbar does not steal focus');

  // Exit button deselects and keeps the diagram rendered
  mouse(preview().querySelector('.pele-btn-close'), 'click');
  assert.equal(preview().classList.contains('pele-selected'), false);
  assert.equal(preview().querySelector('.pele-diagram-toolbar'), null);

  // Esc deselects without ending the edit (handled inside the editor)
  mouse(preview(), 'click');
  const esc = new runtime.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(esc);
  assert.equal(esc.defaultPrevented, true);
  assert.equal(preview().classList.contains('pele-selected'), false);

  // Edit button opens the source of this block
  mouse(preview(), 'click');
  mouse(preview().querySelector('.pele-btn-edit'), 'click');
  assert.equal(preview(), null);
  assert.equal(String(editor.state.selection.$from.parent.attrs.language), 'mermaid');
});

test('editing state: preview button opens the lightbox for a live diagram', () => {
  const { container, editor } = createLiveEditor('Intro\n\n```mermaid\nflowchart TD\n  A --> B\n```');
  editor.commands.setTextSelection(2);
  const preview = container.querySelector('.mermaid-live-preview');
  preview.dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  preview.querySelector('.pele-btn-preview').dispatchEvent(new runtime.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  const overlay = runtime.window.document.querySelector('.canvas-mermaid-lightbox-overlay.active');
  assert.ok(overlay, 'Lightbox opens');
  assert.ok(overlay.querySelector('svg.pele-flowchart'));
  const md = new runtime.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  overlay.querySelector('.canvas-mermaid-lightbox-viewport').dispatchEvent(md);
  assert.equal(md.defaultPrevented, true, 'Clicking inside the lightbox does not move focus out of the editor');
  overlay.__closeLightbox();
  assert.ok(container.querySelector('.mermaid-live-preview'), 'Diagram still rendered in the editor after closing');
});

test('temporary note in edit mode: selecting a diagram, Esc and the lightbox do not end editing', async () => {
  const { window } = runtime;
  const fixture = window.createTempDescriptionFixture({ id: 'note-mermaid', descriptionMd: 'Note\n\n```mermaid\nflowchart TD\n  A --> B\n```' });
  fixture.enterEditingDescription();
  const editor = fixture.descriptionText.__tiptapInstance.rawEditor;
  editor.view.dom.focus();
  editor.commands.setTextSelection(2);
  const preview = () => fixture.descriptionText.querySelector('.mermaid-live-preview');
  assert.ok(preview(), 'Diagram renders inside the note editor');

  const mouse = (el, type) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  mouse(preview(), 'mousedown');
  mouse(preview(), 'click');
  assert.ok(preview().classList.contains('pele-selected'));
  editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(fixture.isEditing(), true, 'Esc only deselects the diagram');
  assert.equal(preview().classList.contains('pele-selected'), false);

  mouse(preview(), 'click');
  mouse(preview().querySelector('.pele-btn-preview'), 'mousedown');
  mouse(preview().querySelector('.pele-btn-preview'), 'click');
  const overlay = window.document.querySelector('.canvas-mermaid-lightbox-overlay.active');
  assert.ok(overlay);
  mouse(overlay.querySelector('.canvas-mermaid-lightbox-viewport'), 'mousedown');
  await sleep(150);
  assert.equal(fixture.isEditing(), true, 'Interacting with the lightbox keeps the note in edit mode');
  overlay.__closeLightbox();

  editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(fixture.isEditing(), false, 'A plain Esc still finishes editing as before');
});

test('editing state: the diagram selection clears when clicking elsewhere, even inside editors that stop mousedown propagation', () => {
  const { container, editor } = createLiveEditor('Intro\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nOutro');
  // Card editors stop mousedown from bubbling (to protect canvas dragging); reproduce that here
  ['mousedown', 'click', 'dblclick'].forEach(type => container.addEventListener(type, e => e.stopPropagation()));
  runtime.window.document.elementFromPoint = () => null;
  editor.commands.setTextSelection(textPos(editor, 'Outro') + 2);
  const preview = () => container.querySelector('.mermaid-live-preview');
  const mouse = (el, type) => el.dispatchEvent(new runtime.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  const select = () => { mouse(preview(), 'mousedown'); mouse(preview(), 'click'); assert.ok(preview().classList.contains('pele-selected')); };

  select();
  mouse(preview().querySelector('.pele-btn-close'), 'mousedown');
  assert.ok(preview().classList.contains('pele-selected'), 'Pressing its own toolbar keeps the selection');

  const paragraph = Array.from(container.querySelectorAll('p')).find(p => p.textContent === 'Intro');
  mouse(paragraph, 'mousedown');
  assert.equal(preview().classList.contains('pele-selected'), false, 'Clicking text in the same editor clears the selection');
  assert.equal(preview().querySelector('.pele-diagram-toolbar'), null, 'Toolbar removed');

  select();
  mouse(runtime.window.document.body, 'mousedown');
  assert.equal(preview().classList.contains('pele-selected'), false, 'Clicking outside the card clears the selection');

  select();
  editor.commands.setTextSelection(textPos(editor, 'Intro') + 1);
  assert.equal(preview().classList.contains('pele-selected'), false, 'Moving the caret clears the selection');

  select();
  editor.view.dispatch(editor.state.tr.insertText('x'));
  assert.equal(preview().classList.contains('pele-selected'), false, 'Typing clears the selection');
});

test('selecting another diagram moves the selection instead of keeping both selected', () => {
  const { container, editor } = createLiveEditor('```mermaid\nflowchart TD\n  A --> B\n```\n\nMiddle\n\n```mermaid\nflowchart TD\n  C --> D\n```');
  editor.commands.setTextSelection(textPos(editor, 'Middle') + 1);
  const [first, second] = container.querySelectorAll('.mermaid-live-preview');
  const mouse = (el, type) => el.dispatchEvent(new runtime.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  mouse(first, 'mousedown'); mouse(first, 'click');
  mouse(second, 'mousedown'); mouse(second, 'click');
  assert.equal(first.classList.contains('pele-selected'), false);
  assert.equal(second.classList.contains('pele-selected'), true);
  assert.equal(container.querySelectorAll('.pele-diagram-toolbar').length, 1);
});

test('lightbox enters the browser top layer on open (above top-layer format toolbars) and leaves it on close', () => {
  const proto = runtime.window.HTMLElement.prototype;
  const originalMatches = proto.matches;
  const calls = [];
  proto.showPopover = function () { calls.push('show'); this.__popoverOpen = true; };
  proto.hidePopover = function () { calls.push('hide'); this.__popoverOpen = false; };
  proto.matches = function (selector) {
    if (selector === ':popover-open') return !!this.__popoverOpen;
    return originalMatches.call(this, selector);
  };
  try {
    const { overlay } = openTestLightbox();
    assert.equal(overlay.getAttribute('popover'), 'manual');
    assert.deepEqual(calls, ['show']);
    overlay.__closeLightbox();
    assert.deepEqual(calls, ['show', 'hide']);
    // Re-opening re-enters the top layer so it stacks above popovers opened in the meantime
    const again = openTestLightbox();
    assert.deepEqual(calls, ['show', 'hide', 'show']);
    again.overlay.__closeLightbox();
  } finally {
    delete proto.showPopover;
    delete proto.hidePopover;
    proto.matches = originalMatches;
  }
});

test('lightbox help lists Shift + wheel horizontal scrolling, unless Shift is the custom zoom key', () => {
  const { overlay } = openTestLightbox();
  const hint = overlay.querySelector('.canvas-mermaid-lightbox-hint');
  assert.match(hint.textContent, /Shift \+ 滚轮：水平滚动/);
  assert.equal(hint.textContent.split('\n').length, 3);
  runtime.window.canvasShortcuts.ctrlKey = 'Shift';
  runtime.window.__updateCanvasMermaidLightboxHint(overlay);
  assert.doesNotMatch(hint.textContent, /水平滚动/);
  runtime.window.canvasShortcuts.ctrlKey = 'Control';
  overlay.__closeLightbox();
});

test('lightbox: inertia events that still carry ctrlKey after releasing Ctrl do not keep zooming (like the main canvas)', async () => {
  const { window } = runtime;
  const state = window.CanvasState;
  state.physicalModifiers = { Control: false, Alt: false, Shift: false, Meta: false };
  // Same rule as the canvas: ctrlKey without the physical key pressed looks like a trackpad pinch
  window.__isCanvasTouchpadPinch = e => !!e.ctrlKey && !state.physicalModifiers.Control;
  window.getCanvasTrackpadZoomFactor = rawDelta => Math.exp(rawDelta * 0.012);
  try {
    const { overlay, wheel } = openTestLightbox();
    const keyDown = () => { state.physicalModifiers.Control = true; window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', bubbles: true })); };
    const keyUp = () => { window.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true })); state.physicalModifiers.Control = false; };

    keyDown();
    for (let i = 0; i < 5; i++) { wheel({ deltaY: -7.5, ctrlKey: true }); await sleep(16); }
    keyUp();
    await sleep(20);
    const scale = renderedScale(overlay);
    const t0 = overlay.__getTranslate();

    // ~700ms decaying momentum tail, still flagged ctrlKey: true, Ctrl no longer physically held
    for (let i = 0, d = 7.5; i < 44; i++, d *= 0.95) {
      wheel({ deltaY: -d, ctrlKey: true });
      await sleep(16);
    }
    await sleep(40);
    assert.equal(renderedScale(overlay), scale, 'Zoom stops dead at release');
    assert.deepEqual(overlay.__getTranslate(), t0, 'No pan either');

    // A new, separate pinch gesture after the tail has ended zooms normally
    await sleep(400);
    wheel({ deltaY: -6.25, ctrlKey: true });
    assert.ok(overlay.__getScale() > scale, 'A later pinch is still accepted');

    overlay.__closeLightbox();
  } finally {
    delete window.__isCanvasTouchpadPinch;
    delete window.getCanvasTrackpadZoomFactor;
    delete state.physicalModifiers;
  }
});

test('lightbox: holding Ctrl keeps zooming, and re-pressing Ctrl right after a release zooms again', async () => {
  const { window } = runtime;
  const state = window.CanvasState;
  state.physicalModifiers = { Control: false, Alt: false, Shift: false, Meta: false };
  try {
    const { overlay, wheel } = openTestLightbox();
    state.physicalModifiers.Control = true;
    wheel({ deltaY: -10, ctrlKey: true });
    await sleep(30);
    const afterFirst = renderedScale(overlay);
    window.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true }));
    state.physicalModifiers.Control = false;
    await sleep(16);
    state.physicalModifiers.Control = true; // pressed again within the release window
    wheel({ deltaY: -10, ctrlKey: true });
    await sleep(30);
    assert.ok(renderedScale(overlay) > afterFirst, 'Physical Ctrl held again overrides the release guard');
    overlay.__closeLightbox();
  } finally {
    delete state.physicalModifiers;
  }
});
