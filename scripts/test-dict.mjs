/**
 * 词典渠道的解析测试（用真实页面快照，不依赖网络）。
 * 运行：pnpm test:dict
 */
import { readFileSync } from 'node:fs';
import { parseHaiciEn } from '../src/lib/dict/haici.ts';
import { definitionLines, parseShard, parseWordShard } from '../src/lib/dict/offlineParse.ts';
import { parseTranslate } from '../src/lib/dict/translate.ts';

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

const html = readFileSync(new URL('./fixtures/haici-en.html', import.meta.url), 'utf8');
const result = parseHaiciEn(html, 'book');

console.log('海词英文：');
ok('解析出结果', !!result);
ok('渠道标识正确', result?.channelId === 'haici-en', String(result?.channelId));
ok('提取到音标', !!result?.phonetic, String(result?.phonetic));
ok(
  '释义包含词性',
  !!result?.blocks?.[0]?.lines?.some((l) => /^n\.|^v\.|^adj\./.test(l)),
  JSON.stringify(result?.blocks?.[0]?.lines),
);
ok(
  '例句单独成块',
  !!result?.blocks?.some((b) => b.heading === '例句' && b.lines.length > 0),
  JSON.stringify(result?.blocks?.map((b) => b.heading)),
);
ok(
  '正文不含站点名噪音',
  !result?.blocks?.some((b) => b.lines.includes('海词词典')),
  JSON.stringify(result?.blocks),
);
ok('空页面返回 null', parseHaiciEn('', 'book') === null);
ok('无意义页面返回 null', parseHaiciEn('<html><body></body></html>', 'book') === null);

const shard = readFileSync(new URL('./fixtures/zidian-ci-0.json', import.meta.url), 'utf8');
const rows = parseShard(shard);
console.log('\n离线词库：');
ok('解析出词条', rows.length > 500, `${rows.length} 条`);
ok(
  '词条与释义都不为空',
  rows.every((r) => r.k && r.d),
  `${rows[0]?.k} / ${rows[0]?.d?.slice(0, 12)}`,
);
ok(
  '释义可拆成多行',
  definitionLines('1.甲\n2.乙\n3.丙').length === 3,
  JSON.stringify(definitionLines('1.甲\n2.乙\n3.丙')),
);
ok('坏分片返回空数组', parseShard('not json').length === 0);

const wordShard = readFileSync(new URL('./fixtures/zidian-word-0.json', import.meta.url), 'utf8');
const chars = parseWordShard(wordShard);
console.log('\n离线汉字：');
ok('解析出汉字', chars.length >= 20, `${chars.length} 条`);
ok(
  '都是单字',
  chars.every((r) => [...r.k].length === 1),
  chars
    .slice(0, 3)
    .map((r) => r.k)
    .join(''),
);
ok(
  '释义带部首与笔画',
  chars.some((r) => /部首 .* · \d+ 画/.test(r.d)),
  chars[0]?.d.slice(0, 20),
);

const mm = readFileSync(new URL('./fixtures/mymemory-en.json', import.meta.url), 'utf8');
console.log('\n中英翻译：');
const tr = parseTranslate(mm, 'book');
ok('解析出译文', tr?.blocks?.[0]?.lines?.[0] === '书籍', JSON.stringify(tr?.blocks));
ok(
  '回显原文时按未收录处理',
  parseTranslate(JSON.stringify({ responseData: { translatedText: 'book' } }), 'book') === null,
);
ok('坏 JSON 返回 null', parseTranslate('oops', 'book') === null);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
