/* 服主网络信息：本机局域网 IP、公网 IP、端口映射提示 */
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';

const PRIVATE = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^127\./,
  /^169\.254\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe80:/i
];

export function isPrivateIp(ip) {
  if (!ip) return true;
  return PRIVATE.some((re) => re.test(ip));
}

/** 收集本机非内部网卡的 IPv4（优先局域网） */
export function listLanIps() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      out.push({
        iface: name,
        address: net.address,
        netmask: net.netmask,
        private: isPrivateIp(net.address)
      });
    }
  }
  // 局域网优先
  out.sort((a, b) => Number(b.private) - Number(a.private));
  return out;
}

function fetchText(url, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location, timeoutMs).then(resolve, reject);
        res.resume();
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body.trim()));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

/** 探测公网 IP（多个公共接口，失败则 null） */
export async function detectPublicIp() {
  const endpoints = [
    'https://api.ipify.org',
    'https://ifconfig.me/ip',
    'http://ip.sb'
  ];
  for (const url of endpoints) {
    try {
      const text = await fetchText(url);
      const ip = (text.match(/\d{1,3}(?:\.\d{1,3}){3}/) || [])[0];
      if (ip) return ip;
    } catch { /* try next */ }
  }
  return null;
}

/**
 * 把穿透/公网入口规范成 http(s) 页面基址。
 * 支持：域名、host:port、http(s)://、ws(s)://、带/ws 路径
 */
export function normalizePublicBase(raw) {
  let u = String(raw || '').trim();
  if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'http://' + u;
  u = u.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
  try {
    const parsed = new URL(u);
    // 去掉 /ws 路径，只保留站点根
    if (/\/ws\/?$/i.test(parsed.pathname)) parsed.pathname = '/';
    else if (parsed.pathname === '/ws') parsed.pathname = '/';
    let path = parsed.pathname || '/';
    if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);
    const basePath = path === '/' ? '' : path;
    const portPart = parsed.port ? (':' + parsed.port) : '';
    return parsed.protocol + '//' + parsed.hostname + portPart + basePath;
  } catch {
    return null;
  }
}

/** 由公网/穿透基址生成页面与联机地址 */
export function urlsFromPublicBase(base) {
  const b = normalizePublicBase(base);
  if (!b) return null;
  const wsBase = b.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return {
    base: b,
    http: b,
    ws: wsBase.replace(/\/?$/, '') + '/ws',
    join: b.replace(/\/?$/, '') + '/?ws=' + encodeURIComponent(wsBase.replace(/\/?$/, '') + '/ws')
  };
}

/**
 * 汇总服主部署信息。
 * @param {{ port?: number, host?: string, publicUrl?: string }} opts
 */
export async function gatherHostInfo(opts = {}) {
  const port = Number(opts.port || process.env.PORT || 4321);
  const bindHost = opts.host || process.env.HOST || '0.0.0.0';
  const lan = listLanIps();
  const publicIp = await detectPublicIp();
  const primaryLan = (lan.find((x) => x.private) || lan[0] || null);
  const publicRaw = opts.publicUrl
    || process.env.PUBLIC_URL
    || process.env.FRP_URL
    || process.env.SP_PUBLIC_URL
    || '';
  const frp = urlsFromPublicBase(publicRaw);

  return {
    port,
    protocol: 'TCP',
    bindHost,
    hostname: os.hostname(),
    platform: process.platform,
    lan,
    primaryLan: primaryLan ? primaryLan.address : null,
    publicIp,
    publicUrl: frp ? frp.base : null,
    frp: frp || null,
    urls: {
      localHttp: `http://127.0.0.1:${port}`,
      localWs: `ws://127.0.0.1:${port}/ws`,
      lanHttp: primaryLan ? `http://${primaryLan.address}:${port}` : null,
      lanWs: primaryLan ? `ws://${primaryLan.address}:${port}/ws` : null,
      publicHttp: frp ? frp.http : (publicIp ? `http://${publicIp}:${port}` : null),
      publicWs: frp ? frp.ws : (publicIp ? `ws://${publicIp}:${port}/ws` : null),
      join: frp ? frp.join : (publicIp
        ? `http://${publicIp}:${port}/?ws=${encodeURIComponent('ws://' + publicIp + ':' + port + '/ws')}`
        : null)
    },
    portMap: {
      externalPort: port,
      internalIp: '127.0.0.1',
      internalPort: port,
      lanIp: primaryLan ? primaryLan.address : null,
      protocol: 'TCP',
      note: 'HTTP 与 WebSocket 共用同一端口。SakuraFrp / frp 请用 TCP 隧道，本地填 127.0.0.1:' + port
    }
  };
}

