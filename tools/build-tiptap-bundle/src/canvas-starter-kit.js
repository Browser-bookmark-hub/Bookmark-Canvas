import StarterKit from '@tiptap/starter-kit';

/** Let the shared boundary command exit inline marks without inserting a space. */
export default StarterKit.extend({
  addExtensions() {
    return this.parent().map(extension => (
      extension.name === 'code' || extension.name === 'link'
        ? extension.extend({ exitable: false })
        : extension
    ));
  },
});
