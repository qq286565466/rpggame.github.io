/* 时空猪 · 装备系统单元测试：node test/items.test.mjs */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
for (const f of ['src/util.js', 'src/items.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const SP = globalThis.SP;
const I = SP.Items;

let pass = 0, fail = 0;
const out = [];
function test(name, fn) {
  try { fn(); pass++; out.push('  ✓ ' + name); }
  catch (e) { fail++; out.push('  ✗ ' + name + '\n      ' + e.message); }
}

/** 生成 n 件装备 */
function sample(seed, n, opts) {
  const rng = SP.makeRng(seed);
  const list = [];
  for (let i = 0; i < n; i++) list.push(I.roll(rng, opts || { ilvl: 20 }));
  return list;
}

test('roll 生成结构完整的装备', () => {
  const list = sample(1, 400);
  for (const it of list) {
    assert.ok(I.DROP_SLOTS.includes(it.slot), '部位非法: ' + it.slot);
    assert.ok(I.RARITY_BY_KEY[it.rarity], '稀有度非法: ' + it.rarity);
    assert.equal(it.ilvl, 20);
    assert.ok(it.name && it.name.length > 1, '缺少名字');
    assert.ok(it.uid, '缺少 uid');
    assert.ok(Object.keys(it.stats).length > 0, '没有任何属性');
    assert.equal(it.upgrade, 0);
    for (const k of Object.keys(it.stats)) {
      assert.ok(I.STAT_META[k], '出现未登记属性: ' + k);
      assert.ok(Number.isFinite(it.stats[k]), '属性值非数值: ' + k);
    }
  }
});

test('uid 不重复', () => {
  const list = sample(2, 600);
  const set = new Set(list.map((i) => i.uid));
  assert.equal(set.size, list.length, '存在重复 uid');
});

test('相同种子生成完全一致的装备内容（uid 除外，身份必须始终唯一）', () => {
  const strip = (l) => l.map((it) => { const c = { ...it }; delete c.uid; return c; });
  const a = strip(sample(777, 20, { ilvl: 33 }));
  const b = strip(sample(777, 20, { ilvl: 33 }));
  assert.deepEqual(a, b, '同种子的装备内容应一致');
});

test('词条数量符合稀有度区间', () => {
  const list = sample(3, 900, { ilvl: 25 });
  for (const it of list) {
    const r = I.RARITY_BY_KEY[it.rarity];
    assert.ok(it.affixes.length >= r.affix[0] && it.affixes.length <= r.affix[1],
      `${it.rarity} 词条数 ${it.affixes.length} 超出 [${r.affix}]`);
    assert.equal(it.affixes.length, new Set(it.affixes.map((a) => a.key)).size, '词条重复');
    // 词条属性必须已并入 stats
    for (const af of it.affixes) assert.ok(it.stats[af.key] > 0 || it.stats[af.key] < 0, '词条未并入属性');
  }
});

test('传说装备必定带独特效果，其余稀有度不带', () => {
  const list = sample(4, 1500, { ilvl: 30, rarityBias: 0.6 });
  let legendary = 0;
  for (const it of list) {
    if (it.rarity === 'legendary') {
      legendary++;
      assert.ok(it.unique && I.UNIQUE_BY_KEY[it.unique], '传说缺少独特效果');
    } else {
      assert.equal(it.unique, null, it.rarity + ' 不应有独特效果');
    }
  }
  assert.ok(legendary > 0, '样本中没有出现传说装备');
});

test('稀有度分布合理：普通最多、传说最稀有', () => {
  const list = sample(5, 4000, { ilvl: 20 });
  const count = {};
  list.forEach((i) => { count[i.rarity] = (count[i.rarity] || 0) + 1; });
  assert.ok((count.common || 0) > (count.rare || 0), '普通应多于稀有');
  assert.ok((count.rare || 0) > (count.epic || 0), '稀有应多于史诗');
  assert.ok((count.legendary || 0) / list.length < 0.03, '传说出现率过高: ' + (count.legendary || 0) / list.length);
  assert.ok((count.legendary || 0) > 0, '应偶尔出现传说');
});

test('掉落幸运 / rarityBias 提升高稀有度产出', () => {
  const plain = sample(6, 3000, { ilvl: 20 });
  const lucky = sample(6, 3000, { ilvl: 20, luck: 1.5, rarityBias: 0.8 });
  const high = (l) => l.filter((i) => I.RARITY_BY_KEY[i.rarity].index >= 2).length;
  assert.ok(high(lucky) > high(plain) * 1.5,
    `幸运应显著提升高稀有度: ${high(plain)} → ${high(lucky)}`);
});

test('物品等级越高，属性与战力越强', () => {
  const low = sample(7, 300, { ilvl: 5 });
  const high = sample(7, 300, { ilvl: 50 });
  const avg = (l) => l.reduce((s, i) => s + I.power(i), 0) / l.length;
  assert.ok(avg(high) > avg(low) * 2.5, `高等级战力应远超低等级: ${avg(low).toFixed(0)} → ${avg(high).toFixed(0)}`);
});

test('同部位同等级下，稀有度越高平均战力越强', () => {
  const rng = SP.makeRng(8);
  const byRarity = {};
  for (let i = 0; i < 30000; i++) {
    const it = I.roll(rng, { ilvl: 40, slot: 'armor' });
    (byRarity[it.rarity] = byRarity[it.rarity] || []).push(I.power(it));
  }
  const avg = (k) => {
    const l = byRarity[k] || [];
    return l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0;
  };
  const order = I.RARITIES.map((r) => r.key);
  for (let i = 1; i < order.length; i++) {
    assert.ok(avg(order[i]) > avg(order[i - 1]),
      `${order[i]}(${avg(order[i]).toFixed(0)}) 应强于 ${order[i - 1]}(${avg(order[i - 1]).toFixed(0)})`);
  }
});

test('词条占比合理，且部位预算生效（首饰不会掷出重甲量级的平坦属性）', () => {
  const rng = SP.makeRng(9);
  let ratioSum = 0, n = 0;
  const flatBySlot = {};
  for (let i = 0; i < 6000; i++) {
    const it = I.roll(rng, { ilvl: 60 });
    if (it.affixes.length) {
      const affixSum = it.affixes.reduce((s, a) => s + Math.abs(a.value), 0);
      const total = Object.values(I.itemStats(it)).reduce((s, v) => s + Math.abs(v), 0);
      if (total > 0) { ratioSum += affixSum / total; n++; }
    }
    (flatBySlot[it.slot] = flatBySlot[it.slot] || []).push(it);
  }
  const avgRatio = ratioSum / n;
  assert.ok(avgRatio > 0.15, '词条占比过低: ' + avgRatio.toFixed(3));

  // 同一等级下，护甲部位的平坦生命词条应显著高于戒指
  const flatHp = (slot) => {
    const vals = [];
    for (const it of flatBySlot[slot] || []) {
      for (const a of it.affixes) if (a.key === 'hp') vals.push(a.value);
    }
    return vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : 0;
  };
  const armorHp = flatHp('armor'), ringHp = flatHp('ring');
  assert.ok(armorHp > 0 && ringHp > 0, '样本不足: armor=' + armorHp + ' ring=' + ringHp);
  assert.ok(armorHp > ringHp * 1.8, `护甲生命词条应远高于戒指: ${armorHp.toFixed(0)} vs ${ringHp.toFixed(0)}`);
});

test('强化每级 +7%，且受上限约束', () => {
  const it = sample(9, 1, { ilvl: 20 })[0];
  const before = I.itemStats(it).atk || 0;
  it.upgrade = 1;
  const after = I.itemStats(it).atk || 0;
  assert.ok(Math.abs(after / before - 1.07) < 1e-9, '一级强化应为 1.07 倍');
  it.upgrade = I.UPGRADE_CAP;
  assert.equal(I.canUpgrade(it), false, '达到上限后不应还能强化');
  assert.ok(Math.abs(I.upgradeMult(it) - (1 + 0.07 * I.UPGRADE_CAP)) < 1e-9);
});

test('强化费用随等级与物品等级上升', () => {
  const a = sample(10, 1, { ilvl: 10 })[0];
  const b = sample(11, 1, { ilvl: 40 })[0];
  assert.ok(I.upgradeCost(b).coins > I.upgradeCost(a).coins, '高 ilvl 更贵');
  const c0 = I.upgradeCost(a).coins;
  a.upgrade = 5;
  assert.ok(I.upgradeCost(a).coins > c0, '强化等级越高越贵');
  assert.ok(I.upgradeCost(a).stones >= 1);
});

test('强化成本保持在够得着的区间（整套满强化 ≈ 20~30 局收入）', () => {
  // 旧式 1.42^lv 让七件满强化要 19 万金币，而 20 局累计收入只有 1,377 —— 金币变死资源。
  for (const ilvl of [8, 16, 24]) {
    const item = { ilvl, rarity: 'rare', upgrade: 0 };
    let coins = 0, stones = 0;
    for (let lv = 0; lv < I.UPGRADE_CAP; lv++) {
      item.upgrade = lv;
      const c = I.upgradeCost(item);
      coins += c.coins;
      stones += c.stones;
    }
    assert.ok(coins < 120000, `ilvl ${ilvl} 单件满强化 ${coins} 金币，超出预算`);
    assert.ok(stones <= 66, `ilvl ${ilvl} 单件满强化 ${stones} 强化石，超出预算`);
    // 单调性：不能出现高等级比低等级便宜
    item.upgrade = I.UPGRADE_CAP - 1;
    const top = I.upgradeCost(item).coins;
    item.upgrade = 0;
    assert.ok(top > I.upgradeCost(item).coins, '末级必须最贵');
  }
});

test('分解返还强化投入，不会让投资凭空蒸发', () => {
  const item = { ilvl: 16, rarity: 'rare', upgrade: 0 };
  const bare = I.salvageYield(item);
  const inv = I.upgradeInvested(item);
  assert.ok(inv.coins === 0 && inv.stones === 0, '未强化装备没有投入');

  item.upgrade = 8;
  const invested = I.upgradeInvested(item);
  const y = I.salvageYield(item);
  assert.ok(invested.coins > 0 && invested.stones > 0, '强化后应记录投入');
  assert.ok(y.coins > 0, '分解强化过的装备应返还金币');
  assert.ok(y.stones > bare.stones, '分解强化过的装备应返还更多强化石');
  assert.ok(y.coins < invested.coins, '返还应低于投入（不是无痛拆装）');
  assert.ok(y.stones < invested.stones + bare.stones, '返还的强化石应低于总投入');
});

test('重铸保留词条种类、重新掷数值', () => {
  const rng = SP.makeRng(12);
  // 抽到一件确实带词条的装备（普通稀有度允许 0 词条）
  let it = null;
  for (let i = 0; i < 200 && !it; i++) {
    const cand = I.roll(rng, { ilvl: 30, rarityBias: 1 });
    if (cand.affixes.length > 0) it = cand;
  }
  assert.ok(it, '未能抽到带词条的装备');
  const before = it.affixes.map((a) => ({ key: a.key, value: a.value }));
  let changed = 0;
  for (let i = 0; i < 12; i++) {
    I.reroll(rng, it);
    assert.deepEqual(it.affixes.map((a) => a.key), before.map((a) => a.key), '词条种类不应变化');
    if (it.affixes.some((a, idx) => Math.abs(a.value - before[idx].value) > 1e-6)) changed++;
  }
  assert.ok(changed > 0, '重铸应能改变数值');
  for (const af of it.affixes) {
    assert.ok(Number.isFinite(af.value) && Number.isFinite(it.stats[af.key]), '重铸后出现非法数值');
  }
});

test('分解与售价随稀有度、物品等级提升', () => {
  const rng = SP.makeRng(13);
  const lvlList = [1, 20, 60].map((ilvl) => I.roll(rng, { ilvl, slot: 'weapon', rarityBias: 2 }));
  const yields = lvlList.map((i) => I.salvageYield(i).stones);
  assert.ok(yields[0] <= yields[1] && yields[1] <= yields[2], '分解产出应随 ilvl 上升: ' + yields.join(','));
  const prices = lvlList.map((i) => I.sellPrice(i));
  assert.ok(prices[0] < prices[1] && prices[1] < prices[2], '售价应随 ilvl 上升: ' + prices.join(','));
  assert.ok(I.salvageYield(lvlList[2]).stones >= 1);
});

test('aggregate 汇总装备属性并收集传说效果', () => {
  const rng = SP.makeRng(14);
  const w = I.roll(rng, { ilvl: 20, slot: 'weapon' });
  const h = I.roll(rng, { ilvl: 20, slot: 'helm' });
  w.unique = 'vampiric';
  const agg = I.aggregate({ weapon: w, helm: h, ring1: null, ring2: null, armor: null, boots: null, amulet: null });
  const expectAtk = (I.itemStats(w).atk || 0);
  assert.ok(Math.abs((agg.atk || 0) - expectAtk) < 1e-9, '武器攻击力应被汇总');
  assert.ok((agg.hp || 0) > 0, '头盔生命应被汇总');
  assert.deepEqual(agg.__uniques, ['vampiric']);
  const empty = I.aggregate(null);
  assert.deepEqual(empty.__uniques, []);
  assert.ok(empty.__sets, '空装备也应返回套装进度');
  assert.deepEqual(empty.__sets.active, []);
  assert.equal(Object.keys(empty).length, 2, '空装备应只返回 __uniques / __sets');
});

test('戒指会依次填入 ring1 / ring2 并返回被替换的装备', () => {
  const rng = SP.makeRng(15);
  const character = { equipped: {} };
  const r1 = I.roll(rng, { ilvl: 10, slot: 'ring' });
  const r2 = I.roll(rng, { ilvl: 10, slot: 'ring' });
  const r3 = I.roll(rng, { ilvl: 10, slot: 'ring' });
  let res = I.equipInto(character, r1);
  assert.equal(res.slot, 'ring1'); assert.equal(res.replaced, null);
  res = I.equipInto(character, r2);
  assert.equal(res.slot, 'ring2'); assert.equal(res.replaced, null);
  res = I.equipInto(character, r3);
  assert.equal(res.slot, 'ring1');
  assert.equal(res.replaced, r1, '第三个戒指应替换 ring1');
  assert.equal(character.equipped.ring1, r3);
  assert.equal(character.equipped.ring2, r2);
});

test('compare 给出属性差值', () => {
  const rng = SP.makeRng(16);
  const weak = I.roll(rng, { ilvl: 5, slot: 'weapon' });
  const strong = I.roll(rng, { ilvl: 40, slot: 'weapon' });
  const diff = I.compare(weak, strong);
  assert.ok((diff.atk || 0) > 0, '高等级武器攻击力差值应为正');
  const none = I.compare(null, null);
  assert.equal(Object.keys(none).length, 0);
});

test('fmt 输出可读的属性文案', () => {
  assert.equal(I.fmt('atk', 12.4), '攻击力 +12');
  assert.equal(I.fmt('crit', 3.25), '暴击率 +3.3%');
  assert.equal(I.fmt('regen', 1.24), '每秒回复 +1.2');
  assert.equal(I.fmt('move', -4), '移动速度 -4%');
});

test('装备可完整 JSON 往返（存档安全）', () => {
  const list = sample(17, 60, { ilvl: 45, rarityBias: 0.5 });
  const back = JSON.parse(JSON.stringify(list));
  assert.deepEqual(back, list);
  for (const it of back) assert.ok(I.power(it) > 0, '往返后战力应可计算');
});

test('各部位都能独立生成，且主属性符合部位定位', () => {
  const rng = SP.makeRng(18);
  for (const slot of I.DROP_SLOTS) {
    for (let i = 0; i < 40; i++) {
      const it = I.roll(rng, { ilvl: 25, slot });
      assert.equal(it.slot, slot);
      if (slot === 'weapon') assert.ok((it.stats.atk || 0) > 0, '武器必须有攻击力');
      if (slot === 'armor') assert.ok((it.stats.hp || 0) > 0, '护甲必须有生命');
      if (slot === 'boots') assert.ok((it.stats.armor || 0) > 0, '战靴必须有护甲');
    }
  }
});

test('allBases / BASE_BY_KEY 覆盖全部装备型号', () => {
  const all = I.allBases();
  assert.ok(all.length >= 20, '装备型号数量应完整');
  const keys = new Set(all.map((b) => b.key));
  assert.equal(keys.size, all.length, 'base key 不应重复');
  for (const b of all) {
    assert.ok(I.BASE_BY_KEY[b.key], 'BASE_BY_KEY 缺少 ' + b.key);
    assert.equal(I.BASE_BY_KEY[b.key].slot, b.slot);
  }
  assert.deepEqual(I.GEAR_SLOT_ORDER, I.DROP_SLOTS);
});

test('武器基础型号覆盖常规八种 + 联动裁刃，并各自对应攻击档案', () => {
  const keys = I.BASES.weapon.map((b) => b.key);
  assert.deepEqual(keys.slice().sort(),
    ['axe', 'bow', 'dagger', 'flail', 'maul', 'oathblade', 'spear', 'staff', 'sword']);
  for (const key of keys) {
    const wp = I.weaponProfile(key);
    assert.equal(wp.key, key);
    assert.ok(wp.style && wp.label && wp.range > 0 && wp.arc > 0, key + ' 档案不完整');
  }
  assert.equal(I.weaponProfile('bow').style, 'shot');
  assert.equal(I.weaponProfile('staff').pierce, 2);
  assert.ok(I.weaponProfile('spear').range > I.weaponProfile('sword').range);
  assert.equal(I.weaponProfile('oathblade').label, '裁斩');
  assert.ok(I.BASE_BY_KEY.oathblade.collab, '裁刃应为联动型号');
});

test('随机武器会落到新型号上，且保留 base 字段', () => {
  const rng = SP.makeRng(19);
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const it = I.roll(rng, { ilvl: 18, slot: 'weapon' });
    assert.ok(it.base, '武器应带 base');
    seen.add(it.base);
  }
  for (const need of ['spear', 'bow', 'staff', 'flail']) {
    assert.ok(seen.has(need), '抽样中应出现 ' + need);
  }
});

test('目标层加权：深层更看重护甲/生命，浅层更看重攻击', () => {
  const atkItem = {
    slot: 'weapon', rarity: 'rare', ilvl: 20, upgrade: 0, unique: null,
    stats: { atk: 40, crit: 8 }, affixes: []
  };
  const tankItem = {
    slot: 'armor', rarity: 'rare', ilvl: 20, upgrade: 0, unique: null,
    stats: { hp: 120, armor: 40 }, affixes: []
  };
  const shallowAtk = I.power(atkItem, 3);
  const shallowTank = I.power(tankItem, 3);
  const deepAtk = I.power(atkItem, 24);
  const deepTank = I.power(tankItem, 24);
  assert.ok(shallowAtk > shallowTank, '浅层进攻装应更高分');
  assert.ok(deepTank > deepAtk, '深层坦克装应更高分');
  assert.ok(I.power(atkItem) > 0);
  const W0 = I.powerWeights(0);
  const W24 = I.powerWeights(24);
  assert.ok(W24.armor > W0.armor);
  assert.ok(W24.atk < W0.atk);
});

test('词条锁定：最多 2 条，重铸跳过已锁数值', () => {
  const rng = SP.makeRng(31);
  let it = null;
  for (let i = 0; i < 300 && !it; i++) {
    const cand = I.roll(rng, { ilvl: 28, rarityBias: 2.5 });
    if (cand.affixes.length >= 3) it = cand;
  }
  assert.ok(it, '应抽到至少 3 词条装备');
  assert.equal(I.toggleAffixLock(it, 0).ok, true);
  assert.equal(it.affixes[0].locked, true);
  assert.equal(I.toggleAffixLock(it, 1).ok, true);
  assert.equal(I.lockedAffixCount(it), 2);
  const third = I.toggleAffixLock(it, 2);
  assert.equal(third.ok, false, '第 3 条不应再锁');
  assert.ok(I.rerollCost(it).rerolls >= 3, '锁词条应提高重铸石消耗');

  const lockedVal = it.affixes[0].value;
  const unlockedBefore = it.affixes[2].value;
  let changedFree = false;
  for (let i = 0; i < 20; i++) {
    I.reroll(rng, it);
    assert.equal(it.affixes[0].value, lockedVal, '锁定词条数值不应变');
    assert.equal(it.affixes[0].locked, true);
    if (Math.abs(it.affixes[2].value - unlockedBefore) > 1e-6) changedFree = true;
  }
  assert.ok(changedFree, '未锁定词条应能被重铸');
  assert.equal(I.toggleAffixLock(it, 0).locked, false);
});

test('传说武器可抽到武器专属独特，防具不会', () => {
  const weaponOnly = I.UNIQUES
    .filter((u) => u.slots && u.slots.indexOf('weapon') >= 0 && !u.setOnly)
    .map((u) => u.key);
  assert.ok(weaponOnly.length >= 6, '应至少有 6 个武器专属传说');
  assert.deepEqual(
    I.uniquesForSlot('helm').map((u) => u.key).filter((k) => weaponOnly.indexOf(k) >= 0),
    [],
    '头盔池不应包含武器专属'
  );
  const wKeys = I.uniquesForSlot('weapon').map((u) => u.key);
  for (const k of weaponOnly) assert.ok(wKeys.indexOf(k) >= 0, '武器池应含 ' + k);
  assert.ok(wKeys.indexOf('domaincut') < 0, '普通传说池不应含套装专属 domaincut');

  const rng = SP.makeRng(21);
  let sawWeaponOnly = false;
  for (let i = 0; i < 80; i++) {
    const key = I.pickUnique(rng, 'weapon');
    if (weaponOnly.indexOf(key) >= 0) sawWeaponOnly = true;
    assert.notEqual(key, 'domaincut', 'pickUnique 不应抽到套装专属');
  }
  assert.ok(sawWeaponOnly, '武器传说抽样应出现武器专属效果');

  for (let i = 0; i < 200; i++) {
    const key = I.pickUnique(rng, 'armor');
    assert.ok(weaponOnly.indexOf(key) < 0, '防具传说不应抽到武器专属: ' + key);
  }
});

test('联动套装不进普通掉落，makeSetPiece 产出传说部件', () => {
  assert.ok(I.GEAR_SETS.oath, '应定义缚誓远征套装');
  const rng = SP.makeRng(99);
  for (let i = 0; i < 400; i++) {
    const it = I.roll(rng, { ilvl: 25, rarityBias: 2 });
    assert.ok(!I.BASE_BY_KEY[it.base].collab, '普通 roll 不应出联动型号: ' + it.base);
  }
  const blade = I.makeSetPiece(rng, 'oath', { ilvl: 22, baseKey: 'oathblade' });
  assert.ok(blade);
  assert.equal(blade.base, 'oathblade');
  assert.equal(blade.set, 'oath');
  assert.equal(blade.rarity, 'legendary');
  assert.equal(blade.unique, 'domaincut');
  assert.equal(I.weaponProfile(blade).label, '裁斩');

  const pieces = {};
  for (let i = 0; i < 60; i++) {
    const it = I.makeSetPiece(rng, 'oath', { ilvl: 20 });
    pieces[it.base] = (pieces[it.base] || 0) + 1;
  }
  assert.ok(Object.keys(pieces).length >= 4, '随机匣应覆盖多件套装部件');
});

test('套装进度与 aggregate 并入 2/4/6 件加成', () => {
  const rng = SP.makeRng(7);
  const eq = { weapon: null, helm: null, armor: null, boots: null, amulet: null, ring1: null, ring2: null };
  const keys = ['oathblade', 'oathhelm', 'oathplate', 'oathboots', 'oathamulet', 'oathring'];
  const slots = ['weapon', 'helm', 'armor', 'boots', 'amulet', 'ring1'];
  for (let i = 0; i < keys.length; i++) {
    eq[slots[i]] = I.makeSetPiece(rng, 'oath', { ilvl: 18, baseKey: keys[i] });
  }
  let prog = I.setProgress({ weapon: eq.weapon, helm: eq.helm });
  assert.equal(prog.counts.oath, 2);
  assert.ok(prog.active[0].flags.markDouble === undefined || !prog.active[0].flags.markDouble);
  assert.equal(prog.active[0].stats.skillDmg, 12);

  prog = I.setProgress(eq);
  assert.equal(prog.counts.oath, 6);
  assert.equal(prog.active[0].flags.markDouble, true);
  assert.equal(prog.active[0].flags.domainStun, 0.55);
  const agg = I.aggregate(eq);
  assert.ok(agg.skillDmg >= 12, '2 件技能伤害应并入 aggregate');
  assert.ok(agg.__uniques.indexOf('domaincut') >= 0);
  assert.equal(agg.__sets.active[0].count, 6);
});

console.log('\n时空猪 · 装备系统测试\n' + out.join('\n'));
console.log(`\n通过 ${pass} / ${pass + fail}` + (fail ? `  ✗ 失败 ${fail}` : '  ✓ 全部通过'));
process.exit(fail ? 1 : 0);
