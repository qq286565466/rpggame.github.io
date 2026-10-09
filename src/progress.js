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
      gearCodex: { bases: {}, uniques: {} },
      created: Date.now()
    };
  }

  function ensureGearCodex(ch) {
    if (!ch.gearCodex || typeof ch.gearCodex !== 'object') ch.gearCodex = { bases: {}, uniques: {} };
    if (!ch.gearCodex.bases || typeof ch.gearCodex.bases !== 'object') ch.gearCodex.bases = {};
    if (!ch.gearCodex.uniques || typeof ch.gearCodex.uniques !== 'object') ch.gearCodex.uniques = {};
    return ch.gearCodex;
  }

  function rarityRank(key) {
    var r = I.RARITY_BY_KEY[key];
    return r ? r.index : -1;
  }

  /**
   * 登记一件装备到装备图鉴。
   * opts.inc=false 时只解锁/刷新最高品质，不累加获得次数（用于读档回填）。
   */
  function discoverGear(ch, item, opts) {
    if (!ch || !item || !item.base || !I.BASE_BY_KEY[item.base]) return false;
    opts = opts || {};
    var inc = opts.inc !== false;
    var codex = ensureGearCodex(ch);
    var dst = codex.bases[item.base];
    if (!dst) {
      dst = codex.bases[item.base] = {
        count: 0,
        bestRarity: item.rarity || 'common',
        firstAt: Date.now()
      };
    }
    if (inc) dst.count = Math.max(0, Math.round(Number(dst.count) || 0)) + 1;
    else dst.count = Math.max(1, Math.round(Number(dst.count) || 0));
    if (rarityRank(item.rarity) > rarityRank(dst.bestRarity)) dst.bestRarity = item.rarity;
    if (!dst.firstAt) dst.firstAt = Date.now();
    if (item.unique && I.UNIQUE_BY_KEY[item.unique]) {
      var u = codex.uniques[item.unique];
      if (!u) u = codex.uniques[item.unique] = { count: 0, firstAt: Date.now() };
      if (inc) u.count = Math.max(0, Math.round(Number(u.count) || 0)) + 1;
      else u.count = Math.max(1, Math.round(Number(u.count) || 0));
      if (!u.firstAt) u.firstAt = Date.now();
    }
    return true;
  }

  function syncGearCodexFromOwned(ch) {
    if (!ch) return;
    (ch.inventory || []).forEach(function (it) { discoverGear(ch, it, { inc: false }); });
    I.EQUIP_SLOTS.forEach(function (s) {
      if (ch.equipped && ch.equipped[s]) discoverGear(ch, ch.equipped[s], { inc: false });
    });
  }

  function isGearDiscovered(ch, baseKey) {
    var e = ch && ch.gearCodex && ch.gearCodex.bases && ch.gearCodex.bases[baseKey];
    return !!(e && (e.count || 0) > 0);
  }

  function isUniqueDiscovered(ch, uniqueKey) {
    var e = ch && ch.gearCodex && ch.gearCodex.uniques && ch.gearCodex.uniques[uniqueKey];
    return !!(e && (e.count || 0) > 0);
  }

  function gearCodexProgress(ch) {
    var bases = I.allBases();
    var found = 0;
    bases.forEach(function (b) { if (isGearDiscovered(ch, b.key)) found++; });
    return { found: found, total: bases.length };
  }

  function uniqueCodexProgress(ch) {
    var total = (I.UNIQUES || []).length;
    var found = 0;
    (I.UNIQUES || []).forEach(function (u) { if (isUniqueDiscovered(ch, u.key)) found++; });
    return { found: found, total: total };
  }

  /** 按部位整理装备图鉴 */
  function gearCodexCatalog(ch) {
    var out = [];
    I.GEAR_SLOT_ORDER.forEach(function (slot) {
      var list = I.BASES[slot] || [];
      var entries = list.map(function (b) {
        var rec = ch && ch.gearCodex && ch.gearCodex.bases && ch.gearCodex.bases[b.key];
        var discovered = !!(rec && (rec.count || 0) > 0);
        return {
          key: b.key,
          slot: slot,
          def: b,
          discovered: discovered,
          count: discovered ? (rec.count || 0) : 0,
          bestRarity: discovered ? (rec.bestRarity || 'common') : null,
          firstAt: discovered ? (rec.firstAt || 0) : 0
        };
      });
      out.push({
        slot: slot,
        name: (I.SLOT_META[slot] && I.SLOT_META[slot].name) || slot,
        entries: entries
      });
    });
    return out;
  }

  /** 传说独特效果图鉴 */
  function uniqueCodexCatalog(ch) {
    return (I.UNIQUES || []).map(function (u) {
      var rec = ch && ch.gearCodex && ch.gearCodex.uniques && ch.gearCodex.uniques[u.key];
      var discovered = !!(rec && (rec.count || 0) > 0);
      return {
        key: u.key,
        def: u,
        discovered: discovered,
        count: discovered ? (rec.count || 0) : 0,
        firstAt: discovered ? (rec.firstAt || 0) : 0
      };
    });
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
    discoverGear(ch, starter);
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
      // 只要捡到过就记入图鉴（即便背包满溢出也算见过）
      discoverGear(ch, it);
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

  /**
   * 角色当前可推进的最高怪物等级（各已解锁群系「下一层」的 mlvl 取最大）。
   * 用于一键换装 / 战力排序按目标层加权。
   */
  function targetMlvl(ch) {
    var best = 1;
    if (!ch || !SP.BIOMES) return best;
    unlockedBiomes(ch).forEach(function (b) {
      var biome = SP.BIOMES[b];
      if (!biome) return;
      var mlvl = biome.mlvlBase + (maxFloor(ch, b) - 1);
      if (mlvl > best) best = mlvl;
    });
    return best;
  }

  function scoreItem(it, mlvl) {
    return I.power(it, mlvl);
  }

  /** 读取某类部位当前装备：戒指取两槽中战力较高的那件（用于界面展示与比较） */
  function currentInSlot(ch, slot, mlvl) {
    var group = slotGroup(slot), best = null;
    var target = mlvl === undefined ? targetMlvl(ch) : mlvl;
    for (var i = 0; i < group.length; i++) {
      var it = ch.equipped[group[i]];
      if (!it) continue;
      if (!best || scoreItem(it, target) > scoreItem(best, target)) best = it;
    }
    return best;
  }

  /**
   * 一键换装：把背包里该部位最强的一件穿上。
   * 目标槽位优先取空槽，否则替换战力最低的槽（戒指两槽独立判定），
   * 被替换下来的装备一定回到背包，不会凭空消失。
   * opts.targetMlvl 可覆盖默认的「下一推进层」评分基准。
   */
  function autoEquipBest(ch, slot, opts) {
    opts = opts || {};
    var mlvl = opts.targetMlvl !== undefined ? opts.targetMlvl : targetMlvl(ch);
    var group = slotGroup(slot);
    var best = null, bestIdx = -1;
    for (var i = 0; i < ch.inventory.length; i++) {
      var it = ch.inventory[i];
      if (it.slot !== slot) continue;
      if (!best || scoreItem(it, mlvl) > scoreItem(best, mlvl)) { best = it; bestIdx = i; }
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
        var pw = scoreItem(cur, mlvl);
        if (pw < weakestPower) { weakestPower = pw; weakestSlot = group[g]; }
      }
      if (scoreItem(best, mlvl) <= weakestPower) return { ok: false, reason: '当前装备已经更好' };
      target = weakestSlot;
    }

    ch.inventory.splice(bestIdx, 1);
    var prev = ch.equipped[target] || null;
    ch.equipped[target] = best;
    if (prev && prev.uid !== best.uid) ch.inventory.push(prev);
    return { ok: true, item: best, replaced: prev, slot: target, targetMlvl: mlvl };
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
    var unlocked = item.affixes.filter(function (a) { return !a.locked; });
    if (!unlocked.length) return { ok: false, reason: '所有词条都已锁定，无需重铸' };
    var cost = I.rerollCost(item);
    if (ch.coins < cost.coins) return { ok: false, reason: 'pig-coin 不足（需要 ' + cost.coins + '）' };
    if (ch.materials.re < cost.rerolls) return { ok: false, reason: '重铸石不足（需要 ' + cost.rerolls + '）' };
    var mlvl = targetMlvl(ch);
    var before = I.power(item, mlvl);
    ch.coins -= cost.coins;
    ch.materials.re -= cost.rerolls;
    I.reroll(SP.makeRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0), item);
    var after = I.power(item, mlvl);
    return { ok: true, item: item, before: before, after: after, cost: cost };
  }

  /** 锁定 / 解锁装备上的一条词条（重铸时跳过已锁词条） */
  function toggleAffixLock(ch, uid, index) {
    var found = findItem(ch, uid);
    if (!found) return { ok: false, reason: '找不到该装备' };
    return I.toggleAffixLock(found.item, index);
  }

  /** 分解为材料；已装备的需先卸下；上锁装备不可分解。强化投入按比例返还。 */
  function salvage(ch, uid) {
    var idx = -1;
    for (var i = 0; i < ch.inventory.length; i++) if (ch.inventory[i].uid === uid) { idx = i; break; }
    if (idx < 0) return { ok: false, reason: '只能分解背包中的装备' };
    if (ch.inventory[idx].locked) return { ok: false, reason: '装备已上锁，请先解锁' };
    var item = ch.inventory.splice(idx, 1)[0];
    var y = I.salvageYield(item);
    ch.materials.up += y.stones;
    ch.materials.re += y.rerolls;
    ch.coins += y.coins || 0;
    return { ok: true, item: item, yield: y };
  }

  function sell(ch, uid) {
    var idx = -1;
    for (var i = 0; i < ch.inventory.length; i++) if (ch.inventory[i].uid === uid) { idx = i; break; }
    if (idx < 0) return { ok: false, reason: '只能出售背包中的装备' };
    if (ch.inventory[idx].locked) return { ok: false, reason: '装备已上锁，请先解锁' };
    var item = ch.inventory.splice(idx, 1)[0];
    var price = I.sellPrice(item);
    ch.coins += price;
    return { ok: true, item: item, price: price };
  }

  /** 切换装备锁定；已装备与背包中的均可上锁 */
  function toggleLock(ch, uid) {
    var found = findItem(ch, uid);
    if (!found) return { ok: false, reason: '找不到该装备' };
    found.item.locked = !found.item.locked;
    return { ok: true, item: found.item, locked: !!found.item.locked };
  }

  function setLocked(ch, uid, locked) {
    var found = findItem(ch, uid);
    if (!found) return { ok: false, reason: '找不到该装备' };
    found.item.locked = !!locked;
    return { ok: true, item: found.item, locked: !!found.item.locked };
  }

  /**
   * 批量分解所有「未装备且战力低于阈值」的装备（背包清理）。
   * 默认跳过上锁装备；第三参可以是保护函数，或 { targetMlvl, protected } 选项对象。
   */
  function salvageBelow(ch, keepPower, optsOrFn) {
    var opts = {};
    var protectedFn = null;
    if (typeof optsOrFn === 'function') protectedFn = optsOrFn;
    else if (optsOrFn && typeof optsOrFn === 'object') {
      opts = optsOrFn;
      protectedFn = opts.protected || null;
    }
    var mlvl = opts.targetMlvl !== undefined ? opts.targetMlvl : targetMlvl(ch);
    var removed = 0, stones = 0, rerolls = 0, coins = 0, skippedLocked = 0, skipped = 0;
    for (var i = ch.inventory.length - 1; i >= 0; i--) {
      var it = ch.inventory[i];
      if (it.locked) { skippedLocked++; continue; }
      if (protectedFn && protectedFn(it)) { skipped++; continue; }
      if (scoreItem(it, mlvl) > keepPower) continue;
      var y = I.salvageYield(it);
      stones += y.stones; rerolls += y.rerolls; coins += y.coins || 0;
      ch.inventory.splice(i, 1);
      removed++;
    }
    ch.materials.up += stones;
    ch.materials.re += rerolls;
    ch.coins += coins;
    return {
      removed: removed, stones: stones, rerolls: rerolls, coins: coins,
      skippedLocked: skippedLocked, skipped: skipped + skippedLocked
    };
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

  /** 用秘宝向神秘商人换一件随机高品质装备（保底精良） */
  var MYSTERY_COST = 6;
  function buyMysteryItem(ch, ilvl, slot) {
    if (ch.stones < MYSTERY_COST) return { ok: false, reason: 'alpha-stone 不足（需要 ' + MYSTERY_COST + '）' };
    if (ch.inventory.length >= INVENTORY_CAP) return { ok: false, reason: '背包已满' };
    ch.stones -= MYSTERY_COST;
    var rng = SP.makeRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
    var item = null;
    for (var tries = 0; tries < 12; tries++) {
      item = I.roll(rng, { ilvl: ilvl, slot: slot, rarityBias: 2.2 + tries * 0.4, luck: 0.4 });
      if (I.RARITY_BY_KEY[item.rarity].index >= 1) break;
    }
    ch.inventory.push(item);
    discoverGear(ch, item);
    return { ok: true, item: item, cost: MYSTERY_COST };
  }

  /**
   * 金币换强化石 / 重铸石。
   * 加这个出口是因为「石头用不完、金币不够用」：机器人 30 局后手里 5,679 强化石
   * 却只有 471 金币，强化永远卡在金币上。有了兑换，两种资源可以互相补位。
   */
  function matCoinPrice(ch, kind) {
    var lvl = Math.max(1, Math.round(num(ch && ch.level, 1)));
    var base = kind === 're' ? 120 : 40;
    return Math.round(base * (1 + 0.25 * lvl));
  }
  function buyMaterial(ch, kind, coinsEach) {
    var n = Math.max(1, Math.round(coinsEach || 1));
    var price = matCoinPrice(ch, kind) * n;
    if (ch.coins < price) return { ok: false, reason: 'pig-coin 不足（需要 ' + price + '）' };
    ch.coins -= price;
    if (kind === 're') ch.materials.re += n;
    else ch.materials.up += n;
    return { ok: true, cost: price, amount: n, kind: kind === 're' ? 're' : 'up' };
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
    // 装备图鉴：清洗未知 base / unique
    var rawG = (ch.gearCodex && typeof ch.gearCodex === 'object') ? ch.gearCodex : {};
    var cleanBases = {}, cleanUniques = {};
    var rawBases = (rawG.bases && typeof rawG.bases === 'object') ? rawG.bases : {};
    var rawUniques = (rawG.uniques && typeof rawG.uniques === 'object') ? rawG.uniques : {};
    Object.keys(rawBases).forEach(function (key) {
      if (!I.BASE_BY_KEY[key]) return;
      var rec = rawBases[key] || {};
      var count = Math.max(0, Math.round(num(rec.count)));
      if (count <= 0) return;
      var br = rec.bestRarity;
      if (!I.RARITY_BY_KEY[br]) br = 'common';
      cleanBases[key] = {
        count: count,
        bestRarity: br,
        firstAt: Math.max(0, Math.round(num(rec.firstAt, Date.now())))
      };
    });
    Object.keys(rawUniques).forEach(function (key) {
      if (!I.UNIQUE_BY_KEY[key]) return;
      var rec = rawUniques[key] || {};
      var count = Math.max(0, Math.round(num(rec.count)));
      if (count <= 0) return;
      cleanUniques[key] = {
        count: count,
        firstAt: Math.max(0, Math.round(num(rec.firstAt, Date.now())))
      };
    });
    ch.gearCodex = { bases: cleanBases, uniques: cleanUniques };
    // 丢弃结构损坏的装备，避免后续计算炸掉
    ch.inventory = ch.inventory.filter(function (it) { return validItem(it); });
    I.EQUIP_SLOTS.forEach(function (s) {
      if (ch.equipped[s] && !validItem(ch.equipped[s])) ch.equipped[s] = null;
    });
    ch.inventory.forEach(normalizeItemFlags);
    I.EQUIP_SLOTS.forEach(function (s) {
      if (ch.equipped[s]) normalizeItemFlags(ch.equipped[s]);
    });
    // 旧存档回填：已拥有的装备记入图鉴
    syncGearCodexFromOwned(ch);
    return ch;
  }

  function normalizeItemFlags(it) {
    if (!it) return;
    it.locked = !!it.locked;
    if (!Array.isArray(it.affixes)) return;
    var locks = 0;
    it.affixes.forEach(function (af) {
      if (!af || typeof af !== 'object') return;
      af.locked = !!af.locked;
      if (af.locked) {
        locks++;
        if (locks > I.MAX_AFFIX_LOCKS) af.locked = false;
      }
    });
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
    targetMlvl: targetMlvl,
    scoreItem: scoreItem,
    slotGroup: slotGroup,
    upgradeItem: upgradeItem,
    rerollItem: rerollItem,
    toggleAffixLock: toggleAffixLock,
    salvage: salvage,
    sell: sell,
    toggleLock: toggleLock,
    setLocked: setLocked,
    salvageBelow: salvageBelow,
    clearedFloor: clearedFloor,
    unlockedBiomes: unlockedBiomes,
    isUnlocked: isUnlocked,
    maxFloor: maxFloor,
    bankRun: bankRun,
    buySteak: buySteak,
    buyMaterial: buyMaterial,
    matCoinPrice: matCoinPrice,
    buyMysteryItem: buyMysteryItem,
    mergeBestiary: mergeBestiary,
    isDiscovered: isDiscovered,
    bestiaryProgress: bestiaryProgress,
    bestiaryCatalog: bestiaryCatalog,
    discoverGear: discoverGear,
    syncGearCodexFromOwned: syncGearCodexFromOwned,
    isGearDiscovered: isGearDiscovered,
    isUniqueDiscovered: isUniqueDiscovered,
    gearCodexProgress: gearCodexProgress,
    uniqueCodexProgress: uniqueCodexProgress,
    gearCodexCatalog: gearCodexCatalog,
    uniqueCodexCatalog: uniqueCodexCatalog
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
