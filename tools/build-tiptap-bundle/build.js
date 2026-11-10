const esbuild = require('esbuild');
const path = require('path');

async function build() {
    const outfile = path.resolve(__dirname, '../../Bookmark-Canvas-main/history_html/vendor/canvas-editor-tiptap.bundle.js');
    console.log(`Building Tiptap Bundle to ${outfile}...`);
    
    try {
        await esbuild.build({
            entryPoints: [path.resolve(__dirname, 'entry.js')],
            bundle: true,
            minify: true,
            sourcemap: false,
            format: 'iife',
            globalName: 'CanvasTiptapModule',
            target: ['chrome100', 'es2020'],
            outfile: outfile,
            define: {
                'process.env.NODE_ENV': '"production"'
            }
        });
        console.log('Build completed successfully!');
    } catch (err) {
        console.error('Build failed:', err);
        process.exit(1);
    }
}

build();
