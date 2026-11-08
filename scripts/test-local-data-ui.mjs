/**
 * 本地数据管理面板的浏览器端到端验证。
 *
 * 前置：先起 mock 后端与静态预览
 *   pnpm build
 *   node scripts/mock-legado.mjs --port 1142
 *   node scripts/serve-dist.mjs --port 4173 --dir dist
 *   pnpm test:local-data-ui
 *
 * 覆盖：界面入口 / 面板展示 / 新增校验 / 重复与无效输入 / 保存 / 刷新恢复 /
 * 查看编辑删除 / 重新加载丢弃未保存改动 / 偏好编辑 / 阅读页入口 / 空白不关闭。
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
const PORT = 9750 + Math.floor(Math.random() * 100);
// 不带 ?endpoint：默认不自动回连，前面的 CRUD 断言才不会被自动记录的地址干扰
const BASE = 'http://127.0.0.1:4173/';
const KEY = 'reader:local-data:v1';
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
if (!(await reachable(BASE)) || !(await reachable('http://127.0.0.1:1142/getBookshelf'))) {
  console.error('请先启动 mock 后端（1142）与 dist 静态预览（4173）');
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'ldata-ui-'));
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
const send = (m, p = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method: m, params: p }));
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
const reload = async () => {
  await send('Page.reload', { ignoreCache: true });
  await sleep(2500);
  await waitFor(() => evalJs(`!!document.querySelector('.shelf')`));
};
const snap = () =>
  evalJs(`(() => {
    const raw = localStorage.getItem('${KEY}');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return 'BAD_JSON'; }
  })()`);
const clickLd = (name) =>
  evalJs(`(() => {
    const b = document.querySelector('[data-ld="${name}"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
const rowCount = () => evalJs(`document.querySelectorAll('[data-ld="row"]').length`);
const errorText = () =>
  evalJs(`document.querySelector('[data-ld="error"]')?.textContent?.trim() || ''`);
const setInput = (selector, value) =>
  evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return true;
  })()`);
const openPanel = async () => {
  await clickLd('open');
  await sleep(300);
  return evalJs(`!!document.querySelector('[data-ld="panel"]')`);
};
const closePanel = async () => {
  await evalJs(`document.querySelector('[data-ld="panel"] [aria-label="关闭"]')?.click()`);
  await sleep(200);
};

try {
  let list = [];
  for (let i = 0; i < 40; i += 1) {
    try {
      list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (list.length) break;
    } catch {
      /* 等端口 */
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
    if (msg.method === 'Page.javascriptDialogOpening') {
      // 重新加载 / 清空 / 导入的二次确认一律接受，避免阻塞 evaluate
      void send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
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
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  /* ---------- A. 入口与面板 ---------- */
  await evalJs(`localStorage.clear()`).catch(() => {});
  await send('Page.navigate', { url: BASE });
  await sleep(2800);
  check('书架侧栏有「本地数据」入口', await evalJs(`!!document.querySelector('[data-ld="open"]')`));
  check('点击入口打开管理面板', await openPanel());
  check(
    '面板显示标题与存储键',
    await evalJs(
      `document.querySelector('[data-ld="panel"]')?.innerText.includes('本地数据管理') && document.querySelector('[data-ld="status"]')?.innerText.includes('${KEY}')`,
    ),
  );
  check(
    '数据总览列出五类数据',
    await evalJs(
      `(() => { const t = document.querySelector('[data-ld="panel"] .stats')?.innerText || ''; return ['后端地址','书源令牌','阅读进度','本地书籍','自定义字体'].every((s) => t.includes(s)); })()`,
    ),
  );
  check('空集合显示空状态', await evalJs(`!!document.querySelector('[data-ld="empty"]')`));

  /* ---------- B. 新增与校验 ---------- */
  await clickLd('new');
  await sleep(150);
  check('新增表单可打开', await evalJs(`!!document.querySelector('[data-ld="form"]')`));
  await clickLd('submit');
  await sleep(150);
  check('必填为空被拦截', (await errorText()).includes('后端地址不能为空'), await errorText());

  await setInput('[data-ld-input="base"]', 'http://127.0.0.1:1142');
  await setInput('[data-ld-input="label"]', '测试后端');
  await clickLd('submit');
  await sleep(250);
  check('新增后出现一条记录', (await rowCount()) === 1, `rows=${await rowCount()}`);
  check(
    '记录内容与输入一致',
    await evalJs(
      `document.querySelector('[data-ld="row"]')?.innerText.includes('http://127.0.0.1:1142') && document.querySelector('[data-ld="row"]')?.innerText.includes('测试后端')`,
    ),
  );
  check('未保存时显示脏标记', await evalJs(`!!document.querySelector('[data-ld="dirty"]')`));
  check('未保存时磁盘里没有这条记录', (await snap())?.endpoints?.length === 0);

  await clickLd('new');
  await setInput('[data-ld-input="base"]', 'http://127.0.0.1:1142');
  await clickLd('submit');
  await sleep(200);
  check(
    '重复业务键被拦截',
    (await errorText()).includes('已存在相同的业务记录'),
    await errorText(),
  );
  check('重复输入没有写入第二条', (await rowCount()) === 1);
  await evalJs(`document.querySelector('[data-ld="form"] button[type="button"]')?.click()`);
  await sleep(150);
  const formClosed = await evalJs(`!document.querySelector('[data-ld="form"]')`);
  check('取消后表单关闭且记录不变', (await rowCount()) === 1 && formClosed);

  /* ---------- C. 保存与重启恢复 ---------- */
  await clickLd('save');
  await sleep(250);
  check(
    '保存后提示成功',
    await evalJs(
      `document.querySelector('[data-ld="message"]')?.innerText.includes('已保存到本机')`,
    ),
  );
  check('保存后脏标记消失', await evalJs(`!document.querySelector('[data-ld="dirty"]')`));
  const s1 = await snap();
  check(
    '磁盘快照含新记录',
    s1?.endpoints?.length === 1 && s1.endpoints[0].label === '测试后端',
    JSON.stringify(s1?.endpoints),
  );

  await reload();
  check('刷新后面板仍可打开', await openPanel());
  check('重启后记录恢复', (await rowCount()) === 1, `rows=${await rowCount()}`);

  /* ---------- D. 查看与编辑 ---------- */
  await clickLd('view');
  await sleep(150);
  check(
    '查看显示完整记录结构',
    await evalJs(
      `(() => { const t = document.querySelector('[data-ld="detail"]')?.innerText || ''; return t.includes('createdAt') && t.includes('http://127.0.0.1:1142'); })()`,
    ),
  );
  await clickLd('edit');
  await sleep(150);
  check(
    '编辑表单预填原值',
    await evalJs(`document.querySelector('[data-ld-input="label"]')?.value === '测试后端'`),
  );
  await setInput('[data-ld-input="label"]', '已改备注');
  await clickLd('submit');
  await sleep(200);
  check(
    '编辑后列表显示新值',
    await evalJs(`document.querySelector('[data-ld="row"]')?.innerText.includes('已改备注')`),
  );
  await clickLd('save');
  await sleep(200);
  check('编辑保存后落盘', (await snap())?.endpoints?.[0]?.label === '已改备注');

  /* ---------- E. 重新加载丢弃未保存改动 ---------- */
  await clickLd('new');
  await setInput('[data-ld-input="base"]', 'http://127.0.0.1:8888');
  await clickLd('submit');
  await sleep(200);
  check('新增第二条（未保存）', (await rowCount()) === 2, `rows=${await rowCount()}`);
  await clickLd('reload');
  await sleep(300);
  check('重新加载丢弃未保存改动', (await rowCount()) === 1, `rows=${await rowCount()}`);
  check('重新加载后磁盘仍是 1 条', (await snap())?.endpoints?.length === 1);

  /* ---------- F. 偏好编辑 ---------- */
  const prefEditClicked = await evalJs(`(() => {
    const blocks = document.querySelectorAll('[data-ld="panel"] .block');
    const b = [...(blocks[blocks.length - 1]?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim() === '编辑');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(150);
  const prefFormOpen = await evalJs(
    `!!document.querySelector('[data-ld="panel"] .block:last-of-type select')`,
  );
  check('偏好编辑表单可打开', prefEditClicked && prefFormOpen);
  await setInput('[data-ld="panel"] .block:last-of-type input', 'http://127.0.0.1:7777');
  await setInput('[data-ld="panel"] .block:last-of-type select', 'local');
  await evalJs(
    `document.querySelector('[data-ld="panel"] .block:last-of-type button[type="submit"]')?.click()`,
  );
  await sleep(200);
  await clickLd('save');
  await sleep(200);
  const s2 = await snap();
  check(
    '偏好修改写入磁盘',
    s2?.preferences?.endpoint === 'http://127.0.0.1:7777' && s2?.preferences?.filter === 'local',
    JSON.stringify(s2?.preferences),
  );
  await closePanel();
  check(
    '保存后界面筛选同步',
    await evalJs(`(() => {
      const b = [...document.querySelectorAll('.segmented button')].find((x) => x.textContent.includes('本地'));
      return !!b && b.classList.contains('active');
    })()`),
  );

  /* ---------- G. 删除与清空 ---------- */
  check('删除前重新打开面板', await openPanel());
  await clickLd('del');
  await sleep(200);
  check('删除后列表为空', (await rowCount()) === 0);
  await clickLd('save');
  await sleep(200);
  check('删除保存后磁盘为空', (await snap())?.endpoints?.length === 0);
  check(
    '空集合时清空按钮禁用',
    await evalJs(`document.querySelector('[data-ld="clear"]')?.disabled === true`),
  );

  /* ---------- H. 点击空白不关闭 ---------- */
  await evalJs(
    `document.querySelector('.ld-backdrop')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
  );
  await sleep(150);
  check('点击面板外空白处不关闭', await evalJs(`!!document.querySelector('[data-ld="panel"]')`));

  /* ---------- I. 与连接窗口联动 ---------- */
  // 重新添加一条真实可连的地址，供快速选择与一键连接使用
  await clickLd('new');
  await setInput('[data-ld-input="base"]', 'http://127.0.0.1:1142');
  await setInput('[data-ld-input="label"]', '本机模拟');
  await clickLd('submit');
  await sleep(200);
  await clickLd('save');
  await sleep(200);
  await closePanel();

  const connectOpened = await evalJs(`(() => {
    const b = document.querySelector('.status-actions button.primary');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(500);
  const savedVisible = await evalJs(`!!document.querySelector('.saved')`);
  check('连接窗口显示「已保存的后端」', connectOpened && savedVisible);
  check(
    '手动输入是弹窗首个操作区且排在扫描之前',
    await evalJs(`(() => {
      const body = document.querySelector('.modal-body');
      const manual = document.querySelector('.manual-block');
      const scan = document.querySelector('.scan-line');
      return !!body && !!manual && !!scan &&
        body.firstElementChild === manual &&
        manual.getBoundingClientRect().top < scan.getBoundingClientRect().top;
    })()`),
  );
  check(
    '已保存列表带地址与备注',
    await evalJs(
      `(() => { const t = document.querySelector('.saved')?.innerText || ''; return t.includes('127.0.0.1:1142') && t.includes('本机模拟'); })()`,
    ),
  );
  await evalJs(`document.querySelector('[data-ld="saved-pick"]')?.click()`);
  await sleep(150);
  check(
    '点地址可快速填入手动输入框',
    await evalJs(`document.querySelector('#manual')?.value === 'http://127.0.0.1:1142'`),
  );
  await evalJs(`(() => {
    const el = document.querySelector('#manual');
    el.value = 'http://%';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.manual-block button')]
      .find((b) => b.textContent.trim() === '连接')?.click();
    return true;
  })()`);
  await sleep(200);
  check(
    '手动输入无效地址时错误提示就近显示',
    await evalJs(`!!document.querySelector('.manual-block .notice.error')?.textContent.trim()`),
  );
  await evalJs(`document.querySelector('[data-ld="manage"]')?.click()`);
  await sleep(350);
  check(
    '连接窗口可跳转本地数据管理',
    await evalJs(
      `!document.querySelector('.saved') && !!document.querySelector('[data-ld="panel"]')`,
    ),
  );

  await evalJs(`document.querySelector('[data-ld="connect"]')?.click()`);
  const connected = await waitFor(() => evalJs(`!!document.querySelector('.dot.online')`), 15000);
  check('管理面板可一键连接后端', connected);
  check('连接后面板自动关闭', await evalJs(`!document.querySelector('[data-ld="panel"]')`));
  const s3 = await snap();
  check(
    '连接成功自动更新已有记录（不产生重复）',
    s3?.endpoints?.length === 1 && s3.endpoints[0].lastUsedAt > 0,
    JSON.stringify(s3?.endpoints),
  );

  await evalJs(`document.querySelector('.status-actions button.primary')?.click()`);
  await sleep(500);
  check(
    '已保存列表标记「当前连接」',
    await evalJs(`document.querySelector('.saved')?.innerText.includes('当前连接')`),
  );
  await evalJs(
    `[...document.querySelectorAll('.modal-footer button')].find((b) => b.textContent.includes('稍后再说'))?.click()`,
  );
  await sleep(250);

  /* ---------- J. 阅读页入口 ---------- */
  // 偏好里把筛选改成了「本地」，先切回全部才能看到刚连上的 mock 后端的书
  await evalJs(`(() => {
    const b = [...document.querySelectorAll('.segmented button')].find((x) => x.textContent.includes('全部'));
    b?.click();
    return !!b;
  })()`);
  await sleep(250);
  await evalJs(`document.querySelector('.card')?.click()`);
  await sleep(1200);
  check('可以进入阅读页', await evalJs(`!!document.querySelector('.tools.left')`));
  const settingsClicked = await evalJs(`(() => {
    const b = [...document.querySelectorAll('.tools.left button')].find((x) => x.textContent.includes('设置'));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(300);
  check(
    '阅读页设置面板里有本地数据入口',
    settingsClicked &&
      (await evalJs(`!!document.querySelector('.settings-layer [data-ld="open"]')`)),
  );
  const jumped = await evalJs(`(() => {
    const b = document.querySelector('.settings-layer [data-ld="open"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(300);
  check(
    '跳转后设置面板关闭、数据面板打开',
    jumped &&
      (await evalJs(
        `!document.querySelector('.settings-layer') && !!document.querySelector('[data-ld="panel"]')`,
      )),
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
