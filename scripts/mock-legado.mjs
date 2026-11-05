/**
 * 「Legado 3.0」Web 后端模拟器（仅用于开发自测）。
 *
 *   node scripts/mock-legado.mjs [--port 1122] [--delay 300] [--stall-shelf 2]
 *     [--search-empty] [--search-fail] [--search-fuzzy] [--require-token] [--fail-save]
 *     [--fail-delete] [--fail-verify] [--search-delay 200] [--ws-port 1123]
 *
 * `--delay` 给正文接口加固定延迟（毫秒），用来观察预加载、加载态等真实网络下的表现。
 * `--stall-shelf N` 让前 N 次 /getBookshelf 挂起 10 秒不响应，模拟安卓端 Web 服务休眠。
 * `--search-fuzzy` 复刻后端「先发部分结果、再推全量排序快照」的回送方式，
 *   排序规则与 Legado SearchModel.mergeItems 一致，用来验证客户端跟随后端顺序。
 * 书源能力按官方 api.md 实现：WS 端口 = HTTP 端口 + 1，路径 /searchBook，
 * 首帧 {"key":"..."}，逐批回送 SearchBook[]，最后以 1000「Search finish」关闭；
 * /saveBook 与 /deleteBook 收 Book JSON。故障开关用来验证异常分支，互不干扰。
 * 接口均带 CORS 头，方便本地验证「连接 → 搜索 → 加书架 → 换源 → 阅读」全链路。
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : fallback;
};
const PORT = Number(value('--port', 1122));
const WS_PORT = Number(value('--ws-port', PORT + 1));
const DELAY = Number(value('--delay', 0));
const STALL_SHELF = Number(value('--stall-shelf', 0));
const SEARCH_DELAY = Number(value('--search-delay', 120));
const SEARCH_EMPTY = flag('--search-empty');
const SEARCH_FAIL = flag('--search-fail');
/** 故意把低匹配结果放在最前面，用来验证客户端的相关度重排 */
const SEARCH_FUZZY = flag('--search-fuzzy');
const REQUIRE_TOKEN = flag('--require-token');
const TOKEN = String(value('--token', 'test-token'));
const FAIL_SAVE = flag('--fail-save');
const FAIL_DELETE = flag('--fail-delete');
const FAIL_VERIFY = flag('--fail-verify');
let shelfHits = 0;
const STARTED = Date.now();

const CATALOG = [
  { title: '楔子 · 一段无关紧要的开场', paragraphs: 5 },
  { title: '第一章 夜行', paragraphs: 7 },
  { title: '第二章 旧书店', paragraphs: 8 },
  { title: '第三章 雨停之前', paragraphs: 6 },
  { title: '第四章 长街', paragraphs: 9 },
  { title: '第五章 灯火', paragraphs: 7 },
  { title: '尾声 · 明天见', paragraphs: 4 },
];

const LOREM = [
  '街灯在雨里散成一团微黄的光，像有人把整条街泡进了温热的茶里。',
  '他合上书，听见纸张贴合时那一声轻响，忽然觉得这个夜晚被妥帖地折了起来。',
  '楼下有人在收摊，铁架子拖过地面，声音很长，像一句没有说完的话。',
  '风从窗缝里挤进来，翻动桌上摊开的书页，停在某一页便不再动了。',
  '她说过，读一本书最好的时候，是雨声刚好盖不住翻页声的那个黄昏。',
  '于是他把茶推到手边，把台灯拧亮一档，重新读起了第一章。',
  '远处有车驶过，水花溅起又落下，世界重新安静下来。',
  '书页上的字迹在灯下显得格外温顺，仿佛它们也在等一个人回来。',
  '他忽然想起很多年前的一个下午，同样的雨，同样的一本书，只是人不同了。',
];

function content(title, count) {
  const lines = [`\u3000\u3000${title}`, ''];
  for (let i = 0; i < count; i += 1) {
    lines.push(`\u3000\u3000${LOREM[i % LOREM.length]}${LOREM[(i + 3) % LOREM.length]}`);
    lines.push('');
  }
  return lines.join('\n');
}

