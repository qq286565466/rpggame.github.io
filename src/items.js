/* 时空猪 · items.js — 装备与词条系统（纯逻辑，可在 Node 中直接测试）
 *
 * 构造思路：
 *   1) 每个部位有一组「基础型号」，提供主属性（武器给攻击力、护甲给生命/护甲…）
 *   2) 基础属性随物品等级 ilvl 成长；稀有度再叠一层整体倍率
 *   3) 词条数量由稀有度决定；平坦词条的数值取「同等级属性基准曲线」的百分比，
 *      因此高等级物品的词条不会变得无足轻重；百分比词条给固定区间
 *   4) 传说装备额外带一条独特效果（由 sim 实际生效）
 */
(function (global) {
  'use strict';
  var SP = global.SP || (global.SP = {});

  /* ------------------------------------------------------------ 部位定义 */
  var EQUIP_SLOTS = ['weapon', 'helm', 'armor', 'boots', 'amulet', 'ring1', 'ring2'];
  var SLOT_META = {
    weapon: { name: '武器', icon: '⚔' },
    helm: { name: '头盔', icon: '⛑' },
    armor: { name: '护甲', icon: '🛡' },
    boots: { name: '战靴', icon: '👢' },
    amulet: { name: '项链', icon: '📿' },
    ring: { name: '戒指', icon: '💍' },
    ring1: { name: '戒指', icon: '💍' },
    ring2: { name: '戒指', icon: '💍' }
  };
  /** 掉落时可生成的部位（戒指两槽共用一种） */
  var DROP_SLOTS = ['weapon', 'helm', 'armor', 'boots', 'amulet', 'ring'];

  /* ------------------------------------------------------------ 稀有度 */
  var RARITIES = [
    { key: 'common', name: '普通', color: '#c3c3d2', affix: [0, 1], weight: 100, mult: 1.00, salvage: 1 },
    { key: 'fine', name: '精良', color: '#7fe36b', affix: [1, 2], weight: 52, mult: 1.07, salvage: 2 },
    { key: 'rare', name: '稀有', color: '#5fa8ff', affix: [2, 3], weight: 23, mult: 1.15, salvage: 4 },
    { key: 'epic', name: '史诗', color: '#c07bff', affix: [3, 4], weight: 8, mult: 1.25, salvage: 8 },
    { key: 'legendary', name: '传说', color: '#ffb03a', affix: [4, 5], weight: 2, mult: 1.38, salvage: 16 }
  ];
  var RARITY_BY_KEY = {};
  RARITIES.forEach(function (r, i) { r.index = i; RARITY_BY_KEY[r.key] = r; });

  /* ------------------------------------------------------- 词条与属性元数据 */
  /** fmt: flat 整数 / flat1 一位小数 / pct 百分比 */
  var STAT_META = {
    atk: { name: '攻击力', fmt: 'flat' },
    atkPct: { name: '攻击力', fmt: 'pct' },
    hp: { name: '生命上限', fmt: 'flat' },
    hpPct: { name: '生命上限', fmt: 'pct' },
    armor: { name: '护甲', fmt: 'flat' },
    crit: { name: '暴击率', fmt: 'pct' },
    critDmg: { name: '暴击伤害', fmt: 'pct' },
    aspd: { name: '攻击速度', fmt: 'pct' },
    move: { name: '移动速度', fmt: 'pct' },
    lifesteal: { name: '吸血', fmt: 'pct' },
    regen: { name: '每秒回复', fmt: 'flat1' },
    thorns: { name: '伤害反弹', fmt: 'flat' },
    pickup: { name: '拾取范围', fmt: 'flat' },
    greed: { name: '金币获取', fmt: 'pct' },
    luck: { name: '掉落幸运', fmt: 'pct' },
    skillDmg: { name: '技能伤害', fmt: 'pct' },
    cdr: { name: '冷却缩减', fmt: 'pct' }
  };

  /** 平坦属性的「同等级基准曲线」，词条按它的百分比取值 */
  var BASELINE = {
    atk: { base: 12, growth: 0.165 },
    hp: { base: 32, growth: 0.175 },
    armor: { base: 8, growth: 0.150 },
    regen: { base: 0.9, growth: 0.110 },
    thorns: { base: 3, growth: 0.150 },
    pickup: { base: 12, growth: 0.020 }
  };

  /**
   * 部位词条预算：不同部位对平坦属性的承载能力不同。
   * 首饰的定位是百分比属性，因此承载的平坦属性要明显压低，
   * 否则一枚戒指会掷出和重甲同量级的生命/护甲。
   */
  var SLOT_BUDGET = {
    weapon: { atk: 1.30, hp: 0.60, armor: 0.50, regen: 0.60, thorns: 0.70, pickup: 1.00 },
    helm: { atk: 0.70, hp: 1.10, armor: 1.10, regen: 0.90, thorns: 1.00, pickup: 1.00 },
    armor: { atk: 0.50, hp: 1.30, armor: 1.50, regen: 1.00, thorns: 1.30, pickup: 0.85 },
    boots: { atk: 0.60, hp: 0.85, armor: 1.00, regen: 1.00, thorns: 0.80, pickup: 1.20 },
    amulet: { atk: 0.75, hp: 0.70, armor: 0.55, regen: 1.10, thorns: 0.60, pickup: 1.10 },
    ring: { atk: 0.70, hp: 0.60, armor: 0.50, regen: 1.00, thorns: 0.50, pickup: 1.10 }
  };
  function budgetOf(slot, statKey) {
    var row = SLOT_BUDGET[slot];
    if (!row) return 1;
    return row[statKey] === undefined ? 1 : row[statKey];
  }

  var AFFIXES = [
    { key: 'atk', flat: [0.55, 1.10], w: 100, prefix: '锋利的' },
    { key: 'atkPct', range: [4, 10], w: 42, prefix: '残暴的' },
    { key: 'hp', flat: [0.55, 1.15], w: 100, suffix: '之坚韧' },
    { key: 'hpPct', range: [4, 10], w: 42, suffix: '之巨力' },
    { key: 'armor', flat: [0.60, 1.30], w: 78, suffix: '之壁垒' },
    { key: 'crit', range: [2, 5.5], w: 58, prefix: '精准的' },
    { key: 'critDmg', range: [12, 30], w: 58, suffix: '之残酷' },
    { key: 'aspd', range: [4, 10], w: 54, prefix: '迅捷的' },
    { key: 'move', range: [2.5, 7], w: 48, suffix: '之疾风' },
    { key: 'lifesteal', range: [0.8, 2.4], w: 34, suffix: '之汲取' },
    { key: 'regen', flat: [0.50, 1.20], w: 46, suffix: '之再生' },
    { key: 'thorns', flat: [0.60, 1.40], w: 32, suffix: '之荆棘' },
    { key: 'pickup', flat: [0.8, 1.8], w: 38, suffix: '之磁力' },
    { key: 'greed', range: [6, 16], w: 44, suffix: '之贪婪' },
    { key: 'luck', range: [4, 11], w: 40, suffix: '之幸运' },
    { key: 'skillDmg', range: [7, 18], w: 50, prefix: '共鸣的' },
    { key: 'cdr', range: [4, 10], w: 40, prefix: '流动的' }
  ];
  var AFFIX_BY_KEY = {};
  AFFIXES.forEach(function (a) { AFFIX_BY_KEY[a.key] = a; });

  /* ------------------------------------------------------------ 基础型号 */
  var BASES = {
    weapon: [
      { key: 'sword', name: '时空短剑', stats: { atk: 12, aspd: 5 } },
      { key: 'axe', name: '营地战斧', stats: { atk: 17, critDmg: 12 } },
      { key: 'dagger', name: '獠牙匕首', stats: { atk: 9, aspd: 12, crit: 3 } },
      { key: 'maul', name: '碎岩重锤', stats: { atk: 23, aspd: -10, critDmg: 20 } }
    ],
    helm: [
      { key: 'hood', name: '皮革头巾', stats: { hp: 26, armor: 5 } },
      { key: 'circlet', name: '时序头环', stats: { hp: 18, skillDmg: 6 } },
      { key: 'ironhelm', name: '铁质头盔', stats: { hp: 34, armor: 9, aspd: -4 } }
    ],
    armor: [
      { key: 'vest', name: '旅者皮甲', stats: { hp: 40, armor: 10 } },
      { key: 'robe', name: '秘术长袍', stats: { hp: 30, armor: 6, cdr: 5 } },
      { key: 'plate', name: '科多兽重铠', stats: { hp: 55, armor: 16, move: -4 } }
    ],
    boots: [
      { key: 'lightboots', name: '轻便战靴', stats: { armor: 5, move: 6 } },
      { key: 'greaves', name: '铁蹄战靴', stats: { armor: 9, hp: 20, move: 3 } }
    ],
    amulet: [
      { key: 'amulet', name: '时空护符', stats: { hp: 22, crit: 3 } },
      { key: 'pendant', name: '秘宝吊坠', stats: { luck: 8, greed: 10 } }
    ],
    ring: [
      { key: 'coinring', name: '金币指环', stats: { greed: 8, hp: 14 } },
      { key: 'hunterband', name: '猎手戒', stats: { crit: 4, atk: 6 } },
      { key: 'signet', name: '秘宝印戒', stats: { luck: 6, skillDmg: 6 } }
    ]
  };

  /* --------------------------------------------------- 传说独特效果（由 sim 生效） */
  var UNIQUES = [
    { key: 'vampiric', name: '噬魂', desc: '吸血效果翻倍' },
    { key: 'berserk', name: '狂怒', desc: '生命低于 40% 时攻击力 +40%' },
    { key: 'greedheart', name: '贪婪之心', desc: '金币收益与掉落幸运 +25%' },
    { key: 'hunter', name: '秘宝猎人', desc: '精英怪额外掉落一件装备' },
    { key: 'echo', name: '时空回响', desc: '击杀时有 12% 概率触发一次小型震击' },
    { key: 'swift', name: '疾风', desc: '移动速度 +12%，冲刺冷却减半' }
  ];
  var UNIQUE_BY_KEY = {};
  UNIQUES.forEach(function (u) { UNIQUE_BY_KEY[u.key] = u; });

  /* --------------------------------------------------------------- 工具 */
  /** 只要数值部分（带正负号与单位），界面里和属性名分列显示时用 */
  function fmtValue(key, value) {
    var meta = STAT_META[key] || { fmt: 'flat' };
    var sign = value >= 0 ? '+' : '';
    if (meta.fmt === 'pct') return sign + (Math.round(value * 10) / 10) + '%';
    if (meta.fmt === 'flat1') return sign + (Math.round(value * 10) / 10);
    return sign + Math.round(value);
  }
  function fmt(key, value) {
    var meta = STAT_META[key] || { name: key, fmt: 'flat' };
    return meta.name + ' ' + fmtValue(key, value);
  }
  function baselineOf(key, ilvl) {
    var b = BASELINE[key];
    if (!b) return 0;
    return b.base * (1 + b.growth * Math.max(0, ilvl - 1));
  }
  /** 基础型号的属性随 ilvl 成长 */
  function scaleBase(key, value, ilvl) {
    var meta = STAT_META[key] || {};
    var t = Math.max(0, ilvl - 1);
    var growth = meta.fmt === 'pct' ? 0.028 : 0.155;
    return value * (1 + growth * t);
  }
  /** 强化倍率：每级 +7% */
  function upgradeMult(item) { return 1 + 0.07 * (item.upgrade || 0); }

  var uidSeq = 0;
  function nextUid(rng) {
    uidSeq++;
    return 'i' + Date.now().toString(36) + '-' + (rng ? Math.floor(rng() * 1e6).toString(36) : uidSeq) + '-' + uidSeq;
  }

  /* --------------------------------------------------------- 随机生成一件 */
  /**
   * opts: { slot, ilvl, rarityBias(0~1 提升稀有度), luck(0~1) }
   */
  function roll(rng, opts) {
    opts = opts || {};
    var ilvl = Math.max(1, Math.round(opts.ilvl || 1));
    var slot = opts.slot || DROP_SLOTS[Math.floor(rng() * DROP_SLOTS.length)];
    if (DROP_SLOTS.indexOf(slot) < 0) slot = 'weapon';

    // 稀有度：按权重抽，幸运与层级偏移会提高稀有度档位的权重
    var bias = 1 + (opts.rarityBias || 0) + (opts.luck || 0) * 0.6;
    var pool = RARITIES.map(function (r) {
      return { r: r, weight: r.weight * (r.index === 0 ? 1 : Math.pow(bias, r.index)) };
    });
    var total = pool.reduce(function (s, p) { return s + p.weight; }, 0);
    var rollv = rng() * total, rarity = RARITIES[0];
    for (var i = 0; i < pool.length; i++) {
      rollv -= pool[i].weight;
      if (rollv <= 0) { rarity = pool[i].r; break; }
    }

    var baseList = BASES[slot] || BASES.weapon;
    var base = baseList[Math.floor(rng() * baseList.length)];

    // 基础属性
    var stats = {};
    Object.keys(base.stats).forEach(function (k) {
      var v = scaleBase(k, base.stats[k], ilvl) * rarity.mult;
      stats[k] = v;
    });

    // 词条：允许与基础属性同 key（正常叠加，例如重甲的基础护甲 + 护甲词条），
    // 但同一条装备上不允许出现重复词条
    var count = Math.round(rarity.affix[0] + rng() * (rarity.affix[1] - rarity.affix[0]));
    var avail = AFFIXES.slice();
    var affixes = [];
    for (var n = 0; n < count && avail.length; n++) {
      var pickIdx = Math.floor(rng() * avail.length);
      var af = avail.splice(pickIdx, 1)[0];
      var value;
      if (af.flat) {
        var pctOf = af.flat[0] + rng() * (af.flat[1] - af.flat[0]);
        value = baselineOf(af.key, ilvl) * pctOf * (0.75 + 0.5 * rarity.mult) * budgetOf(slot, af.key);
      } else {
        value = af.range[0] + rng() * (af.range[1] - af.range[0]);
      }
      affixes.push({ key: af.key, value: value });
      stats[af.key] = (stats[af.key] || 0) + value;
    }

    // 传说附带独特效果
    var unique = null;
    if (rarity.key === 'legendary') {
      unique = UNIQUES[Math.floor(rng() * UNIQUES.length)].key;
    }

    // 生成名字：取数值最高的词条做前缀 / 后缀
    var prefix = '', suffix = '';
    var best = affixes.slice().sort(function (a, b) {
      return (b.value / (AFFIX_BY_KEY[b.key].range ? AFFIX_BY_KEY[b.key].range[1] : 1)) -
             (a.value / (AFFIX_BY_KEY[a.key].range ? AFFIX_BY_KEY[a.key].range[1] : 1));
    })[0];
    if (best) {
      var bd = AFFIX_BY_KEY[best.key];
      if (bd.prefix) prefix = bd.prefix;
      else suffix = bd.suffix;
    }
    var name = (prefix ? prefix : '') + base.name + (suffix ? '·' + suffix : '');
    if (unique) name = UNIQUE_BY_KEY[unique].name + '·' + name;

    return {
      uid: nextUid(rng),
      slot: slot,
      base: base.key,
      baseName: base.name,
      rarity: rarity.key,
      ilvl: ilvl,
      name: name,
      stats: stats,          // 基础 + 词条（未含强化）
      affixes: affixes,
      upgrade: 0,
      unique: unique,
      locked: false
    };
  }

  /** 返回含强化加成的最终属性表 */
  function itemStats(item) {
    var m = upgradeMult(item);
    var out = {};
    Object.keys(item.stats).forEach(function (k) { out[k] = item.stats[k] * m; });
    return out;
  }

  /** 综合战力评分，用于排序与「是否更好」的粗判 */
  var WEIGHT = {
    atk: 3.2, atkPct: 3.0, hp: 0.35, hpPct: 2.6, armor: 1.1, crit: 3.4, critDmg: 0.55,
    aspd: 2.4, move: 1.6, lifesteal: 5.0, regen: 1.6, thorns: 0.9, pickup: 0.12,
    greed: 0.8, luck: 1.2, skillDmg: 1.1, cdr: 1.3
  };
  function power(item) {
    if (!item) return 0;
    var s = itemStats(item), total = 0;
    Object.keys(s).forEach(function (k) { total += (WEIGHT[k] || 0.5) * s[k]; });
    if (item.unique) total += 40;
    return Math.round(total);
  }

  /** 汇总所有已装备物品的属性 */
  function aggregate(equipped) {
    var out = {}, uniques = [];
    EQUIP_SLOTS.forEach(function (slot) {
      var it = equipped && equipped[slot];
      if (!it) return;
      var s = itemStats(it);
      Object.keys(s).forEach(function (k) { out[k] = (out[k] || 0) + s[k]; });
      if (it.unique && uniques.indexOf(it.unique) < 0) uniques.push(it.unique);
    });
    out.__uniques = uniques;
    return out;
  }

  /** 装备到合适的槽位，返回被替换下来的物品 */
  function equipInto(character, item) {
    var slot = item.slot;
    if (slot === 'ring') {
      slot = !character.equipped.ring1 ? 'ring1' : (!character.equipped.ring2 ? 'ring2' : 'ring1');
    }
    var prev = character.equipped[slot] || null;
    character.equipped[slot] = item;
    return { slot: slot, replaced: prev };
  }

  /* --------------------------------------------------------- 强化 / 重铸 / 分解 */
  var UPGRADE_CAP = 12;
  function upgradeCost(item) {
    var lv = item.upgrade || 0;
    var rarity = RARITY_BY_KEY[item.rarity];
    var ilvl = item.ilvl || 1;
    return {
      coins: Math.round((28 + ilvl * 7) * Math.pow(1.42, lv) * (1 + rarity.index * 0.12)),
      stones: 1 + Math.floor(lv / 2) + Math.floor(ilvl / 12)
    };
  }
  function canUpgrade(item) { return (item.upgrade || 0) < UPGRADE_CAP; }

  function rerollCost(item) {
    var rarity = RARITY_BY_KEY[item.rarity];
    return { coins: Math.round((40 + item.ilvl * 9) * (1 + rarity.index * 0.2)), rerolls: 1 };
  }
  /** 重铸：保留词条种类，重新掷数值 */
  function reroll(rng, item) {
    item.affixes.forEach(function (af) {
      var def = AFFIX_BY_KEY[af.key];
      if (!def) return;
      var rarity = RARITY_BY_KEY[item.rarity];
      var value;
      if (def.flat) {
        var pctOf = def.flat[0] + rng() * (def.flat[1] - def.flat[0]);
        value = baselineOf(def.key, item.ilvl) * pctOf * (0.75 + 0.5 * rarity.mult) * budgetOf(item.slot, def.key);
      } else {
        value = def.range[0] + rng() * (def.range[1] - def.range[0]);
      }
      item.stats[af.key] = (item.stats[af.key] || 0) - af.value + value;
      af.value = value;
    });
    return item;
  }

  /** 分解产出：强化石 / 重铸石 */
  function salvageYield(item) {
    var rarity = RARITY_BY_KEY[item.rarity];
    var ilvl = item.ilvl || 1;
    return {
      stones: Math.max(1, Math.round(rarity.salvage * (1 + ilvl * 0.10))),
      rerolls: Math.max(0, Math.round((rarity.index) * (0.6 + ilvl * 0.05)))
    };
  }
  function sellPrice(item) {
    var rarity = RARITY_BY_KEY[item.rarity];
    return Math.round((8 + (item.ilvl || 1) * 4) * (1 + rarity.index * 0.55) * upgradeMult(item));
  }

  /** 两件装备的属性差值（目标 - 当前） */
  function compare(cur, next) {
    var a = cur ? itemStats(cur) : {}, b = next ? itemStats(next) : {};
    var keys = {}, out = {};
    Object.keys(a).forEach(function (k) { keys[k] = 1; });
    Object.keys(b).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var d = (b[k] || 0) - (a[k] || 0);
      if (Math.abs(d) > 1e-9) out[k] = d;
    });
    return out;
  }

  SP.Items = {
    EQUIP_SLOTS: EQUIP_SLOTS,
    DROP_SLOTS: DROP_SLOTS,
    SLOT_META: SLOT_META,
    RARITIES: RARITIES,
    RARITY_BY_KEY: RARITY_BY_KEY,
    STAT_META: STAT_META,
    AFFIXES: AFFIXES,
    AFFIX_BY_KEY: AFFIX_BY_KEY,
    BASES: BASES,
    UNIQUES: UNIQUES,
    UNIQUE_BY_KEY: UNIQUE_BY_KEY,
    UPGRADE_CAP: UPGRADE_CAP,
    fmt: fmt,
    fmtValue: fmtValue,
    baselineOf: baselineOf,
    upgradeMult: upgradeMult,
    roll: roll,
    itemStats: itemStats,
    power: power,
    aggregate: aggregate,
    equipInto: equipInto,
    upgradeCost: upgradeCost,
    canUpgrade: canUpgrade,
    rerollCost: rerollCost,
    reroll: reroll,
    salvageYield: salvageYield,
    sellPrice: sellPrice,
    compare: compare
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
