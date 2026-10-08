/* 时空猪 · 藏身处场景单元测试：node test/hideout.test.mjs */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
for (const f of ['src/util.js', 'src/hideout.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const SP = globalThis.SP;

let pass = 0, fail = 0;
const out = [];
function test(name, fn) {
  try { fn(); pass++; out.push('  ✓ ' + name); }
  catch (e) { fail++; out.push('  ✗ ' + name + '\n      ' + (e && e.message)); }
}
const step = (h, input, seconds = 1) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) h.update(1 / 60, input);
};
const idle = { mx: 0, my: 0 };

test('藏身处初始化：玩家在场内，三个可交互物件齐全', () => {
  const h = new SP.Hideout();
  assert.equal(h.npcs.length, 3);
  assert.ok(h.npcs.some((n) => n.key === 'blacksmith' && n.panel === 'forge'));
  assert.ok(h.npcs.some((n) => n.key === 'merchant' && n.panel === 'shop'));
  assert.ok(h.npcs.some((n) => n.key === 'portal' && n.panel === 'portal'));
  assert.ok(h.props.length > 10, '应有装饰物: ' + h.props.length);
  assert.ok(h.player.x > 0 && h.player.x < h.width);
  assert.ok(h.player.y > 0 && h.player.y < h.height);
  assert.equal(h.nearby, null, '出生点不应正好贴着某个 NPC');
});

test('WASD 能移动玩家，松手后在一个身位内停下', () => {
  const h = new SP.Hideout();
  const x0 = h.player.x;
  step(h, { mx: 1, my: 0 }, 0.5);
  assert.ok(h.player.x > x0 + 40, '应向右移动: ' + (h.player.x - x0).toFixed(1));
  // 松手后会有一点减速滑行（阻尼是有意保留的手感），但不能滑出半个身位
  const x1 = h.player.x;
  step(h, idle, 1.0);
  const drift = Math.abs(h.player.x - x1);
  assert.ok(drift < h.player.r, '停下后滑行距离应小于自身半径: ' + drift.toFixed(1) + 'px');
  // 再等一会儿必须彻底静止
  const x2 = h.player.x;
  step(h, idle, 0.5);
  assert.ok(Math.abs(h.player.x - x2) < 0.5, '最终应完全静止: ' + Math.abs(h.player.x - x2).toFixed(3));
});

test('玩家无法走出藏身处边界', () => {
  const h = new SP.Hideout();
  step(h, { mx: 1, my: 1 }, 8);
  assert.ok(h.player.x <= h.width - 59 && h.player.y <= h.height - 59,
    `越界: ${h.player.x.toFixed(0)},${h.player.y.toFixed(0)}`);
  step(h, { mx: -1, my: -1 }, 16);
  assert.ok(h.player.x >= 59 && h.player.y >= 59,
    `越界: ${h.player.x.toFixed(0)},${h.player.y.toFixed(0)}`);
});

test('无法穿过装饰物与 NPC', () => {
  const h = new SP.Hideout();
  const fire = h.props.find((p) => p.kind === 'fire');
  h.player.x = fire.x; h.player.y = fire.y;
  h.update(1 / 60, idle);
  const dFire = SP.dist(h.player.x, h.player.y, fire.x, fire.y);
  assert.ok(dFire >= fire.r + h.player.r - 0.5, '篝火应把玩家推开: ' + dFire.toFixed(1));

  const smith = h.npcByKey('blacksmith');
  h.player.x = smith.x; h.player.y = smith.y;
  h.update(1 / 60, idle);
  const dNpc = SP.dist(h.player.x, h.player.y, smith.x, smith.y);
  assert.ok(dNpc >= smith.r + h.player.r - 0.5, 'NPC 应把玩家推开: ' + dNpc.toFixed(1));
});

test('走近 NPC 才会出现交互目标，走开就消失', () => {
  const h = new SP.Hideout();
  const smith = h.npcByKey('blacksmith');

  h.player.x = smith.x + 60; h.player.y = smith.y;
  h.update(1 / 60, idle);
  assert.ok(h.nearby, '靠近铁匠后应有交互目标');
  assert.equal(h.nearby.key, 'blacksmith');
  assert.equal(h.interact(), 'forge', '铁匠对应铁匠铺面板');
  assert.ok(h.promptText().includes('铁匠'), '提示文案应带上名字: ' + h.promptText());

  h.player.x = smith.x + 400; h.player.y = smith.y;
  h.update(1 / 60, idle);
  assert.equal(h.nearby, null, '走远后不应还有交互目标');
  assert.equal(h.interact(), null);
  assert.equal(h.promptText(), '');
});

