import { fetchText, htmlToLines, parseDocument } from './html.ts';
import type { DictBlock, DictChannel, DictResult } from './types.ts';

/**
 * 海词：手机端「阅读」内置的两条词典规则，接口结构与它的默认规则一致。
 *
 * - 海词英文 `https://apii.dict.cn/mini.php?q={{key}}`：返回一小段纯文本页面
 * - 海词中文 `https://hanyu.dict.cn/{{key}}`：返回 HTML，正文在 #main 里
 *
 * 两者都没有 CORS 头，只能在扩展里读取（host_permissions 放开了跨域）。
 */

export async function lookupHaiciEn(
  term: string,
  signal?: AbortSignal,
): Promise<DictResult | null> {
  const html = await fetchText(
    `https://apii.dict.cn/mini.php?q=${encodeURIComponent(term)}`,
    {},
    signal,
  );
  return parseHaiciEn(html, term);
}

/** 纯文本页面，解析逻辑与网络分离，方便单测 */
export function parseHaiciEn(html: string, term: string): DictResult | null {
  const lines = htmlToLines(html).filter((line) => line !== '海词词典');
  if (!lines.length) return null;

  const head = lines.find((line) => /\[[^\]]+\]/.test(line)) ?? '';
  const phonetic = head.match(/\[([^\]]+)\]/)?.[1];

  // 「例句与用法:」之后的内容单独成段，读起来更清楚
  const splitAt = lines.findIndex((line) => line.startsWith('例句'));
  const blocks: DictBlock[] = [];
  if (splitAt > 0) {
    blocks.push({ heading: '', lines: lines.slice(0, splitAt).filter((l) => l !== head) });
    blocks.push({ heading: '例句', lines: lines.slice(splitAt + 1, splitAt + 7) });
  } else {
    blocks.push({ heading: '', lines: lines.slice(0, 10) });
  }

  return {
    term,
    channelId: 'haici-en',
    source: '海词英文',
    phonetic,
    url: `https://dict.cn/${encodeURIComponent(term)}`,
    blocks: blocks.filter((b) => b.heading || b.lines.length),
  };
}

export async function lookupHaiciZh(
  term: string,
  signal?: AbortSignal,
): Promise<DictResult | null> {
  const html = await fetchText(`https://hanyu.dict.cn/${encodeURIComponent(term)}`, {}, signal);
  const doc = parseDocument(html);
  doc
    .querySelectorAll('script,style,noscript,#header,#footer,#page-share,[id^="div-gpt-ad"]')
    .forEach((el) => el.remove());

  const main = doc.querySelector('#main');
  if (!main) return null;
  // 页面顶部有一块「发音按钮选项」浮层，和释义混在同一个容器里，先摘掉
  main
    .querySelectorAll('.tbcont_0,[class*="popup"],.fy,input,label,select')
    .forEach((el) => el.remove());

  const root = main.querySelector('.m') ?? main;
  const lines = htmlToLines(root.innerHTML).slice(0, 18);
  if (!lines.length) return null;

  return {
    term,
    channelId: 'haici-zh',
    source: '海词中文',
    url: `https://hanyu.dict.cn/${encodeURIComponent(term)}`,
    blocks: [{ heading: '', lines }],
  };
}

export const haiciEnChannel: DictChannel = {
  id: 'haici-en',
  label: '海词英文',
  langs: ['en'],
  cors: 'extension',
  url: (term) => `https://dict.cn/${encodeURIComponent(term)}`,
  lookup: lookupHaiciEn,
};

export const haiciZhChannel: DictChannel = {
  id: 'haici-zh',
  label: '海词中文',
  langs: ['zh'],
  cors: 'extension',
  url: (term) => `https://hanyu.dict.cn/${encodeURIComponent(term)}`,
  lookup: lookupHaiciZh,
};
