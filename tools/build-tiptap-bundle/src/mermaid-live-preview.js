import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Obsidian 风格的 Mermaid 实时预览（编辑态）：
 * - 光标/选区不在 ```mermaid 代码块内时，隐藏源码并在原位显示 Pele 渲染的图；
 * - 光标进入代码块（点击预览图、或选区移入）时显示源码；移出后自动重新渲染。
 * 预览只是视图装饰（Decoration），不进入文档、Markdown 与 HTML 序列化。
 */
export const mermaidLivePreviewKey = new PluginKey('canvasMermaidLivePreview');

const PREVIEW_CACHE_LIMIT = 32;
const previewCache = new Map();

const isMermaidBlock = node => node.type.name === 'codeBlock'
  && String((node.attrs && node.attrs.language) || '').toLowerCase() === 'mermaid';

const hashSource = (text) => {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

function renderMermaidPreview(source) {
  if (previewCache.has(source)) return previewCache.get(source);
  const pele = typeof window !== 'undefined' ? window.pele : null;
  if (!pele || typeof pele.render !== 'function') return null;
  const normalize = typeof window.__normalizeMermaidDiagramKeyword === 'function'
    ? window.__normalizeMermaidDiagramKeyword
    : (code => code);
  let result;
  try {
    const out = pele.render(normalize(source));
    result = out && typeof out.svg === 'string' ? { svg: out.svg } : null;
  } catch (err) {
    result = { error: (err && err.message) ? err.message : String(err) };
  }
  if (!result) return null;
  if (previewCache.size >= PREVIEW_CACHE_LIMIT) previewCache.delete(previewCache.keys().next().value);
  previewCache.set(source, result);
  return result;
}

function buildPreviewDom(view, getPos, preview) {
  const wrapper = document.createElement('div');
  wrapper.className = 'pele-diagram-container mermaid-live-preview';
  wrapper.contentEditable = 'false';
  if (preview.svg) {
    wrapper.innerHTML = preview.svg;
    wrapper.querySelectorAll('a[href]').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
  } else {
    const badge = document.createElement('div');
    badge.className = 'pele-diagram-error-badge';
    badge.textContent = `Mermaid: ${preview.error}`;
    wrapper.appendChild(badge);
  }
  // 进入源码：把光标放进对应代码块开头（装饰随之移除，显示源码）
  const editSource = () => {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (!Number.isInteger(pos) || !view.editable) return;
    const node = view.state.doc.nodeAt(pos);
    if (!node || !isMermaidBlock(node)) return;
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  };
  // 供画布的三键工具栏「编辑源码」、以及再次点击已选中的图时调用
  wrapper.__mermaidEditSource = editSource;
  const fromToolbarOrLink = event => !!(event.target && event.target.closest
    && event.target.closest('.pele-diagram-toolbar, a[href]'));

  // 与观察态一致：单击选中并显示左上角三键工具栏；再次单击已选中的图 / 双击进入源码。
  // mousedown 阻止默认行为，保持编辑器焦点与当前光标，避免卡片/备注因失焦退出编辑。
  wrapper.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || fromToolbarOrLink(event)) return;
    event.preventDefault();
  });
  wrapper.addEventListener('click', (event) => {
    if (event.button !== 0 || fromToolbarOrLink(event)) return;
    event.preventDefault();
    const select = typeof window !== 'undefined' ? window.__selectCanvasMermaidDiagram : null;
    if (wrapper.classList.contains('pele-selected') || typeof select !== 'function') {
      editSource();
    } else {
      select(wrapper);
    }
  });
  wrapper.addEventListener('dblclick', (event) => {
    if (fromToolbarOrLink(event)) return;
    event.preventDefault();
    editSource();
  });
  return wrapper;
}

// 光标所在文本块在 dir 方向上紧邻的块（逐层向外找第一个存在的兄弟节点）
function adjacentBlock(state, dir) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const boundary = dir > 0 ? $from.after(depth) : $from.before(depth);
    const $boundary = state.doc.resolve(boundary);
    const node = dir > 0 ? $boundary.nodeAfter : $boundary.nodeBefore;
    if (node) return { node, pos: dir > 0 ? boundary : boundary - node.nodeSize };
  }
  return null;
}

const ARROW_DIRECTIONS = { ArrowUp: ['up', -1], ArrowLeft: ['left', -1], ArrowDown: ['down', 1], ArrowRight: ['right', 1] };

/**
 * 方向键进入已渲染的 Mermaid 图：源码被隐藏（display:none）时，浏览器原生的上下移动会直接跳过它，
 * 这里在光标即将离开当前文本块、且相邻块正是已渲染的 Mermaid 图时，把光标放进其源码（向下/右进入开头，向上/左进入末尾）。
 */
function handleSelectedPreviewKey(view, event) {
  if (event.key !== 'Escape' || event.isComposing) return false;
  if (!view.dom.querySelector('.mermaid-live-preview.pele-selected')) return false;
  const deselect = typeof window !== 'undefined' ? window.__deselectCanvasMermaidDiagram : null;
  if (typeof deselect === 'function') deselect();
  else view.dom.querySelectorAll('.mermaid-live-preview.pele-selected').forEach(el => el.classList.remove('pele-selected'));
  return true;
}

function handleArrowIntoPreview(view, event) {
  const direction = ARROW_DIRECTIONS[event.key];
  if (!direction || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || view.composing) return false;
  const { state } = view;
  const { selection } = state;
  if (!selection.empty || !selection.$from.parent.isTextblock) return false;
  const [textDir, dir] = direction;
  const { $from } = selection;
  if (textDir === 'left' && $from.parentOffset !== 0) return false;
  if (textDir === 'right' && $from.parentOffset !== $from.parent.content.size) return false;
  if (textDir === 'up' || textDir === 'down') {
    let atEdge = false;
    try { atEdge = view.endOfTextblock(textDir); } catch (_) { atEdge = false; }
    if (!atEdge) return false;
  }
  const target = adjacentBlock(state, dir);
  if (!target || !isMermaidBlock(target.node)) return false;
  const decorations = mermaidLivePreviewKey.getState(state);
  if (!decorations || decorations.find(target.pos, target.pos + target.node.nodeSize).length === 0) return false;
  const caret = dir > 0 ? target.pos + 1 : target.pos + target.node.nodeSize - 1;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, caret)).scrollIntoView());
  return true;
}

function buildDecorations(state) {
  const { from, to } = state.selection;
  const decorations = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return;
    if (!isMermaidBlock(node)) return false;
    const contentStart = pos + 1;
    const contentEnd = pos + node.nodeSize - 1;
    if (from <= contentEnd && to >= contentStart) return false;
    const source = (node.textContent || '').trim();
    if (!source) return false;
    const preview = renderMermaidPreview(source);
    if (!preview) return false;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'mermaid-live-source-hidden' }));
    decorations.push(Decoration.widget(pos, (view, getPos) => buildPreviewDom(view, getPos, preview), {
      side: -1,
      key: `mermaid-live-${hashSource(source)}`,
      ignoreSelection: true,
      stopEvent: () => true,
    }));
    return false;
  });
  return DecorationSet.create(state.doc, decorations);
}

export default Extension.create({
  name: 'canvasMermaidLivePreview',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mermaidLivePreviewKey,
        state: {
          init: (_, state) => buildDecorations(state),
          apply: (tr, previous, _oldState, newState) => (
            (tr.docChanged || tr.selectionSet) ? buildDecorations(newState) : previous
          ),
        },
        // 选中图并不产生事务；之后任何移动光标/输入的事务都说明用户已转向别处，取消图的选中
        view: () => ({
          update: (view, prevState) => {
            if (view.state.selection.eq(prevState.selection) && view.state.doc.eq(prevState.doc)) return;
            if (!view.dom.querySelector('.mermaid-live-preview.pele-selected')) return;
            const deselect = typeof window !== 'undefined' ? window.__deselectCanvasMermaidDiagram : null;
            if (typeof deselect === 'function') deselect();
            else view.dom.querySelectorAll('.mermaid-live-preview.pele-selected').forEach(el => el.classList.remove('pele-selected'));
          },
        }),
        props: {
          decorations: state => mermaidLivePreviewKey.getState(state),
          // Esc 先取消图的选中（不退出编辑），其余方向键进入源码
          handleKeyDown: (view, event) => handleSelectedPreviewKey(view, event) || handleArrowIntoPreview(view, event),
          handleDOMEvents: {
            // 文末是代码块（渲染后的 Mermaid 图尤其明显）时，点击其下方空白处新起一行普通段落，便于继续输入
            mousedown: (view, event) => {
              if (event.button !== 0 || event.target !== view.dom || !view.editable) return false;
              const { doc, schema } = view.state;
              const last = doc.lastChild;
              if (!last || last.type.name !== 'codeBlock' || !schema.nodes.paragraph) return false;
              const children = Array.from(view.dom.children);
              for (let i = children.length - 1; i >= 0; i--) {
                const rect = children[i].getBoundingClientRect();
                if (rect.width > 0 || rect.height > 0) {
                  if (event.clientY <= rect.bottom) return false;
                  break;
                }
              }
              event.preventDefault();
              const end = doc.content.size;
              const tr = view.state.tr.insert(end, schema.nodes.paragraph.create());
              tr.setSelection(TextSelection.create(tr.doc, end + 1));
              view.dispatch(tr.scrollIntoView());
              view.focus();
              return true;
            },
          },
        },
      }),
    ];
  },
});
