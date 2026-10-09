/* 时空猪 · hideout.js — 藏身处场景（纯逻辑，不触碰 DOM，可在 Node 中测试）
 *
 * 枢纽不再是一堆面板，而是一块可以走动的安全区：
 *   - 玩家用 WASD 走动，撞到帐篷/箱子/篝火等物件会被挡住
 *   - 铁匠与商人是站在场上的 NPC，走近（或点击）才能打开他们的界面
 *   - 时空传送门同样是一个场景物件，走过去选择副本层级
 */
(function (global) {
  'use strict';
  var SP = global.SP || (global.SP = {});

  var WIDTH = 2200;
  var HEIGHT = 1400;
  var INTERACT_RANGE = 74;   // 与 NPC 中心的额外交互距离

  /** NPC / 可交互物件
   * 位置刻意压缩在出生点上方约一个屏幕内：出生即能同时看到铁匠、商人与传送门。
   */
  var NPC_DEFS = [
    {
      key: 'blacksmith', name: '铁匠 · 格罗姆', x: 500, y: 700, r: 26,
      color: '#d08a4a', icon: 'anvil', panel: 'forge',
      hint: '强化、重铸、分解装备'
    },
    {
      key: 'merchant', name: '商人 · 皮皮', x: 1700, y: 700, r: 26,
      color: '#6fbf7f', icon: 'coin', panel: 'shop',
      hint: '补给与神秘装备'
    },
    {
      key: 'portal', name: '时空传送门', x: 1100, y: 620, r: 42,
      color: '#8f7fff', icon: 'portal', panel: 'portal',
      hint: '选择副本层级出发', isPortal: true
    }
  ];

  /** 装饰兼碰撞物：kind 决定画法 */
  var PROP_DEFS = [
    { kind: 'fire', x: 1100, y: 1120, r: 58 },
    { kind: 'tent', x: 790, y: 960, r: 54, rot: -0.3 },
    { kind: 'tent', x: 1410, y: 960, r: 54, rot: 0.3 },
    { kind: 'anvil', x: 660, y: 780, r: 34 },
    { kind: 'forge', x: 350, y: 760, r: 46 },
    { kind: 'stall', x: 1700, y: 850, r: 52 },
    { kind: 'crate', x: 1900, y: 600, r: 26 },
    { kind: 'crate', x: 1980, y: 690, r: 26 },
    { kind: 'crate', x: 690, y: 1240, r: 26 },
    { kind: 'barrel', x: 1580, y: 1160, r: 24 },
    { kind: 'barrel', x: 1670, y: 1230, r: 24 },
    { kind: 'barrel', x: 430, y: 1010, r: 24 },
    { kind: 'tree', x: 210, y: 300, r: 52 },
    { kind: 'tree', x: 1990, y: 290, r: 52 },
    { kind: 'tree', x: 200, y: 1260, r: 52 },
    { kind: 'tree', x: 2000, y: 1260, r: 52 },
    { kind: 'banner', x: 1100, y: 1330, r: 30 }
  ];

  function Hideout(opts) {
    opts = opts || {};
    this.width = WIDTH;
    this.height = HEIGHT;
    this.time = 0;
    this.player = {
      x: opts.x === undefined ? 1100 : opts.x,
      y: opts.y === undefined ? 900 : opts.y,
      r: 17, vx: 0, vy: 0, facing: -Math.PI / 2, walkPhase: 0
    };
    this.npcs = NPC_DEFS.map(function (d) {
      return {
        key: d.key, name: d.name, x: d.x, y: d.y, r: d.r, color: d.color,
        icon: d.icon, panel: d.panel, hint: d.hint, isPortal: !!d.isPortal,
        bob: Math.random() * 6.28
      };
    });
    this.props = PROP_DEFS.map(function (d) {
      return { kind: d.kind, x: d.x, y: d.y, r: d.r, rot: d.rot || 0 };
    });
    this.nearby = null;
    this.camera = { x: this.player.x, y: this.player.y };
    this.speed = 260;
    /** 联机大厅中的其他玩家：{ id, name, level, x, y, facing, walkPhase, inDungeon } */
    this.remotes = {};
  }

  Hideout.prototype.npcByKey = function (key) {
    for (var i = 0; i < this.npcs.length; i++) if (this.npcs[i].key === key) return this.npcs[i];
    return null;
  };

  /** 画面尺寸变化时夹住相机范围 */
  Hideout.prototype.clampCamera = function (viewW, viewH) {
    var limX = Math.max(0, this.width / 2 - viewW / 2);
    var limY = Math.max(0, this.height / 2 - viewH / 2);
    // 场景以 (width/2, height/2) 为原点绘制
    this.camera.x = SP.clamp(this.camera.x, -limX, limX);
    this.camera.y = SP.clamp(this.camera.y, -limY, limY);
  };

  function pushOut(list, ent) {
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
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

  Hideout.prototype.update = function (dt, input) {
    input = input || {};
    var p = this.player;
    this.time += dt;

    var mx = input.mx || 0, my = input.my || 0;
    var ml = SP.len(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; ml = 1; }

    var spd = this.speed;
    // 阻尼比战斗稍强：藏身处是用来「走到 NPC 面前」的，
    // 松手后不该还滑出半个身位（实测 dt*14 会滑出约 19px）
    p.vx = SP.lerp(p.vx, mx * spd, Math.min(1, dt * 20));
    p.vy = SP.lerp(p.vy, my * spd, Math.min(1, dt * 20));
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (ml > 0.05) p.walkPhase += dt * 10;

    // 场界与物件碰撞
    p.x = SP.clamp(p.x, 60, this.width - 60);
    p.y = SP.clamp(p.y, 60, this.height - 60);
    pushOut(this.props, p);
    pushOut(this.npcs, p);
    p.x = SP.clamp(p.x, 60, this.width - 60);
    p.y = SP.clamp(p.y, 60, this.height - 60);

    if (ml > 0.05) p.facing = SP.turnToward(p.facing, Math.atan2(my, mx), dt * 12);

    // 找出可交互目标（只认最近的）
    this.nearby = null;
    var best = Infinity;
    for (var i = 0; i < this.npcs.length; i++) {
      var n = this.npcs[i];
      var d = SP.dist(p.x, p.y, n.x, n.y) - n.r;
      if (d < INTERACT_RANGE && d < best) { best = d; this.nearby = n; }
    }

    // 相机跟随
    var k = Math.min(1, dt * 6);
    this.camera.x = SP.lerp(this.camera.x, p.x - this.width / 2, k);
    this.camera.y = SP.lerp(this.camera.y, p.y - this.height / 2, k);
    return this.nearby;
  };

  /** 交互：返回被触发物件的 panel 名（没有目标时返回 null） */
  Hideout.prototype.interact = function () {
    return this.nearby ? this.nearby.panel : null;
  };

  /** 点击场景坐标：命中最近的可交互物件则走过去（返回是否命中） */
  Hideout.prototype.clickAt = function (worldX, worldY) {
    for (var i = 0; i < this.npcs.length; i++) {
      var n = this.npcs[i];
      if (SP.dist(worldX, worldY, n.x, n.y) <= n.r + 14) { this.nearby = n; return true; }
    }
    return false;
  };

  Hideout.prototype.promptText = function () {
    if (!this.nearby) return '';
    return '按 F 与「' + this.nearby.name + '」交互 · ' + this.nearby.hint;
  };

  /** 同步联机大厅同伴列表（保留平滑坐标） */
  Hideout.prototype.syncRemotes = function (peerList, selfId) {
    var next = {};
    var list = peerList || [];
    for (var i = 0; i < list.length; i++) {
      var src = list[i];
      if (!src || !src.id || src.id === selfId) continue;
      var prev = this.remotes[src.id];
      next[src.id] = {
        id: src.id,
        name: src.name || '旅人',
        level: src.level || 1,
        x: src.x == null ? (prev ? prev.x : 1100) : src.x,
        y: src.y == null ? (prev ? prev.y : 900) : src.y,
        facing: src.facing == null ? (prev ? prev.facing : -Math.PI / 2) : src.facing,
        walkPhase: src.walkPhase || 0,
        inDungeon: !!src.inDungeon,
        vx: prev ? prev.vx : 0,
        vy: prev ? prev.vy : 0
      };
    }
    this.remotes = next;
  };

  Hideout.prototype.applyRemotePos = function (msg) {
    if (!msg || !msg.id) return;
    var r = this.remotes[msg.id];
    if (!r) {
      r = {
        id: msg.id, name: '旅人', level: 1,
        x: msg.x, y: msg.y, facing: msg.facing || 0, walkPhase: 0,
        inDungeon: false, vx: 0, vy: 0
      };
      this.remotes[msg.id] = r;
    }
    r.tx = msg.x; r.ty = msg.y;
    r.facing = msg.facing;
    r.walkPhase = msg.walkPhase || r.walkPhase;
    r.level = msg.level || r.level;
  };

  /** 平滑插值远程玩家位置（视觉用） */
  Hideout.prototype.tickRemotes = function (dt) {
    var ids = Object.keys(this.remotes);
    for (var i = 0; i < ids.length; i++) {
      var r = this.remotes[ids[i]];
      if (r.tx == null) continue;
      var k = Math.min(1, dt * 10);
      var ox = r.x, oy = r.y;
      r.x = SP.lerp(r.x, r.tx, k);
      r.y = SP.lerp(r.y, r.ty, k);
      r.vx = (r.x - ox) / Math.max(dt, 0.001);
      r.vy = (r.y - oy) / Math.max(dt, 0.001);
    }
  };

  Hideout.prototype.remoteList = function () {
    var out = [], ids = Object.keys(this.remotes);
    for (var i = 0; i < ids.length; i++) out.push(this.remotes[ids[i]]);
    return out;
  };

  SP.Hideout = Hideout;
  SP.HIDEOUT_SIZE = { width: WIDTH, height: HEIGHT };
  SP.HIDEOUT_NPCS = NPC_DEFS;
  SP.HIDEOUT_INTERACT_RANGE = INTERACT_RANGE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