const BOOKS = [
  {
    bookUrl: 'mock://book/rain',
    name: '雨夜书店',
    author: '模拟作者',
    origin: 'https://mock.example.com/src1',
    originName: '模拟书源·甲',
    coverUrl: '',
    durChapterIndex: 1,
    durChapterPos: 616,
    durChapterTitle: '第一章 夜行',
    durChapterTime: Date.now() - 1000 * 60 * 30,
    latestChapterTitle: '尾声 · 明天见',
    totalChapterNum: CATALOG.length,
  },
  {
    bookUrl: 'mock://book/lamp',
    name: '灯下漫笔',
    author: '另一位模拟作者',
    origin: 'https://mock.example.com/src1',
    originName: '模拟书源·甲',
    coverUrl: '',
    durChapterIndex: 0,
    durChapterTitle: '楔子 · 一段无关紧要的开场',
    durChapterTime: Date.now() - 1000 * 60 * 60 * 26,
    latestChapterTitle: '第五章 灯火',
    totalChapterNum: CATALOG.length,
  },
];

/** /saveBook 与 /deleteBook 会改动书架；每个进程启动时复位 */
let books = BOOKS.map((b) => ({ ...b }));

/** 换源后的目录故意用不同标题，验证阅读时确实读的是新书源 */
const CATALOG_B = [
  { title: '乙源 · 楔子', paragraphs: 4 },
  { title: '乙源 · 第一章', paragraphs: 6 },
  { title: '乙源 · 第二章', paragraphs: 5 },
  { title: '乙源 · 尾声', paragraphs: 3 },
];

const SRC1 = 'https://mock.example.com/src1';
const SRC2 = 'https://mock.example.com/src2';
const SRC3 = 'https://mock.example.com/src3';

function catalogFor(bookUrl) {
  return String(bookUrl).includes('@src2') ? CATALOG_B : CATALOG;
}

function chapterListFor(bookUrl) {
  const tag = String(bookUrl).includes('@src2') ? 'b' : 'a';
  return catalogFor(bookUrl).map((c, i) => ({
    title: c.title,
    url: `mock://chapter/${tag}/${i}`,
    index: i,
  }));
}

const chapters = chapterListFor('mock://book/rain');

/** 书源搜索的候选结果：同名书来自不同书源，用来验证加书架与换源 */
const SEARCH_BOOKS = [
  {
    name: '雨夜书店',
    author: '模拟作者',
    bookUrl: 'mock://book/rain',
    origin: SRC1,
    originName: '模拟书源·甲',
    tocUrl: 'mock://toc/rain',
    intro: '雨夜里的一间旧书店，和一段没有说完的话。（甲源）',
    latestChapterTitle: '尾声 · 明天见',
    type: 0,
  },
  {
    name: '雨夜书店',
    author: '模拟作者',
    bookUrl: 'mock://book/rain@src2',
    origin: SRC2,
    originName: '模拟书源·乙',
    tocUrl: 'mock://toc/rain-b',
    intro: '同一个故事，来自乙源的版本，目录标题不同。（乙源）',
    latestChapterTitle: '乙源 · 尾声',
    type: 0,
  },
  {
    name: '雨夜书店',
    author: '模拟作者',
    bookUrl: 'mock://book/rain@src3',
    origin: SRC3,
    originName: '模拟书源·丙',
    tocUrl: 'mock://toc/rain-c',
    intro: '丙源版本，用来验证选中的书源会原样写回书架。',
    latestChapterTitle: '第四章 长街',
    type: 0,
  },
  {
    name: '雨夜书店·续篇',
    author: '模拟作者',
    bookUrl: 'mock://book/rain-sequel',
    origin: SRC1,
    originName: '模拟书源·甲',
    tocUrl: 'mock://toc/rain-sequel',
    intro: '续篇，用来验证「加入书架」新增一本。',
    latestChapterTitle: '第五章 灯火',
    type: 0,
  },
  {
    name: '星海旅人',
    author: '新作者',
    bookUrl: 'mock://book/star',
    origin: SRC1,
    originName: '模拟书源·甲',
    tocUrl: 'mock://toc/star',
    intro: '一本不在书架里的新书。',
    latestChapterTitle: '启程',
    type: 0,
  },
];

/**
 * --search-fuzzy：模拟真实后端「先回送一批部分结果、再推送重新排序后的全量快照」。
 * 第一帧故意没有完全同名的书（这时低匹配自然排在前面），第二帧用与
 * SearchModel.mergeItems 相同的分组规则重排。客户端必须跟随第二帧的顺序，
 * 而不是把第一帧的顺序锁死。
 */
