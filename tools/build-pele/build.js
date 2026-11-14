const path = require('node:path');
const fs = require('node:fs');

// Resolve esbuild from sibling build-tiptap-bundle tool
const esbuildPath = path.resolve(__dirname, '../build-tiptap-bundle/node_modules/esbuild');
const esbuild = require(esbuildPath);

const peleMainRoot = '/Users/kk/Downloads/pele-main';
const entryPoint = path.join(peleMainRoot, 'src/index.ts');
const outfile = path.resolve(__dirname, '../../Bookmark-Canvas-main/history_html/vendor/pele.min.js');

async function build() {
    console.log(`Building Pele.js from ${entryPoint}...`);
    if (!fs.existsSync(entryPoint)) {
        throw new Error(`Pele source entry not found at ${entryPoint}`);
    }

    const bannerText = `/*! Pele 1.13.0 | MIT License | https://github.com/obsidianmd/pele | Bundled for Bookmark Canvas */`;
    const footerText = `if (typeof window !== 'undefined') { window.pele = pele; } if (typeof globalThis !== 'undefined') { globalThis.pele = pele; }`;

    await esbuild.build({
        entryPoints: [entryPoint],
        bundle: true,
        minify: true,
        sourcemap: false,
        format: 'iife',
        globalName: 'pele',
        target: ['chrome100', 'es2020'],
        charset: 'utf8',
        legalComments: 'none',
        banner: { js: bannerText },
        footer: { js: footerText },
        outfile: outfile
    });

    const stat = fs.statSync(outfile);
    console.log(`Build complete! Output: ${outfile} (${(stat.size / 1024).toFixed(1)} kB)`);
}

build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
