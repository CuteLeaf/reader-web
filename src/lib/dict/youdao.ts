import { fetchText, textOf } from './html.ts';
import type { DictChannel, DictResult } from './types.ts';

/**
 * 有道：对应手机端词典规则里的「有道」——用移动站的翻译接口，
 * 把原文与译文都取回来。它本质是翻译而不是释义，所以条目里会标明。
 *
 * 站点没有 CORS 头，仅扩展内可用。
 */
export async function lookupYoudao(term: string, signal?: AbortSignal): Promise<DictResult | null> {
  const html = await fetchText(
    'https://m.youdao.com/translate',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `inputtext=${encodeURIComponent(term)}&type=AUTO`,
    },
    signal,
  );

  const source = textOf(html, '#inputText');
  const translation = textOf(html, '#translateResult');
  if (!translation) return null;

  return {
    term: source || term,
    channelId: 'youdao',
    source: '有道翻译',
    url: `https://dict.youdao.com/result?word=${encodeURIComponent(term)}&lang=en`,
    blocks: [
      { heading: '原文', lines: [source || term] },
      { heading: '译文', lines: [translation] },
    ],
    note: '有道返回的是翻译结果，不是词典释义',
  };
}

export const youdaoChannel: DictChannel = {
  id: 'youdao',
  label: '有道',
  langs: ['zh', 'en'],
  cors: 'extension',
  url: (term) => `https://dict.youdao.com/result?word=${encodeURIComponent(term)}&lang=en`,
  lookup: lookupYoudao,
};
