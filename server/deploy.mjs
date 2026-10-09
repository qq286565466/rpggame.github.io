#!/usr/bin/env node
/* 时空猪 · 服主自动部署
 *
 * 1. 探测本机局域网 IP / 公网 IP
 * 2. 醒目提示需要映射的端口与目标 IP
 * 3. 支持 SakuraFrp 等穿透：PUBLIC_URL / --public=
 * 4. 写出服主卡片 host-card.txt 并启动联机服务端
 *
 * 用法：
 *   npm run deploy
 *   node server/deploy.mjs [port]
 *   node server/deploy.mjs --public=http://xxx.sakurafrp.com:12345
 *   PUBLIC_URL=http://xxx.sakurafrp.com:12345 npm run deploy
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gatherHostInfo, formatHostBanner, formatHostCard } from './hostinfo.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  let port = Number(process.env.PORT || 4321);
  let publicUrl = process.env.PUBLIC_URL || process.env.FRP_URL || process.env.SP_PUBLIC_URL || '';
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      console.log(`用法:
  node server/deploy.mjs [端口] [--public=穿透访问地址]

示例（SakuraFrp）:
  1) 面板创建 TCP 隧道，本地 127.0.0.1:4321
  2) 记下访问地址，例如 xxx.sakurafrp.com:23456
  3) node server/deploy.mjs --public=http://xxx.sakurafrp.com:23456

环境变量: PORT  HOST  PUBLIC_URL  FRP_URL`);
      process.exit(0);
    }
    if (a.startsWith('--public=')) publicUrl = a.slice('--public='.length);
    else if (a === '--public' || a === '-p') { /* next handled below */ }
    else if (/^\d+$/.test(a)) port = Number(a);
  }
  const idx = argv.indexOf('--public');
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('-')) {
    publicUrl = argv[idx + 1];
  }
  const idxP = argv.indexOf('-p');
  if (idxP >= 0 && argv[idxP + 1] && !argv[idxP + 1].startsWith('-')) {
    publicUrl = argv[idxP + 1];
  }
  return { port, publicUrl };
}

async function main() {
  const { port, publicUrl } = parseArgs(process.argv.slice(2));
  process.env.PORT = String(port);
  process.env.HOST = process.env.HOST || '0.0.0.0';
  process.env.SP_HOST_DEPLOY = '1';
  if (publicUrl) {
    process.env.PUBLIC_URL = publicUrl;
  }

  process.stdout.write('正在探测本机与公网地址…\n');
  if (publicUrl) process.stdout.write('已指定穿透/公网入口: ' + publicUrl + '\n');
  else process.stdout.write('未指定 PUBLIC_URL（SakuraFrp 服主请加上 --public=访问地址）\n');

  const info = await gatherHostInfo({
    port, host: process.env.HOST, publicUrl: publicUrl || undefined
  });

  const cardPath = path.join(root, 'host-card.txt');
  const jsonPath = path.join(root, '.host-info.json');
  fs.writeFileSync(cardPath, formatHostCard(info), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(info, null, 2), 'utf8');
  process.env.SP_HOST_INFO_PATH = jsonPath;

  console.log(formatHostBanner(info));
  console.log('已写入服主卡片: ' + cardPath);
  console.log('正在启动联机服务端…\n');

  const mod = await import(pathToFileURL(path.join(__dirname, 'index.mjs')).href);
  try {
    await mod.ready;
  } catch (err) {
    // index.mjs already prints EADDRINUSE tips; ensure non-zero exit for .cmd
    process.exitCode = 1;
    throw err;
  }
  // Keep process alive while HTTP server runs (event loop held by listen).
}

main().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  if (!(err && err.code === 'EADDRINUSE')) {
    console.error('部署失败:', msg);
  }
  process.exit(1);
});
