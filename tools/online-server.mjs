/* 时空猪 · 多人联机服务器（零依赖）：静态站 + WebSocket 大厅
 *
 * 用法: node tools/online-server.mjs [port]
 * 默认 http://127.0.0.1:4321  （同一端口升级 WebSocket）
 *
 * 职责：大厅现身、组队、房主权威副本的输入转发与快照广播。
 * 不跑战斗逻辑 —— 战斗仍在客户端（房主）模拟。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2] || 4321);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4'
};

/* ------------------------------------------------------------ 极简 WebSocket */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

function encodeText(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrames(buf) {
  const out = [];
  let i = 0;
  while (i + 2 <= buf.length) {
    const b0 = buf[i];
    const b1 = buf[i + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let off = i + 2;
    if (len === 126) {
      if (off + 2 > buf.length) break;
      len = buf.readUInt16BE(off);
      off += 2;
    } else if (len === 127) {
      if (off + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(off));
      off += 8;
    }
    const maskOff = masked ? off : -1;
    if (masked) off += 4;
    if (off + len > buf.length) break;
    let payload = buf.subarray(off, off + len);
    if (masked) {
      const mask = buf.subarray(maskOff, maskOff + 4);
      const copy = Buffer.alloc(len);
      for (let j = 0; j < len; j++) copy[j] = payload[j] ^ mask[j % 4];
      payload = copy;
    }
    i = off + len;
    if (opcode === 0x8) { out.push({ type: 'close' }); continue; }
    if (opcode === 0x9) { out.push({ type: 'ping', data: payload }); continue; }
    if (opcode === 0x1) out.push({ type: 'text', data: payload.toString('utf8') });
  }
  return { messages: out, rest: buf.subarray(i) };
}

function attachSocket(socket, onMessage, onClose) {
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { messages, rest } = decodeFrames(buf);
    buf = rest;
    for (const m of messages) {
      if (m.type === 'close') { socket.end(); return; }
      if (m.type === 'ping') {
        const pong = Buffer.alloc(2 + m.data.length);
        pong[0] = 0x8a;
        pong[1] = m.data.length;
        m.data.copy(pong, 2);
        socket.write(pong);
        continue;
      }
      if (m.type === 'text') onMessage(m.data);
    }
  });
  socket.on('close', () => onClose());
  socket.on('error', () => onClose());
  return {
    send(obj) {
      try { socket.write(encodeText(JSON.stringify(obj))); } catch { /* ignore */ }
    },
    close() { try { socket.end(); } catch { /* ignore */ } }
  };
}

/* ---------------------------------------------------------------- 大厅状态 */
let nextId = 1;
const peers = new Map(); // id -> { id, name, level, x, y, facing, walkPhase, partyId, ws, inDungeon }
const parties = new Map(); // partyId -> { id, leaderId, members:Set, dungeon }

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

function handleMessage(peer, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg.t !== 'string') return;

  if (msg.t === 'hello') {
    peer.name = String(msg.name || '旅人').slice(0, 16);
    peer.level = Math.max(1, Math.round(Number(msg.level) || 1));
    peer.x = Number(msg.x) || 1100;
    peer.y = Number(msg.y) || 900;
    peer.facing = Number(msg.facing) || -Math.PI / 2;
    peer.ws.send({
      t: 'welcome',
      id: peer.id,
      peers: [...peers.values()].filter((p) => p.id !== peer.id).map(publicPeer)
    });
    broadcast({ t: 'peer_join', peer: publicPeer(peer) }, peer.id);
    return;
  }

  if (msg.t === 'hub_pos') {
    if (peer.inDungeon) return;
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
    if (party.members.size >= 4) {
      peer.ws.send({ t: 'toast', text: '队伍已满（最多 4 人）' });
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
    if (party.members.size >= 4) {
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
    const party = parties.get(peer.partyId);
    if (!party) return;
    party.members.delete(peer.id);
    peer.partyId = null;
    peer.inDungeon = false;
    peer.ws.send({ t: 'party_update', party: null, reason: '已离队' });
    if (party.members.size === 0) {
      parties.delete(party.id);
      return;
    }
    if (party.leaderId === peer.id) {
      party.leaderId = [...party.members][0];
    }
    const pub = partyPublic(party);
    for (const id of party.members) {
      const m = peers.get(id);
      if (m) m.ws.send({ t: 'party_update', party: pub });
    }
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
    const biome = String(msg.biome || 'camp');
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
    broadcast({ t: 'peer_dungeon', id: peer.id, inDungeon: true }, null);
    for (const id of memberIds) {
      if (id !== peer.id) broadcast({ t: 'peer_dungeon', id, inDungeon: true }, null);
    }
    return;
  }

  if (msg.t === 'dungeon_input' || msg.t === 'dungeon_snap' || msg.t === 'dungeon_event') {
    const party = parties.get(peer.partyId);
    const targets = party ? [...party.members] : [peer.id];
    const forward = Object.assign({}, msg, { fromId: peer.id });
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

/* ----------------------------------------------------------- HTTP + 升级 */
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/') rel = '/index.html';
  if (rel === '/api/online') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true, online: peers.size,
      peers: [...peers.values()].map(publicPeer)
    }));
    return;
  }
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').split('?')[0] !== '/ws') {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + acceptKey(key),
    '', ''
  ].join('\r\n');
  socket.write(headers);
  if (head && head.length) socket.unshift(head);

  const id = 'u' + nextId++;
  const peer = {
    id, name: '旅人', level: 1,
    x: 1100, y: 900, facing: -Math.PI / 2, walkPhase: 0,
    partyId: null, inDungeon: false, ws: null
  };
  const ws = attachSocket(socket, (data) => handleMessage(peer, data), () => {
    peers.delete(id);
    if (peer.partyId) {
      const party = parties.get(peer.partyId);
      if (party) {
        party.members.delete(id);
        if (party.members.size === 0) parties.delete(party.id);
        else {
          if (party.leaderId === id) party.leaderId = [...party.members][0];
          const pub = partyPublic(party);
          for (const mid of party.members) {
            const m = peers.get(mid);
            if (m) m.ws.send({ t: 'party_update', party: pub });
          }
        }
      }
    }
    broadcast({ t: 'peer_leave', id }, null);
  });
  peer.ws = ws;
  peers.set(id, peer);
});

server.listen(port, '0.0.0.0', () => {
  console.log('时空猪 · 多人联机');
  console.log('  HTTP  http://127.0.0.1:' + port);
  console.log('  WS    ws://127.0.0.1:' + port + '/ws');
  console.log('打开页面后点「联机」接入大厅；队长发车可组队进本，也可单刷。');
});
