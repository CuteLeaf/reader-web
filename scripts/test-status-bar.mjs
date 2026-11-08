/**
 * 底部细状态栏与设置开关的浏览器端到端验证。
 *
 * 前置：
 *   pnpm build
 *   node scripts/mock-legado.mjs --port 1142
 *   node scripts/serve-dist.mjs --port 4173 --dir dist
 *   pnpm test:status-bar
 *
 * 覆盖：底部状态栏只占纸张宽度 / 只显示章节名（不预设序号）/ 本章阅读百分比 /
 * 默认不显示进度条 / 到顶到底 / 换章重置 / 窄屏让位 /
 * 设置里可开关状态栏与进度条 / 无 JS 异常。
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
const PORT = 9900 + Math.floor(Math.random() * 90);
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

const profile = mkdtempSync(join(tmpdir(), 'status-bar-'));
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

const status = () =>
  evalJs(`(() => {
    const bar = document.querySelector('.status-bar');
    if (!bar) return null;
    const q = (s) => document.querySelector(s);
    const rect = (s) => q(s)?.getBoundingClientRect();
    const prog = q('.status-progress');
    const box = bar.getBoundingClientRect();
    const paper = rect('.paper');
    return {
      height: box.height,
      top: box.top,
      bottomGap: window.innerHeight - box.bottom,
      viewportH: window.innerHeight,
      left: box.left,
      width: box.width,
      zIndex: Number(getComputedStyle(bar).zIndex),
      withBar: document.querySelector('.reader')?.classList.contains('with-status-bar') ?? false,
      sideBorder: getComputedStyle(bar).borderLeftWidth,
      paperLeft: paper?.left ?? -1,
      paperTop: paper?.top ?? -1,
      paperWidth: paper?.width ?? -1,
      text: (bar.textContent ?? '').replace(/\\s+/g, ' ').trim(),
      hasBook: !!q('.status-book'),
      hasIndex: !!q('.status-index'),
      title: q('.status-title')?.textContent?.trim() ?? '',
      percent: prog?.textContent?.trim() ?? '',
      percentPrefix: prog ? getComputedStyle(prog, '::before').content : '',
      headTitle: q('.chapter-head h2')?.textContent?.trim() ?? '',
      hasProgressBar: !!q('.status-bar .progress'),
      fillWidth: rect('.status-bar .progress .fill')?.width ?? 0,
    };
  })()`);

/** mock 数据每章只有几段，注入一些段落保证正文可滚动，进度才有中间值 */
const inflate = () =>
  evalJs(`(() => {
    const c = document.querySelector('.content');
    if (!c || c.dataset.inflated) return false;
    c.dataset.inflated = '1';
    for (let i = 0; i < 160; i += 1) {
      const p = document.createElement('p');
      p.textContent = '测试段落：雨夜的街道很长，足够让本章出现可滚动的中间进度。';
      c.appendChild(p);
    }
    return true;
  })()`);

const scrollToRatio = (ratio) =>
  evalJs(`(() => {
    const el = document.querySelector('.scroller');
    if (!el) return null;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.round(max * ${ratio});
    el.dispatchEvent(new Event('scroll'));
    return { max, top: el.scrollTop };
  })()`);

