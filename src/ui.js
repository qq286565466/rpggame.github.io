/* 时空猪 · ui.js — 账号存档、营地枢纽（角色/背包/铁匠/商店/传送门）、HUD 与结算
 * 说明：账号与角色数据仅存于本机 localStorage，密码只做本地散列，不具备真实安全性。
 */
(function (global) {
  'use strict';
  var SP = global.SP || (global.SP = {});
  var I = SP.Items;
  var P = SP.Progress;
  var doc = global.document;

  var STORE_KEY = 'spm_save_v2';
  var LEGACY_KEY = 'spm_save_v1';
  var SESSION_KEY = 'spm_session';

  /* ============================================================== 账号存档 */
  var Accounts = {
    storage: SP.makeStorage(),
    users: {},
    current: null,

    load: function () {
      try {
        var raw = this.storage.get(STORE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.users) this.users = parsed.users;
        }
      } catch (e) { this.users = {}; }

      // 旧版（生存竞技）存档迁移：保留货币与战绩，换算成材料与新角色
      try {
        var legacyRaw = this.storage.get(LEGACY_KEY);
        if (legacyRaw) {
          var legacy = JSON.parse(legacyRaw);
          if (legacy && legacy.users) {
            Object.keys(legacy.users).forEach(function (k) {
              if (this.users[k]) return; // 已有新版存档则不动
              var old = legacy.users[k];
              var ch = P.migrateV1(old);
              this.users[k] = {
                name: old.name || '时空猪',
                hash: old.hash || '',
                created: old.created || Date.now(),
                guest: false,
                character: ch
              };
            }, this);
            this.save();
          }
        }
      } catch (e) { /* 旧档损坏就忽略 */ }

      // 统一做一次存档校验，避免残缺数据在后面炸开
      var self = this;
      Object.keys(this.users).forEach(function (k) {
        var rec = self.users[k];
        rec.character = P.normalize(rec.character || {});
      });
      return this.users;
    },

    save: function () {
      try { this.storage.set(STORE_KEY, JSON.stringify({ v: 2, users: this.users })); }
      catch (e) { /* 隐私模式等，忽略 */ }
    },

    blank: function (name, hash) {
      return {
        name: name, hash: hash || '', created: Date.now(), guest: false,
        character: (function () {
          var ch = P.newCharacter(name);
          // 起手武器，避免新号赤手空拳
          var starter = I.roll(SP.makeRng(20240501), { ilvl: 1, slot: 'weapon', rarityBias: 1.2 });
          starter.name = '新手·' + starter.baseName;
          ch.equipped.weapon = starter;
          P.discoverGear(ch, starter);
          return ch;
        })()
      };
    },

    register: function (name, pass) {
      var key = name.toLowerCase();
      if (this.users[key]) return { ok: false, msg: '该用户名已被注册。' };
      var rec = this.blank(name, SP.hashPassword(name, pass));
      this.users[key] = rec;
      this.save();
      this.current = rec;
      this.remember(name);
      return { ok: true, rec: rec };
    },

    login: function (name, pass) {
      var rec = this.users[name.toLowerCase()];
      if (!rec) return { ok: false, msg: '账号不存在，请先注册。' };
      if (rec.hash !== SP.hashPassword(name, pass)) return { ok: false, msg: '密码不正确。' };
      rec.character = P.normalize(rec.character);
      this.current = rec;
      this.remember(name);
      return { ok: true, rec: rec };
    },

    guest: function () {
      var rec = this.blank('游客', '');
      rec.guest = true;
      this.current = rec;
      return rec;
    },

    /** 记住上次成功登录的账号名。不保存密码，下次打开网页直接进入藏身处。 */
    remember: function (name) {
      try { this.storage.set(SESSION_KEY, String(name || '').toLowerCase()); }
      catch (e) { /* 隐私模式等，忽略 */ }
    },
    forget: function () {
      try { this.storage.remove(SESSION_KEY); }
      catch (e) { /* 忽略 */ }
    },
    restore: function () {
      var key = this.storage.get(SESSION_KEY);
      if (!key) return false;
      var rec = this.users[String(key).toLowerCase()];
      if (!rec || rec.guest) { this.forget(); return false; }
      rec.character = P.normalize(rec.character);
      this.current = rec;
      return true;
    },

    logout: function () { this.forget(); this.current = null; },
    char: function () { return this.current ? this.current.character : null; },
    persist: function () { if (this.current && !this.current.guest) this.save(); }
  };

  /* ==================================================================== UI */
  function el(tag, cls, html) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function UI() {
    this.sound = null;
    this.hooks = {};
    this.screen = 'login';
    this.authMode = 'login';
    this.t = 0;
    this.toastTimer = 0;
    this.hudCache = {};
    this.lastSlot = {};
    this.selUid = null;       // 当前选中的装备（背包或已装备）
    this.bagFilter = 'all';
    this.bagSort = 'power';
    this.bagCat = 'gear';   // gear 装备 / mat 材料 / use 消耗品
    this.bagPick = null;    // 材料或消耗品格子的 key
    this.floorPick = { camp: 0, forest: 0, cave: 0, nest: 0 };
    this.lootFeed = [];
    this.bestiaryMode = 'monster'; // monster | gear | unique
    this.bestiaryBiome = 'camp';
    this.bestiarySlot = 'weapon';
    this.bestiarySel = null;
  }

  UI.prototype.init = function (hooks) {
    this.hooks = hooks || {};
    var self = this;
    Accounts.load();
    Array.prototype.forEach.call(doc.querySelectorAll('img[data-icon]'), function (img) {
      var url = SP.ItemIcons && SP.ItemIcons.url(img.getAttribute('data-icon'));
      if (url) img.src = url;
    });
    // 统一入口：允许写 '#id' 或 'id'；取不到就立刻抛出带名字的错误，
    // 避免又出现「查询返回 null 然后在别处 undefined 报错」这种难查的问题。
    function $(id) {
      var key = String(id).replace(/^#/, '');
      var node = doc.getElementById(key);
      if (!node) throw new Error('界面元素缺失: #' + key);
      return node;
    }
    this.$ = $;

    /* ---- 登录 / 注册 ---- */
    $('#tabLogin').addEventListener('click', function () { self.setAuthMode('login'); });
    $('#tabReg').addEventListener('click', function () { self.setAuthMode('register'); });
    $('#btnAuth').addEventListener('click', function () { self.submitAuth(); });
    $('#btnGuest').addEventListener('click', function () {
      Accounts.guest();
      self.enterHideout();
      self.flash('游客模式：本轮进度不会保存', true);
    });
    ['inUser', 'inPass'].forEach(function (id) {
      $(id).addEventListener('keydown', function (ev) { if (ev.key === 'Enter') self.submitAuth(); });
    });
    $('#btnLogout').addEventListener('click', function () {
      Accounts.logout();
      self.closeAllPanels();
      self.showLogin();
      self.setMsg('已退出登录。', true);
    });
    $('#btnLoginChangelog').addEventListener('click', function () { self.openPanel('changelog'); });
    $('#btnHelpChangelog').addEventListener('click', function () { self.openPanel('changelog'); });

    /* ---- 藏身处：功能按钮 ---- */
    $('#btnBag').addEventListener('click', function () { self.togglePanel('bag'); });
    $('#btnPortal').addEventListener('click', function () { self.togglePanel('portal'); });
    $('#btnRecord').addEventListener('click', function () { self.togglePanel('record'); });
    $('#btnBestiary').addEventListener('click', function () { self.togglePanel('bestiary'); });
    $('#btnHelp').addEventListener('click', function () { self.togglePanel('help'); });
    Array.prototype.forEach.call(doc.querySelectorAll('#bestiaryMode [data-mode]'), function (btn) {
      btn.addEventListener('click', function () {
        self.bestiaryMode = btn.getAttribute('data-mode') || 'monster';
        self.bestiarySel = null;
        self.renderBestiary();
      });
    });

    /* ---- 面板：关闭按钮 / 点遮罩关闭 ---- */
    Array.prototype.forEach.call(doc.querySelectorAll('[data-close]'), function (btn) {
      btn.addEventListener('click', function () { self.closeAllPanels(); });
    });
    Object.keys(PANEL_IDS).forEach(function (key) {
      var node = doc.getElementById(PANEL_IDS[key]);
      if (!node) return;
      node.addEventListener('mousedown', function (ev) {
        if (ev.target === node) self.closeAllPanels(); // 只认点遮罩本身
      });
    });

    /* ---- 背包工具 ---- */
    Array.prototype.forEach.call(doc.querySelectorAll('#bagTabs .bag-tab'), function (btn) {
      btn.addEventListener('click', function () {
        self.bagCat = btn.getAttribute('data-cat') || 'gear';
        self.bagPick = null;
        self.renderBag();
      });
    });
    $('#bagFilter').addEventListener('change', function () { self.bagFilter = this.value; self.renderBag(); });
    $('#bagSort').addEventListener('change', function () { self.bagSort = this.value; self.renderBag(); });
    $('#btnAutoEquip').addEventListener('click', function () { self.autoEquipAll(); });
    $('#btnJunk').addEventListener('click', function () { self.salvageJunk(); });

    /* ---- 选中物品的操作（强化 / 重铸 只在铁匠铺里提供） ---- */
    $('#actEquip').addEventListener('click', function () { self.actionEquip(); });
    $('#actUnequip').addEventListener('click', function () { self.actionUnequip(); });
    $('#actLock').addEventListener('click', function () { self.actionToggleLock(); });
    $('#actSalvage').addEventListener('click', function () { self.actionSalvage(); });
    $('#actSell').addEventListener('click', function () { self.actionSell(); });

    /* ---- 战斗内 ---- */
    $('#btnResume').addEventListener('click', function () { if (self.hooks.onResume) self.hooks.onResume(); });
    $('#btnQuit').addEventListener('click', function () { if (self.hooks.onQuit) self.hooks.onQuit(); });
    $('#btnDeeper').addEventListener('click', function () { if (self.hooks.onDeeper) self.hooks.onDeeper(); });
    $('#btnRetry').addEventListener('click', function () { if (self.hooks.onRetry) self.hooks.onRetry(); });
    $('#btnBackHub').addEventListener('click', function () { if (self.hooks.onBackHub) self.hooks.onBackHub(); });
    var prompt = $('#interactPrompt');
    if (prompt) prompt.addEventListener('click', function () { self.interactHideout(); });
    $('#slotPause').addEventListener('click', function () { if (self.hooks.onPauseToggle) self.hooks.onPauseToggle(); });

    // 只在背包 / 铁匠面板仍打开时，点空白处才取消选中。
    // 强化、重铸会先重绘面板，按钮从文档里摘掉；这次点击不能再当成点了空白，
    // 否则刚强化成功就把装备选中清掉，铁匠铺立刻变回「请先选中」。
    doc.addEventListener('click', function (ev) {
      var t = ev.target;
      var node = t && t.nodeType === 1 ? t : (t && t.parentElement);
      if (!node || !node.closest || node.isConnected === false) return;
      if (node.closest('.cell, .equip-slot, #bagActions, #forgeBody, .forge-row, #tooltip')) return;
      self.hideTooltip();
      var inSheet = node.closest('#panelBag, #panelForge');
      if (!inSheet || !self.isPanelOpen()) return;
      if (node.closest('button, select, a, input, label')) return;
      if (self.selUid || self.bagPick) {
        self.selUid = null;
        self.bagPick = null;
        self.renderBag(); self.renderEquip(); self.renderForge();
      }
    });

    var tipEl = $('#tooltip');
    if (tipEl) {
      tipEl.addEventListener('click', function (ev) { ev.stopPropagation(); });
      tipEl.addEventListener('wheel', function (ev) { ev.stopPropagation(); }, { passive: true });
    }

    this.setAuthMode('login');
    this.refreshLoginPreview();
    this.applyVersionLabels();
    this.startIdleLoop();
    return this;
  };

  UI.prototype.applyVersionLabels = function () {
    var ver = SP.VERSION || '—';
    var loginNum = this.$('loginVersionNum');
    var helpNum = this.$('helpVersionNum');
    var cur = this.$('changelogCurrent');
    if (loginNum) loginNum.textContent = 'v' + ver;
    if (helpNum) helpNum.textContent = 'v' + ver;
    if (cur) cur.textContent = '当前 v' + ver;
  };

  /* ------------------------------------------------------- 面板（弹窗）管理 */
  var PANEL_IDS = {
    bag: 'panelBag', portal: 'panelPortal', forge: 'panelForge',
    shop: 'panelShop', record: 'panelRecord', bestiary: 'panelBestiary',
    help: 'panelHelp', changelog: 'panelChangelog'
  };

  UI.prototype.openPanel = function (key) {
    if (!PANEL_IDS[key]) return;
    var changed = this.activePanel !== key;
    this.closeAllPanels();
    this.$(PANEL_IDS[key]).classList.add('active');
    this.activePanel = key;
    this.refreshPanel(key);
    if (changed) this.sound && this.sound.play('click');
  };
  UI.prototype.togglePanel = function (key) {
    if (this.activePanel === key) this.closeAllPanels();
    else this.openPanel(key);
  };
  UI.prototype.closeAllPanels = function () {
    var self = this;
    Object.keys(PANEL_IDS).forEach(function (k) { self.$(PANEL_IDS[k]).classList.remove('active'); });
    this.activePanel = null;
    this.hideTooltip();
  };
  UI.prototype.isPanelOpen = function () { return !!this.activePanel; };
  UI.prototype.isPanel = function (key) { return this.activePanel === key; };

  /** 按需刷新某个面板的内容 */
  UI.prototype.refreshPanel = function (key) {
    key = key || this.activePanel;
    if (!key) return;
    if (key === 'bag') {
      this.renderEquip();
      this.renderStats(SP.deriveCharacter(Accounts.char()));
      this.renderBag();
    } else if (key === 'portal') this.renderPortal();
    else if (key === 'forge') this.renderForge();
    else if (key === 'shop') this.renderShop();
    else if (key === 'record') this.renderRecord();
    else if (key === 'bestiary') this.renderBestiary();
    else if (key === 'changelog') this.renderChangelog();
  };

  UI.prototype.renderChangelog = function () {
    var list = this.$('changelogList');
    var entries = SP.CHANGELOG || [];
    list.innerHTML = '';
    this.applyVersionLabels();
    if (!entries.length) {
      list.innerHTML = '<div class="tiny muted">暂无更新记录。</div>';
      return;
    }
    entries.forEach(function (entry) {
      var box = el('article', 'cl-entry');
      var items = (entry.items || []).map(function (line) {
        return '<li>' + esc(line) + '</li>';
      }).join('');
      box.innerHTML =
        '<div class="cl-head">' +
        '<span class="cl-ver">v' + esc(entry.version) + '</span>' +
        (entry.date ? '<span class="cl-date">' + esc(entry.date) + '</span>' : '') +
        (entry.title ? '<div class="cl-title">' + esc(entry.title) + '</div>' : '') +
        '</div>' +
        (items ? '<ul class="cl-items">' + items + '</ul>' : '');
      list.appendChild(box);
    });
  };

  /** 藏身处里与 NPC 交互（由 main.js 在按 F / 点击 NPC 时调用） */
  UI.prototype.interactHideout = function () {
    if (!this.hideout) return null;
    var panel = this.hideout.interact();
    if (panel) this.openPanel(panel);
    return panel;
  };

  /* ------------------------------------------------------------ 登录页 */
  UI.prototype.setAuthMode = function (mode) {
    this.authMode = mode;
    var on = mode === 'login';
    this.$('tabLogin').classList.toggle('on', on);
    this.$('tabReg').classList.toggle('on', !on);
    this.$('btnAuth').textContent = on ? '登录' : '注册并登录';
    this.setMsg('');
  };
  UI.prototype.setMsg = function (text, ok) {
    var e = this.$('authMsg');
    if (!e) return;
    e.textContent = text || '';
    e.classList.toggle('ok', !!ok);
  };
  UI.prototype.toast = function (text, ok) { this.setMsg(text, ok); };

  UI.prototype.submitAuth = function () {
    var name = this.$('inUser').value.trim();
    var pass = this.$('inPass').value;
    if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{2,18}$/.test(name)) return this.setMsg('用户名需 2–18 位，仅限中英文、数字与下划线。');
    if (pass.length < 4) return this.setMsg('密码至少 4 位。');
    var res = this.authMode === 'login' ? Accounts.login(name, pass) : Accounts.register(name, pass);
    if (!res.ok) return this.setMsg(res.msg);
    this.setMsg('');
    this.sound && this.sound.play('levelup');
    this.enterHideout();
  };

  UI.prototype.showScreen = function (name) {
    this.screen = name;
    ['login', 'hideout', 'game'].forEach(function (s) {
      var e = doc.getElementById('screen-' + s);
      if (e) e.classList.toggle('active', s === name);
    });
    doc.documentElement.classList.toggle('in-play', name === 'hideout' || name === 'game');
    var stick = doc.getElementById('stick');
    var host = doc.getElementById('screen-' + name);
    if (stick && host && name !== 'login') host.appendChild(stick);
    if (name === 'hideout') {
      this.renderHideoutHUD();
      var prompt = this.$('interactPrompt');
      if (prompt) prompt.classList.add('hidden');
    }
    if (name === 'login') this.refreshLoginPreview();
    if (this.hooks.onScreen) this.hooks.onScreen(name);
  };
  UI.prototype.showLogin = function () { this.closeAllPanels(); this.showScreen('login'); };
  UI.prototype.showGame = function () { this.closeAllPanels(); this.showScreen('game'); };

  /** 进入藏身处：建立场景并刷新 HUD */
  UI.prototype.enterHideout = function () {
    if (!this.hideout) this.hideout = new SP.Hideout();
    this.showScreen('hideout');
  };
  /** 兼容旧调用名 */
  UI.prototype.enterHub = function () { this.enterHideout(); };
  UI.prototype.renderHub = function () { this.renderHideoutHUD(); this.refreshPanel(); };

  /** 藏身处每帧：推进场景、刷新交互提示 */
  UI.prototype.tickHideout = function (dt, input) {
    if (!this.hideout) return;
    this.hideout.update(dt, input || {});
    var prompt = this.$('interactPrompt');
    var text = this.hideout.promptText();
    if (text) {
      if (prompt.textContent !== text) prompt.textContent = text;
      prompt.classList.remove('hidden');
    } else if (!prompt.classList.contains('hidden')) {
      prompt.classList.add('hidden');
    }
  };

  UI.prototype.drawHideout = function (renderer) {
    if (!this.hideout || !renderer) return;
    this.hideout.clampCamera(renderer.w, renderer.h);
    renderer.drawHideout(this.hideout, {});
  };

  UI.prototype.refreshLoginPreview = function () {
    var rec = Accounts.current;
    var ch = rec ? rec.character : P.newCharacter('时空猪');
    var st = SP.deriveCharacter(ch);
    this.$('loginHp').textContent = Math.round(st.maxHp) + ' / ' + Math.round(st.maxHp);
    this.$('loginHpBar').style.width = '100%';
    this.$('loginAtk').textContent = Math.round(st.damage) + ' / Lv.' + ch.level;
    this.$('loginCoins').textContent = ch.coins;
    this.$('loginStones').textContent = ch.stones;
    var geared = 0;
    I.EQUIP_SLOTS.forEach(function (s) { if (ch.equipped[s]) geared++; });
    this.$('loginGear').textContent = geared
      ? '已装备 ' + geared + ' / 7 件 · 最高通关 ' + SP.BIOME_ORDER.map(function (b) {
        return P.clearedFloor(ch, b);
      }).join('/')
      : '尚未装备任何物品';
    this.drawAvatar();
  };

  UI.prototype.drawAvatar = function () {
    var cv = this.$('avatarCanvas');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save();
    ctx.translate(cv.width / 2, cv.height / 2 + 6);
    ctx.scale(3.4, 3.4);
    ctx.rotate(-0.18);
    SP.Renderer.prototype.drawPigBody.call({ t: 0.6 }, ctx, SP.basePig ? SP.basePig() : fakePig(), null, 1);
    ctx.restore();
  };

  /** 头像用的假角色（渲染只需要这几个字段） */
  function fakePig() {
    return { walkPhase: 0, vx: 0, vy: 0, hurtFlash: 0, facing: 0 };
  }

  /* ------------------------------------------------- 藏身处 HUD（顶栏） */
  UI.prototype.renderHideoutHUD = function () {
    var rec = Accounts.current;
    if (!rec) return;
    var ch = rec.character;
    this.$('hubName').textContent = rec.name + (rec.guest ? '（游客）' : '');
    this.$('hubLv').textContent = 'Lv. ' + ch.level;
    this.$('hubXpBar').style.width = (100 * SP.clamp(ch.xp / SP.xpForLevel(ch.level), 0, 1)).toFixed(1) + '%';
    this.$('hubCoins').textContent = ch.coins;
    var warn = this.$('storeWarn');
    if (warn) warn.classList.toggle('hidden', Accounts.storage.persistent);
    // 传送门按钮在没有可用层级时可点性照旧，只更新一次面板内容
    this.refreshPanel();
  };

  var SLOT_LABEL = {
    weapon: '武器', helm: '头盔', armor: '护甲', boots: '战靴',
    amulet: '项链', ring1: '左戒', ring2: '右戒'
  };
  UI.prototype.renderEquip = function () {
    var ch = Accounts.char();
    var wrap = this.$('equipSlots');
    wrap.innerHTML = '';
    var self = this;
    I.EQUIP_SLOTS.forEach(function (slot) {
      var it = ch.equipped[slot];
      var row = el('div', 'equip-slot' + (it ? '' : ' empty'));
      var rar = it ? I.RARITY_BY_KEY[it.rarity] : null;
      row.innerHTML =
        (it && it.locked ? '<span class="lk" title="已上锁">锁</span>' : '') +
        (it && it.upgrade ? '<span class="es-up">+' + it.upgrade + '</span>' : '') +
        '<div class="es-kicker">' + SLOT_LABEL[slot] + '</div>' +
        '<div class="es-icon"' + (rar ? ' style="border-color:' + rar.color + ';color:' + rar.color + '"' : '') + '>' +
        self.iconHtml(it || slot) + '</div>' +
        '<div class="es-sub">' + (it ? I.power(it) : '空') + '</div>';
      if (it) {
        self.bindItemTooltip(row, it, slot);
        row.addEventListener('click', function (ev) {
          ev.stopPropagation();
          self.selUid = it.uid;
          self.renderBag();
          self.renderEquip();
          self.renderForge();
          if (self.isTouchUi()) self.showTooltip(it, ev, slot);
        });
      } else {
        row.addEventListener('click', function (ev) {
          ev.stopPropagation();
          self.selUid = null;
          self.renderBag(); self.renderEquip(); self.renderForge();
        });
      }
      row.classList.toggle('sel', !!it && self.selUid === it.uid);
      wrap.appendChild(row);
    });
  };

  var STAT_GROUPS = [
    ['攻击', [
      ['damage', '攻击力', 'flat'], ['crit', '暴击率', 'pctRaw'],
      ['critMult', '暴击伤害', 'pctRaw'], ['attackSpeed', '攻击速度', 'perSec'],
      ['skillDmg', '技能伤害', 'pctRaw'], ['lifesteal', '吸血', 'pctRaw']
    ]],
    ['生存', [
      ['maxHp', '生命上限', 'flat'], ['armor', '护甲', 'flat'],
      ['regen', '每秒回复', 'flat1'], ['thorns', '伤害反弹', 'flat']
    ]],
    ['机动', [
      ['speed', '移动速度', 'flat'], ['cdr', '冷却缩减', 'pctRaw'],
      ['magnet', '拾取范围', 'flat'], ['greed', '金币获取', 'pctRaw'],
      ['luck', '掉落幸运', 'pctRaw']
    ]]
  ];
  function fmtStat(st, row) {
    var v = st[row[0]];
    if (row[2] === 'pctRaw') return (v * 100).toFixed(1) + '%';
    if (row[2] === 'perSec') return v.toFixed(2) + '/秒';
    if (row[2] === 'flat1') return v.toFixed(1);
    return Math.round(v).toString();
  }
  UI.prototype.renderStats = function (st) {
    var wrap = this.$('statList');
    wrap.innerHTML = '';
    STAT_GROUPS.forEach(function (g) {
      var sec = el('section');
      sec.appendChild(el('h4', 'stat-group', g[0]));
      g[1].forEach(function (row) {
        sec.appendChild(el('div', 'sl', '<span class="muted">' + row[1] + '</span><span>' + fmtStat(st, row) + '</span>'));
      });
      wrap.appendChild(sec);
    });
    if (st.uniques && st.uniques.length) {
      var names = st.uniques.map(function (k) { return I.UNIQUE_BY_KEY[k] ? I.UNIQUE_BY_KEY[k].name : k; });
      wrap.appendChild(el('section', 'stat-unique',
        '<h4 class="stat-group">传说</h4><div class="sl"><span style="color:var(--r-legendary)">' +
        esc(names.join('、')) + '</span></div>'));
    }
  };

  UI.prototype.slotGlyph = function (slot) { return SP.Renderer.prototype.slotGlyph(slot); };

  /** 装备像素图标。没有对应图时退回部位汉字。 */
  UI.prototype.iconHtml = function (itemOrSlot) {
    var icons = SP.ItemIcons;
    var key = null;
    if (itemOrSlot && typeof itemOrSlot === 'object') key = icons && icons.forItem(itemOrSlot);
    else if (typeof itemOrSlot === 'string') key = (icons && icons.url(itemOrSlot)) ? itemOrSlot : (icons && icons.fallback[itemOrSlot]);
    var src = icons && icons.url(key);
    if (!src) {
      var slot = itemOrSlot && itemOrSlot.slot ? itemOrSlot.slot : itemOrSlot;
      return this.slotGlyph(slot);
    }
    return '<img class="px-icon" alt="" draggable="false" src="' + src + '">';
  };

  /** 比当前身上同部位更强，或还能填进空槽，就标成可提升 */
  UI.prototype.itemIsUpgrade = function (it) {
    var ch = Accounts.char();
    if (!ch || !it) return false;
    if (it.slot === 'ring') {
      var a = ch.equipped.ring1, b = ch.equipped.ring2;
      if (!a || !b) return true;
      return I.power(it) > Math.min(I.power(a), I.power(b));
    }
    var cur = ch.equipped[it.slot];
    return !cur || I.power(it) > I.power(cur);
  };

  /** 与当前装备比较（戒指比两槽中较弱的那件，才是真实收益） */
  UI.prototype.compareTarget = function (item) {
    var ch = Accounts.char();
    if (!ch) return null;
    if (item.slot === 'ring') {
      var a = ch.equipped.ring1, b = ch.equipped.ring2;
      if (!a) return b;
      if (!b) return a;
      return I.power(a) <= I.power(b) ? a : b;
    }
    return ch.equipped[item.slot] || null;
  };

  /** 材料和消耗品是堆叠计数，不占 60 格装备容量 */
  var BAG_STACKS = {
    mat: [
      { key: 'up', name: '强化石', kind: '材料', color: '#ffb27a', icn: 'up',
        desc: '铁匠强化装备时消耗。分解装备可以获得。',
        count: function (ch) { return ch.materials.up; } },
      { key: 're', name: '重铸石', kind: '材料', color: '#c9a6ff', icn: 're',
        desc: '铁匠重铸词条时消耗。分解装备时有机会一起获得。',
        count: function (ch) { return ch.materials.re; } },
      { key: 'alpha', name: '秘宝', kind: '材料', color: '#7fe3ff', icn: 'alpha',
        desc: '副本里拾取的石头。商店可以用它换装备、强化石和重铸石。',
        count: function (ch) { return ch.stones; } }
    ],
    use: [
      { key: 'steak', name: '牛排', kind: '消耗品', color: '#ffc48f', icn: 'steak',
        desc: '带进副本，按 1 回复 30% 生命。身上最多 9 块，每次出发最多带 5 块。',
        count: function (ch) { return ch.steaks; } }
    ]
  };

  UI.prototype.renderBag = function () {
    var ch = Accounts.char();
    var grid = this.$('bagGrid');
    var self = this;
    var cat = this.bagCat || 'gear';
    grid.innerHTML = '';
    this.$('bagCount').textContent = ch.inventory.length + ' / ' + P.INVENTORY_CAP;
    Array.prototype.forEach.call(doc.querySelectorAll('#bagTabs .bag-tab'), function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-cat') === cat);
    });
    Array.prototype.forEach.call(doc.querySelectorAll('.gear-only'), function (node) {
      node.classList.toggle('hidden', cat !== 'gear');
    });
    var bagHead = doc.querySelector('#panelBag .bag-head');
    if (bagHead) bagHead.classList.toggle('hidden', cat !== 'gear');

    if (cat !== 'gear') {
      this.renderBagStacks(ch, BAG_STACKS[cat] || []);
      this.renderBagActions();
      return;
    }

    var list = ch.inventory.filter(function (it) {
      return self.bagFilter === 'all' || it.slot === self.bagFilter;
    });
    var sorters = {
      power: function (a, b) { return I.power(b) - I.power(a); },
      ilvl: function (a, b) { return b.ilvl - a.ilvl || I.power(b) - I.power(a); },
      rarity: function (a, b) {
        return I.RARITY_BY_KEY[b.rarity].index - I.RARITY_BY_KEY[a.rarity].index || I.power(b) - I.power(a);
      }
    };
    list.sort(sorters[this.bagSort] || sorters.power);

    list.forEach(function (it) {
      var rar = I.RARITY_BY_KEY[it.rarity];
      var c = el('div', 'cell' + (self.selUid === it.uid ? ' sel' : '') +
        (self.itemIsUpgrade(it) ? ' better' : '') + (it.locked ? ' is-locked' : ''));
      c.style.borderColor = rar.color;
      c.innerHTML = '<div class="rar" style="background:' + rar.color + '"></div>' +
        (it.locked ? '<span class="lk" title="已上锁">锁</span>' : '') +
        self.iconHtml(it) +
        '<span class="il">' + it.ilvl + '</span>' +
        (it.upgrade ? '<span class="up">+' + it.upgrade + '</span>' : '');
      self.bindItemTooltip(c, it, it.slot);
      c.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var next = self.selUid === it.uid ? null : it.uid;
        self.selUid = next;
        self.renderBag(); self.renderEquip(); self.renderForge();
        if (self.isTouchUi()) {
          if (next) self.showTooltip(it, ev, it.slot);
          else self.hideTooltip();
        }
      });
      grid.appendChild(c);
    });
    if (this.bagFilter === 'all') {
      var pad = Math.max(0, P.INVENTORY_CAP - list.length);
      for (var i = 0; i < pad; i++) grid.appendChild(el('div', 'cell empty'));
    } else if (!list.length) {
      grid.appendChild(el('div', 'bag-empty', '背包里没有这个部位的装备'));
    }

    this.renderBagActions();
  };

  UI.prototype.renderBagStacks = function (ch, stacks) {
    var grid = this.$('bagGrid');
    var self = this;
    if (!stacks.length) {
      grid.appendChild(el('div', 'bag-empty', '这里还是空的'));
      return;
    }
    stacks.forEach(function (stack) {
      var n = stack.count(ch);
      var iconUrl = SP.ItemIcons && SP.ItemIcons.url(stack.icn);
      var face = iconUrl
        ? '<img class="px-icon stk-ico" alt="" draggable="false" src="' + iconUrl + '">'
        : '<i class="icn ' + stack.icn + ' stk-ico"></i>';
      var c = el('div', 'cell stack' + (n ? '' : ' zero') + (self.bagPick === stack.key ? ' sel' : ''));
      c.style.borderColor = stack.color;
      c.innerHTML = '<div class="rar" style="background:' + stack.color + '"></div>' +
        face +
        '<span class="qty">' + n + '</span>' +
        '<span class="stk-name">' + stack.name + '</span>';
      c.addEventListener('mouseenter', function (ev) {
        if (self.isTouchUi()) return;
        self.showStackTip(stack, n, ev);
      });
      c.addEventListener('mouseleave', function () {
        if (self.isTouchUi()) return;
        self.hideTooltip();
      });
      c.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var next = self.bagPick === stack.key ? null : stack.key;
        self.bagPick = next;
        self.renderBag();
        if (self.isTouchUi()) {
          if (next) self.showStackTip(stack, n, ev);
          else self.hideTooltip();
        }
      });
      grid.appendChild(c);
    });
  };

  UI.prototype.isTouchUi = function () {
    return !!(doc.documentElement.classList.contains('is-touch') ||
      (global.matchMedia && global.matchMedia('(pointer: coarse)').matches));
  };

  /** 桌面悬停查看；触屏改由 click 固定展示，避免 mouseleave 一闪就没。 */
  UI.prototype.bindItemTooltip = function (node, item, slot) {
    var self = this;
    node.addEventListener('mouseenter', function (ev) {
      if (self.isTouchUi()) return;
      self.showTooltip(item, ev, slot);
    });
    node.addEventListener('mouseleave', function () {
      if (self.isTouchUi()) return;
      self.hideTooltip();
    });
  };

  /** 把提示框夹在可视区域内；内容过高时靠 max-height + 内部滚动。 */
  UI.prototype.placeTooltip = function (ev) {
    var tip = this.$('tooltip');
    var pad = 8;
    var vw = global.innerWidth || doc.documentElement.clientWidth || 360;
    var vh = global.innerHeight || doc.documentElement.clientHeight || 640;
    var compact = this.isTouchUi() || vw <= 780;
    var maxH = Math.max(160, compact ? Math.min(vh * 0.7, vh - pad * 2) : vh - pad * 2);
    tip.style.maxHeight = Math.round(maxH) + 'px';

    // 先清位移再量，避免沿用上一次的 left/top 影响宽度计算
    tip.style.left = '0px';
    tip.style.top = '0px';
    var rect = tip.getBoundingClientRect();
    var w = rect.width, h = Math.min(rect.height, maxH);
    var x, y;
    var cx = ev && typeof ev.clientX === 'number' ? ev.clientX : vw / 2;
    var cy = ev && typeof ev.clientY === 'number' ? ev.clientY : vh / 2;

    if (compact) {
      x = Math.max(pad, Math.min((vw - w) / 2, vw - w - pad));
      y = cy + 14;
      if (y + h > vh - pad) y = cy - h - 14;
      if (y < pad) y = pad;
      if (y + h > vh - pad) y = Math.max(pad, vh - h - pad);
    } else {
      x = cx + 16;
      y = cy + 12;
      if (x + w > vw - pad) x = cx - w - 14;
      if (x < pad) x = pad;
      if (y + h > vh - pad) y = Math.max(pad, vh - h - pad);
      if (y < pad) y = pad;
    }
    tip.style.left = Math.round(x) + 'px';
    tip.style.top = Math.round(y) + 'px';
  };

  UI.prototype.showStackTip = function (stack, count, ev) {
    var tip = this.$('tooltip');
    tip.innerHTML = '<div class="tt-name" style="color:' + stack.color + '">' + stack.name + '</div>' +
      '<div class="tt-sub">' + stack.kind + ' · 持有 ' + count + '</div>' +
      '<div class="tt-foot">' + stack.desc + '</div>';
    tip.classList.remove('hidden');
    this.placeTooltip(ev);
  };

  UI.prototype.renderBagActions = function () {
    var ch = Accounts.char();
    var bar = this.$('bagActions');
    var found = this.selUid ? P.findItem(ch, this.selUid) : null;
    bar.classList.remove('hidden');
    var cat = this.bagCat || 'gear';
    if (cat !== 'gear') {
      var stacks = BAG_STACKS[cat] || [];
      var picked = null;
      for (var i = 0; i < stacks.length; i++) if (stacks[i].key === this.bagPick) picked = stacks[i];
      ['actEquip', 'actUnequip', 'actLock', 'actSalvage', 'actSell'].forEach(function (id) {
        this.$(id).classList.add('hidden');
      }, this);
      this.$('selName').className = 'tiny' + (picked ? '' : ' muted');
      if (!picked) {
        this.$('selName').textContent = cat === 'mat'
          ? '材料和秘宝不占背包格子。点一下可以查看用途。'
          : '消耗品不占背包格子。牛排要带进副本才能用。';
      } else {
        this.$('selName').innerHTML = '<span style="color:' + picked.color + '">' + picked.name +
          ' × ' + picked.count(ch) + '</span> <span class="muted">· ' + picked.desc + '</span>';
      }
      return;
    }
    if (!found) {
      this.$('selName').className = 'tiny muted';
      this.$('selName').textContent = '点选一件装备，可以换上、上锁、分解或出售';
      ['actEquip', 'actUnequip', 'actLock', 'actSalvage', 'actSell'].forEach(function (id) {
        this.$(id).classList.add('hidden');
      }, this);
      return;
    }
    var it = found.item;
    var rar = I.RARITY_BY_KEY[it.rarity];
    this.$('selName').className = 'tiny';
    this.$('selName').innerHTML = '<span style="color:' + rar.color + '">' + esc(it.name) +
      (it.upgrade ? ' +' + it.upgrade : '') + '</span> <span class="muted">· 战力 ' + I.power(it) + '</span>' +
      (it.locked ? ' <span style="color:#ffd27a">· 已上锁</span>' : '');
    var inBag = found.where === 'inventory';
    this.$('actEquip').classList.toggle('hidden', !inBag);
    this.$('actUnequip').classList.toggle('hidden', inBag);
    this.$('actLock').classList.remove('hidden');
    this.$('actLock').textContent = it.locked ? '解锁' : '上锁';
    this.$('actLock').classList.toggle('on', !!it.locked);
    this.$('actSalvage').classList.remove('hidden');
    this.$('actSell').classList.remove('hidden');
    this.$('actSalvage').disabled = !inBag || !!it.locked;
    this.$('actSell').disabled = !inBag || !!it.locked;
    this.$('actSalvage').title = it.locked ? '装备已上锁' : '';
    this.$('actSell').title = it.locked ? '装备已上锁' : '';
    // 强化 / 重铸 属于铁匠的活，只在铁匠铺面板里提供
  };

  /* ------------------------------------------------------------ 悬浮提示 */
  UI.prototype.showTooltip = function (item, ev, slotContext) {
    var tip = this.$('tooltip');
    var ch = Accounts.char();
    var rar = I.RARITY_BY_KEY[item.rarity];
    var target = this.compareTarget(item);
    var isEquipped = P.findItem(ch, item.uid) && P.findItem(ch, item.uid).where === 'equipped';
    var stats = I.itemStats(item);
    var html = '';
    html += '<div class="tt-top">' + this.iconHtml(item) + '<div class="tt-top-text">';
    html += '<div class="tt-name" style="color:' + rar.color + '">' + esc(item.name) + (item.upgrade ? ' +' + item.upgrade : '') + '</div>';
    html += '<div class="tt-sub">' + rar.name + ' · ' + I.SLOT_META[item.slot].name + ' · 物品等级 ' + item.ilvl +
      (isEquipped ? ' · <b style="color:var(--cyan)">已装备</b>' : '') +
      (item.locked ? ' · <b style="color:#ffd27a">已上锁</b>' : '') + '</div></div></div>';
    if (item.slot === 'weapon') {
      var wp = I.weaponProfile(item);
      html += '<div class="tt-sec"><div class="tt-line"><span>攻击方式</span><b style="color:#ffe9a8">' +
        esc(wp.label) + '</b></div>' +
        '<div class="tiny muted">射程 ' + Math.round(wp.range) +
        (wp.style === 'shot' || wp.style === 'bolt'
          ? ' · 远程弹道' + (wp.pierce > 1 ? '（穿透 ' + wp.pierce + '）' : '')
          : wp.style === 'spin' ? ' · 环身回旋'
          : wp.style === 'smash' ? ' · 附带震波'
          : wp.style === 'thrust' || wp.style === 'stab' ? ' · 窄角度突刺'
          : wp.style === 'cleave' ? ' · 宽扇横劈'
          : ' · 扇形挥砍') +
        '</div></div>';
    }

    // 基础属性（不含词条）
    var perKey = {};
    item.affixes.forEach(function (a) { perKey[a.key] = (perKey[a.key] || 0) + a.value; });
    var baseKeys = Object.keys(item.stats).filter(function (k) {
      return Math.abs(item.stats[k] - (perKey[k] || 0)) > 1e-6;
    });
    if (baseKeys.length) {
      html += '<div class="tt-sec">';
      baseKeys.forEach(function (k) {
        var v = (item.stats[k] - (perKey[k] || 0)) * I.upgradeMult(item);
        html += '<div class="tt-line"><span style="color:#e6e0ff">' + I.STAT_META[k].name + '</span><b>' +
          I.fmtValue(k, v) + '</b></div>';
      });
      html += '</div>';
    }
    if (item.affixes.length) {
      html += '<div class="tt-sec">';
      item.affixes.forEach(function (a) {
        html += '<div class="tt-line"><span style="color:#9fd8ff">' + I.STAT_META[a.key].name + '</span><b style="color:#cfe9ff">' +
          I.fmtValue(a.key, a.value * I.upgradeMult(item)) + '</b></div>';
      });
      html += '</div>';
    }
    if (item.unique) {
      var u = I.UNIQUE_BY_KEY[item.unique];
      html += '<div class="tt-sec"><div class="tt-unique">◆ ' + u.name + '</div>' +
        '<div class="tiny muted">' + u.desc + '</div></div>';
    }
    // 与当前装备的差值
    if (!isEquipped && target) {
      var diff = I.compare(target, item);
      var keys = Object.keys(diff);
      var better = I.power(item) - I.power(target);
      html += '<div class="tt-sec"><div class="tt-line"><span>对比当前装备</span><b class="' +
        (better >= 0 ? 'tt-up' : 'tt-down') + '">' + (better >= 0 ? '+' : '') + better + ' 战力</b></div>';
      keys.slice(0, 7).forEach(function (k) {
        var d = diff[k];
        html += '<div class="tt-line"><span class="muted">' + I.STAT_META[k].name + '</span><b class="' +
          (d >= 0 ? 'tt-up' : 'tt-down') + '">' + (d >= 0 ? '+' : '') +
          (I.STAT_META[k].fmt === 'pct' ? d.toFixed(1) : Math.round(d)) + '</b></div>';
      });
      html += '</div>';
    }
    if (!isEquipped) {
      var y = I.salvageYield(item);
      if (item.locked) {
        html += '<div class="tt-foot" style="color:#ffd27a">已上锁：无法分解或出售</div>';
      } else {
        html += '<div class="tt-foot">分解可得 ' + y.stones + ' 强化石' + (y.rerolls ? ' + ' + y.rerolls + ' 重铸石' : '') +
          ' · 售价 ' + I.sellPrice(item) + ' 金币</div>';
      }
    } else if (item.locked) {
      html += '<div class="tt-foot" style="color:#ffd27a">已上锁：卸下后也无法被分解/出售</div>';
    }
    html += '<div class="tt-foot">战力评分 ' + I.power(item) + '</div>';

    tip.innerHTML = html;
    tip.classList.remove('hidden');
    this.placeTooltip(ev);
    void slotContext;
  };
  UI.prototype.hideTooltip = function () {
    var tip = this.$('tooltip');
    tip.classList.add('hidden');
    tip.style.maxHeight = '';
  };

  /* ------------------------------------------------------------ 装备操作 */
  UI.prototype.actionEquip = function () {
    var ch = Accounts.char();
    var r = P.equipFromBag(ch, this.selUid);
    if (!r.ok) return this.flash(r.reason);
    this.sound && this.sound.play('coin');
    this.selUid = r.item.uid;
    this.afterChange(r.replaced ? '已装备 ' + r.item.name + '，' + r.replaced.name + ' 放回背包' : '已装备 ' + r.item.name);
  };
  UI.prototype.actionUnequip = function () {
    var ch = Accounts.char();
    var found = P.findItem(ch, this.selUid);
    if (!found || found.where !== 'equipped') return this.flash('请先选中一件已装备的物品');
    var r = P.unequip(ch, found.slot);
    if (!r.ok) return this.flash(r.reason);
    this.afterChange('已卸下 ' + r.item.name);
  };
  UI.prototype.actionUpgrade = function () {
    var ch = Accounts.char();
    var r = P.upgradeItem(ch, this.selUid);
    if (!r.ok) return this.flash(r.reason);
    this.sound && this.sound.play('stone');
    this.afterChange('强化成功：' + r.item.name + ' +' + r.item.upgrade + '（战力 ' + r.power + '）');
  };
  UI.prototype.actionReroll = function () {
    var ch = Accounts.char();
    var r = P.rerollItem(ch, this.selUid);
    if (!r.ok) return this.flash(r.reason);
    this.sound && this.sound.play('stone');
    var delta = r.after - r.before;
    this.afterChange('重铸完成：战力 ' + r.before + ' → ' + r.after + '（' + (delta >= 0 ? '+' : '') + delta + '）');
  };
  UI.prototype.actionToggleLock = function () {
    var ch = Accounts.char();
    var r = P.toggleLock(ch, this.selUid);
    if (!r.ok) return this.flash(r.reason);
    this.sound && this.sound.play('click');
    this.afterChange(r.locked ? '已上锁，不会被分解或出售' : '已解锁');
  };
  UI.prototype.actionSalvage = function () {
    var ch = Accounts.char();
    var r = P.salvage(ch, this.selUid);
    if (!r.ok) return this.flash(r.reason);
    this.sound && this.sound.play('coin');
    this.selUid = null;
    this.afterChange('分解获得 ' + r.yield.stones + ' 强化石' + (r.yield.rerolls ? ' + ' + r.yield.rerolls + ' 重铸石' : ''));
  };
  UI.prototype.actionSell = function () {
    var ch = Accounts.char();
    var r = P.sell(ch, this.selUid);
    if (!r.ok) return this.flash(r.reason);
    this.sound && this.sound.play('coin');
    this.selUid = null;
    this.afterChange('出售获得 ' + r.price + ' pig-coin');
  };

  UI.prototype.autoEquipAll = function () {
    var ch = Accounts.char();
    var changed = 0;
    ['weapon', 'helm', 'armor', 'boots', 'amulet', 'ring'].forEach(function (slot) {
      for (var guard = 0; guard < 4; guard++) {
        var r = P.autoEquipBest(ch, slot);
        if (!r.ok) break;
        changed++;
      }
    });
    if (!changed) return this.flash('没有找到更强的装备');
    this.afterChange('已自动换上 ' + changed + ' 件更强的装备');
  };

  UI.prototype.salvageJunk = function () {
    var ch = Accounts.char();
    var threshold = 0;
    I.EQUIP_SLOTS.forEach(function (s) {
      if (ch.equipped[s]) threshold = Math.max(threshold, I.power(ch.equipped[s]) * 0.8);
    });
    if (threshold <= 0) return this.flash('请先装备一些物品，再按战力清理背包');
    var r = P.salvageBelow(ch, threshold);
    if (!r.removed) {
      return this.flash(r.skippedLocked
        ? '没有可清理的装备（上锁装备已跳过）'
        : '没有需要清理的装备');
    }
    this.afterChange('分解了 ' + r.removed + ' 件装备，获得 ' + r.stones + ' 强化石 + ' + r.rerolls + ' 重铸石' +
      (r.skippedLocked ? '（跳过 ' + r.skippedLocked + ' 件上锁）' : ''));
  };

  UI.prototype.afterChange = function (msg) {
    Accounts.persist();
    this.renderHideoutHUD();
    this.refreshPanel();
    this.hideTooltip();
    this.flash(msg, true);
  };

  /** 提示：铁匠铺面板内联显示 + 右上角浮动 toast（不依赖当前打开的是哪个面板） */
  UI.prototype.flash = function (msg, ok) {
    var f = this.$('forgeMsg');
    if (f && this.isPanel('forge')) {
      f.textContent = msg;
      f.style.color = ok ? 'var(--green)' : 'var(--pink)';
    }
    var t = this.$('toast');
    if (t) {
      t.innerHTML = msg;
      t.style.borderColor = ok ? 'rgba(157,255,176,.5)' : 'rgba(255,107,107,.5)';
      t.style.color = ok ? '#c8ffd4' : '#ffd0d0';
      t.classList.remove('hidden');
      t.classList.remove('pop');
      void t.offsetWidth;
      t.classList.add('pop');
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2600);
    }
  };

  /* -------------------------------------------------------------- 铁匠铺 */
  UI.prototype.renderForgeList = function (ch) {
    var list = this.$('forgeList');
    var self = this;
    list.innerHTML = '';
    var rows = [];
    I.EQUIP_SLOTS.forEach(function (slot) {
      var it = ch.equipped[slot];
      if (it) rows.push({ item: it, where: 'equipped', slotName: I.SLOT_META[slot].name });
    });
    ch.inventory.slice().sort(function (a, b) { return I.power(b) - I.power(a); }).forEach(function (it) {
      rows.push({ item: it, where: 'inventory', slotName: I.SLOT_META[it.slot].name });
    });
    if (!rows.length) {
      list.appendChild(el('div', 'tiny muted', '没有可加工的装备'));
      return;
    }
    rows.forEach(function (row) {
      var it = row.item;
      var rar = I.RARITY_BY_KEY[it.rarity];
      var node = el('div', 'forge-row' + (self.selUid === it.uid ? ' sel' : ''));
      node.innerHTML =
        (it.locked ? '<span class="lk" title="已上锁">锁</span>' : '') +
        '<div class="fr-glyph" style="border-color:' + rar.color + ';color:' + rar.color + '">' +
        self.iconHtml(it) + '</div>' +
        '<div class="fr-body"><div class="fr-name" style="color:' + rar.color + '">' +
        esc(it.name) + (it.upgrade ? ' +' + it.upgrade : '') +
        (it.locked ? ' <span style="color:#ffd27a;font-size:12px">锁</span>' : '') + '</div>' +
        '<div class="fr-sub">' + (row.where === 'equipped' ? '已装备 · ' : '') +
        (it.locked ? '已上锁 · ' : '') +
        row.slotName + ' · ilvl ' + it.ilvl + ' · 战力 ' + I.power(it) + '</div></div>';
      node.addEventListener('click', function (ev) {
        ev.stopPropagation();
        self.selUid = it.uid;
        self.renderForge();
      });
      list.appendChild(node);
    });
  };

  UI.prototype.renderForge = function () {
    var ch = Accounts.char();
    var body = this.$('forgeBody');
    body.innerHTML = '';
    var self = this;
    this.renderForgeList(ch);
    var found = this.selUid ? P.findItem(ch, this.selUid) : null;
    if (found) {
      var it = found.item;
      var rar = I.RARITY_BY_KEY[it.rarity];
      var card = el('div', 'shop-item');
      card.innerHTML = '<div class="si-body">' +
        '<div class="si-name" style="color:' + rar.color + '">' + esc(it.name) + (it.upgrade ? ' +' + it.upgrade : '') + '</div>' +
        '<div class="si-desc">' + rar.name + ' · ilvl ' + it.ilvl + ' · 战力 ' + I.power(it) + ' · 词条 ' + it.affixes.length + ' 条</div>' +
        '</div>';
      body.appendChild(card);
      this.$('forgeMsg').textContent = '';
      this.$('forgeMsg').style.color = '';

      var upCost = I.upgradeCost(it);
      var upRow = el('div', 'shop-item');
      upRow.innerHTML = '<div class="si-body"><div class="si-name">强化 +' + (it.upgrade || 0) + ' → +' + ((it.upgrade || 0) + 1) + '</div>' +
        '<div class="si-desc">全属性 +7% ｜ 消耗 ' + upCost.coins + ' 金币 + ' + upCost.stones + ' 强化石</div></div>';
      var upBtn = el('button', 'gold tiny-btn', (it.upgrade || 0) >= I.UPGRADE_CAP ? '已满级' : '强化');
      upBtn.disabled = !I.canUpgrade(it) || ch.coins < upCost.coins || ch.materials.up < upCost.stones;
      upBtn.addEventListener('click', function () { self.actionUpgrade(); });
      upRow.appendChild(upBtn);
      body.appendChild(upRow);

      var reCost = I.rerollCost(it);
      var reRow = el('div', 'shop-item');
      reRow.innerHTML = '<div class="si-body"><div class="si-name">重铸词条</div>' +
        '<div class="si-desc">保留种类、重掷数值 ｜ 消耗 ' + reCost.coins + ' 金币 + ' + reCost.rerolls + ' 重铸石</div></div>';
      var reBtn = el('button', 'tiny-btn', '重铸');
      reBtn.disabled = !it.affixes.length || ch.coins < reCost.coins || ch.materials.re < reCost.rerolls;
      reBtn.addEventListener('click', function () { self.actionReroll(); });
      reRow.appendChild(reBtn);
      body.appendChild(reRow);

      var lockRow = el('div', 'shop-item');
      lockRow.innerHTML = '<div class="si-body"><div class="si-name">' + (it.locked ? '解锁装备' : '上锁装备') + '</div>' +
        '<div class="si-desc">' + (it.locked
          ? '解锁后可以分解或出售'
          : '上锁后不会被分解、出售或「分解垃圾」清掉') + '</div></div>';
      var lockBtn = el('button', 'tiny-btn' + (it.locked ? '' : ' gold'), it.locked ? '解锁' : '上锁');
      lockBtn.addEventListener('click', function () { self.actionToggleLock(); });
      lockRow.appendChild(lockBtn);
      body.appendChild(lockRow);

      if (found.where === 'inventory') {
        var y = I.salvageYield(it);
        var salRow = el('div', 'shop-item');
        salRow.innerHTML = '<div class="si-body"><div class="si-name">分解</div>' +
          '<div class="si-desc">' + (it.locked
            ? '装备已上锁，请先解锁'
            : ('获得 ' + y.stones + ' 强化石' + (y.rerolls ? ' + ' + y.rerolls + ' 重铸石' : ''))) + '</div></div>';
        var salBtn = el('button', 'tiny-btn', '分解');
        salBtn.disabled = !!it.locked;
        salBtn.addEventListener('click', function () { self.actionSalvage(); });
        salRow.appendChild(salBtn);
        body.appendChild(salRow);
      }
    } else {
      this.$('forgeMsg').textContent = '尚未选中装备。点左侧一件即可强化或重铸。';
      this.$('forgeMsg').style.color = '';
    }

    // 批量清理
    var bulk = el('div', 'shop-item');
    bulk.innerHTML = '<div class="si-body"><div class="si-name">批量分解</div>' +
      '<div class="si-desc">分解背包中战力低于「已装备最强者 80%」的装备（自动跳过上锁）</div></div>';
    var bulkBtn = el('button', 'tiny-btn', '执行');
    bulkBtn.addEventListener('click', function () { self.salvageJunk(); });
    bulk.appendChild(bulkBtn);
    body.appendChild(bulk);
  };

  /* ---------------------------------------------------------------- 商店 */
  UI.prototype.renderShop = function () {
    var ch = Accounts.char();
    var body = this.$('shopBody');
    var self = this;
    body.innerHTML = '';

    function shopRow(name, desc, priceHtml, enabled, onClick) {
      var row = el('div', 'shop-item');
      row.innerHTML = '<div class="si-body"><div class="si-name">' + name + '</div><div class="si-desc">' + desc + '</div></div>';
      var b = el('button', 'gold tiny-btn', priceHtml);
      b.disabled = !enabled;
      b.addEventListener('click', onClick);
      row.appendChild(b);
      body.appendChild(row);
    }

    shopRow('牛排 × 1', '带进副本，按 1 回复 30% 生命', P.STEAK_PRICE + ' 金币', ch.coins >= P.STEAK_PRICE && ch.steaks < 9, function () {
      var r = P.buySteak(ch, 1);
      if (!r.ok) return self.flash(r.reason);
      self.sound && self.sound.play('coin');
      self.afterChange('购买了 1 块牛排，现有 ' + ch.steaks + ' 块');
    });
    shopRow('牛排 × 5', '一次买满，下副本更安心', (P.STEAK_PRICE * 5) + ' 金币', ch.coins >= P.STEAK_PRICE * 5 && ch.steaks <= 4, function () {
      var r = P.buySteak(ch, 5);
      if (!r.ok) return self.flash(r.reason);
      self.afterChange('购买了 5 块牛排，现有 ' + ch.steaks + ' 块');
    });
    shopRow('神秘商人 · 随机装备', '按你当前最高层级的等级产出，保底高品质', P.MYSTERY_COST + ' 秘宝',
      ch.stones >= P.MYSTERY_COST && ch.inventory.length < P.INVENTORY_CAP, function () {
        var ilvl = Math.max(1, highestMlvl(ch));
        var r = P.buyMysteryItem(ch, ilvl);
        if (!r.ok) return self.flash(r.reason);
        var rar = I.RARITY_BY_KEY[r.item.rarity];
        self.afterChange('神秘商人给了你 <span style="color:' + rar.color + '">' + esc(r.item.name) + '</span>（ilvl ' + r.item.ilvl + '）');
      });
    shopRow('强化石 × 5', '铁匠强化装备所需', '3 秘宝', ch.stones >= 3, function () {
      ch.stones -= 3; ch.materials.up += 5;
      self.afterChange('兑换了 5 个强化石');
    });
    shopRow('重铸石 × 2', '铁匠重铸词条所需', '3 秘宝', ch.stones >= 3, function () {
      ch.stones -= 3; ch.materials.re += 2;
      self.afterChange('兑换了 2 个重铸石');
    });

    var help = el('div', 'help');
    help.style.marginTop = '8px';
    help.innerHTML = 'pig-coin 来自击杀与出售；<b>alpha-stone</b> 由首领必掉与稀有掉落获得。';
    body.appendChild(help);
  };

  /** 当前角色可触及的最高怪物等级，用于神秘商人定价 */
  function highestMlvl(ch) {
    var best = 0;
    P.unlockedBiomes(ch).forEach(function (b) {
      var f = P.maxFloor(ch, b);
      var mlvl = SP.BIOMES[b].mlvlBase + (f - 1);
      if (mlvl > best) best = mlvl;
    });
    return best;
  }

  /* -------------------------------------------------------------- 传送门 */
  var BIOME_COLOR = { camp: '#d08a4a', forest: '#7dce86', cave: '#7eb6e8', nest: '#e07aa8' };

  UI.prototype.renderPortal = function () {
    var ch = Accounts.char();
    var wrap = this.$('biomeList');
    var self = this;
    wrap.innerHTML = '';
    var unlocked = P.unlockedBiomes(ch);

    SP.BIOME_ORDER.forEach(function (key) {
      var b = SP.BIOMES[key];
      var isOpen = unlocked.indexOf(key) >= 0;
      var boss = SP.ENEMY_TYPES[b.enemies.boss];
      var bossName = boss ? boss.name : '';
      var item = el('div', 'biome-item' + (isOpen ? '' : ' locked'));
      item.style.setProperty('--biome', BIOME_COLOR[key] || '#9682ff');

      if (!isOpen) {
        var prevKey = SP.BIOME_ORDER[SP.BIOME_ORDER.indexOf(key) - 1];
        var need = P.UNLOCK_REQ[key];
        var have = P.clearedFloor(ch, prevKey);
        var pct = need ? Math.max(0, Math.min(100, 100 * have / need)) : 0;
        item.innerHTML =
          '<div class="bi-top"><div class="bi-name">' + b.name + '</div>' +
          '<span class="bi-flag lock">未解锁</span></div>' +
          '<div class="bi-sub">首领 · ' + esc(bossName) + '</div>' +
          '<div class="bi-sub">通关「' + SP.BIOMES[prevKey].name + '」' + need + ' 层后开启</div>' +
          '<div class="bar" title="解锁进度"><i style="width:' + pct.toFixed(0) + '%"></i></div>' +
          '<div class="tiny muted">' + have + ' / ' + need + ' 层</div>';
        wrap.appendChild(item);
        return;
      }

      var maxF = P.maxFloor(ch, key);
      var cleared = P.clearedFloor(ch, key);
      if (!self.floorPick[key] || self.floorPick[key] > maxF) self.floorPick[key] = maxF;
      var pick = self.floorPick[key];
      var mlvl = b.mlvlBase + (pick - 1);
      item.innerHTML =
        '<div class="bi-top"><div class="bi-name">' + b.name + '</div>' +
        '<div class="bi-side">' +
        '<span class="bi-flag' + (pick > cleared ? '' : ' hidden') + '" id="ff-' + key + '">新层</span>' +
        '<div class="bi-mlvl" id="fm-' + key + '">怪物等级 ' + mlvl + '</div></div></div>' +
        '<div class="bi-sub">首领 · ' + esc(bossName) + ' · 已通关 ' + cleared + ' 层</div>';

      if (maxF > 1) {
        var ctrl = el('div', 'floor-ctrl');
        ctrl.appendChild(el('span', 'tiny muted', '1'));
        var range = doc.createElement('input');
        range.type = 'range';
        range.min = '1';
        range.max = String(maxF);
        range.value = String(pick);
        range.setAttribute('aria-label', b.name + '层数');
        range.addEventListener('input', function () {
          var n = Number(this.value);
          self.floorPick[key] = n;
          var lb = doc.getElementById('fp-' + key);
          if (lb) lb.textContent = String(n);
          var m = doc.getElementById('fm-' + key);
          if (m) m.textContent = '怪物等级 ' + (b.mlvlBase + (n - 1));
          var flag = doc.getElementById('ff-' + key);
          if (flag) flag.classList.toggle('hidden', n <= cleared);
        });
        ctrl.appendChild(range);
        ctrl.appendChild(el('span', 'tiny muted', String(maxF)));
        item.appendChild(ctrl);
      }

      var go = el('button', 'primary go', '进入第 <b id="fp-' + key + '">' + pick + '</b> 层');
      go.addEventListener('click', function () {
        self.sound && self.sound.play('click');
        if (self.hooks.onEnterDungeon) self.hooks.onEnterDungeon(key, self.floorPick[key]);
      });
      item.appendChild(go);
      wrap.appendChild(item);
    });
  };

  /* ---------------------------------------------------------------- 图鉴 */
  UI.prototype.renderBestiary = function () {
    var self = this;
    var ch = Accounts.char();
    var mode = this.bestiaryMode || 'monster';
    if (mode !== 'monster' && mode !== 'gear' && mode !== 'unique') mode = 'monster';
    this.bestiaryMode = mode;

    Array.prototype.forEach.call(doc.querySelectorAll('#bestiaryMode [data-mode]'), function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-mode') === mode);
    });

    var titleEl = this.$('bestiaryTitle');
    var leadEl = this.$('bestiaryLead');
    var countEl = this.$('bestiaryCount');
    var prog;
    if (mode === 'gear') {
      titleEl.textContent = '装备图鉴';
      leadEl.textContent = '获得过的装备型号会解锁条目。记录获得次数与见过的最高品质。';
      prog = P.gearCodexProgress(ch);
    } else if (mode === 'unique') {
      titleEl.textContent = '传说图鉴';
      leadEl.textContent = '获得带独特效果的传说装备后解锁。未收录的显示为「？？？」';
      prog = P.uniqueCodexProgress(ch);
    } else {
      titleEl.textContent = '怪物图鉴';
      leadEl.textContent = '击败过的怪物会解锁条目。未遭遇的显示为「？？？」';
      prog = P.bestiaryProgress(ch);
    }
    countEl.textContent = prog.found + ' / ' + prog.total;

    if (mode === 'unique') this.renderUniqueCodex(ch);
    else if (mode === 'gear') this.renderGearCodex(ch);
    else this.renderMonsterCodex(ch);
  };

  UI.prototype.renderMonsterCodex = function (ch) {
    var self = this;
    var catalog = P.bestiaryCatalog(ch);
    var tabs = this.$('bestiaryTabs');
    tabs.innerHTML = '';
    tabs.classList.remove('hidden');
    if (!SP.BIOMES[this.bestiaryBiome]) this.bestiaryBiome = 'camp';

    catalog.forEach(function (group) {
      var found = group.entries.filter(function (e) { return e.discovered; }).length;
      var btn = el('button', 'bag-tab' + (self.bestiaryBiome === group.biome ? ' on' : ''),
        esc(group.name) + ' <span class="tiny muted">' + found + '/' + group.entries.length + '</span>');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        self.bestiaryBiome = group.biome;
        self.bestiarySel = null;
        self.renderBestiary();
      });
      tabs.appendChild(btn);
    });

    var group = catalog.find(function (g) { return g.biome === self.bestiaryBiome; }) || catalog[0];
    var grid = this.$('bestiaryGrid');
    grid.innerHTML = '';
    if (!group) return;

    var stillValid = group.entries.some(function (e) { return e.key === self.bestiarySel; });
    if (!stillValid) {
      var firstOpen = group.entries.find(function (e) { return e.discovered; });
      self.bestiarySel = firstOpen ? firstOpen.key : group.entries[0].key;
    }

    group.entries.forEach(function (entry) {
      var def = entry.def || {};
      var card = el('button',
        'be-card' + (entry.discovered ? '' : ' locked') + (def.boss ? ' boss' : '') +
        (self.bestiarySel === entry.key ? ' sel' : ''));
      card.type = 'button';
      var name = entry.discovered ? def.name : '？？？';
      var kind = entry.discovered
        ? ((SP.KIND_LABEL && SP.KIND_LABEL[def.kind]) || def.kind || '')
        : '未遭遇';
      var sub = entry.discovered
        ? (kind + ' · 击杀 ' + entry.kills + (entry.elites ? '（精英 ' + entry.elites + '）' : ''))
        : '击败后解锁';
      card.innerHTML =
        '<div class="be-portrait" style="background:' + esc(entry.discovered ? (def.color || '#445') : '#222836') + '"></div>' +
        '<div class="be-meta"><div class="be-name">' + esc(name) + '</div>' +
        '<div class="be-sub">' + esc(sub) + '</div></div>';
      card.addEventListener('click', function () {
        self.bestiarySel = entry.key;
        self.renderBestiary();
      });
      grid.appendChild(card);
    });

    var sel = group.entries.find(function (e) { return e.key === self.bestiarySel; }) || group.entries[0];
    this.renderMonsterDetail(sel);
  };

  UI.prototype.renderMonsterDetail = function (entry) {
    var box = this.$('bestiaryDetail');
    if (!entry || !entry.def) {
      box.innerHTML = '<div class="tiny muted">点选左侧条目查看详情</div>';
      return;
    }
    var def = entry.def;
    if (!entry.discovered) {
      box.innerHTML =
        '<div class="bd-head">' +
        '<div class="bd-portrait" style="background:#222836;filter:grayscale(1) brightness(.45)"></div>' +
        '<div><div class="bd-title">？？？</div>' +
        '<div class="bd-tags"><span class="bd-tag">未遭遇</span></div></div></div>' +
        '<div class="bd-desc">这种怪物尚未被记录。进入对应群系击败它即可解锁图鉴。</div>' +
        '<div class="bd-tip">所属：' + esc((SP.BIOMES[def.biome] && SP.BIOMES[def.biome].name) || '未知') + '</div>';
      return;
    }
    var kind = (SP.KIND_LABEL && SP.KIND_LABEL[def.kind]) || def.kind;
    var tags = '<span class="bd-tag">' + esc(kind) + '</span>' +
      (def.boss ? '<span class="bd-tag boss">首领</span>' : '') +
      '<span class="bd-tag">' + esc((SP.BIOMES[def.biome] && SP.BIOMES[def.biome].name) || '') + '</span>';
    box.innerHTML =
      '<div class="bd-head">' +
      '<div class="bd-portrait" style="background:' + esc(def.color || '#445') + '"></div>' +
      '<div><div class="bd-title">' + esc(def.name) + '</div>' +
      '<div class="bd-tags">' + tags + '</div></div></div>' +
      '<div class="bd-desc">' + esc(def.desc || '暂无描述。') + '</div>' +
      (def.tip ? '<div class="bd-tip">作战提示：' + esc(def.tip) + '</div>' : '') +
      '<div class="bd-stats">' +
      '<div><span>基准生命</span><b>' + Math.round(def.hp) + '</b></div>' +
      '<div><span>基准伤害</span><b>' + Math.round(def.dmg) + '</b></div>' +
      '<div><span>移动速度</span><b>' + Math.round(def.speed) + '</b></div>' +
      '<div><span>攻击距离</span><b>' + Math.round(def.atkRange) + '</b></div>' +
      '<div><span>累计击杀</span><b>' + entry.kills + '</b></div>' +
      '<div><span>精英击杀</span><b>' + entry.elites + '</b></div>' +
      '</div>';
  };

  UI.prototype.renderGearCodex = function (ch) {
    var self = this;
    var catalog = P.gearCodexCatalog(ch);
    var tabs = this.$('bestiaryTabs');
    tabs.innerHTML = '';
    tabs.classList.remove('hidden');
    if (I.GEAR_SLOT_ORDER.indexOf(this.bestiarySlot) < 0) this.bestiarySlot = 'weapon';

    catalog.forEach(function (group) {
      var found = group.entries.filter(function (e) { return e.discovered; }).length;
      var btn = el('button', 'bag-tab' + (self.bestiarySlot === group.slot ? ' on' : ''),
        esc(group.name) + ' <span class="tiny muted">' + found + '/' + group.entries.length + '</span>');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        self.bestiarySlot = group.slot;
        self.bestiarySel = null;
        self.renderBestiary();
      });
      tabs.appendChild(btn);
    });

    var group = catalog.find(function (g) { return g.slot === self.bestiarySlot; }) || catalog[0];
    var grid = this.$('bestiaryGrid');
    grid.innerHTML = '';
    if (!group) return;

    var stillValid = group.entries.some(function (e) { return e.key === self.bestiarySel; });
    if (!stillValid) {
      var firstOpen = group.entries.find(function (e) { return e.discovered; });
      self.bestiarySel = firstOpen ? firstOpen.key : group.entries[0].key;
    }

    group.entries.forEach(function (entry) {
      var def = entry.def || {};
      var card = el('button',
        'be-card' + (entry.discovered ? '' : ' locked') +
        (self.bestiarySel === entry.key ? ' sel' : ''));
      card.type = 'button';
      var name = entry.discovered ? def.name : '？？？';
      var rarity = entry.discovered && entry.bestRarity && I.RARITY_BY_KEY[entry.bestRarity]
        ? I.RARITY_BY_KEY[entry.bestRarity] : null;
      var sub = entry.discovered
        ? ('获得 ' + entry.count + (rarity ? ' · 最高 ' + rarity.name : ''))
        : '获得后解锁';
      var iconUrl = SP.ItemIcons && SP.ItemIcons.url(entry.key);
      var iconHtml = iconUrl
        ? '<img class="be-icon" alt="" src="' + iconUrl + '">'
        : '<div class="be-portrait" style="background:#222836"></div>';
      card.innerHTML =
        iconHtml +
        '<div class="be-meta"><div class="be-name"' +
        (rarity ? ' style="color:' + rarity.color + '"' : '') + '>' + esc(name) + '</div>' +
        '<div class="be-sub">' + esc(sub) + '</div></div>';
      card.addEventListener('click', function () {
        self.bestiarySel = entry.key;
        self.renderBestiary();
      });
      grid.appendChild(card);
    });

    var sel = group.entries.find(function (e) { return e.key === self.bestiarySel; }) || group.entries[0];
    this.renderGearDetail(sel);
  };

  UI.prototype.renderGearDetail = function (entry) {
    var box = this.$('bestiaryDetail');
    if (!entry || !entry.def) {
      box.innerHTML = '<div class="tiny muted">点选左侧条目查看详情</div>';
      return;
    }
    var def = entry.def;
    var slotName = (I.SLOT_META[entry.slot] && I.SLOT_META[entry.slot].name) || entry.slot;
    var iconUrl = SP.ItemIcons && SP.ItemIcons.url(entry.key);
    if (!entry.discovered) {
      box.innerHTML =
        '<div class="bd-head">' +
        (iconUrl
          ? '<img class="bd-icon" alt="" src="' + iconUrl + '" style="filter:grayscale(1) brightness(.35)">'
          : '<div class="bd-portrait" style="background:#222836"></div>') +
        '<div><div class="bd-title">？？？</div>' +
        '<div class="bd-tags"><span class="bd-tag">未收录</span><span class="bd-tag">' + esc(slotName) + '</span></div></div></div>' +
        '<div class="bd-desc">这种装备型号尚未被记录。在副本中掉落或从商人处购得即可解锁。</div>';
      return;
    }
    var rarity = entry.bestRarity && I.RARITY_BY_KEY[entry.bestRarity];
    var tags = '<span class="bd-tag">' + esc(slotName) + '</span>' +
      (rarity ? '<span class="bd-tag" style="color:' + rarity.color + '">最高 ' + esc(rarity.name) + '</span>' : '');
    var wp = entry.slot === 'weapon' ? I.weaponProfile(entry.key) : null;
    if (wp) tags += '<span class="bd-tag">' + esc(wp.label) + '</span>';
    var statLines = Object.keys(def.stats || {}).map(function (k) {
      return '<div><span>' + esc((I.STAT_META[k] && I.STAT_META[k].name) || k) + '</span><b>' +
        esc(I.fmtValue(k, def.stats[k])) + '</b></div>';
    }).join('');
    box.innerHTML =
      '<div class="bd-head">' +
      (iconUrl ? '<img class="bd-icon" alt="" src="' + iconUrl + '">' : '<div class="bd-portrait" style="background:#445"></div>') +
      '<div><div class="bd-title">' + esc(def.name) + '</div>' +
      '<div class="bd-tags">' + tags + '</div></div></div>' +
      '<div class="bd-desc">基础型号属性（随物品等级成长；下表为 1 级基准）。</div>' +
      (wp ? '<div class="bd-tip">攻击方式：' + esc(wp.label) + ' · 射程 ' + Math.round(wp.range) + '</div>' : '') +
      '<div class="bd-stats">' + statLines +
      '<div><span>累计获得</span><b>' + entry.count + '</b></div>' +
      (rarity ? '<div><span>最高品质</span><b class="bd-rarity" style="color:' + rarity.color + '">' + esc(rarity.name) + '</b></div>' : '') +
      '</div>';
  };

  UI.prototype.renderUniqueCodex = function (ch) {
    var self = this;
    var tabs = this.$('bestiaryTabs');
    tabs.innerHTML = '';
    tabs.classList.add('hidden');

    var entries = P.uniqueCodexCatalog(ch);
    var grid = this.$('bestiaryGrid');
    grid.innerHTML = '';

    var stillValid = entries.some(function (e) { return e.key === self.bestiarySel; });
    if (!stillValid) {
      var firstOpen = entries.find(function (e) { return e.discovered; });
      self.bestiarySel = firstOpen ? firstOpen.key : (entries[0] && entries[0].key);
    }

    entries.forEach(function (entry) {
      var def = entry.def || {};
      var card = el('button',
        'be-card' + (entry.discovered ? '' : ' locked') + ' boss' +
        (self.bestiarySel === entry.key ? ' sel' : ''));
      card.type = 'button';
      var name = entry.discovered ? def.name : '？？？';
      var slotHint = def.slots && def.slots.length
        ? def.slots.map(function (s) { return (I.SLOT_META[s] && I.SLOT_META[s].name) || s; }).join('/')
        : '任意部位';
      var sub = entry.discovered ? ('获得 ' + entry.count + ' · ' + slotHint) : '传说掉落解锁';
      card.innerHTML =
        '<div class="be-portrait" style="background:' + (entry.discovered ? 'linear-gradient(135deg,#5a3a12,#c48a3a)' : '#222836') + '"></div>' +
        '<div class="be-meta"><div class="be-name">' + esc(name) + '</div>' +
        '<div class="be-sub">' + esc(sub) + '</div></div>';
      card.addEventListener('click', function () {
        self.bestiarySel = entry.key;
        self.renderBestiary();
      });
      grid.appendChild(card);
    });

    var sel = entries.find(function (e) { return e.key === self.bestiarySel; }) || entries[0];
    this.renderUniqueDetail(sel);
  };

  UI.prototype.renderUniqueDetail = function (entry) {
    var box = this.$('bestiaryDetail');
    if (!entry || !entry.def) {
      box.innerHTML = '<div class="tiny muted">点选左侧条目查看详情</div>';
      return;
    }
    var def = entry.def;
    var slotHint = def.slots && def.slots.length
      ? def.slots.map(function (s) { return (I.SLOT_META[s] && I.SLOT_META[s].name) || s; }).join(' / ')
      : '任意部位';
    if (!entry.discovered) {
      box.innerHTML =
        '<div class="bd-head">' +
        '<div class="bd-portrait" style="background:#222836"></div>' +
        '<div><div class="bd-title">？？？</div>' +
        '<div class="bd-tags"><span class="bd-tag">未收录</span><span class="bd-tag boss">传说</span></div></div></div>' +
        '<div class="bd-desc">这条传说独特效果尚未被记录。掉落传说品质装备时有机会解锁。</div>' +
        '<div class="bd-tip">限定部位：' + esc(slotHint) + '</div>';
      return;
    }
    box.innerHTML =
      '<div class="bd-head">' +
      '<div class="bd-portrait" style="background:linear-gradient(135deg,#5a3a12,#c48a3a)"></div>' +
      '<div><div class="bd-title">' + esc(def.name) + '</div>' +
      '<div class="bd-tags"><span class="bd-tag boss">传说独特</span><span class="bd-tag">' + esc(slotHint) + '</span></div></div></div>' +
      '<div class="bd-desc">' + esc(def.desc || '暂无描述。') + '</div>' +
      '<div class="bd-stats">' +
      '<div><span>累计获得</span><b>' + entry.count + '</b></div>' +
      '</div>';
  };

  /* ---------------------------------------------------------------- 战绩 */
  UI.prototype.renderRecord = function () {
    var ch = Accounts.char();
    var s = ch.stats || {};
    var grid = this.$('recordGrid');
    grid.innerHTML = '';
    var bp = P.bestiaryProgress(ch);
    var gp = P.gearCodexProgress(ch);
    var up = P.uniqueCodexProgress(ch);
    [['本轮次数', s.runs || 0], ['通关次数', s.clears || 0], ['阵亡次数', s.deaths || 0],
     ['累计击杀', s.kills || 0], ['获得装备', s.lootFound || 0], ['角色等级', ch.level],
     ['怪物图鉴', bp.found + ' / ' + bp.total],
     ['装备图鉴', gp.found + ' / ' + gp.total],
     ['传说图鉴', up.found + ' / ' + up.total]
    ].forEach(function (row) {
      grid.appendChild(el('div', 'stat', '<b>' + row[1] + '</b><span>' + row[0] + '</span>'));
    });
    var lines = SP.BIOME_ORDER.map(function (b) {
      var bf = (s.bestFloor && s.bestFloor[b]) || 0;
      return SP.BIOMES[b].name + '：已通关 ' + P.clearedFloor(ch, b) + ' 层' + (bf ? '（最深 ' + bf + '）' : '');
    });
    this.$('recordHelp').innerHTML = lines.join('<br>') +
      '<br><br>副本解锁：营地 3 层 → 森林 4 层 → 洞窟 5 层 → 巢穴（无尽）';
  };

  /* ------------------------------------------------------------- 战斗 HUD */
  UI.prototype.setHudName = function (name, biomeName, floor) {
    this.$('hudName').textContent = name;
    this.$('hudBiome').textContent = biomeName + ' ' + floor + ' 层';
  };
  UI.prototype.resetHud = function () {
    this.hudCache = {}; this.lastSlot = {};
    this.lootFeed = [];
    this.$('lootFeed').innerHTML = '';
  };

  UI.prototype.updateHUD = function (world) {
    var c = this.hudCache, p = world.player, $ = this.$;
    function set(id, val) { if (c[id] !== val) { c[id] = val; $(id).textContent = val; } }
    function width(id, val) { if (c[id] !== val) { c[id] = val; $(id).style.width = val; } }

    set('hudHpText', Math.max(0, Math.round(p.hp)) + ' / ' + Math.round(p.maxHp) +
      (p.shield > 0 ? ' （盾 ' + Math.round(p.shield) + '）' : ''));
    width('hudHpBar', (100 * SP.clamp(p.hp / p.maxHp, 0, 1)).toFixed(1) + '%');
    set('hudLv', 'Lv. ' + p.level);
    var next = SP.xpForLevel(p.level);
    set('hudXpText', Math.floor((world.character && world.character.xp) || 0) + ' / ' + next);
    width('hudXpBar', (100 * SP.clamp(((world.character && world.character.xp) || 0) / next, 0, 1)).toFixed(1) + '%');
    set('hudQuotaText', Math.min(world.kills, world.killsNeeded) + ' / ' + world.killsNeeded);
    width('hudQuotaBar', (100 * SP.clamp(world.kills / world.killsNeeded, 0, 1)).toFixed(1) + '%');
    set('hudCoins', world.coins);
    set('hudTimer', SP.fmtTime(world.time));
    set('hudKills', world.kills);
    set('steakCnt', world.steaks);

    var cds = world.cooldowns();
    this.slotCd('slotQuake', cds.quake);
    this.slotCd('slotBless', cds.bless);
    this.slotCd('slotDash', cds.dash);
    this.slotCd('slotSteak', cds.steak);

    var comboEl = $('hudCombo');
    if (world.combo >= 5 && world.comboT > 0) {
      comboEl.classList.add('on');
      comboEl.textContent = '连杀 ×' + world.combo;
    } else comboEl.classList.remove('on');

    var boss = null;
    for (var i = 0; i < world.enemies.length; i++) {
      var e = world.enemies[i];
      if (e.boss && e.dying <= 0) { boss = e; break; }
    }
    var bb = $('bossBar');
    if (boss) {
      bb.classList.add('on');
      if (c.bossName !== boss.name) { c.bossName = boss.name; $('bossName').textContent = boss.name; }
      width('bossHpBar', (100 * SP.clamp(boss.hp / boss.maxHp, 0, 1)).toFixed(1) + '%');
    } else if (bb.classList.contains('on')) {
      bb.classList.remove('on');
    }
  };

  UI.prototype.slotCd = function (id, cd) {
    var node = this.$(id);
    if (!node) return;
    var frac = cd.total > 0 ? SP.clamp(cd.left / cd.total, 0, 1) : 0;
    var last = this.lastSlot[id] || { f: -1, t: -1 };
    var fRound = Math.round(frac * 40) / 40;
    if (last.f !== fRound) {
      last.f = fRound;
      node.querySelector('.cd').style.transform = 'scaleY(' + fRound.toFixed(3) + ')';
      node.classList.toggle('ready', fRound <= 0);
    }
    var txt = cd.left > 0.05 ? cd.left.toFixed(1) : '';
    if (last.t !== txt) { last.t = txt; node.querySelector('.cdt').textContent = txt; }
    this.lastSlot[id] = last;
  };

  UI.prototype.pushLoot = function (item) {
    var feed = this.$('lootFeed');
    if (!feed) return;
    var rar = I.RARITY_BY_KEY[item.rarity];
    var node = el('div', 'loot-toast', this.iconHtml(item) +
      '<span style="color:' + rar.color + '">' + esc(item.name) + '</span>');
    node.style.borderLeftColor = rar.color;
    feed.appendChild(node);
    while (feed.children.length > 5) feed.removeChild(feed.firstChild);
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 4500);
  };

  UI.prototype.setPing = function (ms) {
    var txt = ms + ' ms';
    if (this.hudCache.ping === txt) return;
    this.hudCache.ping = txt;
    ['hudPing', 'hubPing', 'loginPing'].forEach(function (id) {
      var e = doc.getElementById(id);
      if (e) e.textContent = (id === 'hudPing' ? '' : '延迟 ') + txt;
    });
  };

  UI.prototype.banner = function (text, color) {
    var e = this.$('banner');
    if (!e) return;
    e.textContent = text;
    e.style.color = color || '#ffb87a';
    e.classList.remove('show');
    void e.offsetWidth;
    e.classList.add('show');
  };

  /* ------------------------------------------------------------ 暂停 / 结算 */
  UI.prototype.showPause = function (on) { this.$('pauseOverlay').classList.toggle('active', !!on); };
  UI.prototype.isPauseOpen = function () { return this.$('pauseOverlay').classList.contains('active'); };
  UI.prototype.isResultOpen = function () { return this.$('resultOverlay').classList.contains('active'); };
  UI.prototype.hideResult = function () { this.$('resultOverlay').classList.remove('active'); };

  UI.prototype.showResult = function (summary, cleared) {
    var self = this;
    this.$('resTitle').textContent = cleared ? '通关！' : '小猪倒下了';
    this.$('resTitle').style.color = cleared ? '#9dffb0' : '#ff9ec4';
    this.$('resSub').textContent = summary.biomeName + ' 第 ' + summary.floor + ' 层 · 怪物等级 ' + summary.mlvl +
      (cleared ? ' · 已解锁更深层' : ' · 本层未通关');
    this.$('resTime').textContent = SP.fmtTime(summary.time);
    this.$('resKills').textContent = summary.kills;
    this.$('resCoins').textContent = summary.coins;
    this.$('resMats').textContent = summary.upStones;
    this.$('resLootCount').textContent = summary.loot.length;
    var list = this.$('resLoot');
    list.innerHTML = '';
    if (!summary.loot.length) {
      list.appendChild(el('div', 'tiny muted', '这一趟没有拾取到装备。'));
    } else {
      summary.loot.slice().sort(function (a, b) { return I.power(b) - I.power(a); }).forEach(function (it) {
        var rar = I.RARITY_BY_KEY[it.rarity];
        var line = el('div', 'loot-line');
        line.innerHTML = '<div class="ll-slot" style="border-color:' + rar.color + ';color:' + rar.color + '">' +
          self.iconHtml(it) + '</div>' +
          '<div class="ll-name" style="color:' + rar.color + '">' + esc(it.name) + (it.upgrade ? ' +' + it.upgrade : '') + '</div>' +
          '<div class="ll-pow">ilvl ' + it.ilvl + ' · 战力 ' + I.power(it) + '</div>';
        list.appendChild(line);
      });
    }
    this.$('btnDeeper').classList.toggle('hidden', !cleared);
    this.$('resultOverlay').classList.add('active');
  };

  /* ------------------------------------------------------- 闲置动画循环 */
  UI.prototype.startIdleLoop = function () {
    var self = this;
    function frame(now) {
      global.requestAnimationFrame(frame);
      self.t = now / 1000;
    }
    global.requestAnimationFrame(frame);
  };

  SP.Accounts = Accounts;
  SP.UI = UI;
  SP.highestMlvl = highestMlvl;
})(typeof globalThis !== 'undefined' ? globalThis : this);
