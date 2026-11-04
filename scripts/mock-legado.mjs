/**
 * 「Legado 3.0」Web 后端模拟器（仅用于开发自测）。
 *
 *   node scripts/mock-legado.mjs [--port 1122]
 *
 * 接口与真实后端一致，并且带 CORS 头，方便本地验证「扫描 → 连接 → 阅读」全链路。
 */
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = portArg > -1 ? Number(args[portArg + 1]) : 1122;

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
    coverUrl: '',
    durChapterIndex: 1,
    durChapterTitle: '第一章 夜行',
    durChapterTime: Date.now() - 1000 * 60 * 30,
    latestChapterTitle: '尾声 · 明天见',
    totalChapterNum: CATALOG.length,
  },
  {
    bookUrl: 'mock://book/lamp',
    name: '灯下漫笔',
    author: '另一位模拟作者',
    coverUrl: '',
    durChapterIndex: 0,
    durChapterTitle: '楔子 · 一段无关紧要的开场',
    durChapterTime: Date.now() - 1000 * 60 * 60 * 26,
    latestChapterTitle: '第五章 灯火',
    totalChapterNum: CATALOG.length,
  },
];

const chapters = CATALOG.map((c, i) => ({ title: c.title, url: `mock://chapter/${i}`, index: i }));

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
    enabled: false,
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
    json(res, { data: BOOKS });
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
    void readBody(req).then((raw) => {
      let payload;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        json(res, { errorMsg: '格式不对', isSuccess: false });
        return;
      }
      const list = Array.isArray(payload) ? payload : payload ? [payload] : [];
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

  if (url.pathname === '/getChapterList') {
    json(res, { data: chapters });
    return;
  }

  if (url.pathname === '/getBookContent') {
    const index = Number(url.searchParams.get('index') ?? 0);
    const chapter = chapters[index] ?? chapters[0];
    const count = CATALOG[index]?.paragraphs ?? 5;
    json(res, { data: content(chapter.title, count) });
    return;
  }

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>mock legado</title>
      <h1>Legado 3.0 模拟后端</h1>
      <p>书架 ${BOOKS.length} 本 · 目录 ${chapters.length} 章</p>
      <pre>${JSON.stringify(
        BOOKS.map((b) => b.name),
        null,
        2,
      )}</pre>`);
    return;
  }

  res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mock-legado] Legado 3.0 模拟后端已启动: http://127.0.0.1:${PORT}`);
  console.log('[mock-legado] LAN 内其它设备可用本机 IP 访问（同一 Wi-Fi）');
});