const FUZZY_BOOKS = [
  {
    name: '无关杂书',
    author: '路人甲',
    bookUrl: 'mock://book/noise',
    origin: SRC3,
    originName: '模拟书源·丙',
    tocUrl: 'mock://toc/noise',
    intro: '和关键词几乎不沾边（后端 otherData 组）。',
    type: 0,
  },
  {
    name: '星海旅人·外传',
    author: '雨夜书店研究会',
    bookUrl: 'mock://book/star-extra',
    origin: SRC2,
    originName: '模拟书源·乙',
    tocUrl: 'mock://toc/star-extra',
    intro: '只是作者名包含关键词（后端 containsData 组）。',
    type: 0,
  },
  {
    name: '分类测试书',
    author: '某作者',
    bookUrl: 'mock://book/tagged',
    origin: SRC3,
    originName: '模拟书源·丙',
    tocUrl: 'mock://toc/tagged',
    intro: '分类命中关键词（后端 tagsData 组）。',
    kind: '雨夜书店·系列',
    type: 0,
  },
  {
    name: '雨夜书店·续篇·修订合集',
    author: '模拟作者',
    bookUrl: 'mock://book/rain-long',
    origin: SRC1,
    originName: '模拟书源·甲',
    tocUrl: 'mock://toc/rain-long',
    intro: '长尾标题，排序应低于完全同名。',
    type: 0,
  },
  {
    name: '雨夜书店',
    author: '另一位作者',
    bookUrl: 'mock://book/rain-other',
    origin: SRC3,
    originName: '模拟书源·丙',
    tocUrl: 'mock://toc/rain-other',
    intro: '书名完全一致但作者不同，用来验证换源的「校验作者」。',
    type: 0,
  },
  {
    name: '夜 雨',
    author: '某作者',
    bookUrl: 'mock://book/night-rain',
    origin: SRC3,
    originName: '模拟书源·丙',
    tocUrl: 'mock://toc/night-rain',
    intro: '只命中了两个字（后端 otherData 组）。',
    type: 0,
  },
  {
    name: '雨夜书店',
    author: '模拟作者',
    bookUrl: 'mock://book/rain@src4',
    origin: 'https://mock.example.com/src4',
    originName: '模拟书源·丁',
    tocUrl: 'mock://toc/rain-d',
    intro: '完全同名，但被后端放在最后一批。',
    type: 0,
  },
];

/** 复刻 Legado SearchModel.mergeItems 的分组排序（同名同作者按命中书源数降序） */
function sortLikeLegado(list, key) {
  const groups = [[], [], [], []];
  const hitCount = new Map();
  for (const b of list) {
    const id = `${b.name}||${b.author}`;
    hitCount.set(id, (hitCount.get(id) ?? 0) + 1);
  }
  for (const b of list) {
    let g = 3;
    if (b.name === key || b.author === key) g = 0;
    else if (String(b.kind ?? '').includes(key)) g = 1;
    else if (b.name.includes(key) || b.author.includes(key)) g = 2;
    groups[g].push(b);
  }
  for (const g of groups.slice(0, 3)) {
    g.sort(
      (a, z) => hitCount.get(`${z.name}||${z.author}`) - hitCount.get(`${a.name}||${a.author}`),
    );
  }
  return [...groups[0], ...groups[1], ...groups[2], ...groups[3]];
}

const json = (res, payload) => {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
};

