import { Code } from '@tiptap/extension-code';
import { markInputRule, markPasteRule } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';

/**
 * Obsidian 风格智能行内代码匹配器：
 * 1. 兼容双反引号 ``文字``（CommonMark 标准与 Obsidian 语法）
 * 2. 兼容单反引号 `文字`（标准 Markdown）
 * 3. 兼容全角反引号 ｀文字｀ 与 ｀｀文字｀｀（中文输入法全角模式）
 * 4. 兼容中文间隔号 ·文字·（macOS 拼音输入法下 Esc 键下方按键默认输出符号）
 * 5. 杜绝围栏代码块 ``` 误伤
 */
export const findCodeInput = (text) => {
  // 1. 双反引号 ``code``
  const doubleMatch = /(?:^|[^`])(``([^`\n]+)``)$/.exec(text);
  if (doubleMatch) {
    const rawSpan = doubleMatch[1];
    return {
      index: text.length - rawSpan.length,
      text: rawSpan,
      replaceWith: doubleMatch[2],
    };
  }

  // 2. 单反引号 `code`（确保开头不被多余的反引号前置）
  const singleMatch = /(?:^|[^`])(`([^`\n]+)`)$/.exec(text);
  if (singleMatch) {
    const rawSpan = singleMatch[1];
    return {
      index: text.length - rawSpan.length,
      text: rawSpan,
      replaceWith: singleMatch[2],
    };
  }

  // 3. 双全角反引号 ｀｀code｀｀
  const doubleFullwidthMatch = /(?:^|[^｀])(｀｀([^｀\n]+)｀｀)$/.exec(text);
  if (doubleFullwidthMatch) {
    const rawSpan = doubleFullwidthMatch[1];
    return {
      index: text.length - rawSpan.length,
      text: rawSpan,
      replaceWith: doubleFullwidthMatch[2],
    };
  }

  // 4. 单全角反引号 ｀code｀（确保开头不被多余的全角反引号前置）
  const singleFullwidthMatch = /(?:^|[^｀])(｀([^｀\n]+)｀)$/.exec(text);
  if (singleFullwidthMatch) {
    const rawSpan = singleFullwidthMatch[1];
    return {
      index: text.length - rawSpan.length,
      text: rawSpan,
      replaceWith: singleFullwidthMatch[2],
    };
  }

  // 5. 中文间隔号 ·code·（macOS 中文输入法下 ~ 键默认输出）
  const dotMatch = /(?:^|[^·])(·([^·\n]+)·)$/.exec(text);
  if (dotMatch) {
    const rawSpan = dotMatch[1];
    return {
      index: text.length - rawSpan.length,
      text: rawSpan,
      replaceWith: dotMatch[2],
    };
  }

  return null;
};

export const findCodePaste = (text) => {
  const regex = /(?:^|[^`])(`{1,2}([^`\n]+)`{1,2})(?!`)|(?:^|[^｀])(｀{1,2}([^｀\n]+)｀{1,2})(?!｀)|(?:^|[^·])(·([^·\n]+)·)(?!·)/g;
  const matches = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    const rawSpan = m[1] || m[3] || m[5];
    const innerText = m[2] || m[4] || m[6];
    const index = m.index + (m[0].length - rawSpan.length);
    matches.push({
      index,
      text: rawSpan,
      replaceWith: innerText,
    });
  }
  return matches;
};

export default Code.extend({
  exitable: false,

  addInputRules() {
    return [
      markInputRule({
        find: findCodeInput,
        type: this.type,
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: findCodePaste,
        type: this.type,
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      new Plugin({
        props: {
          handleKeyDown: (view, event) => {
            // Obsidian 选区自动包裹体验（Auto-Surround）：选中文本按反引号直接转化为行内代码
            if (event.isComposing || event.keyCode === 229 || view.composing || event.altKey || event.ctrlKey || event.metaKey) {
              return false;
            }
            if (event.key === '`' || event.key === '｀') {
              const { selection } = view.state;
              if (selection instanceof TextSelection && !selection.empty) {
                return this.editor.commands.toggleCode();
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});
