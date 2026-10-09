/* 大厅状态：现身、组队、房主权威副本中继 */

export function createLobby(opts = {}) {
  const maxPeers = opts.maxPeers || 64;
  const maxParty = opts.maxParty || 4;
  let nextId = 1;
  const peers = new Map();
  const parties = new Map();
  const startedAt = Date.now();

  function publicPeer(p) {
    return {
      id: p.id, name: p.name, level: p.level,
      x: p.x, y: p.y, facing: p.facing, walkPhase: p.walkPhase,
      partyId: p.partyId || null, inDungeon: !!p.inDungeon
    };
  }

  function broadcast(msg, exceptId) {
    for (const p of peers.values()) {
      if (exceptId && p.id === exceptId) continue;
      p.ws.send(msg);
    }
  }

  function partyPublic(party) {
    if (!party) return null;
    return {
      id: party.id,
      leaderId: party.leaderId,
      dungeon: party.dungeon ? {
        hostId: party.dungeon.hostId,
        biome: party.dungeon.biome,
        floor: party.dungeon.floor
      } : null,
      members: [...party.members].map((id) => {
        const p = peers.get(id);
        return p ? { id: p.id, name: p.name, level: p.level } : { id, name: '?', level: 1 };
      })
    };
  }

  function dissolveParty(partyId, reason) {
    const party = parties.get(partyId);
    if (!party) return;
    for (const id of party.members) {
      const p = peers.get(id);
      if (!p) continue;
      p.partyId = null;
      p.inDungeon = false;
      p.ws.send({ t: 'party_update', party: null, reason: reason || '解散' });
    }
    parties.delete(partyId);
  }

  function leavePartyMember(peer, silent) {
    const party = parties.get(peer.partyId);
    if (!party) return;
    party.members.delete(peer.id);
    peer.partyId = null;
    peer.inDungeon = false;
    if (!silent) peer.ws.send({ t: 'party_update', party: null, reason: '已离队' });
    if (party.members.size === 0) {
      parties.delete(party.id);
      return;
    }
    if (party.leaderId === peer.id) party.leaderId = [...party.members][0];
    const pub = partyPublic(party);
    for (const id of party.members) {
      const m = peers.get(id);
      if (m) m.ws.send({ t: 'party_update', party: pub });
    }
  }

  function addPeer(ws) {
    if (peers.size >= maxPeers) {
      ws.send({ t: 'toast', text: '服务器已满，稍后再试' });
      ws.close();
      return null;
    }
    const id = 'u' + nextId++;
    const peer = {
      id, name: '旅人', level: 1,
      x: 1100, y: 900, facing: -Math.PI / 2, walkPhase: 0,
      partyId: null, inDungeon: false, character: null,
      lastSeen: Date.now(), lastHubPos: 0, ws
    };
    peers.set(id, peer);
    return peer;
  }

  function removePeer(peer) {
    if (!peers.has(peer.id)) return;
    peers.delete(peer.id);
    if (peer.partyId) leavePartyMember(peer, true);
    broadcast({ t: 'peer_leave', id: peer.id }, null);
  }

  function touch(peer) {
    peer.lastSeen = Date.now();
  }

  function handleMessage(peer, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    touch(peer);

    if (msg.t === 'ping') {
      peer.ws.send({ t: 'pong', ts: msg.ts || Date.now() });
      return;
    }

    if (msg.t === 'hello') {
      peer.name = String(msg.name || '旅人').slice(0, 16);
      peer.level = Math.max(1, Math.round(Number(msg.level) || 1));
      peer.x = Number(msg.x) || 1100;
      peer.y = Number(msg.y) || 900;
      peer.facing = Number(msg.facing) || -Math.PI / 2;
      peer.ws.send({
        t: 'welcome',
        id: peer.id,
        server: { version: opts.version || '2.11.3', maxParty, maxPeers },
        peers: [...peers.values()].filter((p) => p.id !== peer.id).map(publicPeer)
      });
      broadcast({ t: 'peer_join', peer: publicPeer(peer) }, peer.id);
      return;
    }

    if (msg.t === 'hub_pos') {
      if (peer.inDungeon) return;
      const now = Date.now();
      if (now - peer.lastHubPos < 40) return; // 节流 ~25Hz
      peer.lastHubPos = now;
      peer.x = Number(msg.x) || peer.x;
      peer.y = Number(msg.y) || peer.y;
      peer.facing = Number(msg.facing) || peer.facing;
      peer.walkPhase = Number(msg.walkPhase) || 0;
      peer.level = Math.max(1, Math.round(Number(msg.level) || peer.level));
      broadcast({
        t: 'hub_pos',
        id: peer.id,
        x: peer.x, y: peer.y, facing: peer.facing, walkPhase: peer.walkPhase, level: peer.level
      }, peer.id);
      return;
    }

    if (msg.t === 'char_sync') {
      if (msg.character && typeof msg.character === 'object') {
        peer.character = msg.character;
        peer.level = Math.max(1, Math.round(Number(msg.character.level) || peer.level));
        peer.name = String(msg.name || peer.name).slice(0, 16);
      }
      return;
    }

    if (msg.t === 'party_create') {
      if (peer.partyId) dissolveParty(peer.partyId, '重建队伍');
      const id = 'p' + nextId++;
      const party = { id, leaderId: peer.id, members: new Set([peer.id]), dungeon: null };
      parties.set(id, party);
      peer.partyId = id;
      peer.ws.send({ t: 'party_update', party: partyPublic(party) });
      return;
    }

    if (msg.t === 'party_invite') {
      const party = parties.get(peer.partyId);
      if (!party || party.leaderId !== peer.id) return;
      if (party.members.size >= maxParty) {
        peer.ws.send({ t: 'toast', text: '队伍已满（最多 ' + maxParty + ' 人）' });
        return;
      }
      const target = peers.get(msg.toId);
      if (!target || target.partyId || target.inDungeon) {
        peer.ws.send({ t: 'toast', text: '对方无法入队' });
        return;
      }
      target.ws.send({
        t: 'party_invite',
        fromId: peer.id, fromName: peer.name, partyId: party.id
      });
      return;
    }

    if (msg.t === 'party_accept') {
      const party = parties.get(msg.partyId);
      if (!party || peer.partyId) return;
      if (party.members.size >= maxParty) {
        peer.ws.send({ t: 'toast', text: '队伍已满' });
        return;
      }
      party.members.add(peer.id);
      peer.partyId = party.id;
      const pub = partyPublic(party);
      for (const id of party.members) {
        const m = peers.get(id);
        if (m) m.ws.send({ t: 'party_update', party: pub });
      }
      return;
    }

    if (msg.t === 'party_leave') {
      leavePartyMember(peer, false);
      return;
    }

    if (msg.t === 'dungeon_start') {
      const party = parties.get(peer.partyId);
      const solo = !party;
      const memberIds = solo ? [peer.id] : [...party.members];
      if (!solo && party.leaderId !== peer.id) {
        peer.ws.send({ t: 'toast', text: '只有队长可以发车' });
        return;
      }
      const seed = (Number(msg.seed) || (Date.now() ^ Math.floor(Math.random() * 1e9))) >>> 0;
      const biome = String(msg.biome || 'camp').slice(0, 32);
      const floor = Math.max(1, Math.round(Number(msg.floor) || 1));
      const roster = Array.isArray(msg.roster) ? msg.roster : [];
      const byId = {};
      roster.forEach((r) => { if (r && r.id) byId[r.id] = r; });

      const startMsg = {
        t: 'dungeon_start',
        hostId: peer.id,
        seed, biome, floor,
        partyId: solo ? null : party.id,
        roster: memberIds.map((id) => {
          const p = peers.get(id);
          const packed = byId[id] || {};
          return {
            id,
            name: packed.name || (p && p.name) || '旅人',
            character: packed.character || (p && p.character) || {
              level: (p && p.level) || 1, equipped: {}, steaks: 3
            }
          };
        })
      };

      for (const id of memberIds) {
        const p = peers.get(id);
        if (!p) continue;
        p.inDungeon = true;
        p.ws.send(startMsg);
      }
      if (party) party.dungeon = { hostId: peer.id, seed, biome, floor };
      for (const id of memberIds) {
        broadcast({ t: 'peer_dungeon', id, inDungeon: true }, null);
      }
      return;
    }

    if (msg.t === 'dungeon_input' || msg.t === 'dungeon_snap' || msg.t === 'dungeon_event') {
      const party = parties.get(peer.partyId);
      const targets = party ? [...party.members] : [peer.id];
      const forward = Object.assign({}, msg, { fromId: peer.id });
      // 快照仅房主可发
      if (msg.t === 'dungeon_snap' && party && party.dungeon && party.dungeon.hostId !== peer.id) {
        return;
      }
      for (const id of targets) {
        if (id === peer.id) continue;
        const p = peers.get(id);
        if (p) p.ws.send(forward);
      }
      return;
    }

    if (msg.t === 'dungeon_end') {
      const party = parties.get(peer.partyId);
      const targets = party ? [...party.members] : [peer.id];
      if (party && party.dungeon && party.dungeon.hostId !== peer.id) {
        peer.ws.send({ t: 'toast', text: '只有房主可以结束副本' });
        return;
      }
      for (const id of targets) {
        const p = peers.get(id);
        if (!p) continue;
        p.inDungeon = false;
        if (id !== peer.id) p.ws.send(msg);
        broadcast({ t: 'peer_dungeon', id, inDungeon: false }, null);
      }
      if (party) party.dungeon = null;
      return;
    }

    if (msg.t === 'chat') {
      const text = String(msg.text || '').slice(0, 80);
      if (!text) return;
      broadcast({ t: 'chat', id: peer.id, name: peer.name, text }, null);
    }
  }

  /** 踢掉超时无心跳的连接 */
  function sweepStale(timeoutMs) {
    const now = Date.now();
    for (const p of [...peers.values()]) {
      if (now - p.lastSeen > timeoutMs) {
        p.ws.send({ t: 'toast', text: '连接超时' });
        p.ws.close();
        removePeer(p);
      }
    }
  }

  function status() {
    return {
      ok: true,
      name: '时空猪联机服务',
      version: opts.version || '2.11.3',
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      online: peers.size,
      maxPeers,
      parties: parties.size,
      peers: [...peers.values()].map(publicPeer),
      rooms: [...parties.values()].map(partyPublic)
    };
  }

  return {
    addPeer, removePeer, handleMessage, sweepStale, status,
    get peers() { return peers; },
    get parties() { return parties; }
  };
}
