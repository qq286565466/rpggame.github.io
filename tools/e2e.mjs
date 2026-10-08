/* 时空猪 · 一条命令完成验收：node tools/e2e.mjs
 *
 * 五段全自动：
 *   1) 三组逻辑单元测试
 *   2) 打包单文件版本
 *   3) 无头浏览器端到端（新号全流程：注册→枢纽→副本→结算）
 *   4) 旧存档迁移（写入 v1 存档 → 刷新 → 核对迁移结果）
 *   5) 养成循环试玩机器人
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const run = (args) => spawnSync(process.execPath, args, { stdio: 'inherit', cwd: root });
const cdp = path.join(root, 'tools', 'cdp.mjs');
const e2eFile = (name) => '@' + path.join(root, 'test', 'e2e', name);

console.log('── 1/5 逻辑单元测试 ──');
for (const t of ['sim.test.mjs', 'items.test.mjs', 'progress.test.mjs', 'hideout.test.mjs']) {
  console.log('  · ' + t);
  const r = run([path.join(root, 'test', t)]);
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log('\n── 2/5 打包单文件版本 ──');
let r = run([path.join(root, 'tools', 'build.mjs')]);
if (r.status !== 0) process.exit(r.status || 1);

const target = path.join(root, 'dist', 'index.html');
if (!fs.existsSync(target)) { console.error('缺少 dist/index.html'); process.exit(1); }
const url = 'file:///' + target.replace(/\\/g, '/');

console.log('\n── 3/5 无头浏览器端到端（file:// 单文件版，新号全流程）──');
r = run([
  cdp, url, path.join(root, 'shots', 'e2e.png'), '600', '1440', '810',
  e2eFile('probe.js'), e2eFile('flow.js')
]);
if (r.status !== 0) { console.error('\n✗ 端到端未通过'); process.exit(r.status || 1); }

console.log('\n── 4/5 旧存档迁移（v1 生存竞技存档 → v2 角色存档）──');
r = run([
  cdp, url, path.join(root, 'shots', '11-migrate.png'), '2500', '1200', '700',
  e2eFile('probe-migrate.js'), e2eFile('migrate.js')
]);
if (r.status !== 0) { console.error('\n✗ 旧存档迁移未通过'); process.exit(r.status || 1); }

console.log('\n── 5/5 养成循环试玩（机器人刷本）──');
r = run([path.join(root, 'tools', 'progression.mjs'), '10', '240']);
if (r.status !== 0) process.exit(r.status || 1);

console.log('\n✓ 全部验收通过：逻辑测试 + 单文件打包 + 端到端流程 + 旧存档迁移 + 养成循环试玩');