test('商人 / 传送门 各自对应正确的面板', () => {
  const h = new SP.Hideout();
  const cases = [['merchant', 'shop'], ['portal', 'portal'], ['blacksmith', 'forge']];
  for (const [key, panel] of cases) {
    const n = h.npcByKey(key);
    h.player.x = n.x + 70; h.player.y = n.y;
    h.update(1 / 60, idle);
    assert.equal(h.nearby && h.nearby.key, key, '应识别到 ' + key);
    assert.equal(h.interact(), panel, key + ' 应打开 ' + panel);
  }
});

test('同时靠近多个物件时只认最近的一个', () => {
  const h = new SP.Hideout();
  const smith = h.npcByKey('blacksmith');
  // 站在铁匠与铁砧之间，离铁匠更近
  h.player.x = smith.x + 50; h.player.y = smith.y;
  h.update(1 / 60, idle);
  assert.equal(h.nearby.key, 'blacksmith');
  // 明显更靠近传送门时应切换过去
  const portal = h.npcByKey('portal');
  h.player.x = portal.x + 55; h.player.y = portal.y;
  h.update(1 / 60, idle);
  assert.equal(h.nearby.key, 'portal');
});

test('点击 NPC 坐标可选中该目标，点空地则落空', () => {
  const h = new SP.Hideout();
  const mer = h.npcByKey('merchant');
  assert.equal(h.clickAt(mer.x + 5, mer.y), true);
  assert.equal(h.nearby.key, 'merchant');
  assert.equal(h.clickAt(1110, 1300), false, '点空地不应命中');
});

test('相机会跟随玩家并被夹在场景内', () => {
  const h = new SP.Hideout();
  const view = { w: 1440, h: 810 };
  h.player.x = 300; h.player.y = 300;
  step(h, idle, 2);
  h.clampCamera(view.w, view.h);
  const limX = h.width / 2 - view.w / 2;
  const limY = h.height / 2 - view.h / 2;
  assert.ok(Math.abs(h.camera.x) <= limX + 0.001, '相机 X 越界: ' + h.camera.x.toFixed(1));
  assert.ok(Math.abs(h.camera.y) <= limY + 0.001, '相机 Y 越界: ' + h.camera.y.toFixed(1));

  // 相机应跟着玩家动
  const before = h.camera.x;
  h.player.x = 1900;
  step(h, idle, 2);
  h.clampCamera(view.w, view.h);
  assert.ok(h.camera.x > before, '玩家向右走，相机应跟上: ' + before.toFixed(0) + ' → ' + h.camera.x.toFixed(0));
});

test('步长无关性：不同帧率下移动距离接近', () => {
  const a = new SP.Hideout(), b = new SP.Hideout();
  for (let i = 0; i < 180; i++) a.update(1 / 60, { mx: -1, my: 0 });
  for (let i = 0; i < 90; i++) b.update(1 / 30, { mx: -1, my: 0 });
  const da = Math.abs(a.player.x - 1100), db = Math.abs(b.player.x - 1100);
  assert.ok(Math.abs(da - db) / Math.max(da, db) < 0.1, `步长差异过大: ${da.toFixed(1)} vs ${db.toFixed(1)}`);
});

test('长时间走动不产生 NaN、不卡进物件里', () => {
  const h = new SP.Hideout();
  const dirs = [{ mx: 1, my: 0 }, { mx: -1, my: 0 }, { mx: 0, my: 1 }, { mx: 0, my: -1 }, { mx: 1, my: 1 }, { mx: -1, my: -1 }];
  for (let i = 0; i < 60 * 60; i++) h.update(1 / 60, dirs[Math.floor(i / 300) % dirs.length]);
  assert.ok(Number.isFinite(h.player.x) && Number.isFinite(h.player.y), '坐标出现非法值');
  for (const p of h.props) {
    const d = SP.dist(h.player.x, h.player.y, p.x, p.y);
    assert.ok(d >= p.r + h.player.r - 1, `卡进了 ${p.kind}: 距离 ${d.toFixed(1)} < ${(p.r + h.player.r).toFixed(1)}`);
  }
});

console.log('\n时空猪 · 藏身处场景测试\n' + out.join('\n'));
console.log(`\n通过 ${pass} / ${pass + fail}` + (fail ? `  ✗ 失败 ${fail}` : '  ✓ 全部通过'));
process.exit(fail ? 1 : 0);
