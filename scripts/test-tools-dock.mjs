/**
 * 窄屏工具栏「收起成小把手」的浏览器端到端验证。
 *
 * 前置：
 *   pnpm build
 *   node scripts/mock-legado.mjs --port 1142
 *   node scripts/serve-dist.mjs --port 4173 --dir dist
 *   pnpm test:tools-dock
 *
 * 覆盖：收起态 / 点开 / 点空白收起 / 点功能收起 / Esc / 滚动收起 /
 * 自动滚屏时一步暂停 / 桌面端常驻竖排不受影响。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
const PORT = 9800 + Math.floor(Math.random() * 100);
const BASE = 'http://127.0.0.1:4173/';
const ENDPOINT = 'http://127.0.0.1:1142';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ''}`);
  }
};

const reachable = async (url) => {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
};

if (!CHROME) {
  console.error('找不到 Chrome / Edge，可用 CHROME_PATH 指定浏览器路径');
  process.exit(1);
}
if (!(await reachable(BASE)) || !(await reachable(`${ENDPOINT}/getBookshelf`))) {
  console.error('请先启动 mock 后端（1142）与 dist 静态预览（4173）');
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'tools-dock-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let ws;
const pending = new Map();
let seq = 0;
const errors = [];
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};
const waitFor = async (fn, timeout = 12000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
};
const dock = () =>
  evalJs(`(() => {
    const el = document.querySelector('.tools.left');
    if (!el) return null;
    const s = getComputedStyle(el);
    return { opacity: Number(s.opacity), pe: s.pointerEvents, open: el.classList.contains('open') };
  })()`);
const handle = () =>
  evalJs(`(() => {
    const el = document.querySelector('.tools-handle');
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      display: s.display,
      opacity: Number(s.opacity),
      pe: s.pointerEvents,
      label: el.getAttribute('aria-label'),
      pausing: el.classList.contains('pausing'),
      hidden: el.classList.contains('hidden'),
    };
  })()`);
const clickHandle = async () => {
  await evalJs(`document.querySelector('.tools-handle')?.click()`);
  await sleep(260);
};
const clickDock = async (text) =>
  evalJs(`(() => {
    const b = [...document.querySelectorAll('.tools.left button')].find((x) => x.textContent.includes(${JSON.stringify(text)}));
    if (!b) return false;
    b.click();
    return true;
  })()`);
const autoRunning = () =>
  evalJs(`!!document.querySelector('.tools.left button[aria-pressed="true"]')`);

try {
  let list = [];
  for (let i = 0; i < 40; i += 1) {
    try {
      list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (list.length) break;
    } catch {
      /* 等调试端口 */
    }
    await sleep(250);
  }
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params?.exceptionDetails?.text ?? 'unknown');
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 780,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: `${BASE}?endpoint=${encodeURIComponent(ENDPOINT)}` });
  await sleep(2600);
  await evalJs(`document.querySelector('.card')?.click()`);
  const ready = await waitFor(() => evalJs(`!!document.querySelector('.paper .content p')`));
  check('进入阅读页', ready);

  /* ---------- A. 收起态 ---------- */
  console.log('\n收起态：');
  const d0 = await dock();
  const h0 = await handle();
  check(
    '窄屏 dock 默认隐藏且不拦截点击',
    d0?.opacity === 0 && d0.pe === 'none',
    JSON.stringify(d0),
  );
  check('右下角小把手可见', h0?.display === 'flex' && h0.opacity > 0, JSON.stringify(h0));
  check(
    '六个按钮仍在 DOM 中',
    (await evalJs(`document.querySelectorAll('.tools.left button').length`)) === 6,
  );

  /* ---------- A2. 下移时把手也隐藏 ---------- */
  console.log('\n下移自动隐藏：');
  const scrollBy = (px) =>
    evalJs(`(() => {
      const el = document.querySelector('.scroller');
      if (!el) return false;
      el.scrollTop += ${px};
      el.dispatchEvent(new Event('scroll'));
      return true;
    })()`);

  await scrollBy(400);
  await sleep(250);
  const hDown = await handle();
  check(
    '向下滚动时把手隐藏且不拦截点击',
    hDown?.opacity === 0 && hDown.pe === 'none' && hDown.hidden === true,
    JSON.stringify(hDown),
  );

  await scrollBy(-120);
  await sleep(250);
  check('向上滚动时把手立即恢复', (await handle())?.opacity > 0);

  await scrollBy(300);
  await sleep(250);
  check('再次下移仍隐藏', (await handle())?.opacity === 0);
  await sleep(1600);
  check('停止滚动后自动恢复，不会找不到入口', (await handle())?.opacity > 0);

  /* ---------- B. 展开与收起 ---------- */
  console.log('\n展开与收起：');
  await clickHandle();
  const d1 = await dock();
  check(
    '点把手展开 dock',
    d1?.open === true && d1.opacity === 1 && d1.pe === 'auto',
    JSON.stringify(d1),
  );
  check('展开时把手让位隐藏', (await handle())?.opacity === 0);

  await evalJs(`document.querySelector('.paper')?.click()`);
  await sleep(260);
  check('点正文空白处收起', (await dock())?.opacity === 0);

  await clickHandle();
  await sleep(100);
  await evalJs(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  );
  await sleep(260);
  check('Esc 收起', (await dock())?.opacity === 0);

  await clickHandle();
  await sleep(100);
  await evalJs(`(() => {
    const el = document.querySelector('.scroller');
    if (!el) return;
    el.scrollTop += 300;
    el.dispatchEvent(new Event('scroll'));
  })()`);
  await sleep(260);
  check('滚动正文时收起', (await dock())?.opacity === 0);

  await clickHandle();
  await sleep(100);
  const topClicked = await clickDock('顶部');
  await sleep(260);
  check('点功能按钮后自动收起', topClicked && (await dock())?.opacity === 0);

  /* ---------- C. 自动滚屏：必须能一步关掉 ---------- */
  console.log('\n自动滚屏：');
  await clickHandle();
  await sleep(100);
  const rollClicked = await clickDock('滚动');
  await sleep(700);
  const h2 = await handle();
  check('可从 dock 开启自动滚屏', rollClicked && (await autoRunning()));
  check('自动滚屏时 dock 收起', (await dock())?.opacity === 0);
  check(
    '把手变成「暂停自动滚动」并带强调态',
    h2?.label === '暂停自动滚动' && h2.pausing === true && h2.opacity === 1,
    JSON.stringify(h2),
  );
  check('自动滚屏持续下移也不隐藏把手（暂停入口不能丢）', h2?.hidden === false);

  const pos1 = await evalJs(`document.querySelector('.scroller')?.scrollTop ?? 0`);
  await sleep(500);
  const pos2 = await evalJs(`document.querySelector('.scroller')?.scrollTop ?? 0`);
  check('自动滚屏确实在滚动', pos2 > pos1, `${pos1} -> ${pos2}`);
  const hRolling = await handle();
  check(
    '持续滚动期间把手仍可见可点',
    hRolling?.opacity === 1 && hRolling.pe !== 'none',
    JSON.stringify(hRolling),
  );

  await clickHandle();
  await sleep(300);
  check('点把手一步暂停自动滚屏', !(await autoRunning()));
  check('暂停后把手恢复为「展开工具栏」', (await handle())?.label === '展开工具栏');
  const pos3 = await evalJs(`document.querySelector('.scroller')?.scrollTop ?? 0`);
  await sleep(500);
  const pos4 = await evalJs(`document.querySelector('.scroller')?.scrollTop ?? 0`);
  check('暂停后不再继续滚动', pos4 === pos3, `${pos3} -> ${pos4}`);

  /* ---------- D. 桌面端不受影响 ---------- */
  console.log('\n桌面端：');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(350);
  const d3 = await dock();
  const h3 = await handle();
  check('桌面端 dock 常驻可见且可点', d3?.opacity === 1 && d3.pe === 'auto', JSON.stringify(d3));
  check('桌面端小把手隐藏', h3?.display === 'none', JSON.stringify(h3));
  check(
    '桌面端仍是左侧竖排',
    await evalJs(
      `getComputedStyle(document.querySelector('.tools.left')).flexDirection === 'column'`,
    ),
  );

  check('全程没有未捕获 JS 异常', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.error('E2E 异常：', e.message);
  fail += 1;
} finally {
  chrome.kill();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 200);
}
