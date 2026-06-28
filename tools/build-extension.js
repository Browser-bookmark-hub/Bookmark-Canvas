const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const srcDir = path.join(rootDir, 'Bookmark-Canvas-main');
const distDir = path.join(rootDir, 'dist');
const zipFile = path.join(rootDir, 'release.zip');

console.log('===================================================');
console.log('🚀 开始打包构建 Chrome 扩展程序...');
console.log('===================================================');

// 1. 清理已有的打包输出
if (fs.existsSync(distDir)) {
    console.log('🧹 正在清理现有的 dist 目录...');
    fs.rmSync(distDir, { recursive: true, force: true });
}
if (fs.existsSync(zipFile)) {
    console.log('🧹 正在清理旧 of release.zip 压缩包...');
    fs.unlinkSync(zipFile);
}

fs.mkdirSync(distDir, { recursive: true });

// 递归遍历并处理目录下的文件
function processDirectory(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            // 忽略隐藏的系统目录（如 .git 等）
            if (entry.name.startsWith('.')) continue;
            processDirectory(srcPath, destPath);
        } else {
            const ext = path.extname(entry.name).toLowerCase();
            // 判断是否是第三方已经压缩过的库或在 vendor 目录下
            const isMinified = entry.name.includes('.min.') || 
                               srcPath.includes(path.sep + 'vendor' + path.sep);

            // 只针对未压缩过的自定义 JS/CSS 运行混淆压缩
            if ((ext === '.js' || ext === '.css') && !isMinified) {
                const relativePath = path.relative(srcDir, srcPath);
                console.log(`⚡ 压缩混淆中: ${relativePath}`);
                try {
                    // 使用 npx esbuild 无感拉取并执行压缩，保证开发机器无需全局安装依赖
                    execSync(`npx -y esbuild "${srcPath}" --minify --outfile="${destPath}"`, { stdio: 'ignore' });
                } catch (err) {
                    console.warn(`⚠️ esbuild 压缩文件 ${entry.name} 失败，将直接复制原文件。`, err.message);
                    fs.copyFileSync(srcPath, destPath);
                }
            } else {
                // 其他非 JS/CSS 文件、已压缩的文件或资源直接复制
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }
}

// 2. 处理所有资源
console.log('📂 正在处理源码并进行压缩优化...');
processDirectory(srcDir, distDir);
console.log('✅ 所有文件处理完成，已输出至 dist 目录。');

// 3. 将 dist 文件夹压缩为发布用的 zip 压缩包 (macOS 原生 zip 命令)
console.log('📦 正在打包为 release.zip...');
try {
    execSync(`zip -r "${zipFile}" .`, { cwd: distDir, stdio: 'ignore' });
    console.log('===================================================');
    console.log(`🎉 恭喜！打包成功！`);
    console.log(`📦 发布包位置: ${zipFile}`);
    console.log('===================================================');
} catch (err) {
    console.error('❌ 压缩 Zip 文件失败:', err.message);
}
