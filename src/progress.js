/* 时空猪 · progress.js — 角色存档与养成操作（纯逻辑，UI 与自动化测试共用）
 *
 * 负责：副本收益入账、背包装卸、装备强化/重铸/分解/出售、副本解锁。
 * 所有涉及货币与材料的判断都集中在这里，避免散落在界面代码里。
 */
(function (global) {
  'use strict';
  var SP = global.SP || (global.SP = {});
  var I = SP.Items;

  var INVENTORY_CAP = 60;
  var MAX_LEVEL_HINT = 99;

  /** 新建一个 1 级角色 */
  function newCharacter(name) {
    return {
      name: name || '时空猪',
      level: 1,
      xp: 0,
      coins: 0,
      stones: 0,
      steaks: 3,
      materials: { up: 0, re: 0 },
      equipped: { weapon: null, helm: null, armor: null, boots: null, amulet: null, ring1: null, ring2: null },
      inventory: [],
      progress: { camp: 0, forest: 0, cave: 0, nest: 0 },
      stats: { runs: 0, clears: 0, deaths: 0, bestFloor: {} , kills: 0, lootFound: 0 },
      bestiary: {},
      created: Date.now()
    };
  }

  /** 把本局击杀并入图鉴：{ [enemyKey]: { kills, elites } } */
  function mergeBestiary(ch, killsByKey) {
    if (!ch || !killsByKey) return;
    if (!ch.bestiary || typeof ch.bestiary !== 'object') ch.bestiary = {};
    Object.keys(killsByKey).forEach(function (key) {
      if (!SP.ENEMY_TYPES[key]) return;
      var src = killsByKey[key] || {};
      var addK = Math.max(0, Math.round(Number(src.kills) || 0));
      var addE = Math.max(0, Math.round(Number(src.elites) || 0));
      if (addK <= 0 && addE <= 0) return;
      var dst = ch.bestiary[key];
      if (!dst) {
        dst = ch.bestiary[key] = { kills: 0, elites: 0, firstAt: Date.now() };
      }
      dst.kills = Math.max(0, Math.round(Number(dst.kills) || 0)) + addK;
      dst.elites = Math.max(0, Math.round(Number(dst.elites) || 0)) + addE;
      if (!dst.firstAt) dst.firstAt = Date.now();
    });
  }

  function isDiscovered(ch, key) {
    var e = ch && ch.bestiary && ch.bestiary[key];
    return !!(e && ((e.kills || 0) > 0 || (e.elites || 0) > 0));
  }

  /** 图鉴进度：已发现数 / 总数 */
  function bestiaryProgress(ch) {
    var total = 0, found = 0;
    Object.keys(SP.ENEMY_TYPES || {}).forEach(function (key) {
      total++;
      if (isDiscovered(ch, key)) found++;
    });
    return { found: found, total: total };
  }

  /** 按群系整理图鉴条目（含未解锁占位） */
  function bestiaryCatalog(ch) {
    var out = [];
    (SP.BIOME_ORDER || []).forEach(function (biomeKey) {
      var biome = SP.BIOMES[biomeKey];
      if (!biome) return;
      var keys = [biome.enemies.melee, biome.enemies.charger, biome.enemies.ranged, biome.enemies.boss];
      var entries = keys.map(function (key) {
        var def = SP.ENEMY_TYPES[key];
        var rec = (ch && ch.bestiary && ch.bestiary[key]) || null;
        var discovered = !!(rec && ((rec.kills || 0) > 0 || (rec.elites || 0) > 0));
        return {
          key: key,
          def: def,
          discovered: discovered,
          kills: discovered ? (rec.kills || 0) : 0,
          elites: discovered ? (rec.elites || 0) : 0,
          firstAt: discovered ? (rec.firstAt || 0) : 0
        };
      });
      out.push({ biome: biomeKey, name: biome.name, entries: entries });
    });
    return out;
  }

  /** 旧版（生存竞技）存档迁移：保留货币与牛排，其余转为材料起步 */
  function migrateV1(old) {
    var ch = newCharacter(old && old.name);
    if (old) {
      ch.coins = Math.max(0, Math.round(old.coins || 0));
      ch.stones = Math.max(0, Math.round(old.stones || 0));
      ch.steaks = SP.clamp(old.steaks || 3, 0, 9);
      // 旧版永久强化折算成强化石，等价补偿
      var lv = 0;
      var src = old.perm || {};
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) lv += src[k] || 0;
      var sp = old.stonePerm || {};
      for (var k2 in sp) if (Object.prototype.hasOwnProperty.call(sp, k2)) lv += (sp[k2] || 0) * 2;
      ch.materials.up = lv * 3;
      ch.materials.re = Math.floor(lv / 2);
      ch.stats.runs = old.runs || 0;
      ch.stats.kills = old.kills || 0;
      if (old.best) {
        var w = old.best.wave || 0;
        ch.progress.camp = Math.min(3, Math.floor(w / 3));
      }
    }
    // 送一件起手武器，避免新角色赤手空拳
    var starter = I.roll(SP.makeRng(20240501), { ilvl: 1, slot: 'weapon', rarityBias: 1.2 });
    starter.name = '新手·' + starter.baseName;
    ch.equipped.weapon = starter;
    return ch;
  }

  /* ------------------------------------------------------------ 背包与装备 */
  function bagSize(ch) { return ch.inventory.length + equippedCount(ch); }
  function equippedCount(ch) {
    var n = 0;
    I.EQUIP_SLOTS.forEach(function (s) { if (ch.equipped[s]) n++; });
    return n;
  }

  /** 本局战利品入账；背包满则返回未放入的数量 */
  function addLoot(ch, items) {
    var added = 0, overflow = [];
    (items || []).forEach(function (it) {
      if (ch.inventory.length < INVENTORY_CAP) { ch.inventory.push(it); added++; }
      else overflow.push(it);
    });
    ch.stats.lootFound = (ch.stats.lootFound || 0) + added;
    return { added: added, overflow: overflow };
  }

  function findItem(ch, uid) {
    for (var i = 0; i < ch.inventory.length; i++) if (ch.inventory[i].uid === uid) return { item: ch.inventory[i], where: 'inventory', index: i };
    for (var s = 0; s < I.EQUIP_SLOTS.length; s++) {
      var slot = I.EQUIP_SLOTS[s];
      if (ch.equipped[slot] && ch.equipped[slot].uid === uid) return { item: ch.equipped[slot], where: 'equipped', slot: slot };
    }
    return null;
  }

  /** 从背包装备一件物品；被替换下来的装备回到背包 */
  function equipFromBag(ch, uid) {
    var idx = -1;
    for (var i = 0; i < ch.inventory.length; i++) if (ch.inventory[i].uid === uid) { idx = i; break; }
    if (idx < 0) return { ok: false, reason: '背包中没有这件装备' };
    var item = ch.inventory.splice(idx, 1)[0];
    var res = I.equipInto(ch, item);
    if (res.replaced) ch.inventory.push(res.replaced);
    return { ok: true, slot: res.slot, replaced: res.replaced, item: item };
  }

  /** 卸下某个槽位 */
  function unequip(ch, slot) {
    var item = ch.equipped[slot];
    if (!item) return { ok: false, reason: '该槽位是空的' };
    if (ch.inventory.length >= INVENTORY_CAP) return { ok: false, reason: '背包已满' };
    ch.equipped[slot] = null;
    ch.inventory.push(item);
    return { ok: true, item: item };
  }

  /** 部位对应的实际装备槽（戒指是一对二） */
  function slotGroup(slot) { return slot === 'ring' ? ['ring1', 'ring2'] : [slot]; }

  /** 读取某类部位当前装备：戒指取两槽中战力较高的那件（用于界面展示与比较） */
  function currentInSlot(ch, slot) {
    var group = slotGroup(slot), best = null;
    for (var i = 0; i < group.length; i++) {
      var it = ch.equipped[group[i]];
      if (!it) continue;
      if (!best || I.power(it) > I.power(best)) best = it;
    }
    return best;
  }

  /**
   * 一键换装：把背包里该部位最强的一件穿上。
   * 目标槽位优先取空槽，否则替换战力最低的槽（戒指两槽独立判定），
   * 被替换下来的装备一定回到背包，不会凭空消失。
   */
  function autoEquipBest(ch, slot) {
    var group = slotGroup(slot);
    var best = null, bestIdx = -1;
    for (var i = 0; i < ch.inventory.length; i++) {
      var it = ch.inventory[i];
      if (it.slot !== slot) continue;
      if (!best || I.power(it) > I.power(best)) { best = it; bestIdx = i; }
    }
    if (!best) return { ok: false, reason: '背包里没有该部位的装备' };

    var target = null, g;
    for (g = 0; g < group.length; g++) {
      if (!ch.equipped[group[g]]) { target = group[g]; break; }
    }
    if (!target) {
      var weakestSlot = null, weakestPower = Infinity;
      for (g = 0; g < group.length; g++) {
        var cur = ch.equipped[group[g]];
        var pw = I.power(cur);
        if (pw < weakestPower) { weakestPower = pw; weakestSlot = group[g]; }
      }
      if (I.power(best) <= weakestPower) return { ok: false, reason: '当前装备已经更好' };
      target = weakestSlot;
    }

    ch.inventory.splice(bestIdx, 1);
    var prev = ch.equipped[target] || null;
    ch.equipped[target] = best;
    if (prev && prev.uid !== best.uid) ch.inventory.push(prev);
    return { ok: true, item: best, replaced: prev, slot: target };
  }

  /* --------------------------------------------------- 强化 / 重铸 / 分解 / 出售 */
  function upgradeItem(ch, uid) {
    var found = findItem(ch, uid);
    if (!found) return { ok: false, reason: '找不到该装备' };
    var item = found.item;
    if (!I.canUpgrade(item)) return { ok: false, reason: '已经强化到上限 +' + I.UPGRADE_CAP };
    var cost = I.upgradeCost(item);
    if (ch.coins < cost.coins) return { ok: false, reason: 'pig-coin 不足（需要 ' + cost.coins + '）' };
    if (ch.materials.up < cost.stones) return { ok: false, reason: '强化石不足（需要 ' + cost.stones + '）' };
    ch.coins -= cost.coins;
    ch.materials.up -= cost.stones;
    item.upgrade = (item.upgrade || 0) + 1;
    return { ok: true, item: item, cost: cost, power: I.power(item) };
  }

  function rerollItem(ch, uid) {
    var found = findItem(ch, uid);
    if (!found) return { ok: false, reason: '找不到该装备' };
    var item = found.item;
    if (!item.affixes.length) return { ok: false, reason: '这件装备没有词条可重铸' };
    var cost = I.rerollCost(item);
    if (ch.coins < cost.coins) return { ok: false, reason: 'pig-coin 不足（需要 ' + cost.coins + '）' };
    if (ch.materials.re < cost.rerolls) return { ok: false, reason: '重铸石不足（需要 ' + cost.rerolls + '）' };
    var before = I.power(item);
    ch.coins -= cost.coins;
    ch.materials.re -= cost.rerolls;
    I.reroll(SP.makeRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0), item);
    var after = I.power(item);
    return { ok: true, item: item, before: before, after: after, cost: cost };
  }

  /** 分解为材料；已装备的需先卸下 */
  function salvage(ch, uid) {
    var idx = -1;
    for (var i = 0; i < ch.inventory.length; i++) if (ch.inventory[i].uid === uid) { idx = i; break; }
    if (idx < 0) return { ok: false, reason: '只能分解背包中的装备' };
    var item = ch.inventory.splice(idx, 1)[0];
    var y = I.salvageYield(item);
    ch.materials.up += y.stones;
    ch.materials.re += y.rerolls;
    return { ok: true, item: item, yield: y };
  }

  function sell(ch, uid) {
    var idx = -1;
    for (var i = 0; i < ch.inventory.length; i++) if (ch.inventory[i].uid === uid) { idx = i; break; }
    if (idx < 0) return { ok: false, reason: '只能出售背包中的装备' };
    var item = ch.inventory.splice(idx, 1)[0];
    var price = I.sellPrice(item);
    ch.coins += price;
    return { ok: true, item: item, price: price };
  }

  /** 批量分解所有「未装备且战力低于阈值」的装备（背包清理） */
  function salvageBelow(ch, keepPower) {
    var removed = 0, stones = 0, rerolls = 0;
    for (var i = ch.inventory.length - 1; i >= 0; i--) {
      var it = ch.inventory[i];
      if (I.power(it) > keepPower) continue;
      var y = I.salvageYield(it);
      stones += y.stones; rerolls += y.rerolls;
      ch.inventory.splice(i, 1);
      removed++;
    }
    ch.materials.up += stones;
    ch.materials.re += rerolls;
    return { removed: removed, stones: stones, rerolls: rerolls };
  }

  /* -------------------------------------------------------------- 副本进度 */
  var UNLOCK_REQ = { camp: 0, forest: 3, cave: 4, nest: 5 };

  function clearedFloor(ch, biome) { return (ch.progress && ch.progress[biome]) || 0; }

  function unlockedBiomes(ch) {
    var out = ['camp'];
    for (var i = 1; i < SP.BIOME_ORDER.length; i++) {
      var key = SP.BIOME_ORDER[i];
      var prev = SP.BIOME_ORDER[i - 1];
      if (clearedFloor(ch, prev) >= UNLOCK_REQ[key]) out.push(key);
      else break;
    }
    return out;
  }

  function isUnlocked(ch, biome) { return unlockedBiomes(ch).indexOf(biome) >= 0; }

  /** 该群系可进入的最高层：已通关层数 + 1 */
  function maxFloor(ch, biome) { return clearedFloor(ch, biome) + 1; }

  /**
   * 结算一局：把收益写入角色。
   * summary 来自 World.summary()；xp 已在 sim 中直接写入角色等级。
   */
  function bankRun(ch, summary) {
    ch.coins += summary.coins || 0;
    ch.stones += summary.stones || 0;
    ch.materials.up += summary.upStones || 0;
    ch.materials.re += summary.reStones || 0;
    ch.kills = (ch.kills || 0) + (summary.kills || 0);
    ch.stats.runs = (ch.stats.runs || 0) + 1;
    ch.stats.kills = (ch.stats.kills || 0) + (summary.kills || 0);
    mergeBestiary(ch, summary.killsByKey);
    if (summary.cleared) {
      ch.stats.clears = (ch.stats.clears || 0) + 1;
      ch.progress[summary.biome] = Math.max(clearedFloor(ch, summary.biome), summary.floor);
      var bf = ch.stats.bestFloor || (ch.stats.bestFloor = {});
      bf[summary.biome] = Math.max(bf[summary.biome] || 0, summary.floor);
    } else {
      ch.stats.deaths = (ch.stats.deaths || 0) + 1;
    }
    var res = addLoot(ch, summary.loot);
    var prog = bestiaryProgress(ch);
    return {
      coins: summary.coins || 0, stones: summary.stones || 0,
      upStones: summary.upStones || 0, reStones: summary.reStones || 0,
      lootAdded: res.added, overflow: res.overflow.length,
      cleared: !!summary.cleared,
      unlocked: unlockedBiomes(ch),
      bestiaryFound: prog.found,
      bestiaryTotal: prog.total
    };
  }

  /** 买牛排 */
  var STEAK_PRICE = 15;
  function buySteak(ch, n) {
    n = n || 1;
    var cost = STEAK_PRICE * n;
    if (ch.coins < cost) return { ok: false, reason: 'pig-coin 不足' };
    if (ch.steaks + n > 9) return { ok: false, reason: '最多携带 9 块牛排' };
    ch.coins -= cost;
    ch.steaks += n;
    return { ok: true, cost: cost, steaks: ch.steaks };
  }

  /** 用秘宝向神秘商人换一件随机稀有以上装备 */
  var MYSTERY_COST = 6;
  function buyMysteryItem(ch, ilvl, slot) {
    if (ch.stones < MYSTERY_COST) return { ok: false, reason: 'alpha-stone 不足（需要 ' + MYSTERY_COST + '）' };
    if (ch.inventory.length >= INVENTORY_CAP) return { ok: false, reason: '背包已满' };
    ch.stones -= MYSTERY_COST;
    var item = I.roll(SP.makeRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0),
      { ilvl: ilvl, slot: slot, rarityBias: 2.2, luck: 0.4 });
    ch.inventory.push(item);
    return { ok: true, item: item, cost: MYSTERY_COST };
  }

  /** 数值兜底：存档里出现字符串/NaN 时不要让整条数值链被污染 */
  function num(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  /** 存档校验与补全：读档后调用，避免旧档/损坏档导致崩溃 */
  function normalize(ch) {
    var base = newCharacter(ch && ch.name);
    if (!ch || typeof ch !== 'object') return base;
    ch.level = Math.max(1, Math.round(num(ch.level, 1)));
    ch.xp = Math.max(0, num(ch.xp));
    ch.coins = Math.max(0, Math.round(num(ch.coins)));
    ch.stones = Math.max(0, Math.round(num(ch.stones)));
    ch.steaks = SP.clamp(Math.round(num(ch.steaks)), 0, 9);
    ch.materials = ch.materials || { up: 0, re: 0 };
    ch.materials.up = Math.max(0, Math.round(num(ch.materials.up)));
    ch.materials.re = Math.max(0, Math.round(num(ch.materials.re)));
    ch.equipped = ch.equipped || {};
    I.EQUIP_SLOTS.forEach(function (s) { if (!(s in ch.equipped)) ch.equipped[s] = null; });
    if (!Array.isArray(ch.inventory)) ch.inventory = [];
    ch.progress = ch.progress || {};
    SP.BIOME_ORDER.forEach(function (b) { ch.progress[b] = Math.max(0, Math.round(num(ch.progress[b]))); });
    ch.stats = Object.assign(base.stats, ch.stats || {});
    ch.stats.bestFloor = ch.stats.bestFloor || {};
    ['runs', 'clears', 'deaths', 'kills', 'lootFound'].forEach(function (k) {
      ch.stats[k] = Math.max(0, Math.round(num(ch.stats[k])));
    });
    // 图鉴：清洗未知键与非数字计数
    var rawB = (ch.bestiary && typeof ch.bestiary === 'object') ? ch.bestiary : {};
    var cleanB = {};
    Object.keys(rawB).forEach(function (key) {
      if (!SP.ENEMY_TYPES[key]) return;
      var rec = rawB[key] || {};
      var kills = Math.max(0, Math.round(num(rec.kills)));
      var elites = Math.max(0, Math.round(num(rec.elites)));
      if (kills <= 0 && elites <= 0) return;
      cleanB[key] = {
        kills: kills,
        elites: elites,
        firstAt: Math.max(0, Math.round(num(rec.firstAt, Date.now())))
      };
    });
    ch.bestiary = cleanB;
    // 丢弃结构损坏的装备，避免后续计算炸掉
    ch.inventory = ch.inventory.filter(function (it) { return validItem(it); });
    I.EQUIP_SLOTS.forEach(function (s) {
      if (ch.equipped[s] && !validItem(ch.equipped[s])) ch.equipped[s] = null;
    });
    return ch;
  }

  function validItem(it) {
    return !!(it && it.uid && it.slot && it.rarity && I.RARITY_BY_KEY[it.rarity] && it.stats && typeof it.stats === 'object');
  }

  SP.Progress = {
    INVENTORY_CAP: INVENTORY_CAP,
    UNLOCK_REQ: UNLOCK_REQ,
    STEAK_PRICE: STEAK_PRICE,
    MYSTERY_COST: MYSTERY_COST,
    MAX_LEVEL_HINT: MAX_LEVEL_HINT,
    newCharacter: newCharacter,
    migrateV1: migrateV1,
    normalize: normalize,
    validItem: validItem,
    bagSize: bagSize,
    equippedCount: equippedCount,
    addLoot: addLoot,
    findItem: findItem,
    equipFromBag: equipFromBag,
    unequip: unequip,
    autoEquipBest: autoEquipBest,
    currentInSlot: currentInSlot,
    slotGroup: slotGroup,
    upgradeItem: upgradeItem,
    rerollItem: rerollItem,
    salvage: salvage,
    sell: sell,
    salvageBelow: salvageBelow,
    clearedFloor: clearedFloor,
    unlockedBiomes: unlockedBiomes,
    isUnlocked: isUnlocked,
    maxFloor: maxFloor,
    bankRun: bankRun,
    buySteak: buySteak,
    buyMysteryItem: buyMysteryItem,
    mergeBestiary: mergeBestiary,
    isDiscovered: isDiscovered,
    bestiaryProgress: bestiaryProgress,
    bestiaryCatalog: bestiaryCatalog
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
