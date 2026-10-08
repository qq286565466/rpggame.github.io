/* 把 assets/icons/icon-*.png 收成 src/icons.js 里的 data URI。
 * 单文件版本不发外部图片请求，双击 dist 也能显示图标。
 */
import fs from 'node:fs';
import path from 'node:path';

export function embedIcons(root) {
  const dir = path.join(root, 'assets', 'icons');
  const files = fs.readdirSync(dir).filter((f) => /^icon-.+\.png$/.test(f)).sort();
  if (!files.length) throw new Error('assets/icons 里没有 icon-*.png');
  const entries = files.map((f) => {
    const key = f.slice('icon-'.length, -'.png'.length);
    const b64 = fs.readFileSync(path.join(dir, f)).toString('base64');
    return '    ' + key + ": 'data:image/png;base64," + b64 + "'";
  });
  const js = `/* 时空猪 · 装备像素图标。由 tools/embed-icons.mjs 根据 assets/icons 生成。 */
(function (global) {
  'use strict';
  var SP = global.SP || (global.SP = {});

  var URLS = {
${entries.join(',\n')}
  };

  /** 空槽、以及旧存档里没有 base 字段时，用这个部位的代表图标 */
  var FALLBACK = {
    weapon: 'sword', helm: 'ironhelm', armor: 'vest', boots: 'lightboots',
    amulet: 'amulet', ring: 'coinring', ring1: 'coinring', ring2: 'signet'
  };

  var cache = {};
  function url(key) { return URLS[key] || null; }
  function image(key) {
    var u = url(key);
    if (!u || typeof Image === 'undefined') return null;
    if (!cache[key]) {
      var img = new Image();
      img.src = u;
      cache[key] = img;
    }
    return cache[key];
  }
  function forItem(item) {
    if (item && item.base && URLS[item.base]) return item.base;
    if (item && item.slot && FALLBACK[item.slot]) return FALLBACK[item.slot];
    return null;
  }

  if (typeof Image !== 'undefined') {
    Object.keys(URLS).forEach(function (k) { image(k); });
  }

  SP.ItemIcons = { url: url, image: image, fallback: FALLBACK, forItem: forItem };
})(typeof window !== 'undefined' ? window : globalThis);
`;
  const out = path.join(root, 'src', 'icons.js');
  fs.writeFileSync(out, js);
  return { count: files.length, bytes: Buffer.byteLength(js) };
}

if (process.argv[1] && process.argv[1].endsWith('embed-icons.mjs')) {
  const root = path.resolve(import.meta.dirname, '..');
  const info = embedIcons(root);
  console.log('已写入 src/icons.js：' + info.count + ' 张，' + info.bytes + ' 字节');
}
