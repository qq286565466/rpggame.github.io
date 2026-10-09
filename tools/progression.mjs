/* 时空猪 · 养成循环试玩机器人：node tools/progression.mjs [局数] [单局时间上限秒]
 *
 * 模拟一个会打怪的玩家在不断刷副本：
 *   选一层 → 打完/阵亡 → 结算 → 自动穿上更好的装备 → 分解垃圾 → 有钱就强化 → 再进
 * 用来验证「装备驱动成长」这条主线是否成立：等级、装备等级、解锁进度是否稳定推进，
 * 以及在哪个层数会卡住。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
for (const f of ['src/util.js', 'src/items.js', 'src/sim.js', 'src/progress.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const SP = globalThis.SP, I = SP.Items, P = SP.Progress;

/** 自动战斗机器人（与游戏内演示 AI 一致） */
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
      if (w.enemies.filter((e) => e.dying <= 0).length >= 4 && p.quakeCd <= 0) inp.quake = true;
      if (dd > 220 && p.dashCd <= 0) inp.dash = true;
    } else {
      const ax = -p.x, ay = -p.y, al = SP.len(ax, ay) || 1;
      if (al > 60) { inp.mx = ax / al; inp.my = ay / al; }
    }
    if (p.hp / p.maxHp < 0.55 && p.blessCd <= 0) inp.bless = true;
    if (p.hp / p.maxHp < 0.45 && p.useCd <= 0 && w.steaks > 0) inp.use = true;
    w.update(dt, inp);
  };
}

function runDungeon(ch, biome, floor, seed, capSec) {
  const w = new SP.World({
    seed, character: ch,
    dungeon: { biome, floor },
    steaks: Math.min(ch.steaks, 5)
  });
  const step = makeBot(w);
  const maxSteps = capSec * 60;
  let n = 0;
  while (!w.dead && !w.cleared && n < maxSteps) { step(1 / 60); n++; }
  w.steaks = Math.max(0, w.steaks);
  ch.steaks = Math.max(0, ch.steaks - (Math.min(ch.steaks, 5) - w.steaks));
  return w;
}

/** 打完一局后的养成动作：换装 → 分解 → 强化 */
function goShopping(ch) {
  // 1) 每个槽位换上背包里更强的
  for (const slot of ['weapon', 'helm', 'armor', 'boots', 'amulet', 'ring']) {
    for (let guard = 0; guard < 4; guard++) {
      const before = JSON.stringify(ch.equipped[slot] && ch.equipped[slot].uid);
      const r = P.autoEquipBest(ch, slot);
      if (!r.ok) break;
      if (JSON.stringify(ch.equipped[slot] && ch.equipped[slot].uid) === before) break;
    }
  }
  // 2) 清理背包里明显不如当前装备的（按下一推进层加权）
  const mlvl = P.targetMlvl(ch);
  let threshold = 0;
  I.EQUIP_SLOTS.forEach((s) => {
    const it = ch.equipped[s];
    if (it) threshold = Math.max(threshold, I.power(it, mlvl) * 0.75);
  });
  const salvaged = P.salvageBelow(ch, threshold, { targetMlvl: mlvl });

  // 3) 有资源就强化：优先武器，其次护甲/头盔，保持等级均衡
  const order = ['weapon', 'armor', 'helm', 'boots', 'amulet', 'ring1', 'ring2'];
  let upgrades = 0;
  for (let round = 0; round < 40; round++) {
    let acted = false;
    for (const slot of order) {
      const it = ch.equipped[slot];
      if (!it || !I.canUpgrade(it)) continue;
      const cost = I.upgradeCost(it);
      // 留一半金币做缓冲，避免把家底全砸进强化
      if (ch.coins < cost.coins * 1.6 || ch.materials.up < cost.stones) continue;
      const r = P.upgradeItem(ch, it.uid);
      if (r.ok) { upgrades++; acted = true; }
    }
    if (!acted) break;
  }
  return { salvaged, upgrades };
}

const RUNS = Number(process.argv[2] || 30);
const CAP = Number(process.argv[3] || 300);

