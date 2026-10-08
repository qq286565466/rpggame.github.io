/* 时空猪 · 无头浏览器抓图与自检（CDP 驱动，零第三方依赖）
 *
 * 用法: node tools/cdp.mjs <url> <out.png> [等待ms] [宽] [高] ["可选JS表达式"]
 * 例:   node tools/cdp.mjs "http://127.0.0.1:4321/index.html#dev-sim60" shots/fight.png 2500 1440 810
 *
 * 相比 chrome --screenshot，这里用 DevTools 协议真实等待指定的墙钟时间再截图，
 * 因此对持续动画的页面也稳定，同时能回收页面里的 JS 异常与控制台错误。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];

const [url, outArg, waitArg, wArg, hArg, expr, preExpr] = process.argv.slice(2);
if (!url || !outArg) {
  console.error('用法: node tools/cdp.mjs <url> <out.png> [等待ms] [宽] [高] ["探针JS"] ["预处理JS"]');
  process.exit(2);
}
const out = path.resolve(outArg);
const waitMs = Number(waitArg || 2500);
const W = Number(wArg || 1440);
const H = Number(hArg || 810);
if (process.env.CDP_DEBUG) {
  console.log('  [debug] argv=' + JSON.stringify({ url, out, waitMs, W, H, expr, preExpr }));
}

const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!exe) { console.error('未找到 Chrome/Edge'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 表达式以 @ 开头时从文件读取，避免长脚本在命令行里被转义破坏 */
function resolveExpr(s) {
  if (s && s.startsWith('@')) return fs.readFileSync(path.resolve(s.slice(1)), 'utf8');
  return s;
}

const port = 9000 + Math.floor(Math.random() * 900);
const profile = path.join(process.env.TEMP || '.', 'spm-cdp-' + Date.now());

fs.mkdirSync(path.dirname(out), { recursive: true });

const child = spawn(exe, [
  '--headless=new',
  '--disable-gpu',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  // 无头窗口会被判定为「被遮挡」，不给这些开关的话 rAF 会被降频甚至暂停，
  // 依赖帧推进的检查就会随机失败（曾经真的踩到过）。
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-features=CalculateNativeWinOcclusion',
  '--window-size=' + W + ',' + H,
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });

let stderr = '';
child.stderr.on('data', (d) => { stderr += d.toString(); });

let finished = false;
const hardStop = setTimeout(() => {
  if (finished) return;
  console.error('✗ 抓图超时，强制终止');
  cleanup(1);
}, Number(process.env.CDP_TIMEOUT_MS || 90000));

function cleanup(code) {
  finished = true;
  clearTimeout(hardStop);
  try { child.kill('SIGKILL'); } catch {}
  setTimeout(() => {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    process.exit(code);
  }, 200);
}

async function waitForDevtools(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (r.ok) return;
    } catch { /* 尚未就绪 */ }
    await sleep(120);
  }
  throw new Error('DevTools 端口未就绪\n' + stderr.split('\n').slice(-6).join('\n'));
}

async function main() {
  await waitForDevtools();

  const targetRes = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' });
  const target = await targetRes.json();

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const errors = [];
  const events = new Map();
  let msgId = 0;

  const ready = new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = (e) => rej(new Error('WebSocket 连接失败: ' + (e.message || '')));
  });

  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.rej(new Error(JSON.stringify(m.error)));
      else p.res(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errors.push((d.exception && d.exception.description) || d.text || 'unknown exception');
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (m.params.type === 'error') errors.push('console.error: ' + text);
      // 页面里的 console.log 直接透传出来，便于观察端到端脚本的进度
      else if (/^(log|info|warn)$/.test(m.params.type)) console.log('  [page] ' + text);
    } else if (events.has(m.method)) {
      const list = events.get(m.method);
      events.delete(m.method);
      list.forEach((fn) => fn(m.params));
    }
  };

  function send(method, params) {
    return new Promise((res, rej) => {
      const id = ++msgId;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  function once(method) {
    return new Promise((res) => {
      if (!events.has(method)) events.set(method, []);
      events.get(method).push(res);
    });
  }

  await ready;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await Promise.race([loaded, sleep(15000)]);

  // preExpr：等待之前先驱动界面（例如自动注册并开局）
  const preCode = resolveExpr(preExpr);
  if (preCode && preCode.trim()) {
    const pre = await send('Runtime.evaluate', { expression: preCode, returnByValue: true, awaitPromise: true });
    if (pre.exceptionDetails) {
      const d = pre.exceptionDetails;
      console.log('  ⚠ preExpr 抛错: ' + (d.exception?.description || d.text || JSON.stringify(d)));
      errors.push('preExpr: ' + (d.exception?.description || d.text));
    } else if (pre.result && pre.result.value !== undefined) {
      console.log('  预处理: ' + pre.result.value);
    } else {
      console.log('  ⚠ preExpr 无返回值: ' + JSON.stringify(pre).slice(0, 400));
    }
  }

  await sleep(waitMs);

  const probeCode = resolveExpr(expr);
  const probe = await send('Runtime.evaluate', {
    expression: probeCode && probeCode.trim()
      ? probeCode
      : `JSON.stringify({ errs: (window.__errs||[]).length, title: document.title, visible: [...document.querySelectorAll('.screen')].filter(s=>s.classList.contains('active')).map(s=>s.id), hasWorld: !!(window.SP&&SP.__game&&SP.__game.getWorld&&SP.__game.getWorld()) })`,
    returnByValue: true,
    awaitPromise: false
  });
  const probeValue = probe.result && probe.result.value;
  if (probe.exceptionDetails) {
    const d = probe.exceptionDetails;
    console.log('  ⚠ 探针抛错: ' + (d.exception?.description || d.text || JSON.stringify(d)));
    errors.push('probe: ' + (d.exception?.description || d.text));
  }
  if (process.env.CDP_DEBUG) console.log('  [debug] probe=' + JSON.stringify(probe).slice(0, 500));

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));

  console.log('✓ ' + path.relative(process.cwd(), out) + '  (' + fs.statSync(out).size + ' bytes, ' + W + 'x' + H + ')');
  if (probeValue !== undefined) console.log('  探针: ' + probeValue);
  if (errors.length) {
    console.log('  ⚠ 页面错误 ' + errors.length + ' 条:');
    errors.slice(0, 6).forEach((e) => console.log('    - ' + String(e).split('\n')[0]));
  } else {
    console.log('  页面无 JS 异常');
  }

  try { await send('Browser.close'); } catch {}
  ws.close();
  cleanup(errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error('✗ ' + e.message);
  cleanup(1);
});
