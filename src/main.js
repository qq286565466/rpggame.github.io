/* 时空猪 · main.js — 输入、主循环与「枢纽 ↔ 副本」流程
 */
(function (global) {
  'use strict';
  var SP = global.SP;
  var P = SP.Progress;
  var I = SP.Items;
  var doc = global.document;

  var sound = new SP.Sound();
  var ui = new SP.UI();
  var renderer = null;        // 副本画布
  var hideRenderer = null;    // 藏身处画布
  var world = null;
  var running = false;
  var paused = false;
  var runBanked = false;
  var lastSummary = null;
  var lastT = 0;
  var pingSmooth = 16;
  var demo = false;
  var hideoutTarget = null;   // 点击 NPC 后的自动走近目标
  var input = {
    mx: 0, my: 0, attack: false, quake: false, bless: false, use: false, dash: false,
    aimAngle: 0, hasMouse: false, mouseX: 0, mouseY: 0
  };
  var keys = {};
  var stick = { active: false, x: 0, y: 0, id: null };
  var touchUi = false;
  var autoAtk = false;
  var autoLock = false;   // 已进入刀长，正在自动挥砍
  var autoAim = false;    // 已锁定附近敌人（可能尚在刀长外，仅转向）
  var AUTO_KEY = 'spm_auto_atk';

  /* ------------------------------------------------------------------ 输入 */
  function keyName(ev) { return (ev.key || '').toLowerCase(); }

  function markTouchUi() {
    touchUi = !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
    doc.documentElement.classList.toggle('is-touch', touchUi);
  }

  /** 左侧摇杆：按住期间持续给出方向，松手归零。 */
  function bindStick() {
    var el = doc.getElementById('stick');
    if (!el) return;
    var base = el.querySelector('.stick-base');
    var knob = el.querySelector('.stick-knob');
    function place(ev) {
      var rect = base.getBoundingClientRect();
      var maxR = rect.width * 0.36;
      var dx = ev.clientX - (rect.left + rect.width / 2);
      var dy = ev.clientY - (rect.top + rect.height / 2);
      var len = Math.hypot(dx, dy) || 1;
      var clamped = Math.min(maxR, len);
      var nx = dx / len, ny = dy / len;
      knob.style.transform = 'translate(' + (nx * clamped) + 'px,' + (ny * clamped) + 'px)';
      var mag = Math.min(1, len / maxR);
      stick.x = nx * mag;
      stick.y = ny * mag;
      stick.active = mag > 0.16;
    }
    function end(ev) {
      if (ev.pointerId !== stick.id) return;
      stick.id = null;
      stick.active = false;
      stick.x = 0;
      stick.y = 0;
      knob.style.transform = 'translate(0,0)';
    }
    base.addEventListener('pointerdown', function (ev) {
      stick.id = ev.pointerId;
      try { base.setPointerCapture(ev.pointerId); } catch (e) { /* 合成事件没有真实指针 */ }
      sound.resume();
      place(ev);
      ev.preventDefault();
    });
    base.addEventListener('pointermove', function (ev) {
      if (ev.pointerId !== stick.id) return;
      place(ev);
    });
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }

  /** 右下角技能钮。攻击按住连击，其余按一下放一次。 */
  function bindSkillButtons() {
    function pulse(id, flag) {
      var el = doc.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', function (ev) {
        if (ui.screen !== 'game' || !running || paused) return;
        sound.resume();
        input[flag] = true;
        ev.preventDefault();
      });
    }
    var atk = doc.getElementById('slotAtk');
    if (atk) {
      atk.addEventListener('pointerdown', function (ev) {
        if (ui.screen !== 'game' || !running || paused) return;
        sound.resume();
        input.attack = true;
        try { atk.setPointerCapture(ev.pointerId); } catch (e) { /* 合成事件没有真实指针 */ }
        ev.preventDefault();
      });
      function releaseAtk(ev) {
        if (atk.hasPointerCapture && atk.hasPointerCapture(ev.pointerId)) atk.releasePointerCapture(ev.pointerId);
        input.attack = false;
      }
      atk.addEventListener('pointerup', releaseAtk);
      atk.addEventListener('pointercancel', releaseAtk);
    }
    pulse('slotQuake', 'quake');
    pulse('slotBless', 'bless');
    pulse('slotDash', 'dash');
    pulse('slotSteak', 'use');
  }

  function bindInput() {
    var canvas = doc.getElementById('game');
    var hideCanvas = doc.getElementById('hideoutCanvas');
    markTouchUi();
    if (global.matchMedia) {
      var mq = global.matchMedia('(pointer: coarse)');
      if (mq.addEventListener) mq.addEventListener('change', markTouchUi);
    }
    bindStick();
    bindSkillButtons();
    autoAtk = readAutoPref();
    applyAutoButton();
    var autoBtn = doc.getElementById('btnAuto');
    if (autoBtn) autoBtn.addEventListener('click', function () {
      sound.resume();
      setAutoAtk(!autoAtk);
    });

    global.addEventListener('keydown', function (ev) {
      var k = keyName(ev);
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0) ev.preventDefault();
      if (keys[k]) return;
      keys[k] = true;
      sound.resume();

      /* ---- 登录页：Esc 可关掉更新日志等面板 ---- */
      if (ui.screen === 'login') {
        if (k === 'escape' && ui.isPanelOpen()) ui.closeAllPanels();
        return;
      }

      /* ---- 藏身处：走动 + 交互 + 功能按钮 ---- */
      if (ui.screen === 'hideout') {
        if (k === 'f' || k === ' ') { ui.interactHideout(); return; }
        if (k === 'b') { ui.togglePanel('bag'); return; }
        if (k === 'p') { ui.togglePanel('portal'); return; }
        if (k === 'v') { ui.togglePanel('record'); return; }
        if (k === 'h') { ui.togglePanel('help'); return; }
        if (k === 'escape' && ui.isPanelOpen()) { ui.closeAllPanels(); return; }
        return;
      }

      /* ---- 副本内 ---- */
      if (running && !paused) {
        if (k === 'q') input.quake = true;
        if (k === 'e') input.bless = true;
        if (k === '1') input.use = true;
        if (k === ' ' || k === 'shift') input.dash = true;
      }
      if (k === 'r' && ui.screen === 'game') setAutoAtk(!autoAtk);
      if (k === 'escape' && running && !ui.isResultOpen()) togglePause();
      if (k === 'm') sound.setVolume(sound.volume > 0 ? 0 : 0.32);
    });
    global.addEventListener('keyup', function (ev) { keys[keyName(ev)] = false; });
    global.addEventListener('blur', function () {
      keys = {}; input.attack = false;
      if (running && !paused && world && !world.dead && !ui.isResultOpen()) togglePause(true);
    });
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden && running && !paused && world && !world.dead && !ui.isResultOpen()) togglePause(true);
    });

    canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    canvas.addEventListener('mousemove', function (ev) {
      var rect = canvas.getBoundingClientRect();
      input.mouseX = ev.clientX - rect.left;
      input.mouseY = ev.clientY - rect.top;
      input.hasMouse = true;
    });
    canvas.addEventListener('mousedown', function (ev) {
      if (touchUi) return;
      sound.resume();
      if (ev.button === 0) input.attack = true;
    });
    global.addEventListener('mouseup', function (ev) {
      if (ev.button === 0 && !touchUi) input.attack = false;
    });

    /* 没有摇杆的设备仍用「拖动移动、点按攻击」。手机改走摇杆和技能钮。 */
    if (!touchUi) {
      canvas.addEventListener('touchstart', function (ev) {
        sound.resume();
        input.attack = true;
        var t = ev.touches[0];
        if (t) {
          var rect = canvas.getBoundingClientRect();
          input.mouseX = t.clientX - rect.left; input.mouseY = t.clientY - rect.top;
          input.hasMouse = true;
        }
        ev.preventDefault();
      }, { passive: false });
      canvas.addEventListener('touchmove', function (ev) {
        var t = ev.touches[0], rect = canvas.getBoundingClientRect();
        if (!t) return;
        var dx = (t.clientX - rect.left) - input.mouseX;
        var dy = (t.clientY - rect.top) - input.mouseY;
        var l = SP.len(dx, dy) || 1;
        input.mx = SP.clamp(dx / l * Math.min(1, l / 40), -1, 1);
        input.my = SP.clamp(dy / l * Math.min(1, l / 40), -1, 1);
        input.mouseX = t.clientX - rect.left;
        input.mouseY = t.clientY - rect.top;
        ev.preventDefault();
      }, { passive: false });
      canvas.addEventListener('touchend', function () { input.attack = false; input.mx = 0; input.my = 0; });
    }

    /* 藏身处：点击场景里的 NPC 就走过去并打开他的界面。手机点地面也会走过去。 */
    function pointHideout(clientX, clientY) {
      if (!ui.hideout || ui.isPanelOpen() || ui.screen !== 'hideout') return;
      var rect = hideCanvas.getBoundingClientRect();
      var h = ui.hideout;
      var cx = clientX - rect.left, cy = clientY - rect.top;
      var wx = cx - hideCanvas.clientWidth / 2 + (h.width / 2 + h.camera.x);
      var wy = cy - hideCanvas.clientHeight / 2 + (h.height / 2 + h.camera.y);
      if (h.clickAt(wx, wy) && h.nearby) {
        var npc = h.nearby;
        if (SP.dist(h.player.x, h.player.y, npc.x, npc.y) <= npc.r + SP.HIDEOUT_INTERACT_RANGE) {
          ui.openPanel(npc.panel);
        } else {
          hideoutTarget = { x: npc.x, y: npc.y, npcKey: npc.key };
        }
      } else if (touchUi) {
        hideoutTarget = { x: wx, y: wy, npcKey: null };
      }
    }
    hideCanvas.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0) return;
      sound.resume();
      pointHideout(ev.clientX, ev.clientY);
    });
    var tap = null;
    hideCanvas.addEventListener('touchstart', function (ev) {
      var t = ev.changedTouches[0];
      if (t) tap = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    hideCanvas.addEventListener('touchend', function (ev) {
      var t = ev.changedTouches[0];
      if (!t || !tap) return;
      var moved = Math.hypot(t.clientX - tap.x, t.clientY - tap.y);
      tap = null;
      if (moved > 18) return;
      sound.resume();
      pointHideout(t.clientX, t.clientY);
      ev.preventDefault();
    }, { passive: false });

    global.addEventListener('resize', function () {
      if (renderer) renderer.resize();
      if (hideRenderer) hideRenderer.resize();
    });
  }

  /** 藏身处输入：WASD 优先，其次是「点击 NPC 后自动走近」 */
  function readHideoutInput() {
    var mx = 0, my = 0;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (mx || my) { hideoutTarget = null; return { mx: mx, my: my }; }
    if (stick.active) { hideoutTarget = null; return { mx: stick.x, my: stick.y }; }
    if (hideoutTarget && ui.hideout) {
      var h = ui.hideout;
      var dx = hideoutTarget.x - h.player.x;
      var dy = hideoutTarget.y - h.player.y;
      var d = SP.len(dx, dy);
      if (d < 30) {
        // 走到了就打开对应界面
        var npc = hideoutTarget.npcKey ? h.npcByKey(hideoutTarget.npcKey) : null;
        var key = hideoutTarget.npcKey;
        hideoutTarget = null;
        if (npc && key && SP.dist(h.player.x, h.player.y, npc.x, npc.y) <= npc.r + SP.HIDEOUT_INTERACT_RANGE) {
          ui.openPanel(npc.panel);
        }
        return { mx: 0, my: 0 };
      }
      return { mx: dx / d, my: dy / d };
    }
    return { mx: 0, my: 0 };
  }

  function readAutoPref() {
    var v = null;
    try { v = global.localStorage.getItem(AUTO_KEY); } catch (e) {}
    if (v === '1') return true;
    if (v === '0') return false;
    return touchUi;
  }

  function applyAutoButton() {
    var btn = doc.getElementById('btnAuto');
    if (!btn) return;
    btn.classList.toggle('on', autoAtk);
    btn.setAttribute('aria-pressed', autoAtk ? 'true' : 'false');
  }

  function setAutoAtk(on) {
    autoAtk = !!on;
    try { global.localStorage.setItem(AUTO_KEY, autoAtk ? '1' : '0'); } catch (e) {}
    applyAutoButton();
  }

  function readInput() {
    var mx = 0, my = 0;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (stick.active) { mx = stick.x; my = stick.y; }
    else if (input.mx || input.my) { mx += input.mx; my += input.my; }
    input.mx = 0; input.my = 0;

    if (input.hasMouse && renderer && world) {
      var wx = input.mouseX - renderer.w / 2 + world.camera.x;
      var wy = input.mouseY - renderer.h / 2 + world.camera.y;
      input.aimAngle = Math.atan2(wy - world.player.y, wx - world.player.x);
    }
    /* 自动攻击：较大半径内锁最近怪用于转向；进入刀长后才挥砍并瞬间对准。 */
    autoLock = false;
    autoAim = false;
    if (autoAtk && world && world.player) {
      var pick = SP.pickAutoTarget(world, world.player);
      if (pick) {
        var tgt = pick.enemy;
        input.aimAngle = Math.atan2(tgt.y - world.player.y, tgt.x - world.player.x);
        autoAim = true;
        autoLock = !!pick.inSwing;
      }
    }
    var out = {
      mx: SP.clamp(mx, -1, 1), my: SP.clamp(my, -1, 1),
      aimAngle: (autoAim || input.hasMouse) ? input.aimAngle : undefined,
      aimSnap: autoLock,
      attack: input.attack || autoLock,
      quake: input.quake, bless: input.bless, use: input.use, dash: input.dash,
      viewW: renderer ? renderer.w : 0, viewH: renderer ? renderer.h : 0
    };
    input.quake = input.bless = input.use = input.dash = false;
    return out;
  }

  /* ------------------------------------------------------------ 演示 AI（仅开发用） */
  function demoInput() {
    var p = world.player;
    var inp = {
      mx: 0, my: 0, attack: true, aimAngle: p.facing,
      viewW: renderer ? renderer.w : 0, viewH: renderer ? renderer.h : 0
    };
    var best = null, bd = Infinity, alive = 0;
    for (var i = 0; i < world.enemies.length; i++) {
      var e = world.enemies[i];
      if (e.dying > 0) continue;
      alive++;
      var d = SP.dist(p.x, p.y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      var dd = Math.max(1, bd);
      var ux = (best.x - p.x) / dd, uy = (best.y - p.y) / dd;
      inp.aimAngle = Math.atan2(best.y - p.y, best.x - p.x);
      if (dd > 80) { inp.mx = ux; inp.my = uy; }
      else { inp.mx = -uy * 0.7; inp.my = ux * 0.7; }
      if (alive >= 4 && p.quakeCd <= 0) inp.quake = true;
      if (dd > 240 && p.dashCd <= 0) inp.dash = true;
    } else {
      var ax = -p.x, ay = -p.y, al = SP.len(ax, ay) || 1;
      if (al > 60) { inp.mx = ax / al; inp.my = ay / al; }
    }
    if (p.hp / p.maxHp < 0.55 && p.blessCd <= 0) inp.bless = true;
    if (p.hp / p.maxHp < 0.45 && p.useCd <= 0 && world.steaks > 0) inp.use = true;
    return inp;
  }

  /* -------------------------------------------------------------- 事件反馈 */
  function consumeEvents() {
    var evts = world.drainEvents();
    for (var i = 0; i < evts.length; i++) {
      var e = evts[i];
      switch (e.type) {
        case 'attack': sound.play('attack'); break;
        case 'kill':
          sound.play(e.data && e.data.boss ? 'bossdown' : (e.data && e.data.elite ? 'crit' : 'kill'));
          break;
        case 'hurt': sound.play('hurt'); break;
        case 'quake': sound.play('quake'); break;
        case 'bless': sound.play('bless'); break;
        case 'dash': sound.play('spit'); break;
        case 'steak': sound.play('steak'); break;
        case 'pickup':
          if (e.data.kind === 'coin') sound.play('coin');
          else if (e.data.kind === 'alpha') sound.play('stone');
          else if (e.data.kind === 'item') sound.play('stone');
          else if (e.data.kind === 'steak') sound.play('steak');
          break;
        case 'loot': ui.pushLoot(e.data.item); break;
        case 'levelup':
          sound.play('levelup');
          ui.banner('等级提升 Lv.' + e.data.level, '#a8f0ff');
          break;
        case 'spit': sound.play('spit'); break;
        case 'summon': sound.play('summon'); break;
        case 'volley': sound.play('summon'); break;
        case 'boss_wave':
          sound.play('boss');
          ui.banner('关底首领 · ' + e.data.name, '#ff9c5b');
          break;
        case 'clear':
          sound.play('bossdown');
          finishRun(true);
          break;
        case 'death':
          sound.play('death');
          finishRun(false);
          break;
      }
    }
  }

  /* ---------------------------------------------------------------- 流程 */
  function startRun(biome, floor) {
    var rec = SP.Accounts.current;
    if (!rec) return;
    var ch = rec.character;
    world = new SP.World({
      seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
      character: ch,
      dungeon: { biome: biome, floor: floor },
      steaks: Math.min(ch.steaks, 5)
    });
    // 带走本轮携带的牛排
    ch.steaks = Math.max(0, ch.steaks - Math.min(ch.steaks, 5));
    SP.Accounts.persist();

    runBanked = false;
    lastSummary = null;
    ui.resetHud();
    ui.setHudName(rec.name, world.biome.name, world.floor);
    ui.hideResult();
    ui.showPause(false);
    ui.showGame();
    renderer.resize();
    paused = false;
    running = true;
    input.attack = false; input.quake = false; input.bless = false; input.use = false; input.dash = false;
    autoLock = false;
    autoAim = false;
  }

  /** 一局结束（通关或阵亡）：结算入账，只执行一次 */
  function finishRun(cleared) {
    if (runBanked || !world) return;
    runBanked = true;
    var summary = world.summary();
    summary.cleared = !!cleared;
    var bank = P.bankRun(SP.Accounts.current.character, summary);
    SP.Accounts.persist();
    lastSummary = { summary: summary, bank: bank, biome: world.biomeKey, floor: world.floor };
    ui.showResult(summary, !!cleared);
  }

  function togglePause(force) {
    if (!running || !world || world.dead || ui.isResultOpen()) return;
    paused = force === undefined ? !paused : !!force;
    ui.showPause(paused);
  }

  function backToHub() {
    running = false;
    world = null;
    hideoutTarget = null;
    ui.hideResult();
    ui.showPause(false);
    ui.enterHideout();
  }

  function loop(now) {
    global.requestAnimationFrame(loop);
    if (!renderer) return;

    var dtMs = lastT ? now - lastT : 16;
    lastT = now;
    pingSmooth = SP.lerp(pingSmooth, dtMs, 0.06);
    ui.setPing(Math.round(pingSmooth));

    var dt = Math.min(0.033, Math.max(0.0005, dtMs / 1000));

    /* ---- 藏身处：走动的安全区，面板打开时冻结移动 ---- */
    if (ui.screen === 'hideout') {
      ui.tickHideout(dt, ui.isPanelOpen() ? { mx: 0, my: 0 } : readHideoutInput());
      ui.drawHideout(hideRenderer);
      return;
    }

    if (ui.screen !== 'game' || !world) return;
    // 结果面板打开时冻结战斗，但保留画面
    var blocked = paused || ui.isResultOpen();

    if (running && !world.dead && !world.cleared && !blocked) {
      world.update(dt, demo ? demoInput() : readInput());
      consumeEvents();
    } else {
      world.updateVisuals(dt);
      if (running && (world.dead || world.cleared)) consumeEvents();
    }
    renderer.draw(world, { autoAtk: autoAtk, autoAim: autoAim, autoLock: autoLock });
    ui.updateHUD(world);
  }

  /* ------------------------------------------------------------------ 启动 */
  function boot() {
    renderer = new SP.Renderer(doc.getElementById('game'));
    hideRenderer = new SP.Renderer(doc.getElementById('hideoutCanvas'));
    bindInput();

    ui.init({
      onEnterDungeon: function (biome, floor) { startRun(biome, floor); },
      onScreen: function (name) {
        // 切屏时让对应画布跟上实际尺寸
        if (name === 'hideout' && hideRenderer) hideRenderer.resize();
        if (name === 'game' && renderer) renderer.resize();
      },
      onResume: function () { togglePause(false); },
      onPauseToggle: function () { togglePause(); },
      onQuit: function () {
        // 主动放弃本轮：已拾取的战利品与收益照常入账
        if (world && !runBanked) finishRun(false);
        backToHub();
      },
      onDeeper: function () {
        var b = lastSummary ? lastSummary.biome : 'camp';
        var f = lastSummary ? lastSummary.floor : 1;
        startRun(b, f + 1);
      },
      onRetry: function () {
        var b = lastSummary ? lastSummary.biome : 'camp';
        var f = lastSummary ? lastSummary.floor : 1;
        startRun(b, f);
      },
      onBackHub: function () { backToHub(); }
    });
    ui.sound = sound;

    ['click', 'keydown', 'touchstart'].forEach(function (evt) {
      global.addEventListener(evt, function once() {
        sound.resume();
        ['click', 'keydown', 'touchstart'].forEach(function (e2) { global.removeEventListener(e2, once); });
      });
    });

    ui.showLogin();
    global.requestAnimationFrame(loop);

    /* 开发用直达钩子：仅通过显式 #dev-xxx 触发，用于截图与自测。
       普通打开则恢复上次登录的账号，不用再输密码。 */
    var hash = (global.location.hash || '').replace(/^#/, '');
    if (hash.indexOf('dev-') !== 0 && SP.Accounts.restore()) ui.enterHideout();
    if (hash.indexOf('dev-') === 0) {
      SP.Accounts.guest();
      var simMatch = /^dev-sim(\d+)$/.exec(hash);

      /** 给测试角色配一身与层级相称的装备，避免一级小号被丢进终局副本 */
      function devGear(ch, ilvl, level) {
        var rng = SP.makeRng(31337);
        ['weapon', 'helm', 'armor', 'boots', 'amulet', 'ring', 'ring'].forEach(function (s) {
          I_equipInto(ch, I_roll(rng, { ilvl: ilvl, slot: s, rarityBias: 1.7 }));
        });
        ch.level = level;
        ch.coins = 4200; ch.stones = 48;
        ch.materials.up = 180; ch.materials.re = 55; ch.steaks = 5;
      }

      if (hash.indexOf('dev-hub') === 0) {
        var hubCh = SP.Accounts.current.character;
        devGear(hubCh, 26, 26);
        // 背包里放几件不同品质的装备，便于核对背包与悬浮提示
        var hubRng = SP.makeRng(9001);
        for (var hi = 0; hi < 14; hi++) {
          hubCh.inventory.push(I_roll(hubRng, {
            ilvl: 20 + hi * 2,
            slot: I.DROP_SLOTS[hi % I.DROP_SLOTS.length],
            rarityBias: hi * 0.16
          }));
        }
        ui.enterHub();
        // 支持 #dev-hub:bag / :forge / :shop / :portal 直接打开某个面板（截图用）
        var sub = hash.split(':')[1];
        if (sub) {
          if (sub === 'forge') ui.selUid = hubCh.equipped.weapon ? hubCh.equipped.weapon.uid : null;
          ui.openPanel(sub);
        }
      } else if (hash === 'dev-loot') {
        // 造一身装备与一批战利品，直接弹出通关结算，用于核对结算界面
        ui.enterHub();
        var ch = SP.Accounts.current.character;
        devGear(ch, 26, 26);
        ui.renderHub();
        startRun('forest', 4);
        demo = false;
        var rng2 = SP.makeRng(4242);
        for (var li = 0; li < 9; li++) {
          world.loot.push(I_roll(rng2, { ilvl: 22 + li, rarityBias: li * 0.22 }));
        }
        world.time = 128.4; world.kills = 62; world.coins = 318;
        world.stones = 4; world.upStones = 11; world.reStones = 3;
        world.cleared = true;
        finishRun(true);
      } else if (hash === 'dev-bestiary') {
        ui.enterHub();
        devGear(SP.Accounts.current.character, 20, 20);
        startRun('nest', 2);
        demo = false;
        world.killsNeeded = 9999;
        world.enemies.length = 0;
        ['calf', 'sporeling', 'crawler', 'broodling'].forEach(function (k, i) {
          var e = world.spawnEnemy(k);
          e.x = world.player.x - 330 + i * 220; e.y = world.player.y - 100; e.spawnT = 0;
          e.hp = e.maxHp * 0.6;
        });
        var boss = world.spawnEnemy('queen', { elite: true });
        boss.x = world.player.x + 250; boss.y = world.player.y + 140; boss.spawnT = 0;
        world.player.invuln = 9999;
      } else if (simMatch) {
        var ch2 = SP.Accounts.current.character;
        devGear(ch2, 24, 24);
        ui.enterHub();
        startRun('nest', 2);
        var steps = Math.min(60 * 900, parseInt(simMatch[1], 10) * 60);
        for (var i = 0; i < steps && !world.dead && !world.cleared; i++) {
          world.update(1 / 60, demoInput());
          world.drainEvents();
        }
      } else {
        devGear(SP.Accounts.current.character, 18, 18);
        ui.enterHub();
        startRun('cave', 2);
        demo = hash !== 'dev-over';
        if (hash === 'dev-over') {
          world.time = 96.5; world.kills = 41;
          world.hurtPlayer(1e9, 0, 0);
          consumeEvents();
        }
      }
    }
  }

  // 供开发钩子使用的小包装（避免在钩子里写太长）
  function I_roll(rng, opts) { return SP.Items.roll(rng, opts); }
  function I_equipInto(ch, it) { return SP.Items.equipInto(ch, it); }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  SP.__game = {
    getWorld: function () { return world; },
    startRun: startRun,
    ui: ui,
    sound: sound,
    renderer: function () { return renderer; },
    finishRun: finishRun
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