/** 终端可读的服主提醒横幅 */
export function formatHostBanner(info) {
  const lines = [];
  const bar = '═'.repeat(54);
  lines.push(bar);
  lines.push(' 时空猪 · 服主自动部署');
  lines.push(bar);
  lines.push('');
  lines.push('【本地监听 / 穿透本地端】');
  lines.push(`  协议     : ${info.portMap.protocol}`);
  lines.push(`  本地地址 : ${info.portMap.internalIp}:${info.portMap.internalPort}`);
  lines.push(`  说明     : ${info.portMap.note}`);
  lines.push('');
  lines.push('【SakuraFrp / frp 内网穿透】');
  lines.push('  1. 隧道类型选「TCP」（不要只开纯 HTTP 若不支持升级）');
  lines.push(`  2. 本地地址填 127.0.0.1:${info.port}（与本服务一致）`);
  lines.push('  3. 启动穿透后，把「访问地址」设为 PUBLIC_URL 再部署，例如：');
  lines.push('       set PUBLIC_URL=http://xxx.sakurafrp.com:12345');
  lines.push('       npm run deploy');
  lines.push('     或：node server/deploy.mjs --public=http://xxx.sakurafrp.com:12345');
  if (info.frp) {
    lines.push('');
    lines.push('【已配置的穿透地址 → 请把下面发给外网好友】');
    lines.push(`  页面      ${info.urls.publicHttp}`);
    lines.push(`  联机填入  ${info.urls.publicWs}`);
    lines.push(`  一键链接  ${info.urls.join}`);
    lines.push('  ※ 好友必须打开「穿透后的页面地址」，不要用 127.0.0.1');
    lines.push('  ※ 若穿透是 https 域名，联机地址会是 wss://…/ws');
  } else {
    lines.push('');
    lines.push('  ※ 当前未设置 PUBLIC_URL。只用局域网或路由器端口映射时可不填。');
    lines.push('  ※ 用 SakuraFrp 却不设 PUBLIC_URL 时，好友容易连到错误地址。');
  }
  lines.push('');
  lines.push('【路由器端口转发（有公网 IP 时）】');
  lines.push(`  外网端口 ${info.port}  →  ${(info.portMap.lanIp || '局域网IP')}:${info.port}  (TCP)`);
  lines.push('');
  lines.push('【本机地址】（服主自己玩）');
  lines.push(`  页面  ${info.urls.localHttp}`);
  lines.push(`  联机  ${info.urls.localWs}`);
  if (info.urls.lanHttp) {
    lines.push('');
    lines.push('【局域网地址】（同一 Wi‑Fi）');
    lines.push(`  页面  ${info.urls.lanHttp}`);
    lines.push(`  联机  ${info.urls.lanWs}`);
  }
  if (!info.frp && info.publicIp) {
    lines.push('');
    lines.push('【探测到的公网 IP】（需自行做端口映射才可用）');
    lines.push(`  ${info.publicIp}`);
    lines.push(`  页面  ${info.urls.publicHttp}`);
    lines.push(`  联机  ${info.urls.publicWs}`);
  }
  lines.push('');
  lines.push('服主面板：' + info.urls.localHttp + '/host');
  lines.push(bar);
  return lines.join('\n');
}

/** 纯文本服主卡片（可保存分享） */
export function formatHostCard(info) {
  return [
    '时空猪 · 联机服主卡片',
    `生成时间: ${new Date().toISOString()}`,
    `主机名: ${info.hostname}`,
    '',
    `本地服务: 127.0.0.1:${info.port} (TCP)`,
    info.frp ? `穿透入口: ${info.publicUrl}` : '',
    '',
    `本机页面: ${info.urls.localHttp}`,
    `本机联机: ${info.urls.localWs}`,
    info.urls.lanHttp ? `局域网页面: ${info.urls.lanHttp}` : '',
    info.urls.lanWs ? `局域网联机: ${info.urls.lanWs}` : '',
    info.urls.publicHttp ? `外网页面: ${info.urls.publicHttp}` : '',
    info.urls.publicWs ? `外网联机: ${info.urls.publicWs}` : '',
    info.urls.join ? `一键加入: ${info.urls.join}` : '',
    '',
    'SakuraFrp：隧道类型 TCP，本地 127.0.0.1:' + info.port + '，部署时设置 PUBLIC_URL=访问地址',
    '好友请打开外网页面地址，联机栏填外网联机地址（或点一键加入链接）。'
  ].filter(Boolean).join('\n') + '\n';
}
