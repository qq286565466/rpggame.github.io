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
import { formatHostCard } from './hostinfo.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const VERSION = '2.11.5';

const port = Number(process.env.PORT || process.argv[2] || 4321);
const host = process.env.HOST || '0.0.0.0';
const maxPeers = Number(process.env.MAX_PEERS || 64);
const heartbeatMs = Number(process.env.HEARTBEAT_MS || 15000);
const staleMs = Number(process.env.STALE_MS || 45000);

function loadHostInfo() {
  const p = process.env.SP_HOST_INFO_PATH || path.join(root, '.host-info.json');
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { /* ignore */ }
  return null;
}

function renderHostPage(info) {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const pm = info.portMap || {};
  const u = info.urls || {};
  const hasFrp = !!(info.frp && u.publicHttp);
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>时空猪 · 服主面板</title>
<style>
  :root { --bg:#10141c; --card:#1a2230; --line:#2c3a4f; --text:#e8eef7; --muted:#9aabbf; --accent:#5ec8ff; --warn:#ffc857; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: radial-gradient(1200px 600px at 20% -10%, #1c3550, var(--bg)); color: var(--text); }
  main { max-width: 820px; margin: 0 auto; padding: 28px 18px 60px; }
  h1 { font-size: 1.6rem; margin: 0 0 6px; }
  .lead { color: var(--muted); margin: 0 0 22px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; margin-bottom: 14px; }
  .card h2 { margin: 0 0 10px; font-size: 1.05rem; color: var(--accent); }
  .warn { border-color: #6a5420; background: linear-gradient(180deg,#2a2414,#1a2230); }
  .warn h2 { color: var(--warn); }
  .okcard { border-color: #2d6a45; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin: 6px 0; }
  code, .mono { font-family: ui-monospace, Consolas, monospace; background:#0d121a; padding: 4px 8px; border-radius: 8px; border:1px solid var(--line); word-break: break-all; }
  .big { font-size: 1.15rem; font-weight: 700; letter-spacing: .02em; }
  a { color: var(--accent); }
  button { cursor:pointer; border:1px solid var(--line); background:#243247; color:var(--text);
    border-radius: 10px; padding: 8px 12px; }
  button:hover { background:#2d3f5a; }
  ul { margin: 8px 0 0 18px; color: var(--muted); }
  .ok { color: #9dffb0; }
</style></head><body><main>
  <h1>时空猪 · 服主面板</h1>
  <p class="lead">HTTP 与联机 WebSocket <strong>共用同一 TCP 端口</strong>。用 SakuraFrp 时请把「访问地址」配进 PUBLIC_URL，并把<strong>穿透后的地址</strong>发给好友。</p>

  <section class="card warn">
    <h2>SakuraFrp / 内网穿透（远程好友）</h2>
    <ul>
      <li>隧道类型选 <strong>TCP</strong>（需能转发 WebSocket；本地填 <code>127.0.0.1:${esc(info.port)}</code>）</li>
      <li>启动穿透后重新部署：<code>node server/deploy.mjs --public=http://你的访问地址</code></li>
      <li>好友必须打开<strong>穿透页面地址</strong>，不要用 127.0.0.1 / 局域网 IP</li>
      <li>若穿透提供 https 域名，联机栏会使用 <code>wss://…/ws</code></li>
    </ul>
    ${hasFrp ? `
    <div class="row" style="margin-top:12px"><span>发给好友的页面</span>
      <code id="publicHttp" class="big">${esc(u.publicHttp)}</code>
      <button type="button" data-copy="publicHttp">复制</button></div>
    <div class="row"><span>联机栏填入</span>
      <code id="publicWs" class="big">${esc(u.publicWs)}</code>
      <button type="button" data-copy="publicWs">复制</button></div>
    <div class="row"><span>一键加入链接</span>
      <code id="joinUrl">${esc(u.join)}</code>
      <button type="button" data-copy="joinUrl">复制</button></div>
    ` : `
    <p class="lead" style="margin-top:12px">当前<strong>未配置</strong> PUBLIC_URL。远程好友将无法通过穿透地址自动显示在此。请用穿透访问地址重启部署。</p>
    `}
  </section>

  <section class="card">
    <h2>本地监听（穿透「本地」填这个）</h2>
    <div class="row"><span>协议</span><span class="mono big">TCP</span></div>
    <div class="row"><span>本地</span><span class="mono big">127.0.0.1:${esc(info.port)}</span></div>
    <ul>
      <li>路由器端口映射：外网 ${esc(info.port)} → ${esc(pm.lanIp || '局域网IP')}:${esc(info.port)}</li>
      <li>${esc(pm.note || '')}</li>
    </ul>
  </section>

  <section class="card">
    <h2>本机（服主自己）</h2>
    <div class="row">页面 <code id="localHttp">${esc(u.localHttp)}</code>
      <button type="button" data-copy="localHttp">复制</button></div>
    <div class="row">联机 <code id="localWs">${esc(u.localWs)}</code>
      <button type="button" data-copy="localWs">复制</button></div>
  </section>

  ${u.lanHttp ? `<section class="card">
    <h2>局域网（同一 Wi‑Fi）</h2>
    <div class="row">页面 <code id="lanHttp">${esc(u.lanHttp)}</code>
      <button type="button" data-copy="lanHttp">复制</button></div>
    <div class="row">联机 <code id="lanWs">${esc(u.lanWs)}</code>
      <button type="button" data-copy="lanWs">复制</button></div>
  </section>` : ''}

  <section class="card ${hasFrp ? 'okcard' : ''}">
    <h2>状态</h2>
    <p class="lead"><a href="/api/status">/api/status</a> · <a href="/">进入游戏</a> ·
      ${hasFrp ? '<span class="ok">已配置穿透入口</span>' : '<span>未配置 PUBLIC_URL</span>'}</p>
  </section>
<script>
document.querySelectorAll('[data-copy]').forEach(function(btn){
  btn.addEventListener('click', function(){
    var id = btn.getAttribute('data-copy');
    var el = document.getElementById(id);
    if (!el) return;
    navigator.clipboard.writeText(el.textContent).then(function(){
      btn.textContent = '已复制';
      setTimeout(function(){ btn.textContent = '复制'; }, 1200);
    });
  });
});
</script>
</main></body></html>`;
}

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
  if (rel === '/api/host') {
    const info = loadHostInfo();
    if (!info) {
      sendJson(res, 404, {
        ok: false,
        reason: '尚未运行服主部署。请执行 npm run deploy',
        hint: 'node server/deploy.mjs'
      });
      return;
    }
    sendJson(res, 200, Object.assign({ ok: true }, info));
    return;
  }
  if (rel === '/host' || rel === '/host.html') {
    const info = loadHostInfo();
    if (!info) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><meta charset="utf-8"><title>服主面板</title>' +
        '<body style="font-family:sans-serif;padding:2rem;background:#10141c;color:#e8eef7">' +
        '<h1>尚未部署</h1><p>请先在仓库根目录运行 <code>npm run deploy</code>，再打开本页。</p></body>');
      return;
    }
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderHostPage(info));
    return;
  }
  if (rel === '/host-card.txt') {
    const info = loadHostInfo();
    if (!info) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('请先运行 npm run deploy\n');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(formatHostCard(info));
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

/** Resolves when listening; rejects on bind failure (e.g. EADDRINUSE). */
const ready = new Promise((resolve, reject) => {
  const onListen = () => {
    server.off('error', onErr);
    resolve();
  };
  const onErr = (err) => {
    server.off('listening', onListen);
    reject(err);
  };
  server.once('listening', onListen);
  server.once('error', onErr);
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('');
    console.error('[错误] 端口 ' + port + ' 已被占用（EADDRINUSE）。');
    console.error('  · 关掉另一个联机服黑窗口后再试');
    console.error('  · 或换端口：node server/deploy.mjs 4322');
    console.error('  · Windows 查看占用：netstat -ano | findstr :' + port);
  } else {
    console.error('[错误] 无法监听 ' + host + ':' + port + ' —', err && err.message ? err.message : err);
  }
  // deploy.mjs awaits `ready` and exits; direct `node server/index.mjs` exits here
  if (!process.env.SP_HOST_DEPLOY) process.exit(1);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const deployed = !!loadHostInfo();
  console.log('══════════════════════════════════════');
  console.log(' 时空猪 · 联机服务端 v' + VERSION);
  console.log('══════════════════════════════════════');
  console.log('  HTTP   http://127.0.0.1:' + port);
  console.log('  WS     ws://127.0.0.1:' + port + '/ws');
  console.log('  状态   http://127.0.0.1:' + port + '/api/status');
  console.log('  房间   http://127.0.0.1:' + port + '/api/rooms');
  if (deployed) {
    console.log('  服主   http://127.0.0.1:' + port + '/host');
  }
  console.log('  监听   ' + host + ':' + port + '  上限 ' + maxPeers + ' 人');
  console.log('');
  if (!deployed) {
    console.log(' 提示：服主请用 npm run deploy，会显示需映射的端口与 IP');
  }
  console.log(' 打开页面 → 点「联机」接入大厅');
  console.log(' 组队后队长进本，未组队可单刷');
  console.log('══════════════════════════════════════');
});

export { server, lobby, VERSION, ready };
