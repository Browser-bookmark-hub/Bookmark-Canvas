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
  instances.forEach(instance => instance.destroy());
  runtime.close();
});
function create(source) {
  const container = runtime.window.document.createElement('div');
  runtime.window.document.body.append(container);
  const instance = engine.create(container, { initialMarkdown: source });
  instances.push(instance);
  return instance;
}
const json = value => JSON.parse(JSON.stringify(value));
function assertRoundTrip(source) {
  const instance = create(source);
  // Exercise the serializer even when the untouched-source guard would return input verbatim.
  const markdown = instance.rawEditor.storage.markdown.getMarkdown();
  const reloaded = create(markdown);
  assert.deepEqual(json(reloaded.rawEditor.getJSON()), json(instance.rawEditor.getJSON()), markdown);
  return { instance, markdown, reloaded };
}

test('literal entities and HTML-looking text survive edits and legacy normalization', () => {
  const instance = create('');
  const literal = 'Literal &copy; and <span> and &lt;tag&gt;';
  instance.insertContent({ type: 'text', text: literal });
  const markdown = instance.getMarkdown();
  const repaired = runtime.window.__repairLegacyCanvasMarkdownSource(markdown);
  assert.equal(repaired, markdown);
  assert.equal(create(repaired).getText(), literal);
  assert.equal(runtime.window.__htmlToMarkdown('<p>Literal &amp;copy; and &lt;span&gt;</p>'), 'Literal &amp;copy; and &lt;span&gt;');
});

test('legacy repair does not rewrite code or decode valid Markdown entities', () => {
  for (const source of [
    '`&amp;lt;span&amp;gt;`',
    '``a ` <br> ## ## b``',
    '```html\n&lt;span&gt;\n## ## literal\n```',
    '````md\n```\n## ## literal\n````',
    '~~~html\n&lt;br&gt;\n## ## literal\n~~~',
    '> ```md\n> ## ## literal\n> ```',
    '    ## ## literal',
    '```md\n## ## unterminated',
    '&lt;span&gt; &amp;copy; &amp;amp;',
  ]) {
    assert.equal(runtime.window.__repairLegacyCanvasMarkdownSource(source), source);
  }
  assert.equal(runtime.window.__repairLegacyCanvasMarkdownSource('<h2>## Title<br>1. Body</h2>'), '## Title  \n1. Body');
});

test('untouched Markdown is retained, including after undo and silent setMarkdown', () => {
  const source = '*italic*\n\n- [ ] task\n';
  const instance = create(source);
  assert.equal(instance.getMarkdown(), source);
  instance.insertContent({ type: 'text', text: 'changed ' });
  assert.notEqual(instance.getMarkdown(), source);
  instance.rawEditor.commands.undo();
  assert.equal(instance.getMarkdown(), source);
  instance.setMarkdown('_replacement_\n');
  assert.equal(instance.getMarkdown(), '_replacement_\n');
});

test('native details preserve rich summary, body, nesting and open state after edits', () => {
  const source = '<details open><summary><strong>Title</strong></summary><p>Body</p><details><summary>Nested</summary><p>Inner</p></details></details>';
  const { instance } = assertRoundTrip(source);
  assert.equal(instance.container.querySelectorAll('details').length, 2);
  instance.rawEditor.commands.insertContentAt(instance.rawEditor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: 'After' }] });
  const reloaded = create(runtime.window.__repairLegacyCanvasMarkdownSource(instance.getMarkdown()));
  assert.deepEqual(json(reloaded.rawEditor.getJSON()), json(instance.rawEditor.getJSON()));
  assert.match(engine.renderStaticHTML(source), /<details open="">/);
  assert.equal(runtime.window.__htmlToMarkdown(source), source);
});

test('table pipes stay inside their cells, including code, formatting and links', () => {
  for (const cell of ['x \\| y', '`x \\| y`', '**x \\| y**', '[x](https://example.com/a\\|b)', 'x \\\\| y']) {
    assertRoundTrip(`| A | B |\n| --- | --- |\n| ${cell} | z |`);
  }
});

