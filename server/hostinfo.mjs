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
 * 汇总服主部署信息。
 * @param {{ port?: number, host?: string }} opts
 */
export async function gatherHostInfo(opts = {}) {
  const port = Number(opts.port || process.env.PORT || 4321);
  const bindHost = opts.host || process.env.HOST || '0.0.0.0';
  const lan = listLanIps();
  const publicIp = await detectPublicIp();
  const primaryLan = (lan.find((x) => x.private) || lan[0] || null);

  return {
    port,
    protocol: 'TCP',
    bindHost,
    hostname: os.hostname(),
    platform: process.platform,
    lan,
    primaryLan: primaryLan ? primaryLan.address : null,
    publicIp,
    urls: {
      localHttp: `http://127.0.0.1:${port}`,
      localWs: `ws://127.0.0.1:${port}/ws`,
      lanHttp: primaryLan ? `http://${primaryLan.address}:${port}` : null,
      lanWs: primaryLan ? `ws://${primaryLan.address}:${port}/ws` : null,
      publicHttp: publicIp ? `http://${publicIp}:${port}` : null,
      publicWs: publicIp ? `ws://${publicIp}:${port}/ws` : null
    },
    portMap: {
      externalPort: port,
      internalIp: primaryLan ? primaryLan.address : '本机局域网IP',
      internalPort: port,
      protocol: 'TCP',
      note: 'HTTP 与 WebSocket 共用同一端口，只需映射一次 TCP'
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
  lines.push('【必须映射的端口】');
  lines.push(`  协议     : ${info.portMap.protocol}`);
  lines.push(`  外部端口 : ${info.portMap.externalPort}`);
  lines.push(`  内部 IP  : ${info.portMap.internalIp}`);
  lines.push(`  内部端口 : ${info.portMap.internalPort}`);
  lines.push(`  说明     : ${info.portMap.note}`);
  lines.push('');
  lines.push('【路由器 / 光猫端口转发示例】');
  lines.push(`  外网端口 ${info.port}  →  ${info.portMap.internalIp}:${info.port}  (TCP)`);
  lines.push('  云主机安全组 / 防火墙请放行同一 TCP 端口入站。');
  lines.push('');
  lines.push('【本机地址】（服主自己玩）');
  lines.push(`  页面  ${info.urls.localHttp}`);
  lines.push(`  联机  ${info.urls.localWs}`);
  if (info.urls.lanHttp) {
    lines.push('');
    lines.push('【局域网地址】（同一 Wi‑Fi / 内网好友）');
    lines.push(`  页面  ${info.urls.lanHttp}`);
    lines.push(`  联机  ${info.urls.lanWs}`);
  }
  if (info.publicIp) {
    lines.push('');
    lines.push('【公网地址】（完成端口映射后给外网好友）');
    lines.push(`  探测到的公网 IP : ${info.publicIp}`);
    lines.push(`  页面  ${info.urls.publicHttp}`);
    lines.push(`  联机  ${info.urls.publicWs}`);
    lines.push('  ※ 若家宽无公网 IP（运营商 NAT），需内网穿透或云主机。');
  } else {
    lines.push('');
    lines.push('【公网 IP】未能自动探测，请在路由器WAN口查看，或访问 https://ip.sb');
  }
  if (info.lan.length) {
    lines.push('');
    lines.push('【本机网卡】');
    for (const n of info.lan) {
      lines.push(`  ${n.iface.padEnd(12)} ${n.address}${n.private ? '  (局域网)' : ''}`);
    }
  }
  lines.push('');
  lines.push('【发给好友的话术】');
  if (info.urls.lanWs) {
    lines.push(`  局域网：打开 ${info.urls.lanHttp} ，联机填 ${info.urls.lanWs}`);
  }
  if (info.urls.publicWs) {
    lines.push(`  外网：先确保已映射 TCP ${info.port}，再打开 ${info.urls.publicHttp}`);
    lines.push(`        联机填 ${info.urls.publicWs}`);
  }
  lines.push('');
  lines.push('服主面板（启动后）：' + info.urls.localHttp + '/host');
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
    `映射端口: TCP ${info.port}`,
    `内网目标: ${info.portMap.internalIp}:${info.port}`,
    '',
    `本机页面: ${info.urls.localHttp}`,
    `本机联机: ${info.urls.localWs}`,
    info.urls.lanHttp ? `局域网页面: ${info.urls.lanHttp}` : '',
    info.urls.lanWs ? `局域网联机: ${info.urls.lanWs}` : '',
    info.urls.publicHttp ? `公网页面: ${info.urls.publicHttp}` : '',
    info.urls.publicWs ? `公网联机: ${info.urls.publicWs}` : '',
    info.publicIp ? `公网IP: ${info.publicIp}` : '公网IP: (未探测到)',
    '',
    '提醒：路由器做端口转发，云主机放行安全组；HTTP 与 WS 共用该 TCP 端口。'
  ].filter(Boolean).join('\n') + '\n';
}
