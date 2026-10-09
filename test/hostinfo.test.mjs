/* 时空猪 · 服主部署信息测试：node test/hostinfo.test.mjs */
import assert from 'node:assert/strict';
import {
  isPrivateIp, listLanIps, formatHostBanner, formatHostCard, gatherHostInfo
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

await test('formatHostBanner 含端口映射提醒', () => {
  const info = {
    port: 4321,
    portMap: {
      protocol: 'TCP', externalPort: 4321,
      internalIp: '192.168.1.10', internalPort: 4321,
      note: 'HTTP 与 WebSocket 共用同一端口，只需映射一次 TCP'
    },
    lan: [{ iface: 'eth0', address: '192.168.1.10', private: true }],
    primaryLan: '192.168.1.10',
    publicIp: '1.2.3.4',
    urls: {
      localHttp: 'http://127.0.0.1:4321',
      localWs: 'ws://127.0.0.1:4321/ws',
      lanHttp: 'http://192.168.1.10:4321',
      lanWs: 'ws://192.168.1.10:4321/ws',
      publicHttp: 'http://1.2.3.4:4321',
      publicWs: 'ws://1.2.3.4:4321/ws'
    },
    hostname: 'test'
  };
  const text = formatHostBanner(info);
  assert.match(text, /必须映射的端口/);
  assert.match(text, /TCP/);
  assert.match(text, /4321/);
  assert.match(text, /192\.168\.1\.10/);
  assert.match(text, /1\.2\.3\.4/);
  const card = formatHostCard(info);
  assert.match(card, /联机服主卡片/);
  assert.match(card, /映射端口: TCP 4321/);
});

await test('gatherHostInfo 汇总本机信息', async () => {
  const info = await gatherHostInfo({ port: 4321, host: '0.0.0.0' });
  assert.equal(info.port, 4321);
  assert.equal(info.portMap.protocol, 'TCP');
  assert.equal(info.portMap.externalPort, 4321);
  assert.ok(info.urls.localHttp.includes('4321'));
  assert.ok(info.urls.localWs.endsWith('/ws'));
});

console.log('\n时空猪 · 服主部署信息测试\n' + out.join('\n'));
console.log(`\n通过 ${pass} / ${pass + fail}` + (fail ? `  ✗ 失败 ${fail}` : '  ✓ 全部通过'));
process.exit(fail ? 1 : 0);
