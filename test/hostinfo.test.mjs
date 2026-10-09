/* 时空猪 · 服主部署信息测试：node test/hostinfo.test.mjs */
import assert from 'node:assert/strict';
import {
  isPrivateIp, listLanIps, formatHostBanner, formatHostCard, gatherHostInfo,
  normalizePublicBase, urlsFromPublicBase
} from '../server/hostinfo.mjs';

let pass = 0, fail = 0;
const out = [];
async function test(name, fn) {
  try {
    await fn();
    pass++;
    out.push('  ✓ ' + name);
  } catch (e) {
    fail++;
    out.push('  ✗ ' + name + '\n      ' + (e && e.message));
  }
}

await test('isPrivateIp 识别常见私网段', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('192.168.1.8'), true);
  assert.equal(isPrivateIp('10.0.0.2'), true);
  assert.equal(isPrivateIp('172.16.0.1'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
});

await test('listLanIps 返回数组结构', () => {
  const list = listLanIps();
  assert.ok(Array.isArray(list));
  for (const n of list) {
    assert.ok(n.address);
    assert.ok(n.iface);
    assert.equal(typeof n.private, 'boolean');
  }
});

await test('normalizePublicBase / urlsFromPublicBase 支持穿透地址', () => {
  assert.equal(normalizePublicBase('abc.sakurafrp.com:23456'), 'http://abc.sakurafrp.com:23456');
  assert.equal(normalizePublicBase('https://play.example.com/ws'), 'https://play.example.com');
  const u = urlsFromPublicBase('http://abc.sakurafrp.com:23456');
  assert.equal(u.http, 'http://abc.sakurafrp.com:23456');
  assert.equal(u.ws, 'ws://abc.sakurafrp.com:23456/ws');
  assert.match(u.join, /\?ws=/);
  const wss = urlsFromPublicBase('https://game.example.com');
  assert.equal(wss.ws, 'wss://game.example.com/ws');
});

await test('formatHostBanner 含穿透与本地提醒', () => {
  const frp = urlsFromPublicBase('http://abc.sakurafrp.com:23456');
  const info = {
    port: 4321,
    portMap: {
      protocol: 'TCP', externalPort: 4321,
      internalIp: '127.0.0.1', internalPort: 4321, lanIp: '192.168.1.10',
      note: 'HTTP 与 WebSocket 共用同一端口'
    },
    lan: [{ iface: 'eth0', address: '192.168.1.10', private: true }],
    primaryLan: '192.168.1.10',
    publicIp: null,
    publicUrl: frp.base,
    frp,
    urls: {
      localHttp: 'http://127.0.0.1:4321',
      localWs: 'ws://127.0.0.1:4321/ws',
      lanHttp: 'http://192.168.1.10:4321',
      lanWs: 'ws://192.168.1.10:4321/ws',
      publicHttp: frp.http,
      publicWs: frp.ws,
      join: frp.join
    },
    hostname: 'test'
  };
  const text = formatHostBanner(info);
  assert.match(text, /SakuraFrp/);
  assert.match(text, /TCP/);
  assert.match(text, /127\.0\.0\.1:4321/);
  assert.match(text, /abc\.sakurafrp\.com:23456/);
  const card = formatHostCard(info);
  assert.match(card, /联机服主卡片/);
  assert.match(card, /穿透入口/);
});

await test('gatherHostInfo 识别 PUBLIC_URL', async () => {
  const info = await gatherHostInfo({
    port: 4321, host: '0.0.0.0',
    publicUrl: 'http://abc.sakurafrp.com:23456'
  });
  assert.equal(info.port, 4321);
  assert.equal(info.portMap.internalIp, '127.0.0.1');
  assert.equal(info.urls.publicWs, 'ws://abc.sakurafrp.com:23456/ws');
  assert.ok(info.frp);
  assert.match(info.urls.join, /sakurafrp/);
});

console.log('\n时空猪 · 服主部署信息测试\n' + out.join('\n'));
console.log(`\n通过 ${pass} / ${pass + fail}` + (fail ? `  ✗ 失败 ${fail}` : '  ✓ 全部通过'));
process.exit(fail ? 1 : 0);
