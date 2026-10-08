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
  assert.ok(I.upgradeCost(a).coins > c0 * 3, '强化等级越高越贵');
  assert.ok(I.upgradeCost(a).stones >= 1);
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
  assert.equal(Object.keys(empty).length, 1, '空装备应只返回 __uniques');
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

console.log('\n时空猪 · 装备系统测试\n' + out.join('\n'));
console.log(`\n通过 ${pass} / ${pass + fail}` + (fail ? `  ✗ 失败 ${fail}` : '  ✓ 全部通过'));
process.exit(fail ? 1 : 0);
