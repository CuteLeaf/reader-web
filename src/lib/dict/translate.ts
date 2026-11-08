import type { DictChannel, DictResult } from './types.ts';

/**
 * 中英互译：读小说时夹的英文单词/句子，最需要的是中文意思，
 * 而英文词典（dictionaryapi.dev）只给英文释义，所以单独做一条翻译渠道。
 *
 * MyMemory 免费接口，带 `Access-Control-Allow-Origin: *`，网页版与扩展都能用；
 * 匿名额度约每天 5000 字符，够查单词用。
 */

const API = 'https://api.mymemory.translated.net/get';

interface TranslateResponse {
  responseData?: { translatedText?: string; match?: number };
  responseStatus?: number;
}

export function parseTranslate(raw: string, term: string): DictResult | null {
  let data: TranslateResponse;
  try {
    data = JSON.parse(raw) as TranslateResponse;
  } catch {
    return null;
  }

  const text = (data.responseData?.translatedText ?? '').trim();
  if (!text) return null;
  // 没有译文时接口会把原文回显，这种情况按「未收录」处理
  if (text.toLowerCase() === term.toLowerCase()) return null;

  return {
    term,
    channelId: 'translate',
    source: 'MyMemory 翻译',
    url: '',
    blocks: [{ heading: '中文', lines: [text] }],
    note: '机器翻译，供快速理解用',
  };
}

export async function lookupTranslate(
  term: string,
  signal?: AbortSignal,
): Promise<DictResult | null> {
  const url = `${API}?q=${encodeURIComponent(term)}&langpair=${encodeURIComponent('en|zh-CN')}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`翻译服务返回 ${res.status}`);
  return parseTranslate(await res.text(), term);
}

export const translateChannel: DictChannel = {
  id: 'translate',
  label: '中英翻译',
  langs: ['en'],
  cors: 'open',
  lookup: lookupTranslate,
};
