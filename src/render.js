/* 时空猪 · render.js — Canvas 2D 渲染层（全部美术由代码程序化绘制，无外部素材）
 */
(function (global) {
  'use strict';
  var SP = global.SP || (global.SP = {});
  var TAU = SP.TAU, clamp = SP.clamp;

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function ellipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU);
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 960; this.h = 540; this.dpr = 1;
    this.starField = null;
    this.t = 0;
    this.resize();
  }

  Renderer.prototype.resize = function () {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(320, Math.round(rect.width || this.canvas.clientWidth || 960));
    var h = Math.max(240, Math.round(rect.height || this.canvas.clientHeight || 540));
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.bgGrad = null;
  };

  Renderer.prototype.ensureObstacleShapes = function (world) {
    if (world.__shapesDone) return;
    world.__shapesDone = true;
    var rng = SP.makeRng(0xC0FFEE);
    world.obstacles.forEach(function (o, idx) {
      if (o.kind === 'tent' || o.kind === 'spire') return;
      var n = 7 + (idx % 3);
      o._pts = [];
      for (var i = 0; i < n; i++) {
        var a = (i / n) * TAU;
        var rr = o.r * rng.range(0.78, 1.12);
        o._pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr * 0.86 });
      }
    });
  };

  Renderer.prototype.draw = function (world, opts) {
    opts = opts || {};
    var ctx = this.ctx, W = this.w, H = this.h;
    var cam = world.camera;
    var shake = world.shake || 0;
    var sx = (world.rng() - 0.5) * shake, sy = (world.rng() - 0.5) * shake;
    var ox = W / 2 - cam.x + sx, oy = H / 2 - cam.y + sy;
    var self = this;
    this.ox = ox; this.oy = oy;
    function S(x, y) { return { x: x + ox, y: y + oy }; }

    this.ensureObstacleShapes(world);
    this.t += 1 / 60;

    /* ---------------------------------------------------------- 背景星空 */
    if (!this.bgGrad) {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#07060f');
      g.addColorStop(0.55, '#0d0a1a');
      g.addColorStop(1, '#120c1f');
      this.bgGrad = g;
    }
    ctx.fillStyle = this.bgGrad;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    // 星云
    var neb = ctx.createRadialGradient(W * 0.78, H * 0.2, 10, W * 0.78, H * 0.2, Math.max(W, H) * 0.65);
    neb.addColorStop(0, 'rgba(120,70,200,0.16)');
    neb.addColorStop(0.5, 'rgba(50,90,200,0.07)');
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = neb; ctx.fillRect(0, 0, W, H);
    var neb2 = ctx.createRadialGradient(W * 0.12, H * 0.85, 10, W * 0.12, H * 0.85, Math.max(W, H) * 0.55);
    neb2.addColorStop(0, 'rgba(220,90,160,0.10)');
    neb2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = neb2; ctx.fillRect(0, 0, W, H);

    // 视差星点
    for (var i = 0; i < world.stars.length; i++) {
      var st = world.stars[i];
      var px = st.x * 0.35 - cam.x * 0.35 + W / 2;
      var py = st.y * 0.35 - cam.y * 0.35 + H / 2;
      if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
      var tw = 0.55 + 0.45 * Math.sin(this.t * st.tw + st.x);
      ctx.globalAlpha = st.a * tw;
      ctx.fillStyle = '#cfe4ff';
      ctx.fillRect(px, py, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    /* ---------------------------------------------------------- 营地面 */
    var A = world.arena;
    var p0 = S(-A, -A);
    var c0 = S(0, 0);
    var gcol = (world.biome && world.biome.ground) || ['#312639', '#261d2c', '#1e1728', '#151021'];
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, p0.x, p0.y, A * 2, A * 2, 90);
    // 地面：以重生点为中心，按生物群系配色由亮到暗
    var ag = ctx.createRadialGradient(c0.x, c0.y, 40, c0.x, c0.y, A * 1.18);
    ag.addColorStop(0, gcol[0]);
    ag.addColorStop(0.4, gcol[1]);
    ag.addColorStop(0.75, gcol[2]);
    ag.addColorStop(1, gcol[3]);
    ctx.fillStyle = ag;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // 地面斑块：用明暗叠加而不是固定色，才能适配四种地形
    for (var d = 0; d < world.decals.length; d++) {
      var dc = world.decals[d], dp = S(dc.x, dc.y);
      ctx.globalAlpha = dc.a * 3.2;
      ctx.fillStyle = d % 3 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.22)';
      ellipse(ctx, dp.x, dp.y, dc.r, dc.r * 0.7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 网格
    ctx.strokeStyle = 'rgba(130,170,255,0.028)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var grid = 128;
    var gx0 = Math.floor((cam.x - W / 2) / grid) * grid;
    var gy0 = Math.floor((cam.y - H / 2) / grid) * grid;
    for (var gx = gx0; gx < cam.x + W / 2 + grid; gx += grid) {
      ctx.moveTo(gx + ox, -A + oy); ctx.lineTo(gx + ox, A + oy);
    }
    for (var gy = gy0; gy < cam.y + H / 2 + grid; gy += grid) {
      ctx.moveTo(-A + ox, gy + oy); ctx.lineTo(A + ox, gy + oy);
    }
    ctx.stroke();
    ctx.restore();
    // 边界发光
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(140,110,255,0.55)';
    ctx.shadowColor = 'rgba(150,120,255,0.9)';
    ctx.shadowBlur = 22;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

    // 重生点符文
    var sp = S(0, 0);
    ctx.save();
    ctx.translate(sp.x, sp.y);
    var pulse = 0.5 + 0.5 * Math.sin(this.t * 1.6);
    ctx.globalAlpha = 0.25 + pulse * 0.2;
    ctx.strokeStyle = '#7fe7ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 54, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, TAU); ctx.stroke();
    ctx.rotate(this.t * 0.35);
    ctx.beginPath();
    for (var k = 0; k < 6; k++) {
      var a2 = (k / 6) * TAU;
      ctx.moveTo(Math.cos(a2) * 30, Math.sin(a2) * 30);
      ctx.lineTo(Math.cos(a2) * 54, Math.sin(a2) * 54);
    }
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;

    /* ---------------------------------------------------------- 障碍物 */
    for (var oi = 0; oi < world.obstacles.length; oi++) {
      var ob = world.obstacles[oi];
      var op = S(ob.x, ob.y);
      if (op.x < -200 || op.x > W + 200 || op.y < -200 || op.y > H + 200) continue;
      // 影子
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = '#000';
      ellipse(ctx, op.x + 5, op.y + ob.r * 0.42, ob.r * 1.02, ob.r * 0.5);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (ob.kind === 'tent') {
        ctx.save();
        ctx.translate(op.x, op.y);
        ctx.rotate(ob.rot);
        // 帐篷主体
        var tg = ctx.createLinearGradient(-ob.r, 0, ob.r, 0);
        tg.addColorStop(0, '#4a2f4d'); tg.addColorStop(0.5, '#6b3f63'); tg.addColorStop(1, '#3a2340');
        ctx.fillStyle = tg;
        ctx.beginPath();
        ctx.moveTo(-ob.r, ob.r * 0.66);
        ctx.lineTo(0, -ob.r);
        ctx.lineTo(ob.r, ob.r * 0.66);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,180,255,0.25)'; ctx.lineWidth = 2; ctx.stroke();
        // 门帘
        ctx.fillStyle = 'rgba(20,10,26,0.85)';
        ctx.beginPath();
        ctx.moveTo(-ob.r * 0.28, ob.r * 0.66);
        ctx.lineTo(0, -ob.r * 0.12);
        ctx.lineTo(ob.r * 0.28, ob.r * 0.66);
        ctx.closePath(); ctx.fill();
        // 顶旗
        ctx.strokeStyle = '#c9a06a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -ob.r); ctx.lineTo(0, -ob.r - 14); ctx.stroke();
        ctx.fillStyle = '#ffcf6e';
        ctx.beginPath();
        ctx.moveTo(0, -ob.r - 14); ctx.lineTo(14, -ob.r - 9); ctx.lineTo(0, -ob.r - 4);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      } else if (ob.kind === 'spire') {
        ctx.save();
        ctx.translate(op.x, op.y);
        var sg = ctx.createLinearGradient(0, -ob.r * 1.8, 0, ob.r * 0.6);
        sg.addColorStop(0, '#8be6ff'); sg.addColorStop(0.4, '#4a86c9'); sg.addColorStop(1, '#26304d');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.moveTo(-ob.r * 0.72, ob.r * 0.5);
        ctx.lineTo(-ob.r * 0.3, -ob.r * 1.7);
        ctx.lineTo(ob.r * 0.34, -ob.r * 1.2);
        ctx.lineTo(ob.r * 0.72, ob.r * 0.5);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this.t * 2 + ob.x);
        ctx.strokeStyle = '#a9f0ff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (ob.kind === 'tree' || ob.kind === 'mushroom' || ob.kind === 'crystal' ||
                 ob.kind === 'stalagmite' || ob.kind === 'bone' || ob.kind === 'egg') {
        this.drawBiomeProp(ctx, ob, op.x, op.y);
      } else {
        ctx.save();
        ctx.translate(op.x, op.y);
        ctx.rotate(ob.rot * 0.2);
        var rg = ctx.createLinearGradient(0, -ob.r, 0, ob.r);
        rg.addColorStop(0, '#5b5364'); rg.addColorStop(0.45, '#413a4b'); rg.addColorStop(1, '#282330');
        ctx.fillStyle = rg;
        ctx.beginPath();
        var pts = ob._pts || [];
        ctx.moveTo(pts.length ? pts[0].x : -ob.r, pts.length ? pts[0].y : 0);
        for (var pi = 1; pi < pts.length; pi++) ctx.lineTo(pts[pi].x, pts[pi].y);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(190,170,220,0.22)'; ctx.lineWidth = 1.6; ctx.stroke();
        // 苔藓高光
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#6d7f5a';
        ctx.beginPath();
        ctx.ellipse(-ob.r * 0.2, -ob.r * 0.42, ob.r * 0.42, ob.r * 0.2, -0.3, 0, TAU);
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    /* ---------------------------------------------------------- 掉落物 */
    for (var pk = 0; pk < world.pickups.length; pk++) {
      var it = world.pickups[pk];
      var ip = S(it.x, it.y);
      if (ip.x < -60 || ip.x > W + 60 || ip.y < -60 || ip.y > H + 60) continue;
      var bob = Math.sin(it.bob) * 3;
      var fade = it.life < 4 ? (0.35 + 0.65 * Math.abs(Math.sin(it.life * 8))) : 1;
      ctx.globalAlpha = fade;

      // 装备掉落：品质色光柱 + 部位图标，远远就能看见
      if (it.kind === 'item' && it.item) {
        var rar = SP.Items.RARITY_BY_KEY[it.item.rarity] || SP.Items.RARITY_BY_KEY.common;
        var beamH = 78 + rar.index * 16;
        var bg2 = ctx.createLinearGradient(0, ip.y - beamH, 0, ip.y + 6);
        bg2.addColorStop(0, 'rgba(255,255,255,0)');
        bg2.addColorStop(0.45, this.hexA(rar.color, 0.30 + 0.10 * Math.sin(this.t * 3 + it.bob)));
        bg2.addColorStop(1, this.hexA(rar.color, 0.75));
        ctx.fillStyle = bg2;
        ctx.fillRect(ip.x - 7 - rar.index, ip.y - beamH, 14 + rar.index * 2, beamH);
        ctx.fillStyle = this.hexA(rar.color, 0.5);
        ellipse(ctx, ip.x, ip.y + 2, it.r * 1.5, it.r * 0.7); ctx.fill();
        ctx.fillStyle = rar.color;
        ctx.beginPath(); ctx.arc(ip.x, ip.y + bob * 0.4, it.r * 0.55, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.4; ctx.stroke();
        var iconKey = SP.ItemIcons && SP.ItemIcons.forItem(it.item);
        var icon = iconKey && SP.ItemIcons.image(iconKey);
        if (icon && icon.complete && icon.naturalWidth) {
          var sz = Math.max(26, Math.round(it.r * 2.2));
          var smooth = ctx.imageSmoothingEnabled;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(icon, Math.round(ip.x - sz / 2), Math.round(ip.y + bob * 0.4 - sz / 2), sz, sz);
          ctx.imageSmoothingEnabled = smooth;
        } else {
          ctx.fillStyle = 'rgba(12,8,20,0.85)';
          ctx.font = 'bold 12px system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(this.slotGlyph(it.item.slot), ip.x, ip.y + bob * 0.4);
        }
        ctx.globalAlpha = 1;
        continue;
      }

      var glowCol = it.kind === 'coin' ? 'rgba(255,205,80,0.55)'
        : it.kind === 'alpha' ? 'rgba(150,225,255,0.6)'
          : it.kind === 'upstone' ? 'rgba(255,170,110,0.55)'
            : it.kind === 'restone' ? 'rgba(190,150,255,0.55)'
              : 'rgba(255,180,120,0.55)';
      ctx.fillStyle = glowCol;
      ellipse(ctx, ip.x, ip.y + bob, it.r * 1.9, it.r * 1.5);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (it.kind === 'coin') {
        var cg = ctx.createLinearGradient(ip.x - 9, ip.y - 9 + bob, ip.x + 9, ip.y + 9 + bob);
        cg.addColorStop(0, '#ffe9a0'); cg.addColorStop(1, '#e0a020');
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(ip.x, ip.y + bob, it.r * 0.85, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(120,70,0,0.65)'; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('P', ip.x, ip.y + bob + 0.5);
      } else if (it.kind === 'alpha') {
        if (!this.drawItemIcon(ctx, 'alpha', ip.x, ip.y + bob, Math.round(it.r * 2.3))) {
          ctx.save();
          ctx.translate(ip.x, ip.y + bob);
          ctx.rotate(this.t * 0.9);
          var stg = ctx.createLinearGradient(-10, -10, 10, 10);
          stg.addColorStop(0, '#d8f6ff'); stg.addColorStop(0.5, '#69c8f0'); stg.addColorStop(1, '#2f6ea8');
          ctx.fillStyle = stg;
          ctx.beginPath();
          ctx.moveTo(0, -it.r); ctx.lineTo(it.r * 0.8, 0); ctx.lineTo(0, it.r); ctx.lineTo(-it.r * 0.8, 0);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(230,250,255,0.85)'; ctx.lineWidth = 1.4; ctx.stroke();
          ctx.restore();
        }
      } else if (it.kind === 'upstone' || it.kind === 'restone') {
        var stoneKey = it.kind === 'upstone' ? 'up' : 're';
        if (!this.drawItemIcon(ctx, stoneKey, ip.x, ip.y + bob, Math.round(it.r * 2.3))) {
          ctx.save();
          ctx.translate(ip.x, ip.y + bob);
          var mg2 = ctx.createLinearGradient(-8, -10, 8, 10);
          if (it.kind === 'upstone') { mg2.addColorStop(0, '#ffd9b0'); mg2.addColorStop(1, '#b2601f'); }
          else { mg2.addColorStop(0, '#e6d4ff'); mg2.addColorStop(1, '#6a3fb0'); }
          ctx.fillStyle = mg2;
          ctx.beginPath();
          ctx.moveTo(-it.r * 0.8, -it.r * 0.5);
          ctx.lineTo(it.r * 0.8, -it.r * 0.72);
          ctx.lineTo(it.r * 0.62, it.r * 0.72);
          ctx.lineTo(-it.r * 0.66, it.r * 0.5);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
          ctx.restore();
        }
      } else if (!this.drawItemIcon(ctx, 'steak', ip.x, ip.y + bob, Math.round(it.r * 2.4))) {
        ctx.save();
        ctx.translate(ip.x, ip.y + bob);
        ctx.rotate(-0.35);
        ctx.fillStyle = '#8a4a2a';
        roundRect(ctx, -10, -7, 20, 14, 4); ctx.fill();
        ctx.fillStyle = '#c96f46';
        roundRect(ctx, -8, -5, 16, 10, 3); ctx.fill();
        ctx.fillStyle = '#ffd9b0';
        roundRect(ctx, -5, -3, 6, 6, 2); ctx.fill();
        ctx.restore();
      }
    }

    /* ---------------------------------------------------------- 敌方弹幕 */
    for (var pj = 0; pj < world.projectiles.length; pj++) {
      var pr = world.projectiles[pj];
      var pp = S(pr.x, pr.y);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = pr.color;
      ellipse(ctx, pp.x, pp.y, pr.r * 1.8, pr.r * 1.8); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e9dcff';
      ctx.beginPath(); ctx.arc(pp.x, pp.y, pr.r * 0.6, 0, TAU); ctx.fill();
    }

    /* ---------------------------------------------------------- 怪物 */
    var boss = null;
    for (var ei = 0; ei < world.enemies.length; ei++) {
      var e = world.enemies[ei];
      if (e.boss && e.dying <= 0) boss = e;
      var ep = S(e.x, e.y);
      if (ep.x < -160 || ep.x > W + 160 || ep.y < -160 || ep.y > H + 160) continue;
      this.drawEnemy(ctx, e, ep.x, ep.y, world, S);
    }

    /* ---------------------------------------------------------- 普攻扇形 */
    this.drawAttackArc(ctx, world, S, opts);

    /* ---------------------------------------------------------- 玩家 */
    this.drawPlayer(ctx, world, S, opts);

    /* ---------------------------------------------------------- 特效 */
    for (var fi = 0; fi < world.fx.length; fi++) {
      var f = world.fx[fi];
      var fp = S(f.x, f.y);
      var k = 1 - f.life / f.dur;
      if (f.t === 'ring') {
        var rr = SP.lerp(f.r0, f.r1, 1 - Math.pow(1 - k, 2.2));
        ctx.globalAlpha = Math.max(0, 1 - k) * 0.95;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = f.w * (1 - k * 0.6);
        ctx.beginPath(); ctx.arc(fp.x, fp.y, rr, 0, TAU); ctx.stroke();
      } else if (f.t === 'slash') {
        var sweep = SP.lerp(-f.arc / 2, f.arc / 2, Math.min(1, k * 1.35));
        ctx.save();
        ctx.translate(fp.x, fp.y);
        ctx.rotate(f.a);
        ctx.globalAlpha = Math.max(0, 1 - k) * 0.9;
        var lg = ctx.createRadialGradient(0, 0, f.range * 0.25, 0, 0, f.range);
        lg.addColorStop(0, 'rgba(255,255,255,0)');
        lg.addColorStop(0.7, 'rgba(190,235,255,0.55)');
        lg.addColorStop(1, 'rgba(255,255,255,0.95)');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, f.range, -f.arc / 2, sweep);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, f.range * 0.92, -f.arc / 2, sweep); ctx.stroke();
        ctx.restore();
      } else {
        ctx.globalAlpha = Math.max(0, f.life / f.dur);
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(fp.x, fp.y, f.size, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* ---------------------------------------------------------- 飘字 */
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var ti = 0; ti < world.texts.length; ti++) {
      var tx = world.texts[ti];
      var tp = S(tx.x, tx.y);
      ctx.globalAlpha = clamp(tx.life / tx.max, 0, 1);
      ctx.font = 'bold ' + tx.size + 'px system-ui, "Microsoft YaHei", sans-serif';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(tx.text, tp.x, tp.y);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.text, tp.x, tp.y);
    }
    ctx.globalAlpha = 1;

    /* ---------------------------------------------------------- 受伤红晕 */
    var hf = world.player.hurtFlash;
    if (hf > 0) {
      var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.62);
      vg.addColorStop(0, 'rgba(255,0,40,0)');
      vg.addColorStop(1, 'rgba(255,20,50,' + (0.52 * (hf / 0.3)).toFixed(3) + ')');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
    // 常驻暗角
    var vg2 = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.78);
    vg2.addColorStop(0, 'rgba(0,0,0,0)');
    vg2.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg2; ctx.fillRect(0, 0, W, H);

    /* ---------------------------------------------------------- 小地图 */
    if (opts.minimap !== false) this.drawMinimap(ctx, world);

    return { boss: boss };
  };

  /** 普攻范围提示：随武器类型变化（扇形 / 满圈 / 远程瞄准线）。 */
  Renderer.prototype.drawAttackArc = function (ctx, world, S, opts) {
    var p = world.player;
    if (!p || world.dead) return;
    var sp = S(p.x, p.y);
    var range = p.range;
    var arc = p.arcWidth;
    var style = (p.weapon && p.weapon.style) || 'slash';
    var hot = !!(opts && opts.autoLock);
    var tracking = !hot && !!(opts && opts.autoAim);
    var fill = hot ? 'rgba(150, 230, 255, 0.22)'
      : tracking ? 'rgba(160, 220, 255, 0.16)'
      : 'rgba(186, 210, 255, 0.12)';
    var stroke = hot ? 'rgba(220, 248, 255, 0.92)'
      : tracking ? 'rgba(180, 230, 255, 0.78)'
      : 'rgba(206, 224, 255, 0.62)';
    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(p.facing);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = hot ? 2 : 1.5;

    if (style === 'shot' || style === 'bolt') {
      // 远程：细长瞄准锥 + 最远距离刻度
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, range, -arc / 2, arc / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(range, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, range, -0.12, 0.12);
      ctx.stroke();
    } else if (style === 'spin') {
      ctx.beginPath();
      ctx.arc(0, 0, range, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(18, range * 0.35), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, range, -arc / 2, arc / 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, range, -arc / 2, arc / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(Math.cos(-arc / 2) * 16, Math.sin(-arc / 2) * 16);
      ctx.lineTo(Math.cos(-arc / 2) * range, Math.sin(-arc / 2) * range);
      ctx.moveTo(Math.cos(arc / 2) * 16, Math.sin(arc / 2) * 16);
      ctx.lineTo(Math.cos(arc / 2) * range, Math.sin(arc / 2) * range);
      ctx.stroke();
      if (style === 'smash' && p.weapon && p.weapon.smashR) {
        ctx.strokeStyle = hot ? 'rgba(255, 210, 140, 0.85)' : 'rgba(255, 200, 120, 0.45)';
        ctx.beginPath();
        ctx.arc(0, 0, p.weapon.smashR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------ 玩家（小猪） */
  Renderer.prototype.drawPlayer = function (ctx, world, S, opts) {
    var p = world.player;
    var sp = S(p.x, p.y);
    var dead = world.dead;
    var bob = Math.sin((p.walkPhase || 0)) * (SP.len(p.vx, p.vy) > 12 ? 1.2 : 0.5);

    // 影子
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#000';
    ellipse(ctx, sp.x + 3, sp.y + 15, 20, 9); ctx.fill();
    ctx.globalAlpha = 1;

    if (dead) {
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(Math.PI / 2 * 0.9);
      ctx.globalAlpha = 0.75;
      if (!this.drawCharIcon(ctx, 'hero', 0, 0, 44)) this.drawPigBody(ctx, p, world, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }

    // 无敌帧闪烁
    if (p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0) ctx.globalAlpha = 0.45;

    ctx.save();
    ctx.translate(sp.x, sp.y);
    // 护盾
    if (p.shield > 0) {
      ctx.save();
      var sg = ctx.createRadialGradient(0, 0, 16, 0, 0, 34);
      sg.addColorStop(0, 'rgba(120,220,255,0.05)');
      sg.addColorStop(1, 'rgba(120,220,255,0.4)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(0, 0, 32, 0, TAU); ctx.fill();
      ctx.rotate(this.t * 1.2);
      ctx.strokeStyle = 'rgba(180,240,255,0.9)';
      ctx.lineWidth = 2;
      for (var d = 0; d < 6; d++) {
        var a = (d / 6) * TAU;
        ctx.beginPath();
        ctx.arc(0, 0, 30, a, a + 0.6);
        ctx.stroke();
      }
      ctx.restore();
    }
    // 赐福增伤光环
    if (p.dmgBuffT > 0) {
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(this.t * 8);
      ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.rotate(p.facing + Math.PI / 2); // 贴图朝上，旋转到 facing
    ctx.translate(0, bob);
    if (!this.drawCharIcon(ctx, 'hero', 0, -2, 46)) this.drawPigBody(ctx, p, world, 1);
    else if (p.hurtFlash > 0) {
      ctx.globalAlpha = clamp(p.hurtFlash / 0.3, 0, 1) * 0.55;
      ctx.fillStyle = '#fff';
      ellipse(ctx, 0, -2, 18, 16); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  /** 以 (0,0) 为中心、朝上的小猪；朝上方向为 -y */
  Renderer.prototype.drawPigBody = function (ctx, p, world, alpha) {
    var walk = p.walkPhase;
    var moving = SP.len(p.vx, p.vy) > 12;
    var legSwing = moving ? Math.sin(walk) * 3.2 : 0;
    var bodyBob = moving ? Math.abs(Math.sin(walk)) * 1.2 : Math.sin(this.t * 2) * 0.7;

    // 腿
    ctx.fillStyle = '#d97fa8';
    var legs = [[-10, 12], [10, 12], [-10, -6], [10, -6]];
    for (var i = 0; i < legs.length; i++) {
      var lx = legs[i][0], ly = legs[i][1];
      var off = (i % 2 === 0 ? legSwing : -legSwing);
      roundRect(ctx, lx - 3.2, ly - 4 + off, 6.4, 9, 3); ctx.fill();
    }
    // 尾巴
    ctx.strokeStyle = '#e88fb6'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 15 + bodyBob, 5, 0.2, Math.PI * 1.6);
    ctx.stroke();

    // 身体
    ctx.save();
    ctx.translate(0, bodyBob);
    var bg = ctx.createRadialGradient(-5, -6, 2, 0, 0, 22);
    bg.addColorStop(0, '#ffc3da');
    bg.addColorStop(0.55, '#f7a0c0');
    bg.addColorStop(1, '#dd7ea6');
    ctx.fillStyle = bg;
    ellipse(ctx, 0, 0, 17.5, 15.5); ctx.fill();
    ctx.strokeStyle = 'rgba(120,50,80,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();

    // 耳朵
    ctx.fillStyle = '#ef94b8';
    for (var s = -1; s <= 1; s += 2) {
      ctx.beginPath();
      ctx.moveTo(s * 9, -10);
      ctx.lineTo(s * 15.5, -17);
      ctx.lineTo(s * 15, -6);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,50,80,0.4)'; ctx.stroke();
    }

    // 猪鼻
    ctx.fillStyle = '#e8829f';
    ellipse(ctx, 0, -12, 8.5, 6.6); ctx.fill();
    ctx.strokeStyle = 'rgba(110,40,70,0.5)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = 'rgba(120,40,70,0.85)';
    ellipse(ctx, -3, -12, 1.7, 2.4); ctx.fill();
    ellipse(ctx, 3, -12, 1.7, 2.4); ctx.fill();

    // 眼睛
    ctx.fillStyle = '#3a2030';
    ellipse(ctx, -6.2, -4.4, 2.2, 2.6); ctx.fill();
    ellipse(ctx, 6.2, -4.4, 2.2, 2.6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ellipse(ctx, -6.9, -5.4, 0.9, 0.9); ctx.fill();
    ellipse(ctx, 5.5, -5.4, 0.9, 0.9); ctx.fill();

    // 受伤/增伤高光
    if (p.hurtFlash > 0) {
      ctx.globalAlpha = clamp(p.hurtFlash / 0.3, 0, 1) * 0.75;
      ctx.fillStyle = '#fff';
      ellipse(ctx, 0, 0, 17.5, 15.5); ctx.fill();
      ctx.globalAlpha = alpha;
    }
    ctx.restore();
  };

  /* --------------------------------------------------- 小工具：颜色与图标 */
  /** #rrggbb → rgba(...)，用于给品质色加透明度 */
  Renderer.prototype.hexA = function (hex, a) {
    if (!hex || hex[0] !== '#' || hex.length < 7) return 'rgba(255,255,255,' + a + ')';
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  };

  /** 掉落物上的像素图标。图还没解码完时返回 false，调用方再画简易形状。 */
  Renderer.prototype.drawItemIcon = function (ctx, key, x, y, sz, smoothOn) {
    var img = SP.ItemIcons && SP.ItemIcons.image(key);
    if (!img || !img.complete || !img.naturalWidth) return false;
    var smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = !!smoothOn;
    ctx.drawImage(img, Math.round(x - sz / 2), Math.round(y - sz / 2), sz, sz);
    ctx.imageSmoothingEnabled = smooth;
    return true;
  };

  /** 怪物立绘（icon-mob-<key>），用于场上头像与小地图 */
  Renderer.prototype.drawMobIcon = function (ctx, enemyKey, x, y, sz) {
    var icons = SP.ItemIcons;
    if (!icons || !icons.forEnemy) return false;
    var key = icons.forEnemy(enemyKey);
    return key ? this.drawItemIcon(ctx, key, x, y, sz, false) : false;
  };

  /** 角色立绘：主角 / 铁匠 / 商人（柔和卡通，开平滑） */
  Renderer.prototype.drawCharIcon = function (ctx, charKey, x, y, sz) {
    return this.drawItemIcon(ctx, 'char-' + charKey, x, y, sz, true);
  };

  /** 掉落物上标注部位的汉字（比 emoji 更可靠，不依赖字体回退） */
  Renderer.prototype.slotGlyph = function (slot) {
    switch (slot) {
      case 'weapon': return '武';
      case 'helm': return '头';
      case 'armor': return '甲';
      case 'boots': return '靴';
      case 'amulet': return '链';
      case 'ring': return '戒';
      default: return '?';
    }
  };

  /* ------------------------------------------------- 生物群系专属场景物件 */
  Renderer.prototype.drawBiomeProp = function (ctx, ob, x, y) {
    var r = ob.r, t = this.t;
    ctx.save();
    ctx.translate(x, y);
    switch (ob.kind) {
      case 'tree': {
        ctx.fillStyle = '#3a2a1e';
        roundRect(ctx, -r * 0.18, -r * 0.1, r * 0.36, r * 0.95, r * 0.1); ctx.fill();
        var cg = ctx.createRadialGradient(-r * 0.3, -r * 0.9, r * 0.15, 0, -r * 0.7, r * 1.25);
        cg.addColorStop(0, '#4f7a45'); cg.addColorStop(0.6, '#2f5330'); cg.addColorStop(1, '#1b3320');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(0, -r * 0.72, r * 0.92, 0, TAU);
        ctx.arc(-r * 0.55, -r * 0.42, r * 0.6, 0, TAU);
        ctx.arc(r * 0.58, -r * 0.46, r * 0.62, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#6f9a58';
        ctx.beginPath(); ctx.arc(-r * 0.28, -r * 1.05, r * 0.3, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'mushroom': {
        ctx.fillStyle = '#cfc3ab';
        roundRect(ctx, -r * 0.22, -r * 0.2, r * 0.44, r * 1.0, r * 0.16); ctx.fill();
        var mg = ctx.createLinearGradient(0, -r * 1.1, 0, -r * 0.1);
        mg.addColorStop(0, '#c2668f'); mg.addColorStop(1, '#7a3358');
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.moveTo(-r, -r * 0.1);
        ctx.quadraticCurveTo(-r * 0.92, -r * 1.12, 0, -r * 1.12);
        ctx.quadraticCurveTo(r * 0.92, -r * 1.12, r, -r * 0.1);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,225,240,0.85)';
        ctx.beginPath(); ctx.arc(-r * 0.4, -r * 0.62, r * 0.13, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.78, r * 0.1, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 1.8 + ob.x);
        ctx.fillStyle = '#d8a0ff';
        ctx.beginPath(); ctx.arc(r * 0.55, -r * 0.3, r * 0.35, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'crystal': {
        var shapes = 3;
        for (var i = 0; i < shapes; i++) {
          var off = (i - 1) * r * 0.45;
          var h = r * (1.5 - Math.abs(i - 1) * 0.45);
          var cg2 = ctx.createLinearGradient(0, -h, 0, r * 0.4);
          cg2.addColorStop(0, '#a8ecff'); cg2.addColorStop(0.45, '#4f8fd0'); cg2.addColorStop(1, '#25344f');
          ctx.fillStyle = cg2;
          ctx.beginPath();
          ctx.moveTo(off - r * 0.24, r * 0.42);
          ctx.lineTo(off, -h);
          ctx.lineTo(off + r * 0.26, r * 0.42);
          ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = 0.3 + 0.25 * Math.sin(t * 2.2 + ob.x);
        ctx.fillStyle = '#d8f8ff';
        ctx.beginPath(); ctx.arc(0, -r * 0.5, r * 0.5, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'stalagmite': {
        var sg2 = ctx.createLinearGradient(0, -r * 2.1, 0, r * 0.5);
        sg2.addColorStop(0, '#6a7290'); sg2.addColorStop(0.5, '#3f455c'); sg2.addColorStop(1, '#22263a');
        ctx.fillStyle = sg2;
        ctx.beginPath();
        ctx.moveTo(-r * 0.8, r * 0.5);
        ctx.quadraticCurveTo(-r * 0.3, -r * 0.8, 0, -r * 2.0);
        ctx.quadraticCurveTo(r * 0.32, -r * 0.8, r * 0.8, r * 0.5);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(190,205,240,0.2)'; ctx.lineWidth = 1.4; ctx.stroke();
        break;
      }
      case 'bone': {
        ctx.fillStyle = '#d8cfba';
        for (var b = -1; b <= 1; b++) {
          ctx.save();
          ctx.rotate(b * 0.34);
          roundRect(ctx, -r * 0.1, -r * 0.9, r * 0.2, r * 1.5, r * 0.1); ctx.fill();
          ctx.beginPath(); ctx.arc(0, -r * 0.9, r * 0.17, 0, TAU); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = '#8f4a4a';
        ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.ellipse(0, r * 0.2, r * 0.9, r * 0.3, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'egg': {
        var eg = ctx.createRadialGradient(-r * 0.25, -r * 0.5, r * 0.1, 0, 0, r * 1.1);
        eg.addColorStop(0, '#e0c8d8'); eg.addColorStop(0.6, '#9a6a86'); eg.addColorStop(1, '#5a3a52');
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.ellipse(0, 0, r * 0.72, r * 1.0, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(60,30,50,0.5)';
        ctx.beginPath(); ctx.arc(-r * 0.24, -r * 0.3, r * 0.11, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.2, r * 0.24, r * 0.09, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t * 1.5 + ob.y);
        ctx.fillStyle = '#ff9ec4';
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.1, r * 1.3, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
    }
    ctx.restore();
  };

  /* ------------------------------------------------------- 怪物家族美术
   * 四个生物群系各有一套剪影：营地=科多兽(beast)、森林=菌类(fungus)、
   * 洞窟=晶体(crystal)、巢穴=恶魔(demon)；远程怪统一走 wing 分支。
   */
  Renderer.prototype.drawFungusBody = function (ctx, e, isElite) {
    var r = e.r, col = e.color;
    var bob = Math.sin(e.anim) * 1.5;
    ctx.save();
    ctx.translate(0, bob);
    // 菌根腿
    ctx.fillStyle = '#3d3223';
    for (var i = -1; i <= 1; i += 2) {
      roundRect(ctx, i * r * 0.42 - 3.5, r * 0.42, 7, r * 0.72, 3.5); ctx.fill();
    }
    // 菌柄
    var sg = ctx.createLinearGradient(-r * 0.5, 0, r * 0.5, 0);
    sg.addColorStop(0, '#8f8168'); sg.addColorStop(0.5, '#e0d5bd'); sg.addColorStop(1, '#8f8168');
    ctx.fillStyle = sg;
    ellipse(ctx, 0, r * 0.05, r * 0.5, r * 0.72); ctx.fill();
    // 菌盖
    var cg = ctx.createLinearGradient(0, -r * 1.3, 0, r * 0.1);
    cg.addColorStop(0, '#d07aa0'); cg.addColorStop(0.55, col); cg.addColorStop(1, '#2f4429');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.moveTo(-r * 1.02, -r * 0.1);
    ctx.quadraticCurveTo(-r * 0.95, -r * 1.25, 0, -r * 1.25);
    ctx.quadraticCurveTo(r * 0.95, -r * 1.25, r * 1.02, -r * 0.1);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(20,30,20,0.5)'; ctx.lineWidth = 1.6; ctx.stroke();
    // 菌盖斑点
    ctx.fillStyle = 'rgba(255,232,246,0.8)';
    ctx.beginPath(); ctx.arc(-r * 0.42, -r * 0.62, r * 0.14, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.28, -r * 0.86, r * 0.11, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.5, -r * 0.42, r * 0.1, 0, TAU); ctx.fill();
    // 冲锋种长刺
    if (isElite) {
      ctx.fillStyle = '#cfe0b0';
      for (var s = -1; s <= 1; s++) {
        ctx.beginPath();
        ctx.moveTo(s * r * 0.5 - 3, -r * 0.9);
        ctx.lineTo(s * r * 0.5, -r * 1.7);
        ctx.lineTo(s * r * 0.5 + 3, -r * 0.9);
        ctx.closePath(); ctx.fill();
      }
    }
    // 眼睛（长在菌柄上）
    ctx.fillStyle = '#1d2417';
    ellipse(ctx, -r * 0.2, -r * 0.05 + r * 0.22, r * 0.1, r * 0.14); ctx.fill();
    ellipse(ctx, r * 0.2, -r * 0.05 + r * 0.22, r * 0.1, r * 0.14); ctx.fill();
    ctx.restore();
  };

  Renderer.prototype.drawCrystalBody = function (ctx, e, isElite) {
    var r = e.r, col = e.color;
    var bob = Math.sin(e.anim * 0.8) * 1.2;
    ctx.save();
    ctx.translate(0, bob);
    // 晶簇腿
    ctx.fillStyle = 'rgba(120,150,190,0.85)';
    for (var i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      ctx.moveTo(i * r * 0.4 - 4, r * 0.35);
      ctx.lineTo(i * r * 0.55, r * 1.15);
      ctx.lineTo(i * r * 0.4 + 4, r * 0.35);
      ctx.closePath(); ctx.fill();
    }
    // 棱面身体
    var pts = [];
    var n = 7;
    for (var k = 0; k < n; k++) {
      var a = (k / n) * TAU - Math.PI / 2;
      var rr = r * (k % 2 === 0 ? 1.0 : 0.82);
      pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr * 0.94 });
    }
    var bg = ctx.createLinearGradient(-r, -r, r, r);
    bg.addColorStop(0, '#cfe8ff'); bg.addColorStop(0.45, col); bg.addColorStop(1, '#232b40');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var p = 1; p < pts.length; p++) ctx.lineTo(pts[p].x, pts[p].y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(215,240,255,0.5)'; ctx.lineWidth = 1.6; ctx.stroke();
    // 内部发光核心
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin(this.t * 3 + e.anim);
    ctx.fillStyle = '#eafaff';
    ellipse(ctx, 0, -r * 0.1, r * 0.34, r * 0.34); ctx.fill();
    ctx.globalAlpha = 1;
    if (isElite) {
      ctx.fillStyle = 'rgba(230,250,255,0.9)';
      for (var q = -1; q <= 1; q++) {
        ctx.beginPath();
        ctx.moveTo(q * r * 0.45 - 3.5, -r * 0.8);
        ctx.lineTo(q * r * 0.45, -r * 1.75);
        ctx.lineTo(q * r * 0.45 + 3.5, -r * 0.8);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  };

  Renderer.prototype.drawDemonBody = function (ctx, e, isElite) {
    var r = e.r, col = e.color;
    var bob = Math.sin(e.anim * 1.2) * 1.6;
    ctx.save();
    ctx.translate(0, bob);
    // 尖刺剪影身体
    var n = 11;
    ctx.beginPath();
    for (var k = 0; k < n; k++) {
      var a = (k / n) * TAU;
      var rr = r * (k % 2 === 0 ? 1.06 : 0.74);
      var x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.9;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    var bg = ctx.createRadialGradient(-r * 0.3, -r * 0.4, 2, 0, 0, r * 1.35);
    bg.addColorStop(0, '#e08aa8'); bg.addColorStop(0.5, col); bg.addColorStop(1, '#2a1220');
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = 'rgba(30,10,22,0.55)'; ctx.lineWidth = 1.8; ctx.stroke();
    // 犄角
    ctx.strokeStyle = '#f0dcc8'; ctx.lineWidth = isElite ? 4 : 3.2; ctx.lineCap = 'round';
    for (var hs = -1; hs <= 1; hs += 2) {
      ctx.beginPath();
      ctx.moveTo(hs * r * 0.4, -r * 0.75);
      ctx.quadraticCurveTo(hs * r * 1.0, -r * 1.2, hs * r * 0.72, -r * 1.7);
      ctx.stroke();
    }
    // 发光眼
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.t * 5 + e.anim);
    ctx.fillStyle = '#ff4a4a';
    ellipse(ctx, -r * 0.26, -r * 0.42, r * 0.16, r * 0.11); ctx.fill();
    ellipse(ctx, r * 0.26, -r * 0.42, r * 0.16, r * 0.11); ctx.fill();
    ctx.globalAlpha = 1;
    // 獠牙
    ctx.fillStyle = '#fff4e0';
    for (var f = -1; f <= 1; f += 2) {
      ctx.beginPath();
      ctx.moveTo(f * r * 0.14, r * 0.18);
      ctx.lineTo(f * r * 0.24, r * 0.5);
      ctx.lineTo(f * r * 0.34, r * 0.18);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------ 藏身处场景 */
  /**
   * 枢纽不再是一堆面板，而是一块可以走动的安全区。
   * 场景坐标以 (width/2, height/2) 为原点，相机跟随玩家并被夹在场景内。
   */
  Renderer.prototype.drawHideout = function (h, view) {
    var ctx = this.ctx, W = this.w, H = this.h;
    view = view || {};
    var self = this;
    var t = this.t;
    var ox = W / 2 - (h.width / 2 + h.camera.x);
    var oy = H / 2 - (h.height / 2 + h.camera.y);
    function S(x, y) { return { x: x + ox, y: y + oy }; }

    /* 夜空 */
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0a0816');
    sky.addColorStop(0.55, '#120d20');
    sky.addColorStop(1, '#0d0a16');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    for (var i = 0; i < 130; i++) {
      var sx = ((i * 173.3 - h.camera.x * 0.25) % (W + 80) + W + 80) % (W + 80) - 40;
      var sy = ((i * 97.7) % (H * 0.7));
      ctx.globalAlpha = 0.18 + 0.5 * Math.abs(Math.sin(t * 0.7 + i));
      ctx.fillStyle = '#cfe4ff';
      ctx.fillRect(sx, sy, 1.6, 1.6);
    }
    ctx.restore();

    /* 营地地面 */
    var g0 = S(0, 0), g1 = S(h.width, h.height);
    var fire = null;
    for (var pi = 0; pi < h.props.length; pi++) if (h.props[pi].kind === 'fire') fire = h.props[pi];
    var fpos = fire ? S(fire.x, fire.y) : { x: W / 2, y: H / 2 };
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, g0.x, g0.y, h.width, h.height, 60);
    var ground = ctx.createRadialGradient(fpos.x, fpos.y, 40, fpos.x, fpos.y, Math.max(h.width, h.height) * 0.62);
    ground.addColorStop(0, '#5a4535');
    ground.addColorStop(0.3, '#463527');
    ground.addColorStop(0.68, '#33261c');
    ground.addColorStop(1, '#241a14');
    ctx.fillStyle = ground;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // 地面纹理：踩踏痕与土块
    for (var d = 0; d < 60; d++) {
      var dx = ((d * 331) % h.width), dy = ((d * 197) % h.height);
      var dp = S(dx, dy);
      ctx.globalAlpha = 0.05 + (d % 4) * 0.012;
      ctx.fillStyle = d % 3 === 0 ? '#ffffff' : '#000000';
      ellipse(ctx, dp.x, dp.y, 26 + (d % 5) * 14, 18 + (d % 4) * 10);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 石板小径：从出生点通往传送门
    ctx.strokeStyle = 'rgba(190,175,150,0.10)';
    ctx.lineWidth = 46;
    ctx.lineCap = 'round';
    ctx.beginPath();
    var pStart = S(h.width / 2, 1040), pEnd = S(1100, 620);
    ctx.moveTo(pStart.x, pStart.y);
    ctx.lineTo(S(1100, 860).x, S(1100, 860).y);
    ctx.lineTo(pEnd.x, pEnd.y);
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    /* 装饰物 */
    for (var k = 0; k < h.props.length; k++) {
      var pr = h.props[k], pp = S(pr.x, pr.y);
      if (pp.x < -220 || pp.x > W + 220 || pp.y < -220 || pp.y > H + 220) continue;
      this.drawHideoutProp(ctx, pr, pp.x, pp.y, t);
    }

    /* NPC 与传送门 */
    for (var n = 0; n < h.npcs.length; n++) {
      var npc = h.npcs[n], np = S(npc.x, npc.y);
      var isNear = h.nearby === npc;
      this.drawNpc(ctx, npc, np.x, np.y, isNear, t);
    }

    /* 玩家（与战斗共用角色立绘） */
    var pl = S(h.player.x, h.player.y);
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#000';
    ellipse(ctx, pl.x + 3, pl.y + 15, 20, 9); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(pl.x, pl.y);
    ctx.rotate(h.player.facing + Math.PI / 2);
    if (!this.drawCharIcon(ctx, 'hero', 0, -2, 46)) {
      SP.Renderer.prototype.drawPigBody.call(this, ctx, {
        walkPhase: h.player.walkPhase, vx: h.player.vx, vy: h.player.vy, hurtFlash: 0
      }, null, 1);
    }
    ctx.restore();

    /* 交互提示环 */
    if (h.nearby) {
      var tip = S(h.nearby.x, h.nearby.y);
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 4);
      ctx.strokeStyle = '#ffe9a8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, h.nearby.r + 22, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // 头顶箭头
      var ay = tip.y - h.nearby.r - 34 + Math.sin(t * 3) * 4;
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.moveTo(tip.x, ay + 12);
      ctx.lineTo(tip.x - 8, ay);
      ctx.lineTo(tip.x + 8, ay);
      ctx.closePath(); ctx.fill();
    }

    /* 暗角 */
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.46)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    void self;
  };

  /** 藏身处的装饰物 */
  Renderer.prototype.drawHideoutProp = function (ctx, pr, x, y, t) {
    var r = pr.r;
    ctx.save();
    ctx.translate(x, y);
    // 影子
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#000';
    ellipse(ctx, 3, r * 0.42, r * 1.02, r * 0.46); ctx.fill();
    ctx.globalAlpha = 1;

    switch (pr.kind) {
      case 'fire': {
        ctx.globalAlpha = 0.5 + 0.1 * Math.sin(t * 7);
        var fg = ctx.createRadialGradient(0, 0, 6, 0, 0, r * 2.6);
        fg.addColorStop(0, 'rgba(255,180,90,0.8)');
        fg.addColorStop(0.5, 'rgba(255,120,40,0.28)');
        fg.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(0, 0, r * 2.6, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        // 石圈
        ctx.fillStyle = '#4a4038';
        for (var s = 0; s < 9; s++) {
          var a = (s / 9) * TAU;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.5 + 6, r * 0.15, 0, TAU);
          ctx.fill();
        }
        // 木柴
        ctx.strokeStyle = '#3d2a1c'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-r * 0.5, r * 0.2); ctx.lineTo(r * 0.5, -r * 0.1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-r * 0.45, -r * 0.12); ctx.lineTo(r * 0.5, r * 0.22); ctx.stroke();
        // 火焰
        var flick = Math.sin(t * 11) * 5;
        ctx.fillStyle = '#ff9b3d';
        ctx.beginPath();
        ctx.moveTo(-r * 0.42, r * 0.1);
        ctx.quadraticCurveTo(-r * 0.3, -r * 1.0 - flick, 0, -r * 1.35 - flick);
        ctx.quadraticCurveTo(r * 0.3, -r * 1.0, r * 0.42, r * 0.1);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffe08a';
        ctx.beginPath();
        ctx.moveTo(-r * 0.2, r * 0.06);
        ctx.quadraticCurveTo(-r * 0.14, -r * 0.6, 0, -r * 0.82 - flick * 0.6);
        ctx.quadraticCurveTo(r * 0.16, -r * 0.55, r * 0.2, r * 0.06);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'tent': {
        ctx.rotate(pr.rot);
        var tg = ctx.createLinearGradient(-r, 0, r, 0);
        tg.addColorStop(0, '#43304a'); tg.addColorStop(0.5, '#6b4a5f'); tg.addColorStop(1, '#33243b');
        ctx.fillStyle = tg;
        ctx.beginPath();
        ctx.moveTo(-r, r * 0.6); ctx.lineTo(0, -r); ctx.lineTo(r, r * 0.6);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,190,240,0.22)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = 'rgba(20,12,24,0.86)';
        ctx.beginPath();
        ctx.moveTo(-r * 0.26, r * 0.6); ctx.lineTo(0, -r * 0.1); ctx.lineTo(r * 0.26, r * 0.6);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'anvil': {
        ctx.fillStyle = '#3b3a44';
        roundRect(ctx, -r * 0.26, r * 0.3, r * 0.52, r * 0.5, 3); ctx.fill();
        ctx.fillStyle = '#565461';
        ctx.beginPath();
        ctx.moveTo(-r * 0.7, -r * 0.3);
        ctx.lineTo(r * 0.7, -r * 0.3);
        ctx.lineTo(r * 0.5, r * 0.28);
        ctx.lineTo(-r * 0.5, r * 0.28);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#6d6a78';
        roundRect(ctx, -r * 0.85, -r * 0.48, r * 1.7, r * 0.22, 3); ctx.fill();
        break;
      }
      case 'forge': {
        var gg = ctx.createRadialGradient(0, -r * 0.2, 4, 0, -r * 0.2, r * 1.6);
        gg.addColorStop(0, 'rgba(255,150,60,0.85)');
        gg.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(0, -r * 0.2, r * 1.6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3a3038';
        roundRect(ctx, -r * 0.8, -r * 0.2, r * 1.6, r * 1.0, 6); ctx.fill();
        ctx.fillStyle = 'rgba(255,160,70,' + (0.65 + 0.25 * Math.sin(t * 9)).toFixed(2) + ')';
        roundRect(ctx, -r * 0.42, r * 0.02, r * 0.84, r * 0.5, 4); ctx.fill();
        break;
      }
      case 'stall': {
        ctx.fillStyle = '#5a4433';
        roundRect(ctx, -r * 0.9, -r * 0.1, r * 1.8, r * 0.75, 5); ctx.fill();
        ctx.fillStyle = '#8a4a4a';
        ctx.beginPath();
        ctx.moveTo(-r * 1.0, -r * 0.1);
        ctx.lineTo(0, -r * 0.95);
        ctx.lineTo(r * 1.0, -r * 0.1);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,220,200,0.35)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#c9a06a';
        for (var b = -1; b <= 1; b++) {
          ctx.beginPath(); ctx.arc(b * r * 0.45, r * 0.22, r * 0.14, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'crate': {
        var cg = ctx.createLinearGradient(-r, -r, r, r);
        cg.addColorStop(0, '#8a6a44'); cg.addColorStop(1, '#553f28');
        ctx.fillStyle = cg;
        roundRect(ctx, -r, -r * 0.9, r * 2, r * 1.8, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(40,26,14,0.7)'; ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-r, -r * 0.9); ctx.lineTo(r, r * 0.9);
        ctx.moveTo(r, -r * 0.9); ctx.lineTo(-r, r * 0.9);
        ctx.stroke();
        break;
      }
      case 'barrel': {
        var bg = ctx.createLinearGradient(-r, 0, r, 0);
        bg.addColorStop(0, '#4d3626'); bg.addColorStop(0.45, '#7d5a3c'); bg.addColorStop(1, '#3d2a1d');
        ctx.fillStyle = bg;
        roundRect(ctx, -r * 0.8, -r, r * 1.6, r * 2, r * 0.5); ctx.fill();
        ctx.strokeStyle = 'rgba(30,20,12,0.8)'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-r * 0.8, -r * 0.35); ctx.lineTo(r * 0.8, -r * 0.35);
        ctx.moveTo(-r * 0.8, r * 0.35); ctx.lineTo(r * 0.8, r * 0.35);
        ctx.stroke();
        break;
      }
      case 'tree': {
        ctx.fillStyle = '#2e2118';
        roundRect(ctx, -r * 0.16, -r * 0.1, r * 0.32, r * 0.9, r * 0.08); ctx.fill();
        var tg2 = ctx.createRadialGradient(-r * 0.3, -r * 0.85, r * 0.12, 0, -r * 0.7, r * 1.2);
        tg2.addColorStop(0, '#3d5c37'); tg2.addColorStop(0.6, '#263f28'); tg2.addColorStop(1, '#141f18');
        ctx.fillStyle = tg2;
        ctx.beginPath();
        ctx.arc(0, -r * 0.72, r * 0.88, 0, TAU);
        ctx.arc(-r * 0.5, -r * 0.42, r * 0.56, 0, TAU);
        ctx.arc(r * 0.54, -r * 0.46, r * 0.58, 0, TAU);
        ctx.fill();
        break;
      }
      case 'banner': {
        ctx.strokeStyle = '#5a4433'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, r * 0.7); ctx.lineTo(0, -r * 1.5); ctx.stroke();
        var wave = Math.sin(t * 2.2) * 4;
        ctx.fillStyle = '#7a3f6a';
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.5);
        ctx.quadraticCurveTo(r * 0.9, -r * 1.3 + wave, r * 1.5, -r * 1.0);
        ctx.lineTo(r * 1.4, -r * 0.2);
        ctx.quadraticCurveTo(r * 0.7, -r * 0.5 - wave, 0, -r * 0.4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffcf6e';
        ctx.beginPath(); ctx.arc(r * 0.7, -r * 0.85, r * 0.16, 0, TAU); ctx.fill();
        break;
      }
    }
    ctx.restore();
  };

  /** NPC：铁匠、商人，以及作为物件的时空传送门 */
  Renderer.prototype.drawNpc = function (ctx, npc, x, y, isNear, t) {
    var r = npc.r;
    ctx.save();
    ctx.translate(x, y);

    if (npc.isPortal) {
      // 传送门：地面符文 + 双层旋转环 + 中心光柱
      ctx.globalAlpha = 0.55 + 0.2 * Math.sin(t * 2.4);
      var pg = ctx.createRadialGradient(0, 0, 4, 0, 0, r * 2.2);
      pg.addColorStop(0, 'rgba(200,220,255,0.75)');
      pg.addColorStop(0.45, 'rgba(140,120,255,0.4)');
      pg.addColorStop(1, 'rgba(90,70,200,0)');
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.ellipse(0, r * 0.3, r * 2.2, r * 0.9, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      for (var ring = 0; ring < 2; ring++) {
        ctx.save();
        ctx.rotate(t * (ring === 0 ? 0.7 : -0.5));
        ctx.strokeStyle = ring === 0 ? 'rgba(190,170,255,0.9)' : 'rgba(140,230,255,0.75)';
        ctx.lineWidth = ring === 0 ? 3 : 2;
        ctx.setLineDash(ring === 0 ? [16, 10] : [8, 12]);
        ctx.beginPath();
        ctx.ellipse(0, r * 0.3, r * (1.5 - ring * 0.35), r * (0.62 - ring * 0.16), 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      ctx.setLineDash([]);
      var beam = ctx.createLinearGradient(0, -r * 3, 0, r * 0.6);
      beam.addColorStop(0, 'rgba(200,190,255,0)');
      beam.addColorStop(0.6, 'rgba(190,175,255,0.28)');
      beam.addColorStop(1, 'rgba(220,210,255,0.6)');
      ctx.fillStyle = beam;
      ctx.fillRect(-r * 0.7, -r * 3, r * 1.4, r * 3.6);
    } else {
      // 影子
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      ellipse(ctx, 2, r * 0.72, r * 0.78, r * 0.3); ctx.fill();
      ctx.globalAlpha = 1;
      var bob = Math.sin(t * 1.6 + npc.bob) * 1.6;
      ctx.translate(0, bob);
      var charKey = npc.key === 'blacksmith' ? 'blacksmith'
        : (npc.key === 'merchant' ? 'merchant' : null);
      var drawn = charKey && this.drawCharIcon(ctx, charKey, 0, -4, Math.round(r * 2.6));
      if (!drawn) {
        // 回退：旧版斗篷剪影
        var bgr = ctx.createLinearGradient(-r * 0.7, -r * 0.4, r * 0.7, r * 1.1);
        bgr.addColorStop(0, npc.color);
        bgr.addColorStop(1, 'rgba(20,14,26,0.95)');
        ctx.fillStyle = bgr;
        ctx.beginPath();
        ctx.moveTo(-r * 0.62, r * 0.8);
        ctx.quadraticCurveTo(-r * 0.72, -r * 0.35, 0, -r * 0.42);
        ctx.quadraticCurveTo(r * 0.72, -r * 0.35, r * 0.62, r * 0.8);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f0b8c8';
        ctx.beginPath(); ctx.arc(0, -r * 0.62, r * 0.42, 0, TAU); ctx.fill();
        ctx.fillStyle = '#33202c';
        ctx.beginPath();
        ctx.arc(-r * 0.15, -r * 0.64, r * 0.07, 0, TAU);
        ctx.arc(r * 0.15, -r * 0.64, r * 0.07, 0, TAU);
        ctx.fill();
      }
      // 走近时脚下小光圈
      if (isNear) {
        ctx.globalAlpha = 0.35 + 0.2 * Math.sin(t * 5);
        ctx.strokeStyle = npc.color || '#ffe9a8';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, r * 0.75, r * 0.95, r * 0.32, 0, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // 名牌
    ctx.globalAlpha = isNear ? 1 : 0.8;
    ctx.font = 'bold 13px system-ui, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var label = npc.name;
    var ly = npc.isPortal ? -r * 3.3 : -r * 1.9;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(label, 0, ly);
    ctx.fillStyle = isNear ? '#ffe9a8' : '#ded6ff';
    ctx.fillText(label, 0, ly);
    if (isNear) {
      ctx.font = '11px system-ui, "Microsoft YaHei", sans-serif';
      ctx.strokeText(npc.hint, 0, ly + 16);
      ctx.fillStyle = 'rgba(230,222,255,0.9)';
      ctx.fillText(npc.hint, 0, ly + 16);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  /* ---------------------------------------------------------------- 怪物 */
  /** 立绘未就绪时的程序化剪影（保留作回退，正常游戏走像素立绘） */
  Renderer.prototype.drawEnemyFallbackBody = function (ctx, e, dying) {
    var col = e.color;
    var dark = 'rgba(0,0,0,0.35)';
    if (e.kind === 'ranged') {
      var flap = Math.sin(e.anim * 3.2) * 0.6;
      ctx.fillStyle = 'rgba(186,138,245,0.8)';
      for (var w = -1; w <= 1; w += 2) {
        ctx.save();
        ctx.rotate(w * (0.34 + flap));
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(w * 19, -19, w * 35, -7);
        ctx.quadraticCurveTo(w * 27, 4, w * 31, 15);
        ctx.quadraticCurveTo(w * 19, 9, w * 9, 13);
        ctx.quadraticCurveTo(w * 4, 7, 0, 6);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      var bg2 = ctx.createRadialGradient(-3, -3, 1, 0, 0, e.r);
      bg2.addColorStop(0, '#e0c6ff'); bg2.addColorStop(1, col);
      ctx.fillStyle = bg2;
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a1a4d';
      ctx.beginPath(); ctx.arc(-4, -2, 1.8, 0, TAU); ctx.arc(4, -2, 1.8, 0, TAU); ctx.fill();
      return;
    }
    var isCharger = e.kind === 'charger';
    var fam = e.family || 'beast';
    if (fam === 'fungus') { this.drawFungusBody(ctx, e, isCharger); }
    else if (fam === 'crystal') { this.drawCrystalBody(ctx, e, isCharger); }
    else if (fam === 'demon') { this.drawDemonBody(ctx, e, isCharger); }
    else {
      var bob = Math.sin(e.anim) * 1.4;
      ctx.save();
      ctx.translate(0, bob);
      ctx.fillStyle = isCharger ? '#3b2519' : '#4b3423';
      var lg = [[-e.r * 0.55, e.r * 0.5], [e.r * 0.55, e.r * 0.5], [-e.r * 0.55, -e.r * 0.3], [e.r * 0.55, -e.r * 0.3]];
      for (var li = 0; li < lg.length; li++) {
        roundRect(ctx, lg[li][0] - 3.5, lg[li][1] - 4, 7, 12, 3.5); ctx.fill();
      }
      var ebg = ctx.createRadialGradient(-e.r * 0.3, -e.r * 0.4, 2, 0, 0, e.r * 1.3);
      ebg.addColorStop(0, isCharger ? '#c07a4c' : '#c69a6e');
      ebg.addColorStop(0.5, col);
      ebg.addColorStop(1, isCharger ? '#33200f' : '#4a3020');
      ctx.fillStyle = ebg;
      ellipse(ctx, 0, 0, e.r, e.r * 0.82); ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = isCharger ? '#a3653c' : '#8a5c3a';
      ellipse(ctx, 0, -e.r * 0.85, e.r * 0.62, e.r * 0.5); ctx.fill();
      ctx.fillStyle = e.kind === 'boss' ? '#ff5b3a' : '#2a1a10';
      ctx.beginPath();
      ctx.arc(-e.r * 0.24, -e.r * 0.95, e.r * 0.11, 0, TAU);
      ctx.arc(e.r * 0.24, -e.r * 0.95, e.r * 0.11, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    if (e.kind === 'boss') {
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(this.t * 3);
      ctx.strokeStyle = '#ff7a3a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, e.r * 1.35, 0, TAU); ctx.stroke();
      ctx.globalAlpha = dying;
    }
  };

  Renderer.prototype.drawEnemy = function (ctx, e, x, y, world, S) {
    var spawn = e.spawnT > 0 ? clamp(1 - e.spawnT / 0.45, 0.15, 1) : 1;
    var dying = e.dying > 0 ? clamp(e.dying / 0.28, 0, 1) : 1;
    var flash = e.hitFlash > 0;
    var bob = Math.sin(e.anim) * (e.kind === 'ranged' ? 2.2 : 1.4);
    var faceLeft = (e.vx || 0) < -8 || (Math.abs(e.vx || 0) < 8 && world && world.player && e.x > world.player.x);

    ctx.save();
    ctx.translate(x, y);

    // 影子
    ctx.globalAlpha = 0.35 * dying;
    ctx.fillStyle = '#000';
    ellipse(ctx, 3, e.r * 0.55, e.r * 1.05, e.r * 0.45); ctx.fill();
    ctx.globalAlpha = 1;

    // 精英光环：金色脉动圆环，和普通怪一眼区分
    if (e.elite) {
      ctx.globalAlpha = 0.4 + 0.22 * Math.sin(this.t * 3.4 + e.anim);
      ctx.strokeStyle = '#ffd75e'; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(0, 0, e.r * 1.45, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#ffd75e';
      ctx.beginPath(); ctx.arc(0, 0, e.r * 1.45, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 蓄力预警
    if (e.kind === 'charger' && e.state === 'wind') {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#ff5b4a'; ctx.lineWidth = 3;
      ctx.save();
      ctx.rotate(e.chargeDir);
      ctx.setLineDash([10, 7]);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(560, 0); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    if (e.kind === 'boss' && e.state === 'slam_wind') {
      var warnT = 1 - e.stateT / 0.85;
      ctx.globalAlpha = 0.3 + 0.25 * Math.sin(this.t * 22);
      ctx.strokeStyle = '#ff8a4a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, 190 * warnT, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,90,40,0.12)';
      ctx.beginPath(); ctx.arc(0, 0, 190, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.scale(spawn * (0.6 + 0.4 * dying), spawn * (0.6 + 0.4 * dying));
    ctx.globalAlpha = dying;

    // 优先用像素立绘作为场上本体；图未就绪时回退程序化剪影
    var spriteSz = Math.round(e.r * (e.boss ? 2.55 : 2.7));
    var usedPortrait = false;
    ctx.save();
    ctx.translate(0, bob - e.r * 0.08);
    if (faceLeft) ctx.scale(-1, 1);
    if (this.drawMobIcon(ctx, e.key, 0, 0, spriteSz)) {
      usedPortrait = true;
      if (e.boss) {
        ctx.globalAlpha = (0.35 + 0.2 * Math.sin(this.t * 3)) * dying;
        ctx.strokeStyle = '#ff7a3a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, e.r * 1.28, 0, TAU); ctx.stroke();
        ctx.globalAlpha = dying;
      }
      // 冲锋蓄力时立绘边缘发红
      if (e.kind === 'charger' && (e.state === 'wind' || e.state === 'dash')) {
        ctx.globalAlpha = (0.35 + 0.35 * Math.sin(this.t * 26)) * dying;
        ctx.strokeStyle = '#ff3a2a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, e.r * 1.15, 0, TAU); ctx.stroke();
        ctx.globalAlpha = dying;
      }
    }
    ctx.restore();

    if (!usedPortrait) {
      this.drawEnemyFallbackBody(ctx, e, dying);
    }

    // 受击高亮：用「亮边 + 轻填充」而不是整块白，避免多只怪同时被震击命中时糊成一片白团
    if (flash) {
      var fa = clamp(e.hitFlash / 0.16, 0, 1);
      ctx.globalAlpha = fa * 0.42;
      ctx.fillStyle = '#fff';
      ellipse(ctx, 0, bob, e.r * 0.94, e.r * 0.86); ctx.fill();
      ctx.globalAlpha = fa * 0.85;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ellipse(ctx, 0, bob, e.r * 1.02, e.r * 0.94); ctx.stroke();
      ctx.globalAlpha = dying;
    }
    // 眩晕星
    if (e.stun > 0) {
      ctx.fillStyle = '#ffe066';
      for (var s3 = 0; s3 < 3; s3++) {
        var aa = this.t * 6 + s3 * 2.1;
        ctx.beginPath();
        ctx.arc(Math.cos(aa) * 16, -e.r - 12 + Math.sin(aa) * 4, 2.4, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();

    // 血条
    if (e.dying <= 0 && (e.hp < e.maxHp || e.boss)) {
      var bw = Math.max(30, e.r * 2.2), bh = e.boss ? 6 : 4.4;
      var bx = x - bw / 2, by = y - e.r - (e.boss ? 22 : 16);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      roundRect(ctx, bx - 1, by - 1, bw + 2, bh + 2, 3); ctx.fill();
      var ratio = clamp(e.hp / e.maxHp, 0, 1);
      var hg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      if (e.boss) { hg.addColorStop(0, '#ff9a4a'); hg.addColorStop(1, '#ff4a4a'); }
      else { hg.addColorStop(0, '#ff7a7a'); hg.addColorStop(1, '#d43a3a'); }
      ctx.fillStyle = hg;
      roundRect(ctx, bx, by, bw * ratio, bh, 2); ctx.fill();
    }
  };

  /* -------------------------------------------------------------- 小地图 */
  Renderer.prototype.drawMinimap = function (ctx, world) {
    var size = 132, pad = 14;
    var mx = this.w - size - pad, my = this.h - size - pad;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(10,8,20,0.72)';
    roundRect(ctx, mx, my, size, size, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(150,130,255,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.save();
    roundRect(ctx, mx, my, size, size, 10); ctx.clip();
    var A = world.arena, k = size / (A * 2);
    function M(x, y) { return { x: mx + size / 2 + x * k, y: my + size / 2 + y * k }; }
    // 障碍物
    ctx.fillStyle = 'rgba(140,130,170,0.55)';
    for (var i = 0; i < world.obstacles.length; i++) {
      var o = world.obstacles[i], op = M(o.x, o.y);
      ctx.beginPath(); ctx.arc(op.x, op.y, Math.max(1.2, o.r * k), 0, TAU); ctx.fill();
    }
    // 掉落物
    for (var pi = 0; pi < world.pickups.length; pi++) {
      var it = world.pickups[pi], ip = M(it.x, it.y);
      ctx.fillStyle = it.kind === 'coin' ? '#ffd75e' : it.kind === 'stone' ? '#8fe4ff' : '#ffb27a';
      ctx.beginPath(); ctx.arc(ip.x, ip.y, 1.7, 0, TAU); ctx.fill();
    }
    // 怪物
    for (var ei = 0; ei < world.enemies.length; ei++) {
      var e = world.enemies[ei];
      if (e.dying > 0) continue;
      var ep = M(e.x, e.y);
      if (e.boss && this.drawMobIcon(ctx, e.key, ep.x, ep.y, 14)) { /* 首领用小立绘 */ }
      else {
        ctx.fillStyle = e.boss ? '#ff6a3a' : '#ff5b5b';
        ctx.beginPath(); ctx.arc(ep.x, ep.y, e.boss ? 4.2 : 2.7, 0, TAU); ctx.fill();
      }
    }
    // 玩家
    var pp = M(world.player.x, world.player.y);
    ctx.fillStyle = '#7fe7a0';
    ctx.beginPath(); ctx.arc(pp.x, pp.y, 3.6, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(pp.x, pp.y);
    ctx.lineTo(pp.x + Math.cos(world.player.facing) * 9, pp.y + Math.sin(world.player.facing) * 9);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(200,190,255,0.75)';
    ctx.fillText('科多兽营地', mx + 8, my + 6);
    ctx.restore();
  };

  SP.Renderer = Renderer;
  SP.roundRect = roundRect;
})(typeof globalThis !== 'undefined' ? globalThis : this);
