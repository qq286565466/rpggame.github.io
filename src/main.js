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
    weaponSkill: false,
    aimAngle: 0, hasMouse: false, mouseX: 0, mouseY: 0
  };
  var keys = {};
  var stick = { active: false, x: 0, y: 0, id: null };
  var touchUi = false;
  var autoAtk = false;
  var autoLock = false;   // 已进入刀长，正在自动挥砍
  var autoAim = false;    // 已锁定附近敌人（可能尚在刀长外，仅转向）
  var AUTO_KEY = 'spm_auto_atk';

  /* 联机：大厅现身 + 房主权威组队副本 */
  var online = null;
  var onlineRole = null;      // 'host' | 'guest' | null
  var onlineHostId = null;
  var remoteInputs = {};      // guestId -> 最新输入（房主用）
  var snapAcc = 0;
  var inputAcc = 0;
  var awaitingOnlineStart = false;
  var guestPend = null;       // 客机合并的待发送输入（保住一次性按键）

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
    pulse('slotWeapon', 'weaponSkill');
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

    /* 焦点在输入控件 / 按钮上时，方向键与空格是这一控件的键盘操作
       （传送门层数滑块、面板里的按钮），游戏不能抢走。 */
    function isUiFocus(ev) {
      var t = ev.target;
      if (!t || t === doc.body || t === doc.documentElement) return false;
      var tag = (t.tagName || '').toUpperCase();
      return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' ||
        tag === 'A' || !!t.isContentEditable;
    }

    global.addEventListener('keydown', function (ev) {
      var k = keyName(ev);
      var uiFocus = isUiFocus(ev);
      if (!uiFocus &&
        ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0) {
        ev.preventDefault();
      }
      if (keys[k]) return;
      keys[k] = true;
      sound.resume();

      /* 焦点在控件里：让浏览器完成它的默认行为，不当作游戏按键 */
      if (uiFocus && k !== 'escape') return;

      /* ---- 登录页：Esc 可关掉更新日志等面板 ---- */
      if (ui.screen === 'login') {
        if (k === 'escape' && ui.isPanelOpen()) ui.closeAllPanels();
        return;
      }

      /* ---- 藏身处：走动 + 交互 + 功能按钮 ---- */
      if (ui.screen === 'hideout') {
        /* 面板打开时 F / 空格不再触发场景交互：否则站在铁匠旁按空格，
           会把当前面板直接换成铁匠铺（面板在玩家眼皮底下被替换） */
        if (k === 'f' || k === ' ') {
          if (!ui.isPanelOpen()) ui.interactHideout();
          return;
        }
        if (k === 'b') { ui.togglePanel('bag'); return; }
        if (k === 'p') { ui.togglePanel('portal'); return; }
        if (k === 'v') { ui.togglePanel('record'); return; }
        if (k === 'g') { ui.togglePanel('bestiary'); return; }
        if (k === 'h') { ui.togglePanel('help'); return; }
        if (k === 'escape' && ui.isPanelOpen()) { ui.closeAllPanels(); return; }
        return;
      }

      /* ---- 副本内 ---- */
      if (running && !paused) {
        if (k === 'q') input.quake = true;
        if (k === 'e') input.bless = true;
        if (k === '1') input.use = true;
        if (k === '2') input.weaponSkill = true;
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
      weaponSkill: input.weaponSkill,
      viewW: renderer ? renderer.w : 0, viewH: renderer ? renderer.h : 0
    };
    input.quake = input.bless = input.use = input.dash = false;
    input.weaponSkill = false;
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
        case 'domain': sound.play('quake'); break;
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
          ui.banner('关底首领 · ' + e.data.name, '#ff9c5b', e.data.boss);
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

  /* ---------------------------------------------------------------- 联机 */
  function refreshOnlineUi() {
    if (ui.activePanel === 'online') ui.renderOnline();
    if (ui.activePanel === 'portal') ui.renderPortal();
  }

  function syncHideoutRemotes() {
    if (!ui.hideout || !online) return;
    ui.hideout.syncRemotes(online.peerList(), online.id);
  }

  function pushCharSync() {
    var rec = SP.Accounts.current;
    if (!online || !online.connected || !rec) return;
    online.syncCharacter(rec.name, rec.character);
  }

  function wireOnline(client) {
    online = client;
    online.on('welcome', function () {
      var rtt = online.rttMs != null ? (' · ' + online.rttMs + 'ms') : '';
      ui.setOnlineStatus('已接入 · ' + (online.id || '') + rtt, true);
      pushCharSync();
      syncHideoutRemotes();
      refreshOnlineUi();
      ui.flash('已加入服务器', true);
    });
    online.on('pong', function () {
      if (!online || !online.connected) return;
      var rtt = online.rttMs != null ? (' · ' + online.rttMs + 'ms') : '';
      ui.setOnlineStatus('已接入 · ' + (online.id || '') + rtt, true);
    });
    online.on('reconnecting', function (info) {
      ui.setOnlineStatus('重连中… (' + (info && info.attempt || '?') + ')', false);
    });
    online.on('close', function () {
      if (online && online._wantConnect) return; // 自动重连中
      ui.setOnlineStatus('离线', false);
      onlineRole = null;
      onlineHostId = null;
      remoteInputs = {};
      awaitingOnlineStart = false;
      if (ui.hideout) ui.hideout.syncRemotes([], null);
      refreshOnlineUi();
    });
    online.on('error', function (e) {
      if (!(online && online._wantConnect)) ui.setOnlineStatus('连接失败', false);
      ui.flash((e && e.reason) || '无法加入服务器');
    });
    online.on('peers', function () { syncHideoutRemotes(); refreshOnlineUi(); });
    online.on('peer_join', function () { syncHideoutRemotes(); refreshOnlineUi(); });
    online.on('peer_leave', function () { syncHideoutRemotes(); refreshOnlineUi(); });
    online.on('hub_pos', function (msg) {
      if (ui.hideout && ui.hideout.applyRemotePos) ui.hideout.applyRemotePos(msg);
    });
    online.on('party', function () {
      pushCharSync();
      refreshOnlineUi();
    });
    online.on('invite', function (msg) {
      var ok = global.confirm && global.confirm(
        (msg.fromName || '旅人') + ' 邀请你组队，是否加入？'
      );
      if (ok) online.acceptInvite(msg.partyId);
      else online.pendingInvite = null;
    });
    online.on('toast', function (msg) {
      if (msg && msg.text) ui.flash(msg.text, true);
    });
    online.on('dungeon_start', function (msg) { beginOnlineDungeon(msg); });
    online.on('dungeon_input', function (msg) {
      if (onlineRole !== 'host' || !msg || !msg.fromId) return;
      remoteInputs[msg.fromId] = msg.input || {};
    });
    online.on('dungeon_snap', function (msg) {
      if (onlineRole !== 'guest' || !world || !msg || !msg.snap) return;
      world.applySnapshot(msg.snap, { softLocal: true });
      if (world.cleared && !runBanked) finishRun(true);
      else if (world.dead && !runBanked) finishRun(false);
    });
    online.on('dungeon_end', function (msg) {
      if (onlineRole !== 'guest') return;
      var cleared = !!(msg && msg.result && msg.result.cleared);
      if (world && !runBanked) finishRun(cleared);
      onlineRole = null;
      onlineHostId = null;
    });
  }

  function connectOnline(url) {
    if (!SP.OnlineClient) {
      ui.flash('联机模块未加载');
      return;
    }
    var rec = SP.Accounts.current;
    if (!rec) {
      ui.flash('请先登录');
      return;
    }
    var wsUrl = SP.OnlineClient.normalizeWsUrl(
      (url && String(url).trim()) || SP.OnlineClient.defaultWsUrl()
    );
    var urlInp = doc.getElementById('onlineUrl');
    if (urlInp) urlInp.value = wsUrl;
    if (online && online.url === wsUrl && online.connected) {
      ui.flash('已在该服务器中', true);
      return;
    }
    if (online) {
      try { online.disconnect(); } catch (e) { /* ignore */ }
    }
    var client = new SP.OnlineClient({ url: wsUrl, autoReconnect: true });
    wireOnline(client);
    ui.setOnlineStatus('连接中…', false);
    var h = ui.hideout;
    client.connect({
      name: rec.name,
      level: rec.character.level,
      x: h ? h.player.x : 1100,
      y: h ? h.player.y : 900,
      facing: h ? h.player.facing : -Math.PI / 2
    });
  }

  function disconnectOnline() {
    if (online) online.disconnect();
    online = null;
    onlineRole = null;
    onlineHostId = null;
    remoteInputs = {};
    awaitingOnlineStart = false;
    ui.setOnlineStatus('离线', false);
    if (ui.hideout) ui.hideout.syncRemotes([], null);
    refreshOnlineUi();
  }

  function requestOnlineDungeon(biome, floor) {
    if (!online || !online.connected) return false;
    var rec = SP.Accounts.current;
    if (!rec) return false;
    var inParty = online.party && online.party.members && online.party.members.length > 1;
    if (inParty && online.party.leaderId !== online.id) {
      ui.flash('等待队长发车');
      return true;
    }
    pushCharSync();
    var seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    var roster = [{
      id: online.id,
      name: rec.name,
      character: SP.OnlineClient.packCharacter(rec.character)
    }];
    awaitingOnlineStart = true;
    online.startDungeon({ biome: biome, floor: floor, seed: seed, roster: roster });
    return true;
  }

  function beginOnlineDungeon(msg) {
    var rec = SP.Accounts.current;
    if (!rec || !msg) return;
    awaitingOnlineStart = false;
    onlineHostId = msg.hostId;
    onlineRole = (msg.hostId === online.id) ? 'host' : 'guest';
    remoteInputs = {};
    guestPend = null;
    snapAcc = 0;
    inputAcc = 0;

    var roster = (msg.roster || []).map(function (slot) {
      var ch = slot.character || { level: 1, equipped: {}, steaks: 3 };
      // 本地玩家用完整存档（含材料进度），同伴用同步包
      if (slot.id === online.id) {
        ch = rec.character;
      }
      return { id: slot.id, name: slot.name || '旅人', character: ch };
    });

    var ch = rec.character;
    var carry = Math.min(ch.steaks, 5);
    world = new SP.World({
      seed: msg.seed >>> 0,
      character: ch,
      name: rec.name,
      localId: online.id,
      party: roster,
      dungeon: { biome: msg.biome, floor: msg.floor },
      steaks: carry
    });
    ch.steaks = Math.max(0, ch.steaks - carry);
    SP.Accounts.persist();

    runBanked = false;
    lastSummary = null;
    ui.resetHud();
    ui.setHudName(rec.name, world.biome.name, world.floor);
    ui.hideResult();
    ui.showPause(false);
    ui.closeAllPanels();
    ui.showGame();
    renderer.resize();
    paused = false;
    running = true;
    input.attack = false; input.quake = false; input.bless = false; input.use = false; input.dash = false;
    input.weaponSkill = false;
    autoLock = false;
    autoAim = false;
    ui.banner(
      onlineRole === 'host'
        ? (roster.length > 1 ? '组队出发 · 你是房主' : '联机单刷')
        : '组队出发 · 跟随房主',
      '#9dffb0'
    );
  }

  /* ---------------------------------------------------------------- 流程 */
  function startRun(biome, floor) {
    if (online && online.connected) {
      if (requestOnlineDungeon(biome, floor)) return;
    }
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
    input.weaponSkill = false;
    autoLock = false;
    autoAim = false;
    onlineRole = null;
    onlineHostId = null;
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
    if (online && online.connected && onlineRole === 'host') {
      online.sendDungeonEnd({ cleared: !!cleared, biome: world.biomeKey, floor: world.floor });
    }
    if (onlineRole) {
      onlineRole = null;
      onlineHostId = null;
      remoteInputs = {};
    }
  }

  function togglePause(force) {
    if (!running || !world || world.dead || ui.isResultOpen()) return;
    // 组队副本：仅房主可暂停本地模拟；客机跟随快照，不单独暂停权威
    if (onlineRole === 'guest') return;
    paused = force === undefined ? !paused : !!force;
    ui.showPause(paused);
  }

  function backToHub() {
    if (online && online.connected && onlineRole === 'host' && world && !runBanked) {
      online.sendDungeonEnd({ cleared: false, quit: true });
    }
    running = false;
    world = null;
    hideoutTarget = null;
    onlineRole = null;
    onlineHostId = null;
    remoteInputs = {};
    awaitingOnlineStart = false;
    ui.hideResult();
    ui.showPause(false);
    ui.enterHideout();
    syncHideoutRemotes();
    pushCharSync();
  }

  function packNetInput(inp) {
    return {
      mx: inp.mx || 0, my: inp.my || 0,
      aimAngle: inp.aimAngle, aimSnap: !!inp.aimSnap,
      attack: !!inp.attack, quake: !!inp.quake, bless: !!inp.bless,
      use: !!inp.use, dash: !!inp.dash, weaponSkill: !!inp.weaponSkill,
      viewW: inp.viewW || 0, viewH: inp.viewH || 0
    };
  }

  /** 合并客机输入：移动取最新，一次性技能按键做 OR，避免发送间隔丢键 */
  function mergeGuestInput(dst, src) {
    if (!dst) {
      return {
        mx: src.mx || 0, my: src.my || 0,
        aimAngle: src.aimAngle, aimSnap: !!src.aimSnap,
        attack: !!src.attack, quake: !!src.quake, bless: !!src.bless,
        use: !!src.use, dash: !!src.dash, weaponSkill: !!src.weaponSkill,
        viewW: src.viewW || 0, viewH: src.viewH || 0
      };
    }
    dst.mx = src.mx || 0; dst.my = src.my || 0;
    if (src.aimAngle !== undefined) dst.aimAngle = src.aimAngle;
    dst.aimSnap = !!(dst.aimSnap || src.aimSnap);
    dst.attack = !!(dst.attack || src.attack);
    dst.quake = !!(dst.quake || src.quake);
    dst.bless = !!(dst.bless || src.bless);
    dst.use = !!(dst.use || src.use);
    dst.dash = !!(dst.dash || src.dash);
    dst.weaponSkill = !!(dst.weaponSkill || src.weaponSkill);
    dst.viewW = src.viewW || dst.viewW; dst.viewH = src.viewH || dst.viewH;
    return dst;
  }

  /** 房主消费同伴一次性按键后清掉，避免每帧重复释放 */
  function consumeRemoteOneShots() {
    Object.keys(remoteInputs).forEach(function (id) {
      var inp = remoteInputs[id];
      if (!inp) return;
      inp.quake = false; inp.bless = false; inp.use = false;
      inp.dash = false; inp.weaponSkill = false;
      // attack 可按住，保留到下次更新
    });
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
      if (online && online.connected) {
        var rec = SP.Accounts.current;
        online.tickHub(dt, ui.hideout, rec && rec.character);
      }
      ui.drawHideout(hideRenderer);
      return;
    }

    if (ui.screen !== 'game' || !world) return;
    // 结果面板打开时冻结战斗，但保留画面
    var blocked = paused || ui.isResultOpen();

    if (running && !world.dead && !world.cleared && !blocked) {
      var localInp = demo ? demoInput() : readInput();
      if (onlineRole === 'guest') {
        guestPend = mergeGuestInput(guestPend, localInp);
        inputAcc += dt;
        if (inputAcc >= 0.033) {
          inputAcc = 0;
          online.sendDungeonInput(packNetInput(guestPend || localInp));
          guestPend = null;
        }
        // 本地预测移动 + 插值他人/敌人，消除「一顿一顿」
        world.predictLocalMove(dt, localInp);
        world.tickNetInterp(dt);
        world.updateVisuals(dt);
      } else if (onlineRole === 'host' && world.players.length > 1) {
        var multi = { __multi: true };
        multi[online.id] = localInp;
        Object.keys(remoteInputs).forEach(function (id) {
          multi[id] = remoteInputs[id] || {};
        });
        world.update(dt, multi);
        consumeRemoteOneShots();
        consumeEvents();
        snapAcc += dt;
        if (snapAcc >= 0.05) {
          snapAcc = 0;
          online.sendDungeonSnap(world.snapshot());
        }
      } else {
        world.update(dt, localInp);
        consumeEvents();
        if (onlineRole === 'host') {
          snapAcc += dt;
          if (snapAcc >= 0.1) {
            snapAcc = 0;
            online.sendDungeonSnap(world.snapshot());
          }
        }
      }
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
      onBackHub: function () { backToHub(); },
      getOnline: function () { return online; },
      onOnlineConnect: function (url) { connectOnline(url); },
      onOnlineDisconnect: function () { disconnectOnline(); },
      onPartyCreate: function () {
        if (!online || !online.connected) return ui.flash('请先加入服务器（联机 → 加入服务器）');
        pushCharSync();
        online.createParty();
        ui.flash('已创建队伍', true);
      },
      onPartyLeave: function () {
        if (!online || !online.connected) return;
        online.leaveParty();
      },
      onPartyInvite: function (id) {
        if (!online || !online.connected) return;
        online.invite(id);
        ui.flash('已发送邀请', true);
      }
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

      /* 默认让机器人接管操作，画面稳定可复现；#dev-over 需要真实结算所以交还给玩家 */
      demo = hash !== 'dev-over';

      if (hash === 'dev-oath') {
        /* 缚誓远征演示：满套装 + 裁刃，直接进营地 1 层，可按 2 开领域 */
        var oathCh = SP.Accounts.current.character;
        oathCh.level = 22;
        oathCh.coins = 5000; oathCh.stones = 80;
        oathCh.materials.up = 120; oathCh.materials.re = 40; oathCh.steaks = 5;
        var oathRng = SP.makeRng(20261009);
        ['oathblade', 'oathhelm', 'oathplate', 'oathboots', 'oathamulet', 'oathring'].forEach(function (bk) {
          var piece = SP.Items.makeSetPiece(oathRng, 'oath', { ilvl: 22, baseKey: bk });
          if (piece) {
            SP.Items.equipInto(oathCh, piece);
            P.discoverGear(oathCh, piece);
          }
        });
        ui.enterHub();
        startRun('camp', 1);
        demo = false;
        world.player.curseMarks = 5;
        world.player.invuln = 8;
      } else if (hash.indexOf('dev-hub') === 0) {
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
        // 支持 #dev-hub:bag / :forge / :shop / :portal / :bestiary 直接打开某个面板（截图用）
        var sub = hash.split(':')[1];
        if (sub) {
          if (sub === 'forge') ui.selUid = hubCh.equipped.weapon ? hubCh.equipped.weapon.uid : null;
          if (sub === 'bestiary') {
            P.mergeBestiary(hubCh, {
              calf: { kills: 42, elites: 3 },
              charger: { kills: 18, elites: 1 },
              bat: { kills: 11, elites: 0 },
              alpha: { kills: 2, elites: 0 },
              sporeling: { kills: 9, elites: 0 },
              thornbeast: { kills: 4, elites: 1 },
              queen: { kills: 1, elites: 1 }
            });
            // 预填若干装备 / 传说图鉴，便于截图
            var seedRng = SP.makeRng(424242);
            ['sword', 'bow', 'staff', 'flail', 'hood', 'vest', 'plate', 'lightboots', 'amulet', 'coinring'].forEach(function (base, i) {
              var def = I.BASE_BY_KEY[base];
              if (!def) return;
              var it = I.roll(seedRng, { ilvl: 20 + i, slot: def.slot, rarityBias: 1.2 + i * 0.15 });
              it.base = base;
              it.baseName = def.name;
              P.discoverGear(hubCh, it);
            });
            P.discoverGear(hubCh, {
              base: 'bow', rarity: 'legendary', unique: 'multishot', slot: 'weapon', stats: {}
            });
            P.discoverGear(hubCh, {
              base: 'staff', rarity: 'legendary', unique: 'overcharge', slot: 'weapon', stats: {}
            });
            P.discoverGear(hubCh, {
              base: 'amulet', rarity: 'legendary', unique: 'swift', slot: 'amulet', stats: {}
            });
          }
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
    finishRun: finishRun,
    getOnline: function () { return online; },
    connectOnline: connectOnline,
    disconnectOnline: disconnectOnline
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
