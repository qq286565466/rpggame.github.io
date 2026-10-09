/* 时空猪 · net.js — 多人联机客户端（WebSocket 大厅 / 组队 / 副本中继）
 * 纯逻辑封装，不触碰 DOM；由 ui / main 驱动。
 */
(function (global) {
  'use strict';
  var SP = global.SP || (global.SP = {});

  function defaultWsUrl() {
    if (typeof location === 'undefined') return 'ws://127.0.0.1:4321/ws';
    if (location.protocol === 'file:') return 'ws://127.0.0.1:4321/ws';
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws';
  }

  /**
   * 规范化联机地址（Minecraft 式 host:port / SakuraFrp 穿透常用）。
   * - http→ws、https→wss
   * - 无端口的 ws:// 默认补 :4321（类似 MC 默认端口习惯）
   * - 自动补 /ws
   * - 支持只填 host、host:port、完整 URL
   */
  function normalizeWsUrl(raw) {
    var u = String(raw == null ? '' : raw).trim();
    if (!u) return defaultWsUrl();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'ws://' + u;
    u = u.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    // 去掉哈希与查询
    u = u.split('#')[0].split('?')[0];
    u = u.replace(/\/+$/, '');
    try {
      var parsed = new URL(u);
      // 纯 ws 且未写端口 → 默认 4321（Minecraft 式「只填 IP」）
      if (parsed.protocol === 'ws:' && !parsed.port) {
        parsed.port = '4321';
        u = parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''));
      }
    } catch (e) { /* keep u */ }
    if (!/\/ws$/i.test(u)) u += '/ws';
    return u;
  }

  /** 把地址收成 Minecraft 式「主机:端口」展示（用于服务器列表） */
  function toServerAddress(raw) {
    var ws = normalizeWsUrl(raw);
    try {
      var p = new URL(ws);
      var port = p.port || (p.protocol === 'wss:' ? '443' : '4321');
      return p.hostname + ':' + port;
    } catch (e) {
      return String(raw == null ? '' : raw).trim();
    }
  }

  /** 由联机地址得到 HTTP 状态探测 URL */
  function statusHttpUrl(raw) {
    var ws = normalizeWsUrl(raw);
    return ws.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:').replace(/\/ws$/i, '') + '/api/status';
  }

  /**
   * 探测服务器是否在线（类似 MC 多人列表刷新 MOTD / 人数）。
   * 返回 Promise<{ ok, rtt?, online?, version?, error? }>
   */
  function probeServer(raw, timeoutMs) {
    timeoutMs = timeoutMs || 2500;
    var url = statusHttpUrl(raw);
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) try { ctrl.abort(); } catch (e) { /* ignore */ }
    }, timeoutMs);
    var t0 = Date.now();
    var opts = { cache: 'no-store' };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      return {
        ok: true,
        rtt: Date.now() - t0,
        online: j && j.online != null ? j.online : null,
        version: j && j.version ? j.version : null,
        maxPeers: j && j.maxPeers != null ? j.maxPeers : null
      };
    }).catch(function (e) {
      return { ok: false, error: (e && e.name === 'AbortError') ? '超时' : ((e && e.message) || '不可达') };
    }).then(function (res) {
      clearTimeout(timer);
      return res;
    });
  }

  function OnlineClient(opts) {
    opts = opts || {};
    this.url = normalizeWsUrl(opts.url || defaultWsUrl());
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.peers = {}; // id -> peer
    this.party = null;
    this.handlers = {};
    this._posAcc = 0;
    this.pendingInvite = null;
    this._profile = null;
    this._wantConnect = false;
    this._heartbeat = null;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;
    this.autoReconnect = opts.autoReconnect !== false;
    this.rttMs = null;
    this.serverInfo = null;
  }

  OnlineClient.prototype.on = function (type, fn) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(fn);
  };

  OnlineClient.prototype.emit = function (type, data) {
    var list = this.handlers[type] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { /* ignore */ }
    }
  };

  OnlineClient.prototype.connect = function (profile) {
    var self = this;
    profile = profile || this._profile || {};
    this._profile = profile;
    this._wantConnect = true;
    this._clearReconnect();
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      this._manualClose = true;
      this.disconnect();
    }
    this._manualClose = false;
    var url = this.url;
    var ws;
    try { ws = new WebSocket(url); }
    catch (e) {
      this.emit('error', { reason: '无法创建连接：' + (e && e.message) });
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = function () {
      self.connected = true;
      self._reconnectAttempt = 0;
      self.send({
        t: 'hello',
        name: profile.name || '旅人',
        level: profile.level || 1,
        x: profile.x, y: profile.y, facing: profile.facing
      });
      self._startHeartbeat();
      self.emit('open', {});
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      self._handle(msg);
    };
    ws.onclose = function () {
      self.connected = false;
      self.id = null;
      self.peers = {};
      self.party = null;
      self._stopHeartbeat();
      self.emit('close', {});
      if (self._wantConnect && !self._manualClose && self.autoReconnect) {
        self._scheduleReconnect();
      }
    };
    ws.onerror = function () {
      self.emit('error', { reason: '无法加入服务器（请确认服主已开服，地址与端口正确）' });
    };
  };

  OnlineClient.prototype._startHeartbeat = function () {
    var self = this;
    this._stopHeartbeat();
    this._heartbeat = setInterval(function () {
      if (!self.connected) return;
      self.send({ t: 'ping', ts: Date.now() });
    }, 10000);
  };

  OnlineClient.prototype._stopHeartbeat = function () {
    if (this._heartbeat) {
      clearInterval(this._heartbeat);
      this._heartbeat = null;
    }
  };

  OnlineClient.prototype._clearReconnect = function () {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  };

  OnlineClient.prototype._scheduleReconnect = function () {
    var self = this;
    if (!this.autoReconnect || !this._wantConnect) return;
    this._clearReconnect();
    var attempt = this._reconnectAttempt++;
    var delay = Math.min(15000, 800 * Math.pow(1.6, attempt));
    this.emit('reconnecting', { attempt: attempt + 1, delay: delay });
    this._reconnectTimer = setTimeout(function () {
      self._reconnectTimer = null;
      if (self._wantConnect) self.connect(self._profile);
    }, delay);
  };

  OnlineClient.prototype.disconnect = function () {
    this._wantConnect = false;
    this._manualClose = true;
    this._clearReconnect();
    this._stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* ignore */ }
    }
    this.ws = null;
    this.connected = false;
  };

  OnlineClient.prototype.send = function (msg) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try { this.ws.send(JSON.stringify(msg)); return true; }
    catch (e) { return false; }
  };

  OnlineClient.prototype._handle = function (msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'pong') {
      if (msg.ts) this.rttMs = Math.max(0, Date.now() - msg.ts);
      this.emit('pong', msg);
      return;
    }
    if (msg.t === 'welcome') {
      this.id = msg.id;
      this.serverInfo = msg.server || null;
      this.peers = {};
      (msg.peers || []).forEach(function (p) { this.peers[p.id] = p; }, this);
      this.emit('welcome', msg);
      this.emit('peers', this.peerList());
      return;
    }
    if (msg.t === 'peer_join') {
      if (msg.peer) this.peers[msg.peer.id] = msg.peer;
      this.emit('peer_join', msg.peer);
      this.emit('peers', this.peerList());
      return;
    }
    if (msg.t === 'peer_leave') {
      delete this.peers[msg.id];
      this.emit('peer_leave', msg);
      this.emit('peers', this.peerList());
      return;
    }
    if (msg.t === 'hub_pos') {
      var p = this.peers[msg.id];
      if (!p) {
        p = { id: msg.id, name: '旅人', level: 1 };
        this.peers[msg.id] = p;
      }
      p.x = msg.x; p.y = msg.y; p.facing = msg.facing;
      p.walkPhase = msg.walkPhase; p.level = msg.level || p.level;
      this.emit('hub_pos', msg);
      return;
    }
    if (msg.t === 'peer_dungeon') {
      var q = this.peers[msg.id];
      if (q) q.inDungeon = !!msg.inDungeon;
      this.emit('peers', this.peerList());
      return;
    }
    if (msg.t === 'party_update') {
      this.party = msg.party || null;
      this.emit('party', this.party);
      return;
    }
    if (msg.t === 'party_invite') {
      this.pendingInvite = msg;
      this.emit('invite', msg);
      return;
    }
    if (msg.t === 'toast') {
      this.emit('toast', msg);
      return;
    }
    if (msg.t === 'chat') {
      this.emit('chat', msg);
      return;
    }
    if (msg.t === 'dungeon_start' || msg.t === 'dungeon_input' ||
        msg.t === 'dungeon_snap' || msg.t === 'dungeon_event' || msg.t === 'dungeon_end') {
      this.emit(msg.t, msg);
      return;
    }
  };

  OnlineClient.prototype.peerList = function () {
    var out = [];
    Object.keys(this.peers).forEach(function (id) { out.push(this.peers[id]); }, this);
    return out;
  };

  OnlineClient.prototype.tickHub = function (dt, hideout, profile) {
    if (!this.connected || !hideout) return;
    this._posAcc += dt;
    if (this._posAcc < 0.08) return;
    this._posAcc = 0;
    var p = hideout.player;
    this.send({
      t: 'hub_pos',
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      facing: Math.round(p.facing * 100) / 100,
      walkPhase: Math.round((p.walkPhase || 0) * 100) / 100,
      level: profile && profile.level
    });
  };

  OnlineClient.prototype.createParty = function () { this.send({ t: 'party_create' }); };
  OnlineClient.prototype.leaveParty = function () { this.send({ t: 'party_leave' }); };
  OnlineClient.prototype.invite = function (toId) { this.send({ t: 'party_invite', toId: toId }); };
  OnlineClient.prototype.acceptInvite = function (partyId) {
    this.send({ t: 'party_accept', partyId: partyId });
    this.pendingInvite = null;
  };

  OnlineClient.prototype.syncCharacter = function (name, character) {
    return this.send({
      t: 'char_sync',
      name: name || '旅人',
      character: OnlineClient.packCharacter(character)
    });
  };

  OnlineClient.prototype.startDungeon = function (opts) {
    opts = opts || {};
    return this.send({
      t: 'dungeon_start',
      biome: opts.biome,
      floor: opts.floor,
      seed: opts.seed,
      roster: opts.roster || []
    });
  };

  OnlineClient.prototype.sendDungeonInput = function (input) {
    return this.send({ t: 'dungeon_input', input: input });
  };

  OnlineClient.prototype.sendDungeonSnap = function (snap) {
    return this.send({ t: 'dungeon_snap', snap: snap });
  };

  OnlineClient.prototype.sendDungeonEnd = function (payload) {
    return this.send({ t: 'dungeon_end', result: payload || {} });
  };

  OnlineClient.defaultWsUrl = defaultWsUrl;
  OnlineClient.normalizeWsUrl = normalizeWsUrl;
  OnlineClient.toServerAddress = toServerAddress;
  OnlineClient.statusHttpUrl = statusHttpUrl;
  OnlineClient.probeServer = probeServer;
  OnlineClient.DEFAULT_PORT = 4321;
  OnlineClient.packCharacter = function (ch) {
    ch = ch || {};
    return {
      level: ch.level || 1,
      xp: ch.xp || 0,
      steaks: Math.min(9, ch.steaks || 0),
      equipped: ch.equipped || {}
    };
  };

  SP.OnlineClient = OnlineClient;
})(typeof globalThis !== 'undefined' ? globalThis : this);
