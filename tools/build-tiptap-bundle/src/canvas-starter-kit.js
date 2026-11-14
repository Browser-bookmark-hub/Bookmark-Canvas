import StarterKit from '@tiptap/starter-kit';
import { registerCustomProtocol } from 'linkifyjs';

// 内置协议与常见协议白名单：杜绝对 linkify 已有协议重复注册
const registeredProtocols = new Set(['http', 'https', 'ftp', 'ftps', 'mailto', 'obsidian', 'chrome-extension']);

// 模块加载时，立即在 linkify 首次初始化前完成自定义协议注册（避免后续反复报 already initialized）
try {
  registerCustomProtocol('obsidian');
  registerCustomProtocol('chrome-extension');
} catch (_) { }

/** Let the shared boundary command exit inline marks without inserting a space. */
export default StarterKit.extend({
  addExtensions() {
    return this.parent().map(extension => (
      extension.name === 'link'
        ? extension.extend({
            exitable: false,
            onCreate() {
              if (this.options.validate && !this.options.shouldAutoLink) {
                this.options.shouldAutoLink = this.options.validate;
              }
              // 幂等守卫：防止每个卡片编辑器实例创建时重复注册 protocols 触发 linkifyjs 控制台告警
              this.options.protocols.forEach(protocol => {
                const scheme = typeof protocol === 'string' ? protocol : protocol.scheme;
                if (!scheme || registeredProtocols.has(scheme)) return;
                registeredProtocols.add(scheme);
                try {
                  if (typeof protocol === 'string') {
                    registerCustomProtocol(protocol);
                  } else {
                    registerCustomProtocol(protocol.scheme, protocol.optionalSlashes);
                  }
                } catch (_) { }
              });
            },
          })
        : extension
    ));
  },
});
