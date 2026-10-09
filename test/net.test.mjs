/* 时空猪 · 联机模块测试：node test/net.test.mjs */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';

const root = path.resolve(import.meta.dirname, '..');
for (const f of ['src/util.js', 'src/items.js', 'src/sim.js', 'src/hideout.js', 'src/net.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const SP = globalThis.SP;

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

function waitMsg(ws, pred, ms = 2500) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
    function onMsg(ev) {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!pred(msg)) return;
      clearTimeout(t);
      ws.removeEventListener('message', onMsg);
      resolve(msg);
    }
    ws.addEventListener('message', onMsg);
  });
}

function openClient(url, profile) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 3000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        t: 'hello',
        name: profile.name || '旅人',
        level: profile.level || 1,
        x: profile.x || 1100, y: profile.y || 900, facing: -Math.PI / 2
      }));
      resolve(ws);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('ws error'));
    });
  });
}

await test('OnlineClient.packCharacter 压缩角色字段', () => {
  const packed = SP.OnlineClient.packCharacter({
    level: 12, xp: 99, steaks: 20, coins: 500,
    equipped: { weapon: { uid: 1 } }, inventory: [1, 2, 3]
  });
  assert.equal(packed.level, 12);
  assert.equal(packed.steaks, 9, '牛排上限 9');
  assert.ok(packed.equipped.weapon);
  assert.equal(packed.inventory, undefined);
});

await test('Hideout 远程玩家同步与插值', () => {
  const h = new SP.Hideout();
  h.syncRemotes([
    { id: 'u1', name: '甲', level: 5, x: 400, y: 500, facing: 1, inDungeon: false },
    { id: 'u2', name: '乙', level: 3, x: 600, y: 700, facing: 0, inDungeon: true }
  ], 'me');
  assert.equal(h.remoteList().length, 2);
  h.applyRemotePos({ id: 'u1', x: 480, y: 520, facing: 1.2, walkPhase: 2, level: 6 });
  for (let i = 0; i < 30; i++) h.tickRemotes(1 / 60);
  const a = h.remotes.u1;
  assert.ok(a.x > 400 && a.x < 480, '应向目标插值: ' + a.x);
  assert.equal(a.level, 6);
});

await test('组队 World：多人 roster、配额放大、快照往返', () => {
  const chA = {
    level: 10, xp: 0, coins: 0, stones: 0, steaks: 3,
    equipped: { weapon: null, helm: null, armor: null, boots: null, amulet: null, ring1: null, ring2: null },
    inventory: [], materials: { up: 0, re: 0 }
  };
  const chB = Object.assign({}, chA, { level: 8 });
  const w = new SP.World({
    seed: 424242,
    character: chA,
    localId: 'host',
    party: [
      { id: 'host', name: '队长', character: chA },
      { id: 'guest', name: '同伴', character: chB }
    ],
    dungeon: { biome: 'camp', floor: 1 },
    steaks: 3
  });
  assert.equal(w.players.length, 2);
  assert.equal(w.player.id, 'host');
  assert.ok(w.partyScale > 1);
  const solo = new SP.World({ seed: 424242, character: chA, dungeon: { biome: 'camp', floor: 1 } });
  assert.ok(w.killsNeeded > solo.killsNeeded, '组队击杀配额应增加');

  const multi = {
    __multi: true,
    host: { mx: 1, my: 0, attack: false },
    guest: { mx: -1, my: 0, attack: false }
  };
  const hx0 = w.players[0].x, gx0 = w.players[1].x;
  for (let i = 0; i < 30; i++) w.update(1 / 60, multi);
  assert.ok(w.players[0].x > hx0, '房主应右移');
  assert.ok(w.players[1].x < gx0, '同伴应左移');

  const snap = w.snapshot();
  assert.equal(snap.players.length, 2);
  const w2 = new SP.World({
    seed: 424242, character: chA, localId: 'guest',
    party: [
      { id: 'host', name: '队长', character: chA },
      { id: 'guest', name: '同伴', character: chB }
    ],
    dungeon: { biome: 'camp', floor: 1 }
  });
  w2.applySnapshot(snap);
  assert.ok(Math.abs(w2.players[0].x - w.players[0].x) < 0.01);
  assert.equal(w2.player.id, 'guest');
});

