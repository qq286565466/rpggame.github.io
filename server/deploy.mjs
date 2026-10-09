#!/usr/bin/env node
/* 时空猪 · 服主自动部署
 *
 * 1. 探测本机局域网 IP / 公网 IP
 * 2. 醒目提示需要映射的端口与目标 IP
 * 3. 写出服主卡片 host-card.txt
 * 4. 启动联机服务端
 *
 * 用法：
 *   npm run deploy
 *   node server/deploy.mjs [port]
 *   PORT=4321 node server/deploy.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gatherHostInfo, formatHostBanner, formatHostCard } from './hostinfo.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || process.argv[2] || 4321);

async function main() {
  process.env.PORT = String(port);
  process.env.HOST = process.env.HOST || '0.0.0.0';
  process.env.SP_HOST_DEPLOY = '1';

  process.stdout.write('正在探测本机与公网地址…\n');
  const info = await gatherHostInfo({ port, host: process.env.HOST });

  const cardPath = path.join(root, 'host-card.txt');
  const jsonPath = path.join(root, '.host-info.json');
  fs.writeFileSync(cardPath, formatHostCard(info), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(info, null, 2), 'utf8');
  process.env.SP_HOST_INFO_PATH = jsonPath;

  console.log(formatHostBanner(info));
  console.log('已写入服主卡片: ' + cardPath);
  console.log('正在启动联机服务端…\n');

  // 动态加载服务端（复用同一进程）
  await import(pathToFileURL(path.join(__dirname, 'index.mjs')).href);
}

main().catch((err) => {
  console.error('部署失败:', err && err.message ? err.message : err);
  process.exit(1);
});