/** 模拟书源 / 订阅源（用于验证源管理面板；故意不实现令牌接口，模拟 MD3 分支） */
const BOOK_SOURCES = [
  {
    bookSourceUrl: 'https://mock.example.com/src1',
    bookSourceName: '模拟书源·甲',
    bookSourceGroup: '测试',
    enabled: true,
    bookSourceType: 0,
  },
  {
    bookSourceUrl: 'https://mock.example.com/src2',
    bookSourceName: '模拟书源·乙',
    bookSourceGroup: '测试',
    enabled: true,
    bookSourceType: 0,
  },
  {
    bookSourceUrl: 'https://mock.example.com/src3',
    bookSourceName: '模拟书源·丙',
    bookSourceGroup: '测试',
    enabled: true,
    bookSourceType: 0,
  },
];
const RSS_SOURCES = [
  {
    sourceUrl: 'https://mock.example.com/rss1',
    sourceName: '模拟订阅·甲',
    sourceGroup: '测试',
    enabled: true,
    sourceType: 0,
  },
];
let bookSources = [...BOOK_SOURCES];
let rssSources = [...RSS_SOURCES];

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw));
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    res.end();
    return;
  }

  if (url.pathname === '/getBookshelf') {
    shelfHits += 1;
    console.log(
      `[mock] getBookshelf #${shelfHits} +${Date.now() - STARTED}ms (${books.length} 本)`,
    );
    if (shelfHits <= STALL_SHELF) {
      // 挂着不回：真实场景是手机端服务还在唤醒，客户端会先超时
      setTimeout(() => json(res, { data: books }), 10000);
      return;
    }
    json(res, { data: books });
    return;
  }

  // MD3 等分支没有这个接口；--require-token 时模拟新版「访问令牌保护」
  if (url.pathname === '/getJsSourceApiTokenRequired') {
    if (REQUIRE_TOKEN) json(res, { data: true, errorMsg: '', isSuccess: true });
    else {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      res.end('not found');
    }
    return;
  }

  if (url.pathname === '/getBookSources') {
    json(res, { data: bookSources });
    return;
  }

  if (url.pathname === '/getRssSources') {
    json(res, { data: rssSources });
    return;
  }

  if (
    [
      '/saveBookSources',
      '/saveBookSource',
      '/deleteBookSources',
      '/saveRssSources',
      '/saveRssSource',
      '/deleteRssSources',
    ].includes(url.pathname)
  ) {
    // 令牌保护开启时，这些写接口先校验 x-legado-token（与官方 BookSourceController 一致）
    if (REQUIRE_TOKEN && req.headers['x-legado-token'] !== TOKEN) {
      json(res, { errorMsg: 'Web 书源访问令牌未配置或不正确', isSuccess: false });
      return;
    }
    void readBody(req).then((raw) => {
      let payload;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        json(res, { errorMsg: '格式不对', isSuccess: false });
        return;
      }
      const list = Array.isArray(payload) ? payload : payload ? [payload] : [];
      // /saveBookSource 提交空对象只用于无副作用的令牌探测，官方后端会回业务错误
      if (url.pathname === '/saveBookSource' && list.some((x) => !x.bookSourceUrl)) {
        json(res, { errorMsg: '源名称和URL不能为空', isSuccess: false });
        return;
      }
      if (url.pathname.includes('delete')) {
        const urls = new Set(list.map((x) => x.bookSourceUrl || x.sourceUrl));
        if (url.pathname.includes('Book'))
          bookSources = bookSources.filter((s) => !urls.has(s.bookSourceUrl));
        else rssSources = rssSources.filter((s) => !urls.has(s.sourceUrl));
      } else if (url.pathname.includes('Book')) {
        for (const item of list) {
          const i = bookSources.findIndex((s) => s.bookSourceUrl === item.bookSourceUrl);
          if (i >= 0) bookSources[i] = { ...bookSources[i], ...item };
          else bookSources.push(item);
        }
      } else {
        for (const item of list) {
          const i = rssSources.findIndex((s) => s.sourceUrl === item.sourceUrl);
          if (i >= 0) rssSources[i] = { ...rssSources[i], ...item };
          else rssSources.push(item);
        }
      }
      json(res, { data: true, isSuccess: true });
    });
    return;
  }

  if (url.pathname === '/getBookSource') {
    const source = bookSources.find((s) => s.bookSourceUrl === url.searchParams.get('url'));
    json(res, source ? { data: source } : { errorMsg: '未找到书源' });
    return;
  }

  if (url.pathname === '/saveBook' || url.pathname === '/deleteBook') {
    void readBody(req).then((raw) => {
      let book;
      try {
        book = raw ? JSON.parse(raw) : null;
      } catch {
        json(res, { isSuccess: false, errorMsg: '格式不对' });
        return;
      }
      if (!book || typeof book !== 'object' || !book.bookUrl) {
        json(res, { isSuccess: false, errorMsg: '格式不对' });
        return;
      }
      const isSave = url.pathname === '/saveBook';
      console.log(`[mock] ${url.pathname} url=${book.bookUrl} origin=${book.origin}`);
      if (isSave && FAIL_SAVE) {
        json(res, { isSuccess: false, errorMsg: '保存失败（模拟）' });
        return;
      }
      if (!isSave && FAIL_DELETE) {
        json(res, { isSuccess: false, errorMsg: '删除失败（模拟）' });
        return;
      }
      if (isSave) {
        const saved = { ...book };
        // 模拟「后端没按所选书源保存」，用来验证换源/加书架的关联校验与回滚
        if (FAIL_VERIFY) {
          saved.origin = 'https://mock.example.com/wrong-source';
          saved.originName = '错误书源';
        }
        const i = books.findIndex((b) => b.bookUrl === book.bookUrl);
        if (i >= 0) books[i] = { ...books[i], ...saved };
        else books.push(saved);
        console.log(`[mock] 书架现有 ${books.length} 本，刚写入 origin=${saved.origin}`);
      } else {
        books = books.filter((b) => b.bookUrl !== book.bookUrl);
        console.log(`[mock] 删除后书架现有 ${books.length} 本`);
      }
      json(res, { data: true, isSuccess: true, errorMsg: '' });
    });
    return;
  }

  if (url.pathname === '/getChapterList') {
    const bookUrl = url.searchParams.get('url') ?? '';
    console.log(`[mock] getChapterList url=${bookUrl} → ${catalogFor(bookUrl).length} 章`);
    json(res, { data: chapterListFor(bookUrl) });
    return;
  }

  if (url.pathname === '/getBookContent') {
    const bookUrl = url.searchParams.get('url') ?? '';
    const index = Number(url.searchParams.get('index') ?? 0);
    const list = chapterListFor(bookUrl);
    const chapter = list[index] ?? list[0];
    const count = catalogFor(bookUrl)[index]?.paragraphs ?? 5;
    console.log(`[mock] getBookContent url=${bookUrl} index=${index} +${Date.now() - STARTED}ms`);
    const reply = () => json(res, { data: content(chapter.title, count) });
    if (DELAY > 0) setTimeout(reply, DELAY);
    else reply();
    return;
  }

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>mock legado</title>
      <h1>Legado 3.0 模拟后端</h1>
      <p>书架 ${books.length} 本 · 目录 ${chapters.length} 章 · 书源 ${bookSources.length} 个</p>
      <pre>${JSON.stringify(
        books.map((b) => `${b.name} [${b.originName ?? b.origin}]`),
        null,
        2,
      )}</pre>`);
    return;
  }

  res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
  res.end('not found');
});

/* ---------------- 书源搜索 WebSocket（官方 api.md：HTTP 端口 +1） ---------------- */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 服务端帧不掩码；payload 可以是字符串或 Buffer */
function wsFrame(payload, opcode = 0x1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = body.length;
  let head;
  if (len < 126) {
    head = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, body]);
}

function wsClose(code, reason) {
  const head = Buffer.alloc(2);
  head.writeUInt16BE(code, 0);
  return wsFrame(Buffer.concat([head, Buffer.from(reason, 'utf8')]), 0x8);
}

/** 拆客户端帧（浏览器一定带 mask），返回已解出的帧与剩余字节 */
function parseClientFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const opcode = b0 & 0x0f;
    let len = b1 & 0x7f;
    let p = offset + 2;
    if (len === 126) {
      if (p + 2 > buffer.length) break;
      len = buffer.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (p + 8 > buffer.length) break;
      len = Number(buffer.readBigUInt64BE(p));
      p += 8;
    }
    const masked = (b1 & 0x80) !== 0;
    const mask = masked ? buffer.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (p + len > buffer.length) break;
    const data = Buffer.from(buffer.subarray(p, p + len));
    if (mask) {
      for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i % 4];
    }
    frames.push({ opcode, text: data.toString('utf8') });
    offset = p + len;
  }
  return { frames, rest: buffer.subarray(offset) };
}

async function sendSearchResults(socket, key) {
  if (SEARCH_FAIL) {
    setTimeout(() => {
      if (!socket.destroyed) socket.end(wsClose(1011, '模拟搜索异常'));
    }, SEARCH_DELAY);
    return;
  }
  const baseHits = SEARCH_BOOKS.filter((b) => `${b.name} ${b.author}`.includes(key));
  // 只有确实有命中时才掺入乱序结果，保证 --search-empty / 生僻关键词仍是「无结果」
  const hits = SEARCH_EMPTY
    ? []
    : SEARCH_FUZZY && baseHits.length
      ? [...FUZZY_BOOKS, ...baseHits]
      : baseHits;
  if (SEARCH_FUZZY && hits.length) {
    // 真实后端每收到一个书源的结果就重发一次「当前全量、已排序」的列表。
    // 第一帧只有先返回的几个书源（恰好没有完全同名的书），第二帧带上全部书源
    // 并按 SearchModel.mergeItems 的规则重排 —— 客户端必须跟随最后一帧的顺序。
    const first = hits.slice(0, Math.max(1, FUZZY_BOOKS.length - 1));
    if (socket.destroyed) return;
    socket.write(wsFrame(JSON.stringify(first)));
    console.log(`[mock] WS 第 1 帧（部分结果）${first.length} 条`);
    await new Promise((r) => setTimeout(r, SEARCH_DELAY));
    if (socket.destroyed) return;
    const sorted = sortLikeLegado(hits, key);
    socket.write(wsFrame(JSON.stringify(sorted)));
    console.log(
      `[mock] WS 第 2 帧（全量已排序）${sorted.length} 条：${sorted.map((b) => b.name).join(' → ')}`,
    );
  } else {
    // 旧分支/简单后端按增量批次回送
    const mid = Math.ceil(hits.length / 2);
    for (const batch of [hits.slice(0, mid), hits.slice(mid)]) {
      if (socket.destroyed) return;
      if (batch.length) socket.write(wsFrame(JSON.stringify(batch)));
      await new Promise((r) => setTimeout(r, SEARCH_DELAY));
    }
  }
  console.log(`[mock] WS 搜索结束，返回 ${hits.length} 条`);
  if (!socket.destroyed) socket.end(wsClose(1000, 'Search finish'));
}

const wsServer = createServer((_req, res) => {
  res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Web 书源访问令牌未配置或不正确');
});

wsServer.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url, `http://${req.headers.host}`).pathname;
  const protocols = String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (path !== '/searchBook') {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    return;
  }
  if (REQUIRE_TOKEN) {
    const expected = `legado.token.${Buffer.from(TOKEN, 'utf8').toString('base64url')}`;
    if (protocols[0] !== 'legado' || protocols[1] !== expected) {
      console.log(`[mock] WS 握手被拒：protocols=${protocols.join(',') || '(空)'}`);
      const body = Buffer.from('Web 书源访问令牌未配置或不正确', 'utf8');
      socket.end(
        `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
      );
      socket.write(body);
      return;
    }
  }

  const accept = createHash('sha1')
    .update(String(req.headers['sec-websocket-key']) + WS_GUID)
    .digest('base64');
  const replyProtocol = protocols.includes('legado') ? 'legado' : '';
  console.log(`[mock] WS 握手成功 protocols=${protocols.join(',') || '(空)'}`);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      (replyProtocol ? `Sec-WebSocket-Protocol: ${replyProtocol}\r\n` : '') +
      '\r\n',
  );
  if (head?.length) socket.unshift(head);

  let buffer = Buffer.alloc(0);
  let handled = false;
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { frames, rest } = parseClientFrames(buffer);
    buffer = rest;
    for (const frame of frames) {
      if (frame.opcode === 0x8) {
        socket.end(wsClose(1000, ''));
        return;
      }
      if (frame.opcode !== 0x1 || handled) continue;
      handled = true;
      let key = '';
      try {
        key = String(JSON.parse(frame.text).key ?? '');
      } catch {
        /* 忽略非法帧 */
      }
      console.log(`[mock] WS 收到搜索词「${key}」`);
      void sendSearchResults(socket, key);
    }
  });
  socket.on('error', () => {
    /* 客户端提前断开 */
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mock-legado] Legado 3.0 模拟后端已启动: http://127.0.0.1:${PORT}`);
  console.log('[mock-legado] LAN 内其它设备可用本机 IP 访问（同一 Wi-Fi）');
});

wsServer.listen(WS_PORT, '0.0.0.0', () => {
  console.log(
    `[mock-legado] 书源搜索 WS: ws://127.0.0.1:${WS_PORT}/searchBook` +
      (REQUIRE_TOKEN ? `（需要令牌 ${TOKEN}）` : '（无需令牌）'),
  );
});
