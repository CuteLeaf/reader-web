/**
 * 选中文字「搜索」的链接生成测试（纯函数，不依赖浏览器与网络）。
 * 运行：pnpm test:search
 */
import {
  buildSearchUrl,
  cleanQuery,
  openSearch,
  SEARCH_ENGINES,
} from '../src/lib/selection/search.ts';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ''}`);
  }
};

const url = buildSearchUrl('依然');
console.log('默认引擎：');
ok('默认使用百度', url.startsWith('https://www.baidu.com/s?wd='), url);
ok('中文被正确编码', url === `https://www.baidu.com/s?wd=${encodeURIComponent('依然')}`, url);

console.log('\n文本清洗：');
ok('首尾空白被去掉', buildSearchUrl('  依然  ') === buildSearchUrl('依然'));
ok('换行与连续空白合成一个空格', buildSearchUrl('依然\n\n如故') === buildSearchUrl('依然 如故'));
ok('空字符串返回空串', buildSearchUrl('') === '');
ok('纯空白返回空串', buildSearchUrl('  \n \t ') === '');
ok('null 安全', buildSearchUrl(null) === '');
ok('undefined 安全', buildSearchUrl(undefined) === '');
ok(
  '100 字以上的长选区被截断',
  buildSearchUrl('词'.repeat(300)).endsWith(encodeURIComponent('词'.repeat(100))),
);
ok(
  '特殊符号不会破坏查询串',
  buildSearchUrl('A&B #"词"') === `https://www.baidu.com/s?wd=${encodeURIComponent('A&B #"词"')}`,
);

console.log('\n可切换的引擎：');
ok('提供三个引擎', Object.keys(SEARCH_ENGINES).length === 3);
ok(
  '必应链接正确',
  buildSearchUrl('hello world', 'bing') ===
    `https://www.bing.com/search?q=${encodeURIComponent('hello world')}`,
);
ok(
  '谷歌链接正确',
  buildSearchUrl('书', 'google') === `https://www.google.com/search?q=${encodeURIComponent('书')}`,
);
ok('未知引擎回退不抛错', typeof buildSearchUrl('词', undefined) === 'string');
ok(
  '英文词带空格被完整保留',
  decodeURIComponent(buildSearchUrl('quietly reading', 'bing').split('q=')[1]) ===
    'quietly reading',
);

console.log('\n查询清洗：');
ok('cleanQuery 合并空白并截断', cleanQuery('  依然\n如故  ') === '依然 如故');
ok('cleanQuery 最长 100 字', cleanQuery('词'.repeat(300)).length === 100);

console.log('\n执行路径：');
const opened = [];
globalThis.window = {
  open: (url, target, features) => {
    opened.push({ url, target, features });
    return null;
  },
};
delete globalThis.chrome;
ok('网页版走固定引擎', openSearch('依然') === 'url');
ok('网页版在新标签页打开', opened.length === 1 && opened[0].target === '_blank');
ok(
  '网页版带 noopener / noreferrer',
  /noopener/.test(opened[0].features) && /noreferrer/.test(opened[0].features),
);
ok('空内容不打开标签页', openSearch('   ') === '' && opened.length === 1);

const queried = [];
globalThis.chrome = {
  search: {
    query: (info) => {
      queried.push(info);
      return Promise.resolve();
    },
  },
};
ok('扩展版走浏览器默认搜索引擎', openSearch('依然', 'google') === 'default');
ok(
  '默认引擎用新标签页并带上选中文字',
  queried.length === 1 && queried[0].text === '依然' && queried[0].disposition === 'NEW_TAB',
  JSON.stringify(queried),
);
ok('扩展版不会额外打开固定 URL', opened.length === 1);

globalThis.chrome = {
  search: { query: () => Promise.reject(new Error('permission missing')) },
};
openSearch('依然');
await new Promise((r) => setTimeout(r, 0));
ok('默认引擎调用失败时兜底到固定引擎', opened.length === 2, JSON.stringify(opened));
delete globalThis.chrome;

console.log('\n查词面板词条路径（与选取浮层共用 openSearch）：');
// 查词面板传的是词条，不是整段选区；带空白、带换行时同样要清洗干净
const wordBefore = opened.length;
ok('词条按阅读设置里的引擎打开', openSearch('  依然\n如故  ', 'bing') === 'url');
ok(
  '词条空白被合并后再编码',
  decodeURIComponent((opened.at(-1)?.url ?? '').split('q=')[1] ?? '') === '依然 如故',
  opened.at(-1)?.url,
);
ok('空词条不打开标签页', openSearch('  ', 'bing') === '' && opened.length === wordBefore + 1);

const wordQueries = [];
globalThis.chrome = {
  search: {
    query: (info) => {
      wordQueries.push(info);
      return Promise.resolve();
    },
  },
};
ok('扩展里查词词条仍走浏览器默认搜索引擎', openSearch('依然', 'baidu') === 'default');
ok(
  '默认引擎收到清洗后的词条并在新标签页打开',
  wordQueries.length === 1 &&
    wordQueries[0].text === '依然' &&
    wordQueries[0].disposition === 'NEW_TAB',
  JSON.stringify(wordQueries),
);
delete globalThis.chrome;

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