const ch = P.newCharacter('试玩猪');
const rows = [];
let biome = 'camp';
let floor = 1;
let lastDied = false;

console.log('局  区域        层  怪等  结果  用时    击杀  等级  装备均等 攻击   生命   掉落  最好品质');
console.log('─'.repeat(96));

const t0 = Date.now();
for (let run = 1; run <= RUNS; run++) {
  // 上一局在同一层阵亡就重刷该层，否则尝试更深一层
  if (lastDied) { /* 留在原层刷装备 */ } else { floor = Math.min(floor + 1, P.maxFloor(ch, biome) + 1); }
  if (floor > P.clearedFloor(ch, biome) + 1) floor = P.clearedFloor(ch, biome) + 1;
  // 当前区域已通关到较深层且下一区域已解锁时，换区域推进
  const unlocked = P.unlockedBiomes(ch);
  const nextBiome = unlocked[unlocked.length - 1];
  if (nextBiome !== biome && P.clearedFloor(ch, biome) >= P.UNLOCK_REQ[nextBiome]) {
    biome = nextBiome;
    floor = 1;
  }

  const w = runDungeon(ch, biome, floor, 9000 + run * 7919, CAP);
  const summary = w.summary();
  const bank = P.bankRun(ch, summary);
  const shop = goShopping(ch);

  const bestRarity = summary.loot.reduce((acc, it) => {
    const idx = I.RARITY_BY_KEY[it.rarity].index;
    return idx > acc.idx ? { idx, key: it.rarity } : acc;
  }, { idx: -1, key: '—' });
  const gearAvg = I.EQUIP_SLOTS.reduce((s, k) => s + (ch.equipped[k] ? ch.equipped[k].ilvl : 0), 0) / I.EQUIP_SLOTS.length;

  rows.push({
    run, biome, floor, mlvl: summary.mlvl, cleared: summary.cleared,
    time: summary.time, kills: summary.kills, level: ch.level,
    gearAvg, loot: summary.loot.length, best: bestRarity.key,
    upgrades: shop.upgrades, killed: ch.stats.kills
  });

  console.log(
    String(run).padEnd(4) +
    (SP.BIOMES[biome].name + '      ').slice(0, 10) +
    String(floor).padEnd(4) +
    String(summary.mlvl).padEnd(6) +
    (summary.cleared ? '通关' : '阵亡') + '  ' +
    SP.fmtTime(summary.time).padEnd(8) +
    String(summary.kills).padEnd(6) +
    String(ch.level).padEnd(6) +
    gearAvg.toFixed(1).padEnd(9) +
    String(Math.round(w.player.damage)).padEnd(7) +
    String(Math.round(w.player.maxHp)).padEnd(7) +
    String(summary.loot.length).padEnd(6) +
    bestRarity.key
  );
  lastDied = !summary.cleared;
}

const wall = Date.now() - t0;
const clears = rows.filter((r) => r.cleared).length;
console.log('─'.repeat(96));
console.log(`共 ${RUNS} 局，通关 ${clears}，阵亡 ${RUNS - clears}`);
console.log(`最终角色：等级 ${ch.level}，pig-coin ${ch.coins}，alpha-stone ${ch.stones}，强化石 ${ch.materials.up}，重铸石 ${ch.materials.re}`);
console.log(`最终装备：` + I.EQUIP_SLOTS.map((s) => {
  const it = ch.equipped[s];
  return s + (it ? `[${I.RARITY_BY_KEY[it.rarity].name} ilvl${it.ilvl} +${it.upgrade}]` : '[空]');
}).join(' '));
console.log(`区域进度：` + SP.BIOME_ORDER.map((b) => `${SP.BIOMES[b].name} ${P.clearedFloor(ch, b)} 层`).join(' · '));
console.log(`累计击杀 ${ch.stats.kills}，获得装备 ${ch.stats.lootFound} 件`);
console.log(`模拟墙钟耗时 ${wall} ms（${RUNS} 局，单局约 ${(wall / RUNS).toFixed(0)} ms）`);