const percentNumber = (s) => Number(String(s?.percent ?? '').replace('%', ''));

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
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: `${BASE}?endpoint=${encodeURIComponent(ENDPOINT)}` });
  await sleep(2600);
  await evalJs(`document.querySelector('.card')?.click()`);
  const ready = await waitFor(() => evalJs(`!!document.querySelector('.paper .content p')`));
  check('进入阅读页', ready);
  await inflate();
  // mock 后端可能带上次阅读位置，先回到章首再看初始版式
  await scrollToRatio(0);
  await sleep(250);

  /* ---------- A. 状态栏本身 ---------- */
  console.log('\n状态栏：');
  const a = await status();
  check('状态栏存在', !!a, JSON.stringify(a));
  check('高度很小（不超过 30px）', a?.height > 0 && a?.height <= 30, `${a?.height}px`);
  check('贴在页面底部', (a?.bottomGap ?? 99) <= 1, `${a?.bottomGap}px`);
  check('阅读页带状态栏标记', a?.withBar === true);
  // 摸鱼模式伪装层 z-index 999，状态栏必须低于它，否则伪装时会漏出章节名
  check('层级低于伪装层', a?.zIndex > 0 && a?.zIndex < 900, `${a?.zIndex}`);
  check(
    '状态栏常驻底部、纸张从页面顶部开始',
    (a?.bottomGap ?? 99) <= 1 &&
      (a?.top ?? -1) >= (a?.viewportH ?? 0) - 30 &&
      (a?.paperTop ?? -1) <= 1,
    JSON.stringify({ top: a?.top, vh: a?.viewportH, paperTop: a?.paperTop }),
  );
  check(
    '宽度与中间纸张一致且左右对齐',
    Math.abs((a?.width ?? 0) - (a?.paperWidth ?? -1)) <= 2 &&
      Math.abs((a?.left ?? 0) - (a?.paperLeft ?? -1)) <= 2,
    JSON.stringify({ bar: [a?.left, a?.width], paper: [a?.paperLeft, a?.paperWidth] }),
  );
  check('默认不显示进度条，只留百分比', a?.hasProgressBar === false);

  /* ---------- B. 章节名 ---------- */
  console.log('\n章节信息：');
  check('不显示小说名', a?.hasBook === false && !(a?.text ?? '').includes('雨夜书店'), a?.text);
  check(
    '不预设「第X章」，也不显示 N/M 总章数',
    a?.hasIndex === false &&
      !/\d+\s*\/\s*\d+/.test(a?.text ?? '') &&
      !/^第\d+章/.test(a?.text ?? ''),
    a?.text,
  );
  check(
    '只显示章节名且与正文标题一致',
    (a?.title ?? '').length > 0 && a?.title === a?.headTitle,
    `${a?.title} vs ${a?.headTitle}`,
  );
  check(
    '显示「本章 N%」',
    /^\d+%$/.test(a?.percent ?? '') && (a?.percentPrefix ?? '').includes('本章'),
    JSON.stringify({ percent: a?.percent, prefix: a?.percentPrefix }),
  );

  /* ---------- C. 本章阅读进度 ---------- */
  console.log('\n本章进度：');
  const topState = await scrollToRatio(0);
  await sleep(220);
  const p0 = await status();
  check('正文可滚动（能算出中间进度）', (topState?.max ?? 0) > 200, JSON.stringify(topState));
  check('章首为 0%', percentNumber(p0) === 0, p0?.percent);

  await scrollToRatio(0.5);
  await sleep(220);
  const p50 = await status();
  check('滚动时状态栏仍粘在底部', (p50?.bottomGap ?? 99) <= 1, `${p50?.bottomGap}px`);
  check('滚到一半显示中间百分比', percentNumber(p50) > 20 && percentNumber(p50) < 80, p50?.percent);

  await scrollToRatio(1);
  await sleep(220);
  const p100 = await status();
  check('滚到底为 100%', percentNumber(p100) === 100, p100?.percent);

  await scrollToRatio(0);
  await sleep(220);
  const pBack = await status();
  check('往回看进度同步回退', percentNumber(pBack) === 0, pBack?.percent);

  /* ---------- D. 换章 ---------- */
  console.log('\n换章：');
  const beforeTitle = (await status())?.title ?? '';
  const nextClicked = await evalJs(`(() => {
    const b = [...document.querySelectorAll('.chapter-foot button')].find((x) => x.textContent.includes('下一章'));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const changed = await waitFor(async () => (await status())?.title !== beforeTitle);
  await sleep(300);
  const d = await status();
  check('可以翻到下一章', nextClicked && changed, `${beforeTitle} -> ${d?.title}`);
  check(
    '换章后状态栏仍只显示新章节名',
    d?.hasIndex === false && d?.title !== beforeTitle && d?.title === d?.headTitle,
    `${beforeTitle} -> ${d?.title}`,
  );
  check(
    '换章后章节名同步',
    (d?.title ?? '').length > 0 && d?.title === d?.headTitle,
    `${d?.title} vs ${d?.headTitle}`,
  );
  check('换章后本章进度重置为 0%', percentNumber(d) === 0, d?.percent);

  /* ---------- E. 窄屏让位 ---------- */
  console.log('\n窄屏：');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 340,
    height: 620,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(350);
  const e = await status();
  check('侧栏很窄时状态栏仍只有一行', e?.height > 0 && e?.height <= 30, `${e?.height}px`);
  check(
    '窄屏状态栏随纸张铺满并与纸张对齐',
    Math.abs((e?.width ?? 0) - (e?.paperWidth ?? -1)) <= 2 &&
      Math.abs((e?.left ?? 0) - (e?.paperLeft ?? -1)) <= 2 &&
      (e?.width ?? 0) >= 340 - 20,
    JSON.stringify({ bar: [e?.left, e?.width], paper: [e?.paperLeft, e?.paperWidth] }),
  );
  check('窄屏去掉左右边框', e?.sideBorder === '0px', e?.sideBorder);
  check('窄屏省去「本章」字样', !(e?.percentPrefix ?? '').includes('本章'), e?.percentPrefix);
  check(
    '窄屏仍不显示小说名',
    e?.hasBook === false && !(e?.text ?? '').includes('雨夜书店'),
    e?.text,
  );
  check(
    '窄屏仍只显示章节名与进度',
    e?.hasIndex === false && (e?.title ?? '').length > 0 && /%$/.test(e?.percent ?? ''),
    JSON.stringify({ title: e?.title, percent: e?.percent }),
  );
  check(
    '窄屏状态栏仍贴在底部、纸张从顶部开始',
    (e?.bottomGap ?? 99) <= 1 && (e?.paperTop ?? -1) <= 1,
    JSON.stringify({ bottomGap: e?.bottomGap, paperTop: e?.paperTop }),
  );

  /* ---------- F. 设置里的两个开关 ---------- */
  console.log('\n设置开关：');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(300);
  const openSettings = await evalJs(`(() => {
    const b = [...document.querySelectorAll('.tools.left button')].find((x) =>
      x.textContent.includes('设置'),
    );
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const panelReady = await waitFor(() =>
    evalJs(`!!document.querySelector('button[aria-label="显示底部状态栏"]')`),
  );
  const progressSwitch = await evalJs(
    `!!document.querySelector('button[aria-label="显示状态栏进度条"]')`,
  );
  check('设置面板里有状态栏与进度条两个开关', openSettings && panelReady && progressSwitch);

  const switchInfo = (label) =>
    evalJs(`(() => {
      const b = [...document.querySelectorAll('button[aria-label]')].find(
        (x) => x.getAttribute('aria-label') === ${JSON.stringify(label)},
      );
      return b ? { pressed: b.getAttribute('aria-pressed'), disabled: b.disabled } : null;
    })()`);
  const toggle = async (label) => {
    await evalJs(`(() => {
      const b = [...document.querySelectorAll('button[aria-label]')].find(
        (x) => x.getAttribute('aria-label') === ${JSON.stringify(label)},
      );
      b?.click();
    })()`);
    await sleep(250);
  };

  const barOn = await switchInfo('显示底部状态栏');
  const lineOff = await switchInfo('显示状态栏进度条');
  check(
    '默认开状态栏、关进度条',
    barOn?.pressed === 'true' && lineOff?.pressed === 'false',
    JSON.stringify({ barOn, lineOff }),
  );

  await toggle('显示底部状态栏');
  const barHidden = await evalJs(
    `!document.querySelector('.status-bar') && !document.querySelector('.reader')?.classList.contains('with-status-bar')`,
  );
  check('关掉开关后状态栏与占位一起消失', barHidden);
  check('状态栏关掉时进度条开关不可点', (await switchInfo('显示状态栏进度条'))?.disabled === true);

  await toggle('显示底部状态栏');
  check('重新开启后状态栏恢复', await evalJs(`!!document.querySelector('.status-bar')`));

  await toggle('显示状态栏进度条');
  check('开启进度条后细线出现', await evalJs(`!!document.querySelector('.status-bar .progress')`));
  await scrollToRatio(0.5);
  await sleep(250);
  const f = await status();
  check(
    '细线按本章进度伸展',
    (f?.fillWidth ?? 0) > (f?.width ?? 0) * 0.3,
    JSON.stringify({ fill: f?.fillWidth, bar: f?.width, percent: f?.percent }),
  );

  await toggle('显示状态栏进度条');
  check('再次关闭后细线消失', await evalJs(`!document.querySelector('.status-bar .progress')`));

  check('全程没有未捕获 JS 异常', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.error('E2E 异常：', e.message);
  fail += 1;
} finally {
  chrome.kill();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 200);
}
