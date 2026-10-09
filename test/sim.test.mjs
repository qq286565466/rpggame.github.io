/* 时空猪 · 动作 RPG 战斗与副本逻辑测试：node test/sim.test.mjs */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
for (const f of ['src/util.js', 'src/items.js', 'src/sim.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const SP = globalThis.SP;
const I = SP.Items;

let pass = 0, fail = 0;
const out = [];
function test(name, fn) {
  try { fn(); pass++; out.push('  ✓ ' + name); }
  catch (e) { fail++; out.push('  ✗ ' + name + '\n      ' + (e && e.message)); }
}

/** 造一个测试用角色；opts 可指定等级与装备 */
function makeCharacter(opts = {}) {
  const ch = {
    level: opts.level || 1,
    xp: 0,
    coins: 0, stones: 0, upStones: 0, reStones: 0, steaks: 3,
    equipped: { weapon: null, helm: null, armor: null, boots: null, amulet: null, ring1: null, ring2: null },
    inventory: [], materials: { up: 0, re: 0 }
  };
  if (opts.gear) {
    const rng = SP.makeRng(opts.gearSeed || 42);
    for (const slot of opts.gear) {
      const it = I.roll(rng, { ilvl: opts.gearIlvl || 20, slot, rarityBias: 1.5 });
      I.equipInto(ch, it);
    }
  }
  return ch;
}
function makeWorld(o = {}) {
  return new SP.World({
    seed: o.seed === undefined ? 12345 : o.seed,
    character: o.character || makeCharacter(),
    dungeon: { biome: o.biome || 'camp', floor: o.floor || 1 },
    steaks: o.steaks
  });
}

/** 会打架的机器人：贴近最近敌人并挥砍，血量低时用技能 */
function makeBot(w) {
  return function step(dt) {
    const p = w.player;
    const inp = { mx: 0, my: 0, attack: true, aimAngle: p.facing };
    let best = null, bd = Infinity;
    for (const e of w.enemies) {
      if (e.dying > 0) continue;
      const d = SP.dist(p.x, p.y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      const dd = Math.max(1, bd);
      const ux = (best.x - p.x) / dd, uy = (best.y - p.y) / dd;
      inp.aimAngle = Math.atan2(best.y - p.y, best.x - p.x);
      if (dd > 82) { inp.mx = ux; inp.my = uy; }
      else { inp.mx = -uy * 0.7; inp.my = ux * 0.7; }
      if (w.enemies.length >= 4 && p.quakeCd <= 0) inp.quake = true;
      if (dd > 200 && p.dashCd <= 0) inp.dash = true;
    } else {
      const ax = -p.x, ay = -p.y, al = SP.len(ax, ay) || 1;
      if (al > 60) { inp.mx = ax / al; inp.my = ay / al; }
    }
    if (p.hp / p.maxHp < 0.55 && p.blessCd <= 0) inp.bless = true;
    if (p.hp / p.maxHp < 0.45 && p.useCd <= 0 && w.steaks > 0) inp.use = true;
    w.update(dt, inp);
  };
}

/* ---------------------------------------------------------------- 角色属性 */
test('无装备 1 级角色属性符合基准', () => {
  const w = makeWorld();
  const p = w.player;
  assert.equal(p.level, 1);
  assert.ok(Math.abs(p.maxHp - (110 + 14)) < 1e-6, '生命基准: ' + p.maxHp);
  assert.ok(Math.abs(p.damage - (9 + 2.1)) < 1e-6, '攻击基准: ' + p.damage);
  assert.equal(p.hp, p.maxHp);
  assert.ok(Math.abs(p.crit - 0.05) < 1e-9);
  assert.ok(Math.abs(p.attackSpeed - 1.6) < 1e-9);
});

test('装备会切实提升角色属性（攻击/生命/暴击）', () => {
  const bare = SP.deriveCharacter(makeCharacter());
  const geared = SP.deriveCharacter(makeCharacter({ gear: ['weapon', 'armor', 'amulet'], gearIlvl: 30 }));
  assert.ok(geared.damage > bare.damage, '武器应提升攻击力');
  assert.ok(geared.maxHp > bare.maxHp, '护甲应提升生命');
  assert.ok(geared.crit > bare.crit || geared.armor > bare.armor, '装备应带来额外属性');
  assert.ok(geared.level === bare.level);
});

test('等级提升会提高基准属性', () => {
  const l1 = SP.deriveCharacter(makeCharacter({ level: 1 }));
  const l30 = SP.deriveCharacter(makeCharacter({ level: 30 }));
  assert.ok(l30.damage > l1.damage * 5, '攻击成长');
  assert.ok(l30.maxHp > l1.maxHp * 3, '生命成长');
  assert.ok(SP.xpForLevel(1) > 0 && SP.xpForLevel(20) > SP.xpForLevel(10), '经验曲线递增');
});

test('护甲减伤有上限且随怪物等级衰减', () => {
  assert.equal(SP.armorReduction(0, 10), 0);
  const low = SP.armorReduction(200, 1);
  const high = SP.armorReduction(200, 60);
  assert.ok(low > high, '怪物等级越高，同样护甲减伤越低');
  assert.ok(SP.armorReduction(1e9, 1) <= 0.75, '减伤不超过 75%');
});

/* ---------------------------------------------------------------- 战斗基础 */
test('普通攻击命中正前方敌人，且受攻速冷却限制', () => {
  const w = makeWorld();
  w.enemies.length = 0;
  const e = w.spawnEnemy('calf');
  e.x = w.player.x + 60; e.y = w.player.y; e.spawnT = 0; e.hp = e.maxHp = 99999;
  w.player.crit = 0;
  w.tryAttack(0);
  const after1 = e.hp;
  assert.ok(after1 < 99999, '应造成伤害');
  w.tryAttack(0);
  assert.equal(e.hp, after1, '冷却期内不应再次造成伤害');
});

test('攻击不会命中背后或射程外的敌人', () => {
  const w = makeWorld();
  w.enemies.length = 0;
  const behind = w.spawnEnemy('calf'); behind.x = w.player.x - 60; behind.y = w.player.y; behind.spawnT = 0;
  const far = w.spawnEnemy('calf'); far.x = w.player.x + 500; far.y = w.player.y; far.spawnT = 0;
  const b0 = behind.hp, f0 = far.hp;
  w.tryAttack(0);
  assert.equal(behind.hp, b0, '背后不应被命中');
  assert.equal(far.hp, f0, '射程外不应被命中');
});

test('暴击按暴击率与暴击伤害生效', () => {
  const w = makeWorld();
  w.enemies.length = 0;
  const e = w.spawnEnemy('calf');
  e.x = w.player.x + 60; e.y = w.player.y; e.spawnT = 0; e.hp = e.maxHp = 1e9;
  w.player.crit = 1; w.player.critMult = 2.5; w.player.damage = 100;
  w.player.atkCd = 0;
  w.tryAttack(0);
  const critDealt = 1e9 - e.hp;
  assert.ok(Math.abs(critDealt - 250) < 1, '必定暴击应打出 2.5 倍伤害: ' + critDealt);
});

test('Q 震击：范围伤害 + 冷却，且能清除弹幕', () => {
  const w = makeWorld();
  w.enemies.length = 0;
  const near = w.spawnEnemy('calf'); near.x = w.player.x + 80; near.y = w.player.y; near.spawnT = 0;
  const outside = w.spawnEnemy('calf'); outside.x = w.player.x + 900; outside.y = w.player.y; outside.spawnT = 0;
  const n0 = near.hp, o0 = outside.hp;
  w.projectiles.push({ x: w.player.x + 50, y: w.player.y, vx: 0, vy: 0, r: 7, dmg: 5, life: 3, friendly: false, color: '#fff' });
  assert.equal(w.castQuake(), true);
  assert.ok(near.hp < n0, '范围内应受伤');
  assert.equal(outside.hp, o0, '范围外不应受伤');
  assert.equal(w.projectiles.length, 0, '弹幕应被清除');
  assert.equal(w.castQuake(), false, '冷却中不应再次释放');
});

test('E 赐福：按生命上限回血、给护盾与增伤', () => {
  const w = makeWorld();
  w.player.hp = 1;
  const maxHp = w.player.maxHp;
  assert.equal(w.castBless(), true);
  assert.ok(Math.abs(w.player.hp - (1 + maxHp * 0.3)) < 1e-6, '回血应为生命上限 30%');
  assert.ok(w.player.shield > 0, '应获得护盾');
  assert.equal(w.player.dmgBuffMul, 1.5);
  assert.equal(w.castBless(), false);
});

test('冲刺提供无敌帧并进入冷却', () => {
  const w = makeWorld();
  assert.equal(w.tryDash(0), true);
  assert.ok(w.player.dashT > 0 && w.player.invuln > 0.2, '冲刺应给短暂无敌');
  assert.equal(w.tryDash(0), false, '冷却中不应再次冲刺');
});

test('牛排消耗品：需持有、满血不浪费、有冷却', () => {
  const w = makeWorld({ steaks: 2 });
  assert.equal(w.steaks, 2);
  w.player.hp = 10;
  assert.equal(w.useSteak(), true);
  assert.equal(w.steaks, 1);
  assert.ok(w.player.hp > 10);
  assert.equal(w.useSteak(), false, '冷却中不应连续使用');
  w.player.useCd = 0; w.player.hp = w.player.maxHp;
  assert.equal(w.useSteak(), false, '满血不应消耗');
  assert.equal(w.steaks, 1);
});

test('受伤：护甲减伤、无敌帧、护盾优先吸收', () => {
  const w = makeWorld();
  w.player.armor = 200;
  const expect = 40 * (1 - SP.armorReduction(200, w.mlvl));
  w.hurtPlayer(40, 0, 0);
  assert.ok(Math.abs(w.player.hp - (w.player.maxHp - expect)) < 1e-6, '护甲应减伤');
  const hpAfter = w.player.hp;
  w.hurtPlayer(40, 0, 0);
  assert.equal(w.player.hp, hpAfter, '无敌帧内不应再次受伤');

  const w2 = makeWorld();
  w2.player.shield = 1000; w2.player.shieldT = 5;
  w2.hurtPlayer(30, 0, 0);
  assert.equal(w2.player.hp, w2.player.maxHp, '护盾应吸收伤害');
});

test('吸血按造成伤害回血', () => {
  const w = makeWorld();
  w.enemies.length = 0;
  w.player.lifesteal = 0.2;
  w.player.hp = 10;
  const e = w.spawnEnemy('calf');
  e.x = w.player.x + 60; e.y = w.player.y; e.spawnT = 0; e.hp = e.maxHp = 1e6;
  w.player.crit = 0; w.player.damage = 100;
  w.tryAttack(0);
  assert.ok(w.player.hp > 10, '应通过吸血回血: ' + w.player.hp);
  assert.ok(Math.abs(w.player.hp - (10 + 100 * 0.2)) < 1, '回血量应等于伤害的 20%');
});

test('荆棘反伤与传说独特效果（噬魂/狂怒）', () => {
  const w = makeWorld();
  w.player.thorns = 50;
  const e = w.spawnEnemy('calf'); e.x = w.player.x + 20; e.y = w.player.y; e.spawnT = 0;
  const hp0 = e.hp;
  w.hurtPlayer(10, e.x, e.y);
  assert.ok(e.hp < hp0, '荆棘应反伤近身敌人');

  const vamp = SP.deriveCharacter(Object.assign(makeCharacter(), {
    equipped: { weapon: { slot: 'weapon', rarity: 'legendary', ilvl: 20, stats: { lifesteal: 5 }, affixes: [], upgrade: 0, unique: 'vampiric' } }
  }));
  assert.ok(Math.abs(vamp.lifesteal - 0.10) < 1e-9, '噬魂应让吸血翻倍: ' + vamp.lifesteal);

  const swift = I.aggregate({
    amulet: { slot: 'amulet', rarity: 'legendary', ilvl: 10, stats: {}, affixes: [], upgrade: 0, unique: 'swift' }
  });
  assert.deepEqual(swift.__uniques, ['swift']);
});

/* ------------------------------------------------------------------ 掉落 */
test('击杀会掉落金币，并可能掉落装备与材料', () => {
  const w = makeWorld();
  w.enemies.length = 0;
  // 关掉自动刷怪，避免群系危害刷怪干扰掉落抽样
  w.updateSpawns = function () {};
  for (let i = 0; i < 120; i++) {
    const e = w.spawnEnemy('calf');
    e.x = w.player.x + 60; e.y = w.player.y; e.spawnT = 0; e.hp = 1;
    w.player.atkCd = 0;
    w.tryAttack(0);
    w.update(0.42, { mx: 0, my: 0, attack: false }); // 让 dying 与掉落推进
  }
  assert.ok(w.kills > 100, '应完成大量击杀: ' + w.kills);
  assert.ok(w.pickups.some((k) => k.kind === 'coin') || w.coins > 0, '应掉落金币');
  assert.ok(w.pickups.some((k) => k.kind === 'item') || w.loot.length > 0, '应掉落装备');
  assert.ok(w.pickups.some((k) => k.kind === 'upstone') || w.upStones > 0, '应掉落强化石');
});

test('掉落装备的 ilvl 与副本怪物等级挂钩', () => {
  const lowW = makeWorld({ biome: 'camp', floor: 1 });
  const highW = makeWorld({ biome: 'nest', floor: 6 });
  assert.equal(lowW.mlvl, 1);
  assert.equal(highW.mlvl, SP.BIOMES.nest.mlvlBase + 5);
  const sampleIlvl = (w) => {
    const ilvls = [];
    for (let i = 0; i < 200; i++) {
      const e = w.spawnEnemy('calf');
      e.x = 0; e.y = 0; e.x = w.player.x; e.y = w.player.y;
      e.hp = 1; e.dying = 0;
      w.rollLoot(e);
    }
    w.pickups.filter((k) => k.kind === 'item').forEach((k) => ilvls.push(k.item.ilvl));
    return ilvls;
  };
  const low = sampleIlvl(lowW), high = sampleIlvl(highW);
  assert.ok(low.length > 0 && high.length > 0, '两边都应产生装备掉落');
  assert.ok(Math.min(...high) > Math.max(...low), `高难度层应掉落更高 ilvl: ${Math.min(...high)} vs ${Math.max(...low)}`);
});

test('精英怪掉率与属性高于普通怪，首领必掉多件且保底稀有', () => {
  const w = makeWorld({ floor: 3 });
  const norm = w.spawnEnemy('calf');
  const elite = w.spawnEnemy('calf', { elite: true });
  assert.ok(elite.maxHp > norm.maxHp * 2, '精英血量应显著更高');
  assert.ok(elite.dmg > norm.dmg, '精英伤害应更高');
  assert.ok(elite.name.startsWith('精英·'), '精英应有名字前缀');

  const w2 = makeWorld({ floor: 3 });
  const boss = w2.spawnEnemy(w2.biome.enemies.boss);
  w2.rollLoot(boss);
  const items = w2.pickups.filter((k) => k.kind === 'item').map((k) => k.item);
  assert.ok(items.length >= 3, '首领应掉落至少 3 件: ' + items.length);
  assert.ok(items.some((it) => I.RARITY_BY_KEY[it.rarity].index >= 2), '首领应保底掉落稀有以上');
});

test('拾取装备会进入本局战利品列表并派发事件', () => {
  const w = makeWorld();
  const item = I.roll(SP.makeRng(5), { ilvl: 10, slot: 'weapon' });
  w.pickups.push({ x: w.player.x, y: w.player.y, kind: 'item', item, life: 60, r: 14, bob: 0, vx: 0, vy: 0 });
  w.updatePickups(1 / 60);
  assert.equal(w.loot.length, 1);
  assert.equal(w.loot[0].uid, item.uid);
});

/* ------------------------------------------------------------------ 副本 */
test('副本流程：刷够配额 → 首领出现 → 击败即通关', () => {
  const w = makeWorld({ floor: 1 });
  assert.equal(w.killsNeeded, 14 + 3, '第 1 层配额');
  assert.equal(w.bossSpawned, false);
  assert.equal(w.cleared, false);
  // 直接把击杀数推到配额
  w.kills = w.killsNeeded;
  w.updateSpawns(1 / 60);
  assert.equal(w.bossSpawned, true, '达到配额应刷出首领');
  assert.ok(w.boss, '应记录首领引用');
  assert.equal(w.cleared, false, '首领未死不应通关');

  const events = w.drainEvents();
  assert.ok(events.some((e) => e.type === 'boss_wave'), '应派发首领波次事件');

  w.boss.hp = 1;
  w.damageEnemy(w.boss, 999);
  assert.equal(w.cleared, true, '击败首领应通关');
  const events2 = w.drainEvents();
  assert.ok(events2.some((e) => e.type === 'clear'), '应派发通关事件');
});

test('不同生物群系使用各自的怪物与首领', () => {
  const seen = new Set();
  for (const key of SP.BIOME_ORDER) {
    const w = makeWorld({ biome: key });
    const b = SP.BIOMES[key];
    assert.equal(w.biomeKey, key);
    assert.equal(w.tier, b.tier);
    const boss = w.spawnEnemy(b.enemies.boss);
    assert.ok(boss.boss && boss.name === SP.ENEMY_TYPES[b.enemies.boss].name);
    seen.add(boss.key);
    // 该群系的怪物表存在
    for (const role of ['melee', 'charger', 'ranged', 'boss']) {
      assert.ok(SP.ENEMY_TYPES[b.enemies[role]], `${key} 缺少 ${role}`);
    }
  }
  assert.equal(seen.size, 4, '四个群系应有四个不同首领');
});

test('怪物等级随群系与层数提升，属性同步放大', () => {
  const a = makeWorld({ biome: 'camp', floor: 1 });
  const b = makeWorld({ biome: 'nest', floor: 8 });
  assert.ok(b.mlvl > a.mlvl, '更深层怪物等级更高');
  const ea = a.spawnEnemy('calf');
  const eb = b.spawnEnemy('calf');
  assert.ok(eb.maxHp > ea.maxHp * 3, '高等级怪物血量应显著更高');
  assert.ok(eb.dmg > ea.dmg, '高等级怪物伤害应更高');
});

test('角色升级：生命上限提升、派发事件、存档等级同步', () => {
  const ch = makeCharacter();
  const w = makeWorld({ character: ch });
  const hp0 = w.player.maxHp;
  let need = 0;
  for (let l = 1; l <= 3; l++) need += SP.xpForLevel(l); // 恰好够升到 4 级
  w.addXp(need + 1);
  assert.ok(ch.level >= 4, '角色应升到 4 级以上: ' + ch.level);
  assert.ok(w.player.maxHp > hp0, '升级应提高生命上限');
  assert.equal(w.player.level, ch.level);
  assert.ok(ch.xp >= 0 && ch.xp < SP.xpForLevel(ch.level), '剩余经验应落在当前等级区间内');
  const ev = w.drainEvents();
  assert.ok(ev.some((e) => e.type === 'levelup'), '应派发升级事件');
});

test('死亡：记录结算数据并停止推进', () => {
  const w = makeWorld();
  w.time = 71.2; w.kills = 33; w.coins = 120; w.upStones = 4;
  const item = I.roll(SP.makeRng(9), { ilvl: 12 });
  w.loot.push(item);
  w.hurtPlayer(1e9, 0, 0);
  assert.equal(w.dead, true);
  const s = w.deathStats;
  assert.ok(s, '应有结算数据');
  assert.equal(s.kills, 33);
  assert.equal(s.coins, 120);
  assert.equal(s.upStones, 4);
  assert.equal(s.loot.length, 1, '阵亡结算应带上已拾取的战利品');
  assert.equal(s.cleared, false);
  const t0 = w.time;
  w.update(1 / 60, { attack: true });
  assert.equal(w.time, t0, '死亡后时间应停止');
});

/* -------------------------------------------------------------- 稳定性 */
test('相同种子结果可复现', () => {
  const run = () => {
    const w = makeWorld({ seed: 20240915 });
    const step = makeBot(w);
    for (let i = 0; i < 900; i++) step(1 / 60);
    return { kills: w.kills, x: w.player.x.toFixed(6), enemies: w.enemies.length, hp: w.player.hp.toFixed(4) };
  };
  assert.deepEqual(run(), run());
});

test('玩家无法离开副本地图边界', () => {
  const w = makeWorld();
  for (let i = 0; i < 900; i++) w.update(1 / 60, { mx: 1, my: 1, attack: false });
  assert.ok(Math.abs(w.player.x) <= w.arena + 0.001 && Math.abs(w.player.y) <= w.arena + 0.001);
});

test('长时间运行不产生 NaN 与实体数量失控', () => {
  const w = makeWorld({ biome: 'forest', floor: 4 });
  const step = makeBot(w);
  for (let i = 0; i < 60 * 300 && !w.dead && !w.cleared; i++) step(1 / 60);
  const p = w.player;
  for (const v of [p.x, p.y, p.hp, p.maxHp, p.damage, p.armor, w.time]) {
    assert.ok(Number.isFinite(v), '出现非法数值: ' + v);
  }
  for (const e of w.enemies) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.hp), '怪物数值非法');
  assert.ok(w.enemies.length < 260, '怪物数量失控: ' + w.enemies.length);
  assert.ok(w.pickups.length < 900, '掉落物数量失控: ' + w.pickups.length);
});

test('帧率无关性：不同步长的移动距离接近', () => {
  const a = makeWorld({ seed: 5 }), b = makeWorld({ seed: 5 });
  a.enemies.length = 0; b.enemies.length = 0;
  // 时长控制在撞墙之前，否则边界钳制会掩盖差异
  for (let i = 0; i < 240; i++) a.update(1 / 60, { mx: 1, my: 0, attack: false });
  for (let i = 0; i < 120; i++) b.update(1 / 30, { mx: 1, my: 0, attack: false });
  const da = Math.abs(a.player.x), db = Math.abs(b.player.x);
  assert.ok(da < a.arena * 0.9, '测试时长不应撞到边界: ' + da.toFixed(1));
  assert.ok(Math.abs(da - db) / Math.max(da, db) < 0.08, `步长差异过大: ${da.toFixed(1)} vs ${db.toFixed(1)}`);
});

test('自动选敌：刀长外仍可锁定用于转向，刀长内才标 inSwing', () => {
  const w = makeWorld({ seed: 11 });
  w.enemies.length = 0;
  const p = w.player;
  const far = w.spawnEnemy('calf');
  far.spawnT = 0; far.x = p.x + 220; far.y = p.y;
  const pickFar = SP.pickAutoTarget(w, p);
  assert.ok(pickFar, '刀长外的附近敌人应被锁定');
  assert.equal(pickFar.enemy, far);
  assert.equal(pickFar.inSwing, false, '刀长外不应进入挥砍');

  const near = w.spawnEnemy('bat');
  near.spawnT = 0; near.x = p.x + 50; near.y = p.y;
  const pickNear = SP.pickAutoTarget(w, p);
  assert.equal(pickNear.enemy, near, '应优先锁定更近的敌人');
  assert.equal(pickNear.inSwing, true, '刀长内应进入挥砍');
});

test('自动选敌：忽略濒死与尚未现身的怪，超出锁敌半径则放弃', () => {
  const w = makeWorld({ seed: 12 });
  w.enemies.length = 0;
  const p = w.player;
  const dying = w.spawnEnemy('calf');
  dying.spawnT = 0; dying.dying = 0.5; dying.x = p.x + 40; dying.y = p.y;
  const spawning = w.spawnEnemy('calf');
  spawning.spawnT = 0.4; spawning.x = p.x + 45; spawning.y = p.y;
  assert.equal(SP.pickAutoTarget(w, p), null, '只有无效目标时应返回 null');

  const remote = w.spawnEnemy('calf');
  remote.spawnT = 0; remote.x = p.x + 900; remote.y = p.y;
  assert.equal(SP.pickAutoTarget(w, p, 300), null, '超出锁敌半径不应锁定');
});

function applyWeapon(w, key) {
  const wp = I.weaponProfile(key);
  w.player.weapon = wp;
  w.player.range = wp.range;
  w.player.arcWidth = wp.arc;
  return wp;
}

test('链锤回旋能命中身后敌人', () => {
  const w = makeWorld({ seed: 21 });
  w.enemies.length = 0;
  applyWeapon(w, 'flail');
  const behind = w.spawnEnemy('calf');
  behind.x = w.player.x - 50; behind.y = w.player.y; behind.spawnT = 0;
  const hp0 = behind.hp;
  w.player.crit = 0; w.player.atkCd = 0;
  w.tryAttack(0);
  assert.ok(behind.hp < hp0, '回旋应打到身后');
});

test('长枪突刺射程长于短剑，窄角打不到侧方', () => {
  const w = makeWorld({ seed: 22 });
  w.enemies.length = 0;
  applyWeapon(w, 'spear');
  const far = w.spawnEnemy('calf');
  far.x = w.player.x + 110; far.y = w.player.y; far.spawnT = 0; far.hp = far.maxHp = 1e9;
  const side = w.spawnEnemy('calf');
  side.x = w.player.x + 40; side.y = w.player.y + 70; side.spawnT = 0;
  const f0 = far.hp, s0 = side.hp;
  w.player.crit = 0; w.player.atkCd = 0;
  w.tryAttack(0);
  assert.ok(far.hp < f0, '长枪应打到 110 距离外的正前方');
  assert.equal(side.hp, s0, '长枪窄角不应打到侧方');
});

test('短弓开火产生友方弹道并在命中后造成伤害', () => {
  const w = makeWorld({ seed: 23 });
  w.enemies.length = 0;
  applyWeapon(w, 'bow');
  const e = w.spawnEnemy('calf');
  e.x = w.player.x + 180; e.y = w.player.y; e.spawnT = 0; e.hp = e.maxHp = 1e9;
  const before = w.projectiles.length;
  w.player.crit = 0; w.player.atkCd = 0; w.player.damage = 40;
  w.tryAttack(0);
  assert.ok(w.projectiles.length > before, '应发射箭矢');
  assert.equal(w.projectiles[w.projectiles.length - 1].friendly, true);
  const hp0 = e.hp;
  for (let i = 0; i < 90 && e.hp === hp0; i++) w.updateProjectiles(1 / 60);
  assert.ok(e.hp < hp0, '箭矢命中应造成伤害');
});

test('法杖奥术弹可穿透两名敌人', () => {
  const w = makeWorld({ seed: 24 });
  w.enemies.length = 0;
  applyWeapon(w, 'staff');
  const a = w.spawnEnemy('calf'); a.x = w.player.x + 90; a.y = w.player.y; a.spawnT = 0; a.hp = a.maxHp = 1e9;
  const b = w.spawnEnemy('calf'); b.x = w.player.x + 160; b.y = w.player.y; b.spawnT = 0; b.hp = b.maxHp = 1e9;
  w.player.crit = 0; w.player.atkCd = 0; w.player.damage = 30; w.player.skillDmg = 0;
  w.tryAttack(0);
  const a0 = a.hp, b0 = b.hp;
  for (let i = 0; i < 120; i++) w.updateProjectiles(1 / 60);
  assert.ok(a.hp < a0 && b.hp < b0, '穿透弹应打到两名排成一线的敌人');
});

test('重锤砸击能波及扇形外的近身敌人', () => {
  const w = makeWorld({ seed: 25 });
  w.enemies.length = 0;
  applyWeapon(w, 'maul');
  const side = w.spawnEnemy('calf');
  side.x = w.player.x; side.y = w.player.y + 40; side.spawnT = 0;
  const hp0 = side.hp;
  w.player.crit = 0; w.player.atkCd = 0;
  w.tryAttack(0); // 朝右挥，侧方靠震波
  assert.ok(side.hp < hp0, '砸击震波应打到侧方近身敌人');
});

function withUnique(w, key) {
  w.player.uniques = [key];
  w.hasUnique = function (k) { return w.player.uniques.indexOf(k) >= 0; };
}

test('传说武器·连星：远程普攻额外射出两发侧弹', () => {
  const w = makeWorld({ seed: 31 });
  w.enemies.length = 0;
  applyWeapon(w, 'bow');
  withUnique(w, 'multishot');
  w.player.atkCd = 0;
  w.tryAttack(0);
  assert.equal(w.projectiles.length, 3, '连星应共发射 3 支箭');
  const scales = w.projectiles.map((p) => Math.round(p.dmg));
  assert.ok(scales[0] > scales[1], '主弹伤害应高于侧弹');
});

test('传说武器·猎杀：残血敌人受到额外伤害', () => {
  const w = makeWorld({ seed: 32 });
  w.enemies.length = 0;
  applyWeapon(w, 'sword');
  withUnique(w, 'execute');
  const e = w.spawnEnemy('calf');
  e.x = w.player.x + 40; e.y = w.player.y; e.spawnT = 0;
  e.hp = e.maxHp = 1000;
  e.hp = 200; // 20% 血
  w.player.crit = 0; w.player.damage = 100; w.player.atkCd = 0;
  w.player.dmgBuffT = 0; w.player.weapon.dmgMul = 1;
  const hp0 = e.hp;
  w.hitEnemyWithAttack(e, 0, { dmgScale: 1, noProc: true });
  const dealtLow = hp0 - e.hp;
  e.hp = 800; // 80% 血
  const hp1 = e.hp;
  w.hitEnemyWithAttack(e, 0, { dmgScale: 1, noProc: true });
  const dealtHigh = hp1 - e.hp;
  assert.ok(dealtLow > dealtHigh * 1.5, '残血增伤应显著: ' + dealtLow + ' vs ' + dealtHigh);
});

test('传说武器·裂空：命中溅射周围敌人', () => {
  const w = makeWorld({ seed: 33 });
  w.enemies.length = 0;
  applyWeapon(w, 'sword');
  withUnique(w, 'rift');
  const a = w.spawnEnemy('calf'); a.x = w.player.x + 40; a.y = w.player.y; a.spawnT = 0; a.hp = a.maxHp = 1e9;
  const b = w.spawnEnemy('calf'); b.x = a.x + 40; b.y = a.y; b.spawnT = 0; b.hp = b.maxHp = 1e9;
  w.player.crit = 0; w.player.damage = 80; w.player.atkCd = 0;
  const b0 = b.hp;
  w.hitEnemyWithAttack(a, 0, { dmgScale: 1 });
  assert.ok(b.hp < b0, '裂空应对邻近敌人造成溅射');
});

test('传说武器·渴血：击杀回复生命', () => {
  const w = makeWorld({ seed: 34 });
  w.enemies.length = 0;
  withUnique(w, 'bloodthirst');
  w.player.hp = w.player.maxHp * 0.5;
  const before = w.player.hp;
  const e = w.spawnEnemy('calf'); e.x = w.player.x + 30; e.y = w.player.y; e.spawnT = 0; e.hp = 1;
  w.damageEnemy(e, 999, {});
  assert.ok(w.player.hp > before, '渴血应在击杀后回血');
  assert.ok(Math.abs(w.player.hp - (before + w.player.maxHp * 0.05)) < 1.5, '回血约为最大生命 5%');
});

test('击杀会按怪物 key 记入 killsByKey 并出现在 summary', () => {
  const w = makeWorld({ seed: 41 });
  w.enemies.length = 0;
  const a = w.spawnEnemy('calf'); a.x = w.player.x + 30; a.y = w.player.y; a.spawnT = 0; a.hp = 1;
  const b = w.spawnEnemy('calf', { elite: true }); b.x = w.player.x + 30; b.y = w.player.y; b.spawnT = 0; b.hp = 1;
  w.damageEnemy(a, 999, {});
  w.damageEnemy(b, 999, {});
  assert.equal(w.killsByKey.calf.kills, 2);
  assert.equal(w.killsByKey.calf.elites, 1);
  const sum = w.summary();
  assert.equal(sum.killsByKey.calf.kills, 2);
  assert.equal(sum.killsByKey.calf.elites, 1);
});

test('怪物图鉴字段：每种敌人都有群系与描述', () => {
  const keys = Object.keys(SP.ENEMY_TYPES);
  assert.equal(keys.length, 16);
  for (const key of keys) {
    const e = SP.ENEMY_TYPES[key];
    assert.ok(e.biome && SP.BIOMES[e.biome], key + ' 缺少有效 biome');
    assert.ok(e.desc && e.tip, key + ' 缺少图鉴文案');
    assert.ok(SP.KIND_LABEL[e.kind], key + ' 缺少 kind 标签');
  }
});

test('四群系都登记了环境危害', () => {
  for (const key of SP.BIOME_ORDER) {
    const b = SP.BIOMES[key];
    assert.ok(b.hazard && b.hazard.key && b.hazard.name && b.hazard.desc, key + ' 缺少 hazard');
  }
  assert.equal(SP.BIOMES.camp.hazard.key, 'stampede');
  assert.equal(SP.BIOMES.forest.hazard.key, 'spores');
  assert.equal(SP.BIOMES.cave.hazard.key, 'shatter');
  assert.equal(SP.BIOMES.nest.hazard.key, 'brood');
});

test('孢子毒雾会对站立玩家造成 soft 伤害', () => {
  const w = makeWorld({ seed: 77, biome: 'forest', floor: 2 });
  w.enemies.length = 0;
  w.player.vx = 0; w.player.vy = 0;
  const hp0 = w.player.hp;
  for (let i = 0; i < 120; i++) w.update(1 / 60, { mx: 0, my: 0 });
  assert.ok(w.player.hp < hp0, '毒雾应扣血');
  assert.equal(w.player.invuln, 0, 'soft 伤害不应上无敌帧');
});

test('碎晶坠落会生成危害预警并在落地时结算', () => {
  const w = makeWorld({ seed: 78, biome: 'cave', floor: 1 });
  w.enemies.length = 0;
  w.hazardTimer = 0;
  w.updateHazards(0.016);
  assert.ok(w.hazards.length >= 1, '应生成碎晶预警');
  const hz = w.hazards[0];
  hz.x = w.player.x; hz.y = w.player.y; hz.life = 0;
  const hp0 = w.player.hp;
  w.updateHazards(0.016);
  assert.equal(w.hazards.length, 0, '落地后危害应移除');
  assert.ok(w.player.hp < hp0, '落在玩家身上应造成伤害');
});

test('践踏潮提高冲锋刷新占比；巢穴狂潮提高场上目标数', () => {
  const camp = makeWorld({ seed: 79, biome: 'camp', floor: 1 });
  let charger = 0;
  for (let i = 0; i < 400; i++) {
    if (camp.pickSpawnKey() === camp.biome.enemies.charger) charger++;
  }
  assert.ok(charger > 140, '践踏潮冲锋占比应明显提高: ' + charger);

  const nest = makeWorld({ seed: 80, biome: 'nest', floor: 1 });
  const base = makeWorld({ seed: 80, biome: 'cave', floor: 1 });
  assert.ok(nest.aliveTarget > base.aliveTarget, '巢穴场上目标数应更高');
  const boss = nest.spawnEnemy(nest.biome.enemies.boss);
  assert.ok(boss.summonN > SP.ENEMY_TYPES.queen.summonN, '巢穴首领召唤更多');
});

test('传说武器·超载：提升技能伤害并缩短震击冷却', () => {
  const base = SP.deriveCharacter(makeCharacter());
  const oc = SP.deriveCharacter(Object.assign(makeCharacter(), {
    equipped: {
      weapon: {
        slot: 'weapon', rarity: 'legendary', ilvl: 20, stats: {}, affixes: [], upgrade: 0,
        unique: 'overcharge', base: 'staff'
      }
    }
  }));
  assert.ok(oc.skillDmg >= base.skillDmg + 0.3 - 1e-9, '超载应 +30% 技能伤害');
  const w = makeWorld({
    seed: 35,
    character: Object.assign(makeCharacter(), {
      equipped: {
        weapon: {
          slot: 'weapon', rarity: 'legendary', ilvl: 20, stats: { atk: 10 }, affixes: [], upgrade: 0,
          unique: 'overcharge', base: 'staff'
        }
      }
    })
  });
  w.castQuake();
  assert.ok(w.player.quakeCd < 8 * 0.9, '超载应缩短震击冷却: ' + w.player.quakeCd);
});

test('缚誓裁刃：普攻叠咒印，按武器技展开领域', () => {
  const rng = SP.makeRng(44);
  const blade = I.makeSetPiece(rng, 'oath', { ilvl: 20, baseKey: 'oathblade' });
  const helm = I.makeSetPiece(rng, 'oath', { ilvl: 20, baseKey: 'oathhelm' });
  const plate = I.makeSetPiece(rng, 'oath', { ilvl: 20, baseKey: 'oathplate' });
  const boots = I.makeSetPiece(rng, 'oath', { ilvl: 20, baseKey: 'oathboots' });
  const ch = Object.assign(makeCharacter({ level: 12 }), {
    equipped: {
      weapon: blade, helm, armor: plate, boots,
      amulet: null, ring1: null, ring2: null
    }
  });
  const derived = SP.deriveCharacter(ch);
  assert.ok(derived.uniques.indexOf('domaincut') >= 0);
  assert.equal(derived.setFlags.markDouble, true, '4 件应激活咒印加倍');

  const w = makeWorld({ seed: 46, character: ch });
  assert.equal(w.player.curseMarks, 0);
  assert.equal(w.castWeaponSkill(), false, '无咒印不能开领域');

  // 造一只贴脸怪，直接走命中管线叠印
  w.enemies.push({
    x: w.player.x + 40, y: w.player.y, r: 16, hp: 500, maxHp: 500,
    dying: 0, boss: false, elite: false, armor: 0, name: '试靶'
  });
  const foe = w.enemies[0];
  w.hitEnemyWithAttack(foe, 0, { noProc: false });
  assert.ok(w.player.curseMarks >= 2, '4 件套应一次叠 2 印: ' + w.player.curseMarks);

  w.player.curseMarks = 5;
  const ok = w.castWeaponSkill();
  assert.equal(ok, true);
  assert.equal(w.player.curseMarks, 0);
  assert.ok(w.player.domainT > 3, '领域应持续数秒');
  assert.ok(w.player.domainR >= 150, '领域应有半径');
  assert.ok(w.player.weaponSkillCd > 0, '武器技应进冷却');
  const cds = w.cooldowns();
  assert.equal(cds.weapon.ready, true);
  assert.ok(cds.weapon.left > 0);

  // 域内增伤：同伤害在领域内外不同
  const e2 = {
    x: w.player.x + 20, y: w.player.y, r: 14, hp: 1000, maxHp: 1000,
    dying: 0, boss: false, elite: false, armor: 0, name: '域内'
  };
  w.enemies.push(e2);
  const hpBefore = e2.hp;
  w.hitEnemyWithAttack(e2, 0, { noProc: true, noMark: true });
  const inDomainDmg = hpBefore - e2.hp;
  w.player.domainT = 0;
  e2.hp = 1000;
  w.hitEnemyWithAttack(e2, 0, { noProc: true, noMark: true });
  const outDomainDmg = 1000 - e2.hp;
  assert.ok(inDomainDmg > outDomainDmg * 1.05, '领域内应增伤');
});

console.log('\n时空猪 · 战斗与副本逻辑测试\n' + out.join('\n'));
console.log(`\n通过 ${pass} / ${pass + fail}` + (fail ? `  ✗ 失败 ${fail}` : '  ✓ 全部通过'));
process.exit(fail ? 1 : 0);
