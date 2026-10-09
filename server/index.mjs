#!/usr/bin/env node
/* 时空猪 · 联机服务端（零依赖）
 *
 * 提供：
 *   - HTTP 静态站点（游戏本体）
 *   - WebSocket /ws 大厅（现身 / 组队 / 房主权威副本中继）
 *   - REST：/api/status · /api/online · /api/rooms
 *
 * 用法：
 *   node server/index.mjs [port]
 *   PORT=4321 HOST=0.0.0.0 node server/index.mjs
 *   npm run online
 *
 * 战斗仍由房主客户端模拟；本服务负责同步与中继，不跑战斗逻辑。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptKey, attachSocket } from './ws.mjs';
import { createLobby } from './lobby.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const VERSION = '2.11.1';

const port = Number(process.env.PORT || process.argv[2] || 4321);
const host = process.env.HOST || '0.0.0.0';
const maxPeers = Number(process.env.MAX_PEERS || 64);
const heartbeatMs = Number(process.env.HEARTBEAT_MS || 15000);
const staleMs = Number(process.env.STALE_MS || 45000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

const lobby = createLobby({ version: VERSION, maxPeers });

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res, rel) {
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  let rel = decodeURIComponent(url.pathname);

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (rel === '/api/status' || rel === '/api/online') {
    sendJson(res, 200, lobby.status());
    return;
  }
  if (rel === '/api/rooms') {
    const st = lobby.status();
    sendJson(res, 200, { ok: true, rooms: st.rooms, online: st.online });
    return;
  }
  if (rel === '/api/health') {
    sendJson(res, 200, { ok: true, version: VERSION });
    return;
  }

  if (rel === '/') rel = '/index.html';
  serveStatic(req, res, rel);
});

server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url || '').split('?')[0];
  if (pathname !== '/ws') {
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

  let peer = null;
  const ws = attachSocket(
    socket,
    (data) => { if (peer) lobby.handleMessage(peer, data); },
    () => { if (peer) lobby.removePeer(peer); peer = null; }
  );
  peer = lobby.addPeer(ws);
  if (!peer) return;
});

setInterval(() => {
  for (const p of lobby.peers.values()) p.ws.ping();
  lobby.sweepStale(staleMs);
}, heartbeatMs).unref?.();

server.listen(port, host, () => {
  console.log('══════════════════════════════════════');
  console.log(' 时空猪 · 联机服务端 v' + VERSION);
  console.log('══════════════════════════════════════');
  console.log('  HTTP   http://127.0.0.1:' + port);
  console.log('  WS     ws://127.0.0.1:' + port + '/ws');
  console.log('  状态   http://127.0.0.1:' + port + '/api/status');
  console.log('  房间   http://127.0.0.1:' + port + '/api/rooms');
  console.log('  监听   ' + host + ':' + port + '  上限 ' + maxPeers + ' 人');
  console.log('');
  console.log(' 打开页面 → 点「联机」接入大厅');
  console.log(' 组队后队长进本，未组队可单刷');
  console.log('══════════════════════════════════════');
});

export { server, lobby, VERSION };