await test('客机软快照：本地预测不被小误差拉回，敌人走插值', () => {
  const ch = {
    level: 10, xp: 0, coins: 0, stones: 0, steaks: 3,
    equipped: { weapon: null, helm: null, armor: null, boots: null, amulet: null, ring1: null, ring2: null },
    inventory: [], materials: { up: 0, re: 0 }
  };
  const w = new SP.World({
    seed: 7, character: ch, localId: 'guest',
    party: [
      { id: 'host', name: '队长', character: ch },
      { id: 'guest', name: '同伴', character: ch }
    ],
    dungeon: { biome: 'camp', floor: 1 }
  });
  const me = w.player;
  me.x = 40; me.y = 0;
  const ally = w.players[0];
  ally.x = 0; ally.y = 0;
  w.enemies = [{
    key: 'calf', name: '犊', kind: 'melee', x: 100, y: 0, hp: 10, maxHp: 10,
    r: 16, color: '#fff', boss: false, elite: false, dying: 0, spawnT: 0,
    state: 'idle', stateT: 0, hitFlash: 0, stun: 0, anim: 0, slamR: 190,
    chargeDir: 0, vx: 0, vy: 0, atkCd: 1, atkRange: 40, dmg: 1, speed: 0, xp: 0, coin: 0
  }];

  const snap = {
    time: 1, kills: 0, killsNeeded: 17, coins: 0, stones: 0, steaks: 3,
    bossSpawned: false, cleared: false, dead: false,
    players: [
      { id: 'host', x: 30, y: 0, vx: 0, vy: 0, facing: 0, hp: 100, maxHp: 100, walkPhase: 1, swingT: 0, swingDir: 0, hurtFlash: 0, shield: 0, domainT: 0, domainR: 0, curseMarks: 0 },
      { id: 'guest', x: 48, y: 0, vx: 0, vy: 0, facing: 0, hp: 100, maxHp: 100, walkPhase: 1, swingT: 0, swingDir: 0, hurtFlash: 0, shield: 0, domainT: 0, domainR: 0, curseMarks: 0 }
    ],
    enemies: [{
      key: 'calf', x: 140, y: 0, vx: 20, vy: 0, hp: 10, maxHp: 10, r: 16, color: '#fff',
      boss: false, elite: false, dying: 0, spawnT: 0, state: 'idle', stateT: 0,
      hitFlash: 0, stun: 0, anim: 0, slamR: 190, chargeDir: 0
    }],
    pickups: []
  };
  w.applySnapshot(snap, { softLocal: true });
  // 本地误差 < 22：保持预测位置
  assert.equal(me.x, 40);
  assert.equal(me.tx, null);
  // 同伴与敌人进入插值目标
  assert.equal(ally.tx, 30);
  assert.equal(w.enemies[0].tx, 140);
  const ex0 = w.enemies[0].x;
  for (let i = 0; i < 20; i++) w.tickNetInterp(1 / 60);
  assert.ok(w.enemies[0].x > ex0, '敌人应向目标插值');
  assert.ok(ally.x > 0, '同伴应向目标插值');

  // 本地大幅偏离应硬纠正
  me.x = -200;
  w.applySnapshot(snap, { softLocal: true });
  assert.ok(Math.abs(me.x - 48) < 0.1, '大误差应硬纠正到权威位置');
});

await test('客机 predictLocalMove 响应方向键', () => {
  const ch = {
    level: 5, xp: 0, coins: 0, stones: 0, steaks: 3,
    equipped: { weapon: null, helm: null, armor: null, boots: null, amulet: null, ring1: null, ring2: null },
    inventory: [], materials: { up: 0, re: 0 }
  };
  const w = new SP.World({
    seed: 9, character: ch, localId: 'guest',
    party: [
      { id: 'host', name: '队长', character: ch },
      { id: 'guest', name: '同伴', character: ch }
    ],
    dungeon: { biome: 'camp', floor: 1 }
  });
  const x0 = w.player.x;
  for (let i = 0; i < 30; i++) w.predictLocalMove(1 / 60, { mx: 1, my: 0 });
  assert.ok(w.player.x > x0 + 20, '本地预测应向右移动');
});

const PORT = 18765 + Math.floor(Math.random() * 200);
let serverProc = null;