test('HTML table conversion preserves pipe data and complex cell structure', () => {
  const html = '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>x | y</td><td>z</td></tr></tbody></table>';
  const markdown = runtime.window.__htmlToMarkdown(html);
  assert.match(markdown, /x \\\| y/);
  const reloaded = create(markdown);
  assert.deepEqual(Array.from(reloaded.container.querySelectorAll('td'), cell => cell.textContent), ['x | y', 'z']);
  for (const rich of [
    '<table><tbody><tr><td colspan="2"><p>merged</p></td></tr></tbody></table>',
    '<table><tbody><tr><th><p>A</p></th></tr><tr><td><p>First</p><p>Second</p></td></tr></tbody></table>',
    '<table><tbody><tr><th align="right"><p>A</p></th></tr><tr><td align="right"><p>Value</p></td></tr></tbody></table>',
    '<table><tbody><tr><td><p>No header</p></td></tr></tbody></table>',
    '<table><tbody><tr><th><p>A</p></th></tr><tr><td><p>First<br>Second</p></td></tr></tbody></table>',
  ]) {
    const { instance } = assertRoundTrip(rich);
    const converted = runtime.window.__htmlToMarkdown(rich);
    assert.match(converted, /<table>/);
    assert.deepEqual(json(create(converted).rawEditor.getJSON()), json(instance.rawEditor.getJSON()));
  }
});

test('aligned HTML conversion retains inline formatting', () => {
  const html = '<p style="text-align: center"><strong>bold</strong> <mark>highlight</mark></p>';
  assertRoundTrip(runtime.window.__htmlToMarkdown(html));
  const rendered = engine.renderStaticHTML(runtime.window.__htmlToMarkdown(html));
  assert.match(rendered, /<strong>bold<\/strong>/);
  assert.match(rendered, /<mark>highlight<\/mark>/);
});

test('aligned headings and HTML blocks convert inline Markdown syntax into marks', () => {
  const heading = '<h1 style="text-align: center">**居中粗体** ==高亮==</h1>';
  const repairedHeading = runtime.window.__repairLegacyCanvasMarkdownSource(heading);
  assert.match(repairedHeading, /<strong>居中粗体<\/strong>/);
  assert.match(repairedHeading, /<mark>高亮<\/mark>/);
  const renderedHeading = engine.renderStaticHTML(repairedHeading);
  assert.match(renderedHeading, /<strong>居中粗体<\/strong>/);
  assert.match(renderedHeading, /<mark>高亮<\/mark>/);

  const center = '<center>**居中粗体** `code` *斜体* ~~删除~~</center>';
  const repairedCenter = runtime.window.__repairLegacyCanvasMarkdownSource(center);
  assert.match(repairedCenter, /<strong>居中粗体<\/strong>/);
  assert.match(repairedCenter, /<code>code<\/code>/);
  assert.match(repairedCenter, /<em>斜体<\/em>/);
  assert.match(repairedCenter, /<s>删除<\/s>/);

  const summary = '<details><summary>**折叠标题**</summary>内容</details>';
  const repairedSummary = runtime.window.__repairLegacyCanvasMarkdownSource(summary);
  assert.match(repairedSummary, /<strong>折叠标题<\/strong>/);
});

test('static URLs are clickable and existing image/CJK/highlight behavior remains intact', () => {
  assert.match(engine.renderStaticHTML('https://example.com'), /href="https:\/\/example.com"/);
  assert.match(engine.renderStaticHTML('www.example.com'), /href="http:\/\/www.example.com"/);
  assertRoundTrip('**注意：**请先备份 ==高亮== <u>下划线</u>');
  const instance = create('');
  instance.insertContent('![icon](data:image/png;base64,aGVsbG8=)');
  assert.equal(instance.container.querySelector('img[src]').alt, 'icon');
});

test('repeated parsing keeps plugin rules constant', () => {
  const instance = create('==mark==\n\n- [ ] task');
  const parser = instance.rawEditor.storage.markdown.parser.md;
  const counts = () => [parser.inline.ruler.__rules__.length, parser.core.ruler.__rules__.length];
  const before = counts();
  for (let i = 0; i < 25; i++) instance.setMarkdown('==mark==\n\n- [ ] task');
  assert.deepEqual(counts(), before);
});
