/* 时空猪 · 打包为可双击运行的单文件 HTML：node tools/build.mjs
 * 把 index.html 中所有 <script src> 内联进同一个文件，产出 dist/ 下可直接双击打开的版本。
 * 单文件版本不依赖任何外部请求，因此在 file:// 下也能完整运行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { embedIcons } from './embed-icons.mjs';

const root = path.resolve(import.meta.dirname, '..');
const distDir = path.join(root, 'dist');
const icons = embedIcons(root);
console.log('图标: ' + icons.count + ' 张已写入 src/icons.js（' + icons.bytes + ' 字节）');

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const inlined = [];
html = html.replace(/[ \t]*<script src="([^"]+)"><\/script>\r?\n?/g, (m, src) => {
  const file = path.join(root, src);
  if (!fs.existsSync(file)) throw new Error('缺少脚本文件: ' + src);
  const code = fs.readFileSync(file, 'utf8');
  inlined.push(src + ' (' + code.length + ' 字节)');
  return '<script>\n/* ==================== ' + src + ' ==================== */\n' + code + '\n</script>\n';
});

/* 防卫式检查：单文件版本不允许残留任何外部资源引用 */
const leftovers = [];
for (const m of html.matchAll(/<script[^>]+src=/g)) leftovers.push(m[0]);
for (const m of html.matchAll(/<link[^>]+href=/g)) leftovers.push(m[0]);
if (leftovers.length) throw new Error('仍有外部引用未内联: ' + leftovers.join(', '));

fs.mkdirSync(distDir, { recursive: true });
const targets = ['时空猪.html', 'index.html'];
for (const name of targets) {
  fs.writeFileSync(path.join(distDir, name), html, 'utf8');
}

console.log('已内联 ' + inlined.length + ' 个脚本:');
inlined.forEach((s) => console.log('  - ' + s));
console.log('产出:');
targets.forEach((n) => console.log('  ✓ dist/' + n + '  (' + fs.statSync(path.join(distDir, n)).size + ' 字节)'));
console.log('可直接双击打开，无需服务器。');
