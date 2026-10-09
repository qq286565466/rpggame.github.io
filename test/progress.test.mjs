/* 时空猪 · 存档养成层测试：node test/progress.test.mjs */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
for (const f of ['src/util.js', 'src/items.js', 'src/sim.js', 'src/progress.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const SP = globalThis.SP, I = SP.Items, P = SP.Progress;

let pass = 0, fail = 0;
const out = [];
function test(name, fn) {
  try { fn(); pass++; out.push('  ✓ ' + name); }
  catch (e) { fail++; out.push('  ✗ ' + name + '\n      ' + (e && e.message)); }
}
function item(ilvl, slot, seed) {
  return I.roll(SP.makeRng(seed || 1), { ilvl: ilvl, slot: slot || 'weapon', rarityBias: 1.5 });
}
function richChar() {
  const ch = P.newCharacter('测试猪');
  ch.coins = 100000;
  ch.stones = 200;
  ch.materials.up = 500;
  ch.materials.re = 200;
  return ch;
}

test('新角色：1 级、空背包、空装备、初始牛排', () => {
  const ch = P.newCharacter('小猪');
  assert.equal(ch.level, 1);
  assert.equal(ch.xp, 0);
  assert.equal(ch.steaks, 3);
  assert.equal(ch.inventory.length, 0);
  I.EQUIP_SLOTS.forEach((s) => assert.equal(ch.equipped[s], null));
  assert.deepEqual(P.unlockedBiomes(ch), ['camp']);
  assert.equal(P.maxFloor(ch, 'camp'), 1);
  assert.deepEqual(ch.bestiary, {});
  assert.deepEqual(P.bestiaryProgress(ch), { found: 0, total: Object.keys(SP.ENEMY_TYPES).length });
});

test('旧版生存存档可迁移：保留货币，折算材料，送起手武器', () => {
  const old = {
    name: '老玩家', coins: 342, stones: 7, steaks: 5, runs: 9, kills: 120,
    perm: { maxHp: 3, damage: 2, speed: 1 }, stonePerm: { startLevel: 2, startShield: 1 },
    best: { wave: 12, kills: 200, time: 500 }
  };
  const ch = P.migrateV1(old);
  assert.equal(ch.name, '老玩家');
  assert.equal(ch.coins, 342);
  assert.equal(ch.stones, 7);
  assert.equal(ch.steaks, 5);
  assert.equal(ch.level, 1, '迁移后从 1 级重新开始装备养成');
  assert.ok(ch.materials.up > 0, '旧强化应折算成强化石: ' + ch.materials.up);
  assert.ok(ch.equipped.weapon, '应赠送起手武器');
  assert.equal(P.validItem(ch.equipped.weapon), true);
  assert.ok(P.clearedFloor(ch, 'camp') >= 1, '旧战绩应折算一部分进度');
  assert.equal(ch.stats.kills, 120);
});

test('normalize 修复残缺存档并丢弃损坏装备', () => {
  const broken = {
    name: 'x', level: -5, coins: -100, stones: 'abc', steaks: 99,
    inventory: [null, { uid: 'bad' }, item(10, 'weapon', 3)],
    equipped: { weapon: { uid: 'garbage', slot: 'weapon' }, ring1: item(5, 'ring', 4) },
    progress: { camp: 3.7 }, stats: null, materials: null
  };
  const ch = P.normalize(broken);
  assert.equal(ch.level, 1, '非法等级应被修正');
  assert.equal(ch.coins, 0);
  assert.equal(ch.stones, 0);
  assert.equal(ch.steaks, 9, '牛排应被夹到上限');
  assert.equal(ch.inventory.length, 1, '损坏物品应被剔除');
  assert.equal(ch.equipped.weapon, null, '损坏装备应被卸下');
  assert.ok(ch.equipped.ring1, '合法装备应保留');
  assert.equal(ch.progress.camp, 4);
  assert.ok(ch.materials && typeof ch.materials.up === 'number');
  assert.ok(ch.stats && typeof ch.stats.runs === 'number');
  I.EQUIP_SLOTS.forEach((s) => assert.ok(s in ch.equipped));
});

test('战利品入账受背包上限约束并返回溢出', () => {
  const ch = P.newCharacter();
  const many = [];
  for (let i = 0; i < P.INVENTORY_CAP + 5; i++) many.push(item(10, 'helm', 100 + i));
  const res = P.addLoot(ch, many);
  assert.equal(ch.inventory.length, P.INVENTORY_CAP);
  assert.equal(res.added, P.INVENTORY_CAP);
  assert.equal(res.overflow.length, 5, '溢出数量应正确');
  assert.equal(ch.stats.lootFound, P.INVENTORY_CAP);
});

test('从背包装备会与当前装备互换', () => {
  const ch = P.newCharacter();
  const a = item(10, 'weapon', 11), b = item(30, 'weapon', 12);
  ch.inventory.push(a, b);
  let r = P.equipFromBag(ch, a.uid);
  assert.equal(r.ok, true);
  assert.equal(ch.equipped.weapon.uid, a.uid);
  assert.equal(ch.inventory.length, 1);
  r = P.equipFromBag(ch, b.uid);
  assert.equal(r.ok, true);
  assert.equal(ch.equipped.weapon.uid, b.uid);
  assert.equal(ch.inventory.length, 1, '被替换的装备应回到背包');
  assert.equal(ch.inventory[0].uid, a.uid);
  assert.equal(P.equipFromBag(ch, 'not-exist').ok, false);
});

test('卸下装备在背包满时被拒绝', () => {
  const ch = P.newCharacter();
  ch.equipped.weapon = item(10, 'weapon', 20);
  assert.equal(P.unequip(ch, 'weapon').ok, true);
  assert.equal(ch.equipped.weapon, null);
  assert.equal(ch.inventory.length, 1);
  assert.equal(P.unequip(ch, 'helm').ok, false, '空槽位不能卸下');
  ch.equipped.ring1 = item(10, 'ring', 21);
  while (ch.inventory.length < P.INVENTORY_CAP) ch.inventory.push(item(1, 'boots', ch.inventory.length + 500));
  const r = P.unequip(ch, 'ring1');
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('背包已满'));
});

test('一键换装：戒指会正确落到 ring1/ring2 而不是野键', () => {
  const ch = P.newCharacter();
  const r1 = item(20, 'ring', 201), r2 = item(30, 'ring', 202), r3 = item(45, 'ring', 203);
  ch.inventory.push(r1, r2, r3);
  assert.equal(P.autoEquipBest(ch, 'ring').ok, true);
  assert.ok(ch.equipped.ring1, '第一枚戒指应进入 ring1');
  assert.equal('ring' in ch.equipped && ch.equipped.ring !== undefined, false, '不应写入裸 ring 键');
  assert.equal(P.autoEquipBest(ch, 'ring').ok, true);
  assert.ok(ch.equipped.ring2, '第二枚戒指应进入 ring2');
  // 第三枚更强，应替换掉较弱的一枚
  const before = [ch.equipped.ring1.uid, ch.equipped.ring2.uid];
  const r = P.autoEquipBest(ch, 'ring');
  if (r.ok) {
    const after = [ch.equipped.ring1.uid, ch.equipped.ring2.uid];
    assert.ok(after.includes(r3.uid), '最强戒指应被穿上');
    assert.notDeepEqual(after, before);
  }
  // 装齐后再调用不应无故替换
  const powers = [I.power(ch.equipped.ring1), I.power(ch.equipped.ring2)];
  const again = P.autoEquipBest(ch, 'ring');
  if (again.ok) assert.ok(I.power(again.item) > Math.min(...powers), '只有更强才应替换');
});

test('一键换装只换更强的同部位装备', () => {
  const ch = P.newCharacter();
  const weak = item(5, 'weapon', 31), strong = item(40, 'weapon', 32);
  ch.equipped.weapon = weak;
  ch.inventory.push(strong);
  const r = P.autoEquipBest(ch, 'weapon');
  assert.equal(r.ok, true);
  assert.equal(ch.equipped.weapon.uid, strong.uid);
  assert.equal(ch.inventory[0].uid, weak.uid, '旧装备应回背包');
  assert.equal(P.autoEquipBest(ch, 'weapon').ok, false, '已经是最好时不应再换');
  assert.equal(P.autoEquipBest(ch, 'amulet').ok, false, '没有该部位装备时不应成功');
});

test('强化：扣费正确、受上限约束、资源不足被拒', () => {
  const ch = richChar();
  const w = item(20, 'weapon', 41);
  ch.inventory.push(w);
  const p0 = I.power(w);
  const cost = I.upgradeCost(w);
  const coins0 = ch.coins, ups0 = ch.materials.up;
  const r = P.upgradeItem(ch, w.uid);
  assert.equal(r.ok, true);
  assert.equal(w.upgrade, 1);
  assert.equal(ch.coins, coins0 - cost.coins);
  assert.equal(ch.materials.up, ups0 - cost.stones);
  assert.ok(I.power(w) > p0, '强化应提升战力');

  const poor = richChar();
  poor.coins = 0;
  poor.inventory.push(w);
  assert.equal(P.upgradeItem(poor, w.uid).ok, false);

  const noStone = richChar();
  noStone.materials.up = 0;
  const w2 = item(20, 'weapon', 42);
  noStone.inventory.push(w2);
  const rr = P.upgradeItem(noStone, w2.uid);
  assert.equal(rr.ok, false);
  assert.ok(rr.reason.includes('强化石'));

  w.upgrade = I.UPGRADE_CAP;
  const capped = P.upgradeItem(ch, w.uid);
  assert.equal(capped.ok, false);
  assert.ok(capped.reason.includes('上限'));
});

test('重铸：需要词条与材料，会改变数值', () => {
  const ch = richChar();
  let withAffix = null;
  for (let i = 0; i < 200 && !withAffix; i++) {
    const c = item(30, 'weapon', 50 + i);
    if (c.affixes.length) withAffix = c;
  }
  assert.ok(withAffix, '应能抽到带词条的装备');
  ch.inventory.push(withAffix);
  const ups0 = ch.materials.re;
  const r = P.rerollItem(ch, withAffix.uid);
  assert.equal(r.ok, true);
  assert.equal(ch.materials.re, ups0 - 1);
  assert.ok(Number.isFinite(r.after));

  const plain = richChar();
  const noAffix = { uid: 'noaffix', slot: 'weapon', rarity: 'common', ilvl: 5, stats: { atk: 5 }, affixes: [], upgrade: 0, unique: null };
  plain.inventory.push(noAffix);
  const r2 = P.rerollItem(plain, 'noaffix');
  assert.equal(r2.ok, false, '没有词条的装备不能重铸');
  assert.equal(P.rerollItem(plain, 'missing').ok, false);
});

test('分解与出售：产出材料/金币，已装备的不可操作', () => {
  const ch = richChar();
  const it = item(25, 'armor', 61);
  ch.inventory.push(it);
  const up0 = ch.materials.up, re0 = ch.materials.re;
  const y = I.salvageYield(it);
  const r = P.salvage(ch, it.uid);
  assert.equal(r.ok, true);
  assert.equal(ch.materials.up, up0 + y.stones);
  assert.equal(ch.materials.re, re0 + y.rerolls);
  assert.equal(ch.inventory.length, 0);

  const it2 = item(25, 'armor', 62);
  ch.inventory.push(it2);
  const c0 = ch.coins;
  const price = I.sellPrice(it2);
  assert.equal(P.sell(ch, it2.uid).ok, true);
  assert.equal(ch.coins, c0 + price);

  ch.equipped.helm = item(25, 'helm', 63);
  assert.equal(P.salvage(ch, ch.equipped.helm.uid).ok, false, '已装备不能分解');
  assert.equal(P.sell(ch, ch.equipped.helm.uid).ok, false, '已装备不能出售');
});

test('批量分解只清理低于阈值的装备', () => {
  const ch = P.newCharacter();
  const low = item(3, 'helm', 71), mid = item(20, 'helm', 72), high = item(60, 'helm', 73);
  ch.inventory.push(low, mid, high);
  const threshold = I.power(mid);
  const res = P.salvageBelow(ch, threshold - 1);
  assert.ok(res.removed >= 1, '应至少清理掉低战力装备');
  assert.ok(ch.inventory.some((i) => i.uid === high.uid), '高战力装备必须保留');
  assert.ok(res.stones > 0);
});

test('上锁：可切换锁定，阻止分解/出售，批量清理跳过', () => {
  const ch = richChar();
  const bag = item(20, 'weapon', 81);
  const worn = item(20, 'helm', 82);
  ch.inventory.push(bag);
  ch.equipped.helm = worn;

  assert.equal(!!bag.locked, false);
  const t1 = P.toggleLock(ch, bag.uid);
  assert.equal(t1.ok, true);
  assert.equal(t1.locked, true);
  assert.equal(bag.locked, true);

  assert.equal(P.salvage(ch, bag.uid).ok, false, '上锁装备不可分解');
  assert.equal(P.sell(ch, bag.uid).ok, false, '上锁装备不可出售');
  assert.equal(ch.inventory.length, 1, '上锁后仍应留在背包');

  const t2 = P.toggleLock(ch, worn.uid);
  assert.equal(t2.ok, true);
  assert.equal(worn.locked, true);

  const set = P.setLocked(ch, bag.uid, false);
  assert.equal(set.ok, true);
  assert.equal(bag.locked, false);
  assert.equal(P.salvage(ch, bag.uid).ok, true, '解锁后可分解');

  const keep = item(5, 'ring', 83);
  const junk = item(5, 'boot', 84);
  keep.locked = true;
  ch.inventory.push(keep, junk);
  const before = ch.inventory.length;
  const res = P.salvageBelow(ch, 1e9);
  assert.ok(res.removed >= 1);
  assert.ok(res.skippedLocked >= 1, '应报告跳过上锁件数');
  assert.ok(ch.inventory.some((i) => i.uid === keep.uid), '上锁装备不能被批量分解');
  assert.ok(!ch.inventory.some((i) => i.uid === junk.uid), '未上锁低战力应被清理');
  assert.ok(ch.inventory.length < before);

  assert.equal(P.toggleLock(ch, 'missing-uid').ok, false);
  assert.equal(P.setLocked(ch, 'missing-uid', true).ok, false);
});

test('normalize 将 locked 规范为布尔值', () => {
  const it = item(10, 'weapon', 91);
  it.locked = 1;
  const ch = P.normalize({
    name: '锁猪',
    inventory: [it],
    equipped: { weapon: Object.assign({}, item(10, 'weapon', 92), { locked: 'yes' }) }
  });
  assert.equal(ch.inventory[0].locked, true);
  assert.equal(ch.equipped.weapon.locked, true);
});

test('副本解锁按前一区域通关层数递进', () => {
  const ch = P.newCharacter();
  assert.deepEqual(P.unlockedBiomes(ch), ['camp']);
  ch.progress.camp = 2;
  assert.deepEqual(P.unlockedBiomes(ch), ['camp'], '营地未通 3 层不应解锁森林');
  ch.progress.camp = 3;
  assert.deepEqual(P.unlockedBiomes(ch), ['camp', 'forest']);
  ch.progress.forest = 4;
  assert.deepEqual(P.unlockedBiomes(ch), ['camp', 'forest', 'cave']);
  ch.progress.cave = 5;
  assert.deepEqual(P.unlockedBiomes(ch), ['camp', 'forest', 'cave', 'nest']);
  assert.equal(P.isUnlocked(ch, 'nest'), true);
  assert.equal(P.isUnlocked(ch, 'cave'), true);
  ch.progress.camp = 0; ch.progress.forest = 0; ch.progress.cave = 0;
  assert.equal(P.isUnlocked(ch, 'forest'), false, '清空前置应重新锁上');
  assert.equal(P.maxFloor(ch, 'camp'), 1);
  ch.progress.camp = 7;
  assert.equal(P.maxFloor(ch, 'camp'), 8, '可进入已通关层数 +1');
});

test('结算入账：货币材料战利品与进度一并写入', () => {
  const ch = P.newCharacter();
  const loot = [item(20, 'weapon', 81), item(20, 'helm', 82)];
  const summary = {
    biome: 'camp', floor: 3, cleared: true, kills: 40, coins: 260, stones: 5,
    upStones: 7, reStones: 2, loot: loot,
    killsByKey: { calf: { kills: 30, elites: 2 }, alpha: { kills: 1, elites: 0 } }
  };
  const res = P.bankRun(ch, summary);
  assert.equal(ch.coins, 260);
  assert.equal(ch.stones, 5);
  assert.equal(ch.materials.up, 7);
  assert.equal(ch.materials.re, 2);
  assert.equal(ch.inventory.length, 2);
  assert.equal(ch.progress.camp, 3, '通关应推进进度');
  assert.equal(ch.stats.clears, 1);
  assert.equal(ch.stats.runs, 1);
  assert.equal(ch.stats.kills, 40);
  assert.equal(res.lootAdded, 2);
  assert.deepEqual(res.unlocked, ['camp', 'forest'], '通关营地 3 层后森林应已解锁');
  assert.equal(ch.stats.bestFloor.camp, 3);
  assert.equal(ch.bestiary.calf.kills, 30);
  assert.equal(ch.bestiary.calf.elites, 2);
  assert.equal(ch.bestiary.alpha.kills, 1);
  assert.ok(P.isDiscovered(ch, 'calf'));
  assert.equal(P.isDiscovered(ch, 'queen'), false);
  assert.equal(res.bestiaryFound, 2);

  const death = { biome: 'forest', floor: 1, cleared: false, kills: 12, coins: 30, stones: 0, upStones: 1, reStones: 0, loot: [] };
  P.bankRun(ch, death);
  assert.equal(ch.stats.deaths, 1);
  assert.equal(ch.progress.forest, 0, '未通关不应推进进度');
  assert.equal(ch.stats.runs, 2);
});

test('图鉴：normalize 清洗坏数据，catalog 覆盖全部群系', () => {
  const ch = P.normalize({
    name: '图鉴猪',
    bestiary: {
      calf: { kills: '12', elites: 1 },
      nope: { kills: 9 },
      bat: { kills: 0, elites: 0 }
    }
  });
  assert.equal(ch.bestiary.calf.kills, 12);
  assert.equal(ch.bestiary.calf.elites, 1);
  assert.equal(ch.bestiary.nope, undefined);
  assert.equal(ch.bestiary.bat, undefined);
  const catalog = P.bestiaryCatalog(ch);
  assert.equal(catalog.length, 4);
  assert.equal(catalog.reduce((n, g) => n + g.entries.length, 0), Object.keys(SP.ENEMY_TYPES).length);
  const camp = catalog.find((g) => g.biome === 'camp');
  assert.ok(camp.entries.find((e) => e.key === 'calf').discovered);
  assert.ok(!camp.entries.find((e) => e.key === 'bat').discovered);
});

test('通关营地 3 层后森林解锁', () => {
  const ch = P.newCharacter();
  for (let f = 1; f <= 3; f++) {
    P.bankRun(ch, { biome: 'camp', floor: f, cleared: true, kills: 20, coins: 10, stones: 0, upStones: 0, reStones: 0, loot: [] });
  }
  assert.equal(ch.progress.camp, 3);
  assert.ok(P.isUnlocked(ch, 'forest'), '通关营地 3 层应解锁森林');
});

test('牛排购买：价格、上限与余额校验', () => {
  const ch = P.newCharacter();
  ch.coins = 100;
  ch.steaks = 3;
  const r = P.buySteak(ch, 1);
  assert.equal(r.ok, true);
  assert.equal(ch.coins, 100 - P.STEAK_PRICE);
  assert.equal(ch.steaks, 4);
  ch.steaks = 9;
  assert.equal(P.buySteak(ch, 1).ok, false, '超过携带上限应被拒');
  ch.steaks = 0; ch.coins = 0;
  assert.equal(P.buySteak(ch, 1).ok, false, '金币不足应被拒');
});

test('神秘商人：消耗秘宝换取高品质装备，背包满时被拒', () => {
  const ch = P.newCharacter();
  ch.stones = P.MYSTERY_COST * 3;
  const s0 = ch.stones;
  const r = P.buyMysteryItem(ch, 30, 'weapon');
  assert.equal(r.ok, true);
  assert.equal(ch.stones, s0 - P.MYSTERY_COST);
  assert.equal(ch.inventory.length, 1);
  assert.ok(I.RARITY_BY_KEY[r.item.rarity].index >= 1, '应至少是精良: ' + r.item.rarity);

  ch.stones = 0;
  assert.equal(P.buyMysteryItem(ch, 30, 'weapon').ok, false);
  ch.stones = 100;
  while (ch.inventory.length < P.INVENTORY_CAP) ch.inventory.push(item(1, 'boots', ch.inventory.length + 900));
  assert.equal(P.buyMysteryItem(ch, 30, 'weapon').ok, false, '背包满时应被拒');
});

test('全套装备后的角色属性明显强于裸装', () => {
  const bare = P.newCharacter();
  const geared = P.newCharacter();
  geared.level = 20;
  const rng = SP.makeRng(777);
  ['weapon', 'helm', 'armor', 'boots', 'amulet', 'ring', 'ring'].forEach((slot) => {
    const it = I.roll(rng, { ilvl: 40, slot, rarityBias: 2 });
    I.equipInto(geared, it);
  });
  const a = SP.deriveCharacter(bare), b = SP.deriveCharacter(geared);
  assert.ok(b.damage > a.damage * 3, `攻击力应大幅提升: ${a.damage.toFixed(0)} → ${b.damage.toFixed(0)}`);
  assert.ok(b.maxHp > a.maxHp * 2, `生命应大幅提升: ${a.maxHp.toFixed(0)} → ${b.maxHp.toFixed(0)}`);
  assert.equal(P.equippedCount(geared), 7, '七个槽位应装满');
});

console.log('\n时空猪 · 存档养成层测试\n' + out.join('\n'));
console.log(`\n通过 ${pass} / ${pass + fail}` + (fail ? `  ✗ 失败 ${fail}` : '  ✓ 全部通过'));
process.exit(fail ? 1 : 0);