async function startServer() {
  serverProc = spawn(process.execPath, ['server/index.mjs', String(PORT)], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server start timeout')), 4000);
    const onData = (buf) => {
      if (String(buf).includes('联机服务端') || String(buf).includes('HTTP')) {
        clearTimeout(t); resolve();
      }
    };
    serverProc.stdout.on('data', onData);
    serverProc.stderr.on('data', onData);
    serverProc.on('exit', (code) => {
      clearTimeout(t);
      reject(new Error('server exited early ' + code));
    });
  });
}

function stopServer() {
  if (serverProc) {
    try { serverProc.kill('SIGTERM'); } catch { /* ignore */ }
    serverProc = null;
  }
}

await test('联机服务器：大厅现身、组队、发车', async () => {
  await startServer();
  try {
    const getJson = (path) => new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:' + PORT + path, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
    const api = await getJson('/api/status');
    assert.equal(api.ok, true);
    assert.ok(api.version);
    const rooms = await getJson('/api/rooms');
    assert.equal(rooms.ok, true);
    assert.ok(Array.isArray(rooms.rooms));

    const a = await openClient('ws://127.0.0.1:' + PORT + '/ws', { name: '甲', level: 10, x: 200, y: 300 });
    const welcomeA = await waitMsg(a, (m) => m.t === 'welcome');
    assert.ok(welcomeA.id);

    const joinAPromise = waitMsg(a, (m) => m.t === 'peer_join' && m.peer && m.peer.name === '乙');
    const b = await openClient('ws://127.0.0.1:' + PORT + '/ws', { name: '乙', level: 8, x: 400, y: 500 });
    const welcomeB = await waitMsg(b, (m) => m.t === 'welcome');
    assert.ok(welcomeB.peers.some((p) => p.id === welcomeA.id), '乙应看到甲');
    await joinAPromise;

    a.send(JSON.stringify({ t: 'ping', ts: 12345 }));
    const pong = await waitMsg(a, (m) => m.t === 'pong');
    assert.equal(pong.ts, 12345);

    a.send(JSON.stringify({ t: 'hub_pos', x: 220, y: 310, facing: 0.5, walkPhase: 1, level: 10 }));
    const posB = await waitMsg(b, (m) => m.t === 'hub_pos' && m.id === welcomeA.id);
    assert.equal(posB.x, 220);

    a.send(JSON.stringify({
      t: 'char_sync', name: '甲',
      character: { level: 10, steaks: 3, equipped: {}, xp: 0 }
    }));
    b.send(JSON.stringify({
      t: 'char_sync', name: '乙',
      character: { level: 8, steaks: 2, equipped: {}, xp: 0 }
    }));

    a.send(JSON.stringify({ t: 'party_create' }));
    const partyA = await waitMsg(a, (m) => m.t === 'party_update' && m.party);
    assert.equal(partyA.party.leaderId, welcomeA.id);

    a.send(JSON.stringify({ t: 'party_invite', toId: welcomeB.id }));
    const invite = await waitMsg(b, (m) => m.t === 'party_invite');
    assert.equal(invite.partyId, partyA.party.id);

    const partyPromise = waitMsg(a, (m) => m.t === 'party_update' && m.party && m.party.members.length === 2);
    b.send(JSON.stringify({ t: 'party_accept', partyId: invite.partyId }));
    await partyPromise;

    const startB = waitMsg(b, (m) => m.t === 'dungeon_start');
    a.send(JSON.stringify({
      t: 'dungeon_start',
      biome: 'camp', floor: 1, seed: 999001,
      roster: [{
        id: welcomeA.id, name: '甲',
        character: { level: 10, steaks: 3, equipped: {} }
      }]
    }));
    const startA = await waitMsg(a, (m) => m.t === 'dungeon_start');
    const startGuest = await startB;
    assert.equal(startA.hostId, welcomeA.id);
    assert.equal(startA.seed, 999001);
    assert.equal(startGuest.roster.length, 2);
    assert.ok(startGuest.roster.some((r) => r.id === welcomeB.id));
    const guestSlot = startGuest.roster.find((r) => r.id === welcomeB.id);
    assert.equal(guestSlot.character.level, 8, 'char_sync 应进入发车名单');

    a.close();
    b.close();
  } finally {
    stopServer();
  }
});

console.log('\n时空猪 · 联机模块测试\n' + out.join('\n'));
console.log(`\n通过 ${pass} / ${pass + fail}` + (fail ? `  ✗ 失败 ${fail}` : '  ✓ 全部通过'));
process.exit(fail ? 1 : 0);
