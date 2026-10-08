/* 时空猪 · sim.js — 动作 RPG 战斗与副本模拟（纯逻辑，不触碰 DOM）
 *
 * 与生存竞技版的区别：
 *   - 角色属性不再来自「本轮升级卡牌」，而是由 角色等级 + 已装备物品 派生（见 SP.deriveCharacter）
 *   - 战斗发生在「副本层」中：刷够击杀数 → 关底首领出现 → 击败即通关
 *   - 怪物按 生物群系 + 层级 决定等级 mlvl，掉落物品的 ilvl 与之挂钩
 *   - 击杀掉落装备实体、三种货币与两种强化材料
 */
(function (global) {
  'use strict';
  var SP = global.SP || (global.SP = {});
  var TAU = SP.TAU, clamp = SP.clamp, dist = SP.dist, angleDiff = SP.angleDiff;

  /* =============================================================== 生物群系 */
  var BIOMES = {
    camp: {
      key: 'camp', name: '科多兽营地', mlvlBase: 1, arena: 1150,
      ground: ['#312639', '#261d2c', '#1e1728', '#151021'],
      obstacleKinds: ['tent', 'rock', 'spire'],
      enemies: { melee: 'calf', charger: 'charger', ranged: 'bat', boss: 'alpha' },
      tier: 1
    },
    forest: {
      key: 'forest', name: '孢子森林', mlvlBase: 5, arena: 1250,
      ground: ['#1d2b22', '#17231b', '#121b16', '#0d1512'],
      obstacleKinds: ['tree', 'mushroom', 'rock'],
      enemies: { melee: 'sporeling', charger: 'thornbeast', ranged: 'spitter', boss: 'treant' },
      tier: 2
    },
    cave: {
      key: 'cave', name: '时空洞窟', mlvlBase: 10, arena: 1200,
      ground: ['#1b2130', '#151a27', '#10141f', '#0b0e16'],
      obstacleKinds: ['crystal', 'stalagmite', 'rock'],
      enemies: { melee: 'crawler', charger: 'gargoyle', ranged: 'shardcaster', boss: 'golem' },
      tier: 3
    },
    nest: {
      key: 'nest', name: '魔兽巢穴', mlvlBase: 16, arena: 1300,
      ground: ['#2c1c24', '#23161d', '#1a1017', '#120a10'],
      obstacleKinds: ['bone', 'egg', 'rock'],
      enemies: { melee: 'broodling', charger: 'ravager', ranged: 'venomwing', boss: 'queen' },
      tier: 4
    }
  };
  var BIOME_ORDER = ['camp', 'forest', 'cave', 'nest'];

  /* ================================================================= 怪物表
   * kind 决定行为：melee 追击近战 / charger 蓄力冲撞 / ranged 远程弹幕 / boss 首领
   */
  function E(key, name, kind, o) {
    return {
      key: key, name: name, kind: kind, family: o.family || 'beast',
      hp: o.hp, speed: o.speed, radius: o.r, dmg: o.dmg,
      atkCd: o.cd, atkRange: o.range, xp: o.xp, coin: o.coin,
      color: o.color, accent: o.accent || null,
      boss: kind === 'boss',
      slamR: o.slamR || 190, summon: o.summon || null, summonN: o.summonN || 3,
      volley: !!o.volley, elite: false
    };
  }

  var ENEMY_TYPES = {};
  [
    /* --- 科多兽营地 --- */
    E('calf', '科多兽幼崽', 'melee', { family: 'beast', hp: 46, speed: 96, r: 19, dmg: 8, cd: 1.1, range: 40, xp: 6, coin: 1, color: '#9a7550' }),
    E('charger', '冲锋科多兽', 'charger', { family: 'beast', hp: 88, speed: 74, r: 26, dmg: 19, cd: 2.6, range: 46, xp: 11, coin: 2, color: '#79543a' }),
    E('bat', '孢子蝠', 'ranged', { family: 'wing', hp: 34, speed: 134, r: 15, dmg: 7, cd: 2.2, range: 300, xp: 9, coin: 2, color: '#8f66bd' }),
    E('alpha', '营地首领·科多兽王', 'boss', { family: 'beast', hp: 880, speed: 68, r: 44, dmg: 26, cd: 4.0, range: 84, xp: 150, coin: 30, color: '#b45f34', summon: 'calf', summonN: 3 }),

    /* --- 孢子森林 --- */
    E('sporeling', '孢子行者', 'melee', { family: 'fungus', hp: 62, speed: 104, r: 20, dmg: 10, cd: 1.0, range: 42, xp: 8, coin: 1, color: '#5f8f5a' }),
    E('thornbeast', '荆棘兽', 'charger', { family: 'fungus', hp: 120, speed: 80, r: 28, dmg: 24, cd: 2.5, range: 48, xp: 14, coin: 2, color: '#4e7a44' }),
    E('spitter', '孢囊喷吐者', 'ranged', { family: 'wing', hp: 44, speed: 120, r: 17, dmg: 9, cd: 1.9, range: 320, xp: 11, coin: 2, color: '#8fbf6a' }),
    E('treant', '森林主宰·孢子树王', 'boss', { family: 'fungus', hp: 1150, speed: 58, r: 48, dmg: 30, cd: 3.6, range: 92, xp: 190, coin: 36, color: '#4a6b3c', summon: 'sporeling', summonN: 4, slamR: 220, volley: true }),

    /* --- 时空洞窟 --- */
    E('crawler', '晶壳爬虫', 'melee', { family: 'crystal', hp: 84, speed: 98, r: 21, dmg: 13, cd: 1.1, range: 42, xp: 10, coin: 2, color: '#5a7fa8' }),
    E('gargoyle', '石像鬼', 'charger', { family: 'crystal', hp: 150, speed: 86, r: 27, dmg: 28, cd: 2.4, range: 48, xp: 17, coin: 3, color: '#6d7793' }),
    E('shardcaster', '碎晶术士', 'ranged', { family: 'wing', hp: 56, speed: 116, r: 18, dmg: 12, cd: 1.8, range: 340, xp: 14, coin: 3, color: '#7fc4e8' }),
    E('golem', '洞窟守卫·时空魔像', 'boss', { family: 'crystal', hp: 1500, speed: 56, r: 50, dmg: 34, cd: 3.4, range: 96, xp: 240, coin: 44, color: '#6f86a8', summon: 'crawler', summonN: 3, slamR: 240, volley: true }),

    /* --- 魔兽巢穴 --- */
    E('broodling', '巢穴幼魔', 'melee', { family: 'demon', hp: 70, speed: 132, r: 17, dmg: 12, cd: 0.9, range: 38, xp: 9, coin: 2, color: '#a85a72' }),
    E('ravager', '噬骨魔', 'charger', { family: 'demon', hp: 190, speed: 92, r: 29, dmg: 33, cd: 2.3, range: 50, xp: 21, coin: 4, color: '#8a4a5c' }),
    E('venomwing', '毒翼', 'ranged', { family: 'wing', hp: 68, speed: 140, r: 18, dmg: 14, cd: 1.7, range: 330, xp: 16, coin: 3, color: '#a06ad0' }),
    E('queen', '巢穴女王', 'boss', { family: 'demon', hp: 1900, speed: 78, r: 52, dmg: 38, cd: 3.0, range: 100, xp: 300, coin: 55, color: '#b05a8a', summon: 'broodling', summonN: 5, slamR: 260, volley: true })
  ].forEach(function (e) { ENEMY_TYPES[e.key] = e; });

  /* ========================================================= 角色属性派生 */
  var BASE = {
    atk: function (lv) { return 9 + lv * 2.1; },
    hp: function (lv) { return 110 + lv * 14; },
    crit: 5, critDmg: 150, aspd: 1.6, move: 205,
    regen: 0.6, pickup: 112
  };

  function xpForLevel(lv) { return Math.round(42 + lv * 26 + lv * lv * 2.2); }

  /**
   * 由 角色等级 + 已装备物品 推导出实际战斗属性。
   * character: { level, equipped:{...}, }
   */
  function deriveCharacter(character) {
    var ch = character || {};
    var lv = ch.level || 1;
    var eq = SP.Items.aggregate(ch.equipped);
    var uniq = eq.__uniques || [];
    var has = function (k) { return uniq.indexOf(k) >= 0; };

    var atk = (BASE.atk(lv) + (eq.atk || 0)) * (1 + (eq.atkPct || 0) / 100);
    var maxHp = (BASE.hp(lv) + (eq.hp || 0)) * (1 + (eq.hpPct || 0) / 100);
    var crit = clamp(BASE.crit + (eq.crit || 0), 0, 90) / 100;
    var critMult = (BASE.critDmg + (eq.critDmg || 0)) / 100;
    var aspd = BASE.aspd * (1 + (eq.aspd || 0) / 100);
    var move = BASE.move * (1 + (eq.move || 0) / 100);
    var lifesteal = (eq.lifesteal || 0) / 100;
    var greed = (eq.greed || 0) / 100;
    var luck = (eq.luck || 0) / 100;
    var skillDmg = (eq.skillDmg || 0) / 100;
    var cdr = clamp((eq.cdr || 0) / 100, 0, 0.6);

    // 传说独特效果
    if (has('swift')) move *= 1.12;
    if (has('greedheart')) { greed += 0.25; luck += 0.25; }
    if (has('vampiric')) lifesteal *= 2;

    return {
      level: lv,
      damage: atk,
      maxHp: maxHp,
      crit: crit,
      critMult: critMult,
      attackSpeed: aspd,
      speed: move,
      armor: (eq.armor || 0),
      lifesteal: lifesteal,
      regen: BASE.regen + (eq.regen || 0),
      thorns: (eq.thorns || 0),
      magnet: BASE.pickup + (eq.pickup || 0),
      greed: greed,
      luck: luck,
      skillDmg: skillDmg,
      cdr: cdr,
      uniques: uniq
    };
  }

  /** 护甲减伤：随怪物等级提升而衰减，避免高等级时护甲无限强 */
  function armorReduction(armor, mlvl) {
    if (armor <= 0) return 0;
    return Math.min(0.75, armor / (armor + 60 + 7 * mlvl));
  }

  /* -------------------------------------------------------------- 场景障碍物 */
  function buildObstacles(rng, biome) {
    var list = [], i, tries, ox, oy, r, ok, A = biome.arena;
    var kinds = biome.obstacleKinds;
    function farEnough(x, y, rr) {
      if (SP.dist(x, y, 0, 0) < rr + 140) return false;
      for (var k = 0; k < list.length; k++) {
        var o = list[k];
        if (SP.dist(x, y, o.x, o.y) < rr + o.r + 48) return false;
      }
      return true;
    }
    // 中心一圈地标（营地是帐篷、森林是巨树、洞窟是晶簇、巢穴是骨堆）
    for (i = 0; i < 5; i++) {
      var a = (i / 5) * TAU + rng() * 0.5;
      r = kinds[0] === 'tent' ? rng.range(34, 46) : rng.range(38, 54);
      list.push({
        x: Math.cos(a) * rng.range(230, 350), y: Math.sin(a) * rng.range(230, 350),
        r: r, kind: kinds[0], rot: a
      });
    }
    for (i = 0; i < 22; i++) {
      var kind = kinds[i % kinds.length === 0 ? 0 : (1 + (i % 2))] || kinds[1];
      if (i % 3 === 0) kind = kinds[0];
      r = kind === 'stalagmite' || kind === 'crystal' || kind === 'mushroom' ? rng.range(22, 34) : rng.range(34, 74);
      ok = false; ox = 0; oy = 0;
      for (tries = 0; tries < 40 && !ok; tries++) {
        var ang = rng() * TAU, rad = rng.range(400, A - 130);
        ox = Math.cos(ang) * rad; oy = Math.sin(ang) * rad;
        if (Math.abs(ox) < A - r - 60 && Math.abs(oy) < A - r - 60 && farEnough(ox, oy, r)) ok = true;
      }
      if (ok) list.push({ x: ox, y: oy, r: r, kind: kind, rot: rng() * TAU });
    }
    return list;
  }

  /* =================================================================== World */
  /**
   * opts: {
   *   seed, character,            // 角色存档（等级 + 装备）
   *   dungeon: { biome, floor }   // 目标副本层
   * }
   */
  function World(opts) {
    opts = opts || {};
    var seed = opts.seed === undefined ? ((Date.now() ^ 0x5f3759df) >>> 0) : (opts.seed >>> 0);
    this.seed = seed;
    this.rng = SP.makeRng(seed);

    var d = opts.dungeon || {};
    var biomeKey = BIOMES[d.biome] ? d.biome : 'camp';
    this.biomeKey = biomeKey;
    this.biome = BIOMES[biomeKey];
    this.floor = Math.max(1, Math.round(d.floor || 1));
    this.tier = this.biome.tier;
    this.mlvl = this.biome.mlvlBase + (this.floor - 1);
    this.arena = this.biome.arena;

    var stats = deriveCharacter(opts.character);
    this.character = opts.character || null;
    this.stats = stats;

    var p = this.player = {
      x: 0, y: 0, vx: 0, vy: 0, r: 18, facing: -Math.PI / 2,
      damage: stats.damage, maxHp: stats.maxHp, hp: stats.maxHp,
      speed: stats.speed, attackSpeed: stats.attackSpeed,
      range: 88, arcWidth: 1.9, crit: stats.crit, critMult: stats.critMult,
      armor: stats.armor, lifesteal: stats.lifesteal, regen: stats.regen,
      thorns: stats.thorns, magnet: stats.magnet, greed: stats.greed,
      luck: stats.luck, skillDmg: stats.skillDmg, cdr: stats.cdr,
      uniques: stats.uniques,
      atkCd: 0, swingT: 0, swingDir: 0,
      quakeCd: 0, blessCd: 0, useCd: 0, dashCd: 0, dashT: 0, dashDir: 0,
      shield: 0, shieldT: 0, dmgBuffT: 0, dmgBuffMul: 1,
      speedBuffT: 0, invuln: 0, hurtFlash: 0, walkPhase: 0,
      killStreak: 0, level: stats.level
    };
    this.hasUnique = function (k) { return p.uniques.indexOf(k) >= 0; };

    this.obstacles = buildObstacles(this.rng, this.biome);
    this.decals = [];
    for (var i = 0; i < 26; i++) {
      this.decals.push({
        x: this.rng.range(-this.arena, this.arena), y: this.rng.range(-this.arena, this.arena),
        r: this.rng.range(30, 120), a: this.rng.range(0.03, 0.09)
      });
    }
    this.stars = [];
    for (var s = 0; s < 190; s++) {
      this.stars.push({
        x: this.rng.range(-this.arena - 400, this.arena + 400),
        y: this.rng.range(-this.arena - 400, this.arena + 400),
        r: this.rng.range(0.6, 2.1), a: this.rng.range(0.15, 0.7), tw: this.rng.range(0.5, 2.4)
      });
    }

    this.enemies = [];
    this.pickups = [];
    this.projectiles = [];
    this.fx = [];
    this.texts = [];
    this.events = [];

    this.time = 0;
    this.kills = 0;
    this.eliteKills = 0;
    this.coins = 0;
    this.stones = 0;
    this.upStones = 0;
    this.reStones = 0;
    this.steaks = clamp((opts.steaks !== undefined ? opts.steaks : 3), 0, 9);
    this.loot = [];              // 本局拾取到的装备
    this.xpGained = 0;
    this.levelsGained = 0;

    // 副本推进：击杀配额 → 首领 → 通关
    this.killsNeeded = Math.min(60, 14 + this.floor * 3);
    this.boss = null;
    this.bossSpawned = false;
    this.cleared = false;
    this.dead = false;
    this.deathStats = null;
    this.stats_damageDealt = 0;
    this.stats_damageTaken = 0;
    this.spawnTimer = 1.2;
    // 场上同时存在的怪越多，越逼玩家走位而不是站桩
    this.aliveTarget = 8 + Math.min(12, Math.floor(this.floor / 1.2));

    this.shake = 0;
    this.hitStop = 0;
    this.comboT = 0;
    this.combo = 0;
    this.camera = { x: 0, y: 0 };
  }

  World.prototype.emit = function (type, data) { this.events.push({ type: type, data: data || null, t: this.time }); };
  World.prototype.drainEvents = function () { var e = this.events; this.events = []; return e; };

  /* ------------------------------------------------------------- 几何与碰撞 */
  function pushOutOfObstacles(w, ent) {
    for (var i = 0; i < w.obstacles.length; i++) {
      var o = w.obstacles[i];
      var dx = ent.x - o.x, dy = ent.y - o.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var min = o.r + ent.r;
      if (d < min) {
        if (d < 0.0001) { dx = 1; dy = 0; d = 1; }
        ent.x = o.x + (dx / d) * min;
        ent.y = o.y + (dy / d) * min;
      }
    }
  }
  function clampArena(w, ent) {
    var A = w.arena;
    ent.x = clamp(ent.x, -A, A);
    ent.y = clamp(ent.y, -A, A);
  }
  function blocked(w, x, y, r) {
    for (var i = 0; i < w.obstacles.length; i++) {
      var o = w.obstacles[i];
      if (SP.dist(x, y, o.x, o.y) < o.r + r + 6) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------- 特效与文字 */
  World.prototype.addText = function (x, y, text, color, size, vy) {
    this.texts.push({
      x: x, y: y, text: text, color: color || '#fff',
      size: size || 15, life: 0.85, max: 0.85, vy: vy === undefined ? -46 : vy
    });
  };
  World.prototype.ring = function (x, y, r0, r1, dur, color, width) {
    this.fx.push({ t: 'ring', x: x, y: y, r0: r0, r1: r1, dur: dur, life: dur, color: color, w: width || 4 });
  };
  World.prototype.slash = function (x, y, angle, range, arc, dur) {
    this.fx.push({ t: 'slash', x: x, y: y, a: angle, range: range, arc: arc, dur: dur, life: dur });
  };
  World.prototype.burst = function (x, y, n, color, speed, life, size) {
    for (var i = 0; i < n; i++) {
      var a = this.rng() * TAU, sp = speed * this.rng.range(0.35, 1.2);
      this.fx.push({
        t: 'p', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        dur: life * this.rng.range(0.6, 1.3), life: life, color: color, size: size || 3
      });
    }
  };

  /* --------------------------------------------------------------- 刷怪 */
  /**
   * 难度曲线。这里刻意使用「二次」成长而不是线性：
   * 掉落 ilvl 与怪物等级同步上涨，而玩家攻击力 = 等级 + 装备 + 强化，是叠加成长的，
   * 若怪物只按线性变强，越往深层反而越轻松（实测过：机器人能一路平推 17 层不死）。
   * 二次项保证越深越吃装备，从而形成真正的「装备门槛」。
   */
  World.prototype.scaling = function () {
    var m = this.mlvl;
    return {
      hp: 1 + 0.30 * m + 0.035 * m * m,
      dmg: 1 + 0.25 * m + 0.030 * m * m,
      speed: Math.min(2.3, 1 + 0.035 * m)
    };
  };

  /** 首领血量单独一条更平缓的曲线，避免单场首领战拖到一分钟以上 */
  World.prototype.bossHpMul = function () {
    var m = this.mlvl;
    return 1 + 0.30 * m + 0.014 * m * m;
  };

  World.prototype.spawnEnemy = function (key, opts) {
    opts = opts || {};
    var def = ENEMY_TYPES[key];
    if (!def) def = ENEMY_TYPES.calf;
    var sc = this.scaling();
    var elite = !!opts.elite;
    var p = this.player, x = 0, y = 0, ok = false;
    var rad0 = opts.dist || 470, rad1 = (opts.dist || 470) + 210;
    for (var i = 0; i < 60 && !ok; i++) {
      var a = opts.angle !== undefined ? opts.angle + this.rng.range(-0.5, 0.5) : this.rng() * TAU;
      var rad = this.rng.range(rad0, rad1);
      x = clamp(p.x + Math.cos(a) * rad, -this.arena + 40, this.arena - 40);
      y = clamp(p.y + Math.sin(a) * rad, -this.arena + 40, this.arena - 40);
      if (!blocked(this, x, y, def.radius)) ok = true;
    }
    var hpMul = (def.boss ? this.bossHpMul() : sc.hp) * (elite ? 2.8 : 1);
    var e = {
      key: key, name: (elite ? '精英·' : '') + def.name, kind: def.kind, family: def.family || 'beast',
      x: x, y: y, vx: 0, vy: 0, r: def.radius * (elite ? 1.22 : 1),
      hp: def.hp * hpMul, maxHp: def.hp * hpMul,
      speed: def.speed * sc.speed * (elite ? 0.92 : 1),
      dmg: def.dmg * sc.dmg * (elite ? 1.45 : 1),
      atkCd: def.atkCd * this.rng.range(0.7, 1.2), atkRange: def.atkRange,
      xp: def.xp * (1 + 0.55 * this.mlvl) * (elite ? 2.5 : 1),
      coin: def.coin * (elite ? 4 : 1),
      color: def.color, accent: def.accent,
      state: 'idle', stateT: 0, hitFlash: 0, stun: 0, dying: 0,
      chargeDir: 0, didHit: false, boss: def.boss, elite: elite,
      spawnT: 0.45, anim: this.rng() * TAU,
      slamR: def.slamR, summon: def.summon, summonN: def.summonN, volley: def.volley
    };
    if (def.boss) { e.slamCd = 3.0; e.summonCd = 8.0; e.volleyCd = 5.5; }
    this.enemies.push(e);
    if (def.boss) this.boss = e;
    this.emit('spawn', { key: key, boss: def.boss, elite: elite });
    return e;
  };

  World.prototype.pickSpawnKey = function () {
    var set = this.biome.enemies;
    var r = this.rng();
    if (r < 0.58) return set.melee;
    if (r < 0.82) return set.charger;
    return set.ranged;
  };

  World.prototype.updateSpawns = function (dt) {
    if (this.bossSpawned) return;
    var alive = 0;
    for (var i = 0; i < this.enemies.length; i++) if (this.enemies[i].dying <= 0) alive++;
    // 首领已出现前持续补充怪群，维持压迫感
    if (this.kills >= this.killsNeeded) {
      if (!this.bossSpawned) {
        this.bossSpawned = true;
        this.emit('boss_wave', { boss: this.biome.enemies.boss, name: ENEMY_TYPES[this.biome.enemies.boss].name });
        this.addText(this.player.x, this.player.y - 80, '首领出现！', '#ff9c5b', 24, -18);
        this.spawnEnemy(this.biome.enemies.boss, { dist: 430 });
      }
      return;
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = Math.max(0.28, 0.85 - this.floor * 0.03);
    var batch = alive < this.aliveTarget ? 2 : 1;
    for (var b = 0; b < batch; b++) {
      var elite = this.rng() < (0.06 + 0.02 * this.tier);
      this.spawnEnemy(this.pickSpawnKey(), { elite: elite });
    }
  };

  /* ----------------------------------------------------------------- 伤害 */
  World.prototype.damageEnemy = function (e, amount, opts) {
    opts = opts || {};
    if (e.dying > 0) return 0;
    var dealt = Math.max(1, amount);
    e.hp -= dealt;
    e.hitFlash = 0.16;
    this.stats_damageDealt += dealt;
    this.addText(e.x + this.rng.range(-8, 8), e.y - e.r - 6,
      (opts.crit ? '✦' : '') + Math.round(dealt), opts.crit ? '#ffe066' : '#ffffff', opts.crit ? 19 : 14);
    this.burst(e.x, e.y, opts.crit ? 7 : 4, '#ff7a7a', 150, 0.3, 2.6);
    if (opts.knock) {
      e.vx += Math.cos(opts.knockAngle) * opts.knock;
      e.vy += Math.sin(opts.knockAngle) * opts.knock;
    }
    if (opts.stun) e.stun = Math.max(e.stun, opts.stun);
    if (e.hp <= 0) this.killEnemy(e);
    return dealt;
  };

  World.prototype.rollLoot = function (e) {
    var p = this.player;
    var ilvl = Math.max(1, this.mlvl + Math.round(this.rng.range(-1, 2)));
    var chance = e.boss ? 1 : (e.elite ? 0.55 : 0.16);
    var count = e.boss ? 3 + (e.elite ? 1 : 0) : (e.elite ? 1 : 0);
    if (e.elite && this.hasUnique('hunter')) count += 1;
    if (this.rng() < chance) count += 1;
    for (var i = 0; i < count; i++) {
      // 首领第一件保底稀有以上
      var bias = (e.boss ? 0.35 : 0) + (e.elite ? 0.15 : 0) + this.floor * 0.012;
      var item = SP.Items.roll(this.rng, { ilvl: ilvl, rarityBias: bias, luck: p.luck });
      if (e.boss && i === 0) {
        var idx = SP.Items.RARITY_BY_KEY[item.rarity].index;
        if (idx < 2) {
          item = SP.Items.roll(this.rng, { ilvl: ilvl, rarityBias: bias + 1.6, luck: p.luck });
        }
      }
      this.pickups.push({
        x: e.x + this.rng.range(-26, 26), y: e.y + this.rng.range(-26, 26),
        kind: 'item', item: item, life: 60, r: 14, bob: this.rng() * TAU, vx: 0, vy: 0
      });
    }
  };

  World.prototype.killEnemy = function (e) {
    if (e.dying > 0) return;
    e.dying = 0.3;
    this.kills++;
    if (e.elite) this.eliteKills++;
    this.combo++;
    this.comboT = 2.4;
    var p = this.player;

    this.addXp(e.xp);

    // 吸血改为按造成伤害计算，这里只处理击杀回血类的独特效果
    var coins = Math.max(1, Math.round(e.coin * (1 + p.greed)));
    this.pickups.push({
      x: e.x + this.rng.range(-14, 14), y: e.y + this.rng.range(-14, 14),
      kind: 'coin', value: coins, life: 30, r: 11, bob: this.rng() * TAU, vx: 0, vy: 0
    });
    // 材料与秘宝
    var matChance = e.boss ? 1 : (e.elite ? 0.6 : 0.10);
    if (this.rng() < matChance) {
      this.pickups.push({
        x: e.x + this.rng.range(-20, 20), y: e.y + this.rng.range(-20, 20),
        kind: 'upstone', value: (e.boss ? 3 : (e.elite ? 2 : 1)), life: 40, r: 12, bob: this.rng() * TAU, vx: 0, vy: 0
      });
    }
    if (this.rng() < matChance * 0.55) {
      this.pickups.push({
        x: e.x + this.rng.range(-20, 20), y: e.y + this.rng.range(-20, 20),
        kind: 'restone', value: 1, life: 40, r: 12, bob: this.rng() * TAU, vx: 0, vy: 0
      });
    }
    if (e.boss || this.rng() < 0.02 + p.luck) {
      var n = e.boss ? 4 : 1;
      for (var s = 0; s < n; s++) {
        this.pickups.push({
          x: e.x + this.rng.range(-40, 40), y: e.y + this.rng.range(-40, 40),
          kind: 'alpha', value: 1, life: 50, r: 12, bob: this.rng() * TAU, vx: 0, vy: 0
        });
      }
    }
    if (this.rng() < (e.boss ? 1 : 0.07)) {
      this.pickups.push({
        x: e.x + this.rng.range(-18, 18), y: e.y + this.rng.range(-18, 18),
        kind: 'steak', value: 1, life: 34, r: 12, bob: this.rng() * TAU, vx: 0, vy: 0
      });
    }

    this.rollLoot(e);

    // 传说：时空回响
    if (this.hasUnique('echo') && this.rng() < 0.12) {
      this.ring(p.x, p.y, 12, 150, 0.35, '#7fe3ff', 5);
      for (var q = 0; q < this.enemies.length; q++) {
        var t = this.enemies[q];
        if (t.dying > 0) continue;
        if (SP.dist(p.x, p.y, t.x, t.y) < 160 + t.r) {
          this.damageEnemy(t, p.damage * 1.4, { knock: 200, knockAngle: Math.atan2(t.y - p.y, t.x - p.x) });
        }
      }
    }

    this.burst(e.x, e.y, e.boss ? 46 : (e.elite ? 22 : 12), e.color, e.boss ? 280 : 180, 0.6, e.boss ? 4 : 3);
    this.emit('kill', { key: e.key, x: e.x, y: e.y, boss: e.boss, elite: e.elite, combo: this.combo });

    if (e.boss) {
      this.cleared = true;
      this.shake = Math.max(this.shake, 18);
      this.ring(e.x, e.y, 10, 300, 0.8, '#ffb066', 9);
      this.emit('clear', { floor: this.floor, biome: this.biomeKey, kills: this.kills });
    } else {
      this.shake = Math.max(this.shake, e.elite ? 7 : 3.5);
    }
  };

  World.prototype.addXp = function (n) {
    var p = this.player;
    this.xpGained += n;
    if (!this.character) return;
    var ch = this.character;
    ch.xp = (ch.xp || 0) + n;
    var guard = 0;
    while (ch.xp >= xpForLevel(ch.level || 1) && guard++ < 30) {
      ch.xp -= xpForLevel(ch.level);
      ch.level = (ch.level || 1) + 1;
      this.levelsGained++;
      // 升级即时强化本轮属性
      p.level = ch.level;
      var fresh = deriveCharacter(ch);
      var hpGain = fresh.maxHp - p.maxHp;
      p.maxHp = fresh.maxHp;
      p.hp = Math.min(p.maxHp, p.hp + Math.max(0, hpGain) + p.maxHp * 0.15);
      p.damage = fresh.damage;
      this.ring(p.x, p.y, 12, 150, 0.6, '#a8f0ff', 5);
      this.burst(p.x, p.y, 24, '#a8f0ff', 210, 0.65, 3);
      this.addText(p.x, p.y - 74, 'Lv.' + ch.level, '#a8f0ff', 25, -30);
      this.emit('levelup', { level: ch.level });
    }
    this.emit('xp', { xp: ch.xp, next: xpForLevel(ch.level) });
  };

  /* ------------------------------------------------------------- 玩家受伤 */
  World.prototype.hurtPlayer = function (amount, srcX, srcY) {
    var p = this.player;
    if (this.dead || p.invuln > 0) return 0;
    var reduced = amount * (1 - armorReduction(p.armor, this.mlvl));
    if (p.shield > 0) {
      var absorbed = Math.min(p.shield, reduced);
      p.shield -= absorbed;
      reduced -= absorbed;
      this.addText(p.x, p.y - 34, '护盾 -' + Math.round(absorbed), '#8fd8ff', 13);
    }
    if (reduced > 0) {
      p.hp -= reduced;
      this.stats_damageTaken += reduced;
      this.addText(p.x, p.y - 26, '-' + Math.round(reduced), '#ff6b6b', 17);
    }
    p.invuln = 0.62;
    p.hurtFlash = 0.3;
    this.shake = Math.max(this.shake, 8);
    this.hitStop = 0.05;
    this.burst(p.x, p.y, 8, '#ff5c5c', 160, 0.35, 3);
    this.emit('hurt', { amount: reduced });
    if (this.hasUnique('swift')) p.speedBuffT = 2.5;
    if (p.thorns > 0) {
      for (var i = 0; i < this.enemies.length; i++) {
        var e = this.enemies[i];
        if (e.dying > 0) continue;
        if (SP.dist(e.x, e.y, p.x, p.y) < e.r + p.r + 34) this.damageEnemy(e, p.thorns, {});
      }
    }
    if (p.hp <= 0) this.die();
    return reduced;
  };

  World.prototype.die = function () {
    if (this.dead) return;
    this.dead = true;
    this.player.hp = 0;
    this.shake = 22;
    this.burst(this.player.x, this.player.y, 40, '#ff9ec4', 240, 0.9, 4);
    this.deathStats = this.summary();
    this.emit('death', this.deathStats);
  };

  World.prototype.summary = function () {
    return {
      biome: this.biomeKey, biomeName: this.biome.name, floor: this.floor, mlvl: this.mlvl,
      time: this.time, kills: this.kills, eliteKills: this.eliteKills,
      coins: this.coins, stones: this.stones, upStones: this.upStones, reStones: this.reStones,
      loot: this.loot.slice(),
      level: this.player.level,
      cleared: this.cleared,
      damageDealt: Math.round(this.stats_damageDealt),
      killsNeeded: this.killsNeeded
    };
  };

  /* ----------------------------------------------------------------- 技能 */
  World.prototype.tryAttack = function (aimAngle) {
    var p = this.player;
    if (p.atkCd > 0) return;
    p.atkCd = 1 / p.attackSpeed;
    p.swingT = 0.24;
    p.swingDir = aimAngle;
    this.slash(p.x, p.y, aimAngle, p.range, p.arcWidth, 0.24);
    this.emit('attack', {});
    var hits = [], i;
    for (i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dying > 0) continue;
      var d = dist(p.x, p.y, e.x, e.y);
      if (d > p.range + e.r) continue;
      var ang = Math.atan2(e.y - p.y, e.x - p.x);
      if (Math.abs(angleDiff(aimAngle, ang)) > p.arcWidth / 2 + Math.min(0.35, e.r / 60)) continue;
      hits.push({ e: e, d: d, ang: ang });
    }
    hits.sort(function (a, b) { return a.d - b.d; });
    for (i = 0; i < hits.length && i < 3; i++) this.hitEnemyWithAttack(hits[i].e, hits[i].ang);
  };

  World.prototype.hitEnemyWithAttack = function (e, ang) {
    var p = this.player;
    var crit = this.rng() < p.crit;
    var mul = p.dmgBuffT > 0 ? p.dmgBuffMul : 1;
    if (this.hasUnique('berserk') && p.hp / p.maxHp < 0.40) mul *= 1.4;
    var dmg = p.damage * mul * (crit ? p.critMult : 1);
    var dealt = this.damageEnemy(e, dmg, {
      crit: crit, knock: 130, knockAngle: ang, stun: e.boss ? 0 : 0.12
    });
    this.applyLifesteal(dealt);
  };

  World.prototype.applyLifesteal = function (dealt) {
    var p = this.player;
    if (!p.lifesteal || dealt <= 0) return;
    var heal = dealt * p.lifesteal;
    p.hp = Math.min(p.maxHp, p.hp + heal);
  };

  World.prototype.castQuake = function () {
    var p = this.player;
    if (p.quakeCd > 0 || this.dead) return false;
    p.quakeCd = 8 * (1 - p.cdr);
    var R = 195;
    this.ring(p.x, p.y, 16, R, 0.45, '#7fe3ff', 7);
    this.ring(p.x, p.y, 8, R * 0.7, 0.32, '#ffffff', 3);
    this.burst(p.x, p.y, 26, '#7fe3ff', 300, 0.5, 3);
    this.shake = Math.max(this.shake, 11);
    this.emit('quake', {});
    var base = p.damage * 3.0 * (1 + p.skillDmg);
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dying > 0) continue;
      var d = dist(p.x, p.y, e.x, e.y);
      if (d > R + e.r) continue;
      var ang = Math.atan2(e.y - p.y, e.x - p.x);
      var dealt = this.damageEnemy(e, base * (1 - 0.35 * (d / (R + e.r))), {
        knock: 380, knockAngle: ang, stun: e.boss ? 0.4 : 0.85
      });
      this.applyLifesteal(dealt);
    }
    for (var k = this.projectiles.length - 1; k >= 0; k--) {
      var pr = this.projectiles[k];
      if (!pr.friendly && dist(p.x, p.y, pr.x, pr.y) <= R) this.projectiles.splice(k, 1);
    }
    return true;
  };

  World.prototype.castBless = function () {
    var p = this.player;
    if (p.blessCd > 0 || this.dead) return false;
    p.blessCd = 18 * (1 - p.cdr);
    var heal = p.maxHp * 0.30;
    p.hp = Math.min(p.maxHp, p.hp + heal);
    p.shield = Math.max(p.shield, p.maxHp * 0.18);
    p.shieldT = 6;
    p.dmgBuffT = 8;
    p.dmgBuffMul = 1.5;
    this.addText(p.x, p.y - 52, '+' + Math.round(heal), '#9dffb0', 22, -34);
    var R = 255;
    this.ring(p.x, p.y, 12, R, 0.6, '#ffe9a8', 6);
    this.ring(p.x, p.y, 6, R * 0.55, 0.45, '#9dffb0', 4);
    this.burst(p.x, p.y, 30, '#ffe9a8', 240, 0.75, 3.4);
    this.emit('bless', {});
    var base = p.damage * 2.0 * (1 + p.skillDmg);
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dying > 0) continue;
      var d = dist(p.x, p.y, e.x, e.y);
      if (d > R + e.r) continue;
      var ang = Math.atan2(e.y - p.y, e.x - p.x);
      var dealt = this.damageEnemy(e, base, { knock: 240, knockAngle: ang, stun: 0.3 });
      this.applyLifesteal(dealt);
    }
    return true;
  };

  World.prototype.tryDash = function (dirAngle) {
    var p = this.player;
    if (p.dashCd > 0 || this.dead) return false;
    var cd = 3.0 * (1 - p.cdr) * (this.hasUnique('swift') ? 0.5 : 1);
    p.dashCd = cd;
    p.dashT = 0.18;
    p.dashDir = dirAngle;
    p.invuln = Math.max(p.invuln, 0.26);
    this.burst(p.x, p.y, 14, '#a8f0ff', 180, 0.4, 3);
    this.emit('dash', {});
    return true;
  };

  World.prototype.useSteak = function () {
    var p = this.player;
    if (p.useCd > 0 || this.steaks <= 0 || this.dead) return false;
    if (p.hp >= p.maxHp) return false;
    this.steaks--;
    p.useCd = 6;
    var heal = p.maxHp * 0.30;
    p.hp = Math.min(p.maxHp, p.hp + heal);
    this.addText(p.x, p.y - 40, '牛排 +' + Math.round(heal), '#ffc48f', 18, -30);
    this.burst(p.x, p.y, 12, '#ffc48f', 130, 0.5, 3);
    this.emit('steak', {});
    return true;
  };

  /* ------------------------------------------------------------------ 更新 */
  World.prototype.update = function (dt, input) {
    if (this.dead) { this.updateVisuals(dt); return; }
    input = input || {};
    if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.25; }

    this.time += dt;
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }

    this.updateSpawns(dt);
    this.updatePlayer(dt, input);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);
    this.updateVisuals(dt);

    // 相机跟随，并朝瞄准方向做轻微前瞻
    var cam = this.camera;
    var ax = (input.aimX !== undefined) ? input.aimX - this.player.x : 0;
    var ay = (input.aimY !== undefined) ? input.aimY - this.player.y : 0;
    var ll = SP.len(ax, ay) || 1;
    ax = ax / ll * Math.min(90, ll * 0.28);
    ay = ay / ll * Math.min(90, ll * 0.28);
    cam.x = SP.lerp(cam.x, this.player.x + ax, Math.min(1, dt * 7));
    cam.y = SP.lerp(cam.y, this.player.y + ay, Math.min(1, dt * 7));

    // 相机夹在副本范围内：否则贴墙时会把地图外的「虚空」露出来
    if (input.viewW && input.viewH) {
      var limX = Math.max(0, this.arena - input.viewW / 2);
      var limY = Math.max(0, this.arena - input.viewH / 2);
      cam.x = clamp(cam.x, -limX, limX);
      cam.y = clamp(cam.y, -limY, limY);
    }
  };

  World.prototype.updateVisuals = function (dt) {
    this.updateFx(dt);
    this.updateTexts(dt);
    this.shake *= Math.pow(0.0016, dt);
    if (this.shake < 0.05) this.shake = 0;
  };

  World.prototype.updatePlayer = function (dt, input) {
    var p = this.player;
    p.atkCd = Math.max(0, p.atkCd - dt);
    p.quakeCd = Math.max(0, p.quakeCd - dt);
    p.blessCd = Math.max(0, p.blessCd - dt);
    p.useCd = Math.max(0, p.useCd - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.swingT = Math.max(0, p.swingT - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtFlash = Math.max(0, p.hurtFlash - dt);
    if (p.shieldT > 0) { p.shieldT -= dt; if (p.shieldT <= 0) p.shield = 0; }
    if (p.dmgBuffT > 0) p.dmgBuffT -= dt;
    if (p.speedBuffT > 0) p.speedBuffT -= dt;
    if (p.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);

    var mx = input.mx || 0, my = input.my || 0;
    var ml = SP.len(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; ml = 1; }

    var aim = input.aimAngle;
    if (aim === undefined && input.aimX !== undefined) aim = Math.atan2(input.aimY - p.y, input.aimX - p.x);

    if (p.dashT > 0) {
      p.dashT -= dt;
      var dsp = 1180;
      p.vx = Math.cos(p.dashDir) * dsp;
      p.vy = Math.sin(p.dashDir) * dsp;
      this.fx.push({ t: 'p', x: p.x, y: p.y, vx: 0, vy: 0, dur: 0.22, life: 0.22, color: '#a8f0ff', size: 5 });
    } else {
      var spd = p.speed * (p.speedBuffT > 0 ? 1.3 : 1) * (p.swingT > 0 ? 0.74 : 1);
      p.vx = SP.lerp(p.vx, mx * spd, Math.min(1, dt * 16));
      p.vy = SP.lerp(p.vy, my * spd, Math.min(1, dt * 16));
      if (input.dash && (ml > 0.05 || aim !== undefined)) {
        this.tryDash(ml > 0.05 ? Math.atan2(my, mx) : aim);
      }
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (ml > 0.05) p.walkPhase += dt * 11;

    clampArena(this, p);
    pushOutOfObstacles(this, p);

    if (aim !== undefined && isFinite(aim)) p.facing = SP.turnToward(p.facing, aim, dt * 22);
    else if (ml > 0.05) p.facing = SP.turnToward(p.facing, Math.atan2(my, mx), dt * 14);

    if (input.attack && p.swingT <= 0) this.tryAttack(p.facing);
    if (input.quake) this.castQuake();
    if (input.bless) this.castBless();
    if (input.use) this.useSteak();
  };

  World.prototype.updateEnemies = function (dt) {
    var p = this.player, i, j, e, list = this.enemies;

    for (i = list.length - 1; i >= 0; i--) {
      if (list[i].dying > 0) {
        list[i].dying -= dt;
        if (list[i].dying <= 0) list.splice(i, 1);
      }
    }

    for (i = 0; i < list.length; i++) {
      e = list[i];
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.anim += dt * 6;
      if (e.spawnT > 0) e.spawnT -= dt;
      if (e.stun > 0) {
        e.stun -= dt;
        e.vx *= Math.pow(0.02, dt); e.vy *= Math.pow(0.02, dt);
        e.x += e.vx * dt; e.y += e.vy * dt;
        clampArena(this, e);
        continue;
      }
      var dx = p.x - e.x, dy = p.y - e.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / d, uy = dy / d;
      var ax = 0, ay = 0;
      var def = ENEMY_TYPES[e.key] || ENEMY_TYPES.calf;

      if (e.kind === 'melee') {
        if (d > e.atkRange) { ax = ux * e.speed; ay = uy * e.speed; }
        else {
          e.atkCd -= dt;
          if (e.atkCd <= 0) {
            e.atkCd = def.atkCd * this.rng.range(0.85, 1.15);
            this.hurtPlayer(e.dmg, e.x, e.y);
            this.burst(p.x, p.y, 5, '#ff8080', 120, 0.25, 2.5);
          }
        }
      } else if (e.kind === 'charger') {
        e.stateT -= dt;
        if (e.state === 'idle') {
          if (d > 300) { ax = ux * e.speed; ay = uy * e.speed; }
          else if (e.stateT <= 0) { e.state = 'wind'; e.stateT = 0.7; e.chargeDir = Math.atan2(dy, dx); }
          else { ax = ux * e.speed * 0.4; ay = uy * e.speed * 0.4; }
        } else if (e.state === 'wind') {
          e.chargeDir = SP.turnToward(e.chargeDir, Math.atan2(dy, dx), dt * 2.4);
          if (e.stateT <= 0) { e.state = 'dash'; e.stateT = 0.45; e.didHit = false; }
        } else if (e.state === 'dash') {
          ax = Math.cos(e.chargeDir) * 540; ay = Math.sin(e.chargeDir) * 540;
          this.fx.push({ t: 'p', x: e.x, y: e.y, vx: 0, vy: 0, dur: 0.25, life: 0.25, color: e.color, size: 5 });
          if (!e.didHit && d < e.r + p.r + 12) { e.didHit = true; this.hurtPlayer(e.dmg, e.x, e.y); }
          if (e.stateT <= 0) { e.state = 'idle'; e.stateT = this.rng.range(0.6, 1.2); }
        }
      } else if (e.kind === 'ranged') {
        var ideal = 265;
        if (d < ideal - 60) { ax = -ux * e.speed; ay = -uy * e.speed; }
        else if (d > ideal + 60) { ax = ux * e.speed * 0.85; ay = uy * e.speed * 0.85; }
        else { ax = -uy * e.speed * 0.6; ay = ux * e.speed * 0.6; }
        e.atkCd -= dt;
        if (e.atkCd <= 0 && d < 440) {
          e.atkCd = def.atkCd * this.rng.range(0.8, 1.25);
          this.shootAt(e, p, 275, e.dmg, 7, e.color);
        }
      } else if (e.kind === 'boss') {
        if (d > e.atkRange) { ax = ux * e.speed; ay = uy * e.speed; }
        e.slamCd -= dt; e.summonCd -= dt; if (e.volleyCd !== undefined) e.volleyCd -= dt;
        if (e.state === 'slam_wind') {
          e.stateT -= dt;
          ax = 0; ay = 0;
          if (e.stateT <= 0) {
            e.state = 'idle';
            this.ring(e.x, e.y, 20, e.slamR, 0.4, '#ff9c5b', 9);
            this.shake = Math.max(this.shake, 13);
            if (dist(e.x, e.y, p.x, p.y) < e.slamR + p.r) this.hurtPlayer(e.dmg, e.x, e.y);
            this.burst(e.x, e.y, 20, '#ff9c5b', 200, 0.6, 3.5);
          }
        } else if (e.slamCd <= 0 && d < 230) {
          e.state = 'slam_wind'; e.stateT = 0.85; e.slamCd = 4.2;
          this.addText(e.x, e.y - e.r - 16, '重击蓄力！', '#ff9c5b', 15);
        } else if (e.summonCd <= 0 && e.summon) {
          e.summonCd = 9.5;
          for (var s = 0; s < e.summonN; s++) {
            this.spawnEnemy(e.summon, { dist: 120, angle: this.rng() * TAU });
          }
          this.addText(e.x, e.y - e.r - 16, '召唤援军！', '#ffd08a', 15);
          this.emit('summon', {});
        } else if (e.volley && e.volleyCd <= 0) {
          e.volleyCd = 5.5;
          for (var v = 0; v < 8; v++) {
            this.shootAt(e, p, 230, e.dmg * 0.6, 8, e.color, (v / 8) * TAU);
          }
          this.emit('volley', {});
        }
      }

      e.vx = SP.lerp(e.vx, ax, Math.min(1, dt * 7));
      e.vy = SP.lerp(e.vy, ay, Math.min(1, dt * 7));
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      clampArena(this, e);
      pushOutOfObstacles(this, e);
    }

    // 分离，避免叠成一坨
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (e.dying > 0) continue;
      for (j = i + 1; j < list.length; j++) {
        var o = list[j];
        if (o.dying > 0) continue;
        var ddx = o.x - e.x, ddy = o.y - e.y;
        var dd = ddx * ddx + ddy * ddy;
        var minD = e.r + o.r;
        if (dd < minD * minD && dd > 0.001) {
          var dl = Math.sqrt(dd);
          var overlap = (minD - dl) * 0.5;
          var nx = ddx / dl, ny = ddy / dl;
          var w1 = e.boss ? 0.15 : 1, w2 = o.boss ? 0.15 : 1;
          e.x -= nx * overlap * w1; e.y -= ny * overlap * w1;
          o.x += nx * overlap * w2; o.y += ny * overlap * w2;
        }
      }
    }
  };

  World.prototype.shootAt = function (from, target, speed, dmg, radius, color, forcedAngle) {
    var a = forcedAngle !== undefined ? forcedAngle
      : Math.atan2(target.y - from.y, target.x - from.x);
    this.projectiles.push({
      x: from.x, y: from.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: radius, dmg: dmg, life: 3.2, friendly: false, color: color || '#b98cff'
    });
    this.emit('spit', {});
  };

  World.prototype.updateProjectiles = function (dt) {
    var p = this.player;
    for (var i = this.projectiles.length - 1; i >= 0; i--) {
      var pr = this.projectiles[i];
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;
      var hit = false;
      if (!pr.friendly && SP.dist(pr.x, pr.y, p.x, p.y) < pr.r + p.r) {
        this.hurtPlayer(pr.dmg, pr.x, pr.y);
        this.burst(pr.x, pr.y, 8, pr.color, 130, 0.35, 3);
        hit = true;
      }
      if (!hit && blocked(this, pr.x, pr.y, pr.r * 0.4)) {
        this.burst(pr.x, pr.y, 6, pr.color, 100, 0.3, 2.6);
        hit = true;
      }
      if (hit || pr.life <= 0 || Math.abs(pr.x) > this.arena || Math.abs(pr.y) > this.arena) {
        this.projectiles.splice(i, 1);
      }
    }
  };

  World.prototype.updatePickups = function (dt) {
    var p = this.player;
    for (var i = this.pickups.length - 1; i >= 0; i--) {
      var k = this.pickups[i];
      k.life -= dt;
      k.bob += dt * 4;
      var d = SP.dist(k.x, k.y, p.x, p.y);
      if (d < p.magnet && k.life > 0.2) {
        var pull = (1 - d / p.magnet) * 520 + 90;
        k.vx = SP.lerp(k.vx, (p.x - k.x) / (d || 1) * pull, Math.min(1, dt * 8));
        k.vy = SP.lerp(k.vy, (p.y - k.y) / (d || 1) * pull, Math.min(1, dt * 8));
        k.x += k.vx * dt; k.y += k.vy * dt;
      }
      if (d < p.r + k.r) {
        if (k.kind === 'coin') {
          this.coins += k.value;
          this.addText(p.x, p.y - 30, '+' + k.value, '#ffd75e', 14, -40);
        } else if (k.kind === 'alpha') {
          this.stones += k.value;
          this.addText(p.x, p.y - 30, '+1 alpha-stone', '#a8e6ff', 15, -40);
          this.burst(k.x, k.y, 10, '#a8e6ff', 140, 0.5, 3);
        } else if (k.kind === 'upstone') {
          this.upStones += k.value;
          this.addText(p.x, p.y - 30, '+' + k.value + ' 强化石', '#ffb27a', 14, -40);
        } else if (k.kind === 'restone') {
          this.reStones += k.value;
          this.addText(p.x, p.y - 30, '+' + k.value + ' 重铸石', '#c9a6ff', 14, -40);
        } else if (k.kind === 'item') {
          this.loot.push(k.item);
          this.emit('loot', { item: k.item });
        } else if (k.kind === 'steak') {
          if (this.steaks < 9) {
            this.steaks++;
            this.addText(p.x, p.y - 30, '牛排 +1', '#ffc48f', 15, -40);
          } else { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.1); }
        }
        this.emit('pickup', { kind: k.kind });
        this.pickups.splice(i, 1);
        continue;
      }
      if (k.life <= 0) this.pickups.splice(i, 1);
    }
  };

  World.prototype.updateFx = function (dt) {
    for (var i = this.fx.length - 1; i >= 0; i--) {
      var f = this.fx[i];
      f.life -= dt;
      if (f.t === 'p') {
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.vx *= Math.pow(0.06, dt); f.vy *= Math.pow(0.06, dt);
      }
      if (f.life <= 0) this.fx.splice(i, 1);
    }
  };

  World.prototype.updateTexts = function (dt) {
    for (var i = this.texts.length - 1; i >= 0; i--) {
      var t = this.texts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= Math.pow(0.25, dt);
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  };

  World.prototype.cooldowns = function () {
    var p = this.player;
    return {
      quake: { left: p.quakeCd, total: 8 * (1 - p.cdr) },
      bless: { left: p.blessCd, total: 18 * (1 - p.cdr) },
      dash: { left: p.dashCd, total: 3 * (1 - p.cdr) * (this.hasUnique('swift') ? 0.5 : 1) },
      steak: { left: p.useCd, total: 6 }
    };
  };

  SP.BIOMES = BIOMES;
  SP.BIOME_ORDER = BIOME_ORDER;
  SP.ENEMY_TYPES = ENEMY_TYPES;
  SP.deriveCharacter = deriveCharacter;
  SP.armorReduction = armorReduction;
  SP.xpForLevel = xpForLevel;
  SP.World = World;
})(typeof globalThis !== 'undefined' ? globalThis : this);
