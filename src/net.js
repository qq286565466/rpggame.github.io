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

  function OnlineClient(opts) {
    opts = opts || {};
    this.url = opts.url || defaultWsUrl();
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.peers = {}; // id -> peer
    this.party = null;
    this.handlers = {};
    this._posAcc = 0;
    this.pendingInvite = null;
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
    profile = profile || {};
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      this.disconnect();
    }
    var url = this.url;
    var ws;
    try { ws = new WebSocket(url); }
    catch (e) {
      this.emit('error', { reason: '无法创建连接：' + (e && e.message) });
      return;
    }
    this.ws = ws;
    ws.onopen = function () {
      self.connected = true;
      self.send({
        t: 'hello',
        name: profile.name || '旅人',
        level: profile.level || 1,
        x: profile.x, y: profile.y, facing: profile.facing
      });
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
      self.emit('close', {});
    };
    ws.onerror = function () {
      self.emit('error', { reason: '联机连接失败（请确认已运行 npm run online）' });
    };
  };

  OnlineClient.prototype.disconnect = function () {
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
    if (msg.t === 'welcome') {
      this.id = msg.id;
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
