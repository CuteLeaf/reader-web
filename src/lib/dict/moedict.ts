import type { DictBlock, DictChannel, DictResult } from './types.ts';

/**
 * 萌典（教育部《重編國語辭典修訂本》整理版）：中文词条带注音、释义与例句，
 * 接口开放且带 `Access-Control-Allow-Origin: *`，网页版与扩展侧栏都能直连。
 */
interface MoedictDefinition {
  def?: string;
  example?: string[];
  quote?: string[];
  type?: string;
  antonyms?: string;
  synonyms?: string;
}

interface MoedictHeteronym {
  bopomofo?: string;
  pinyin?: string;
  definitions?: MoedictDefinition[];
}

interface MoedictResponse {
  title?: string;
  heteronyms?: MoedictHeteronym[];
}

export const moedictUrl = (term: string): string =>
  `https://www.moedict.tw/${encodeURIComponent(term)}`;

export async function lookupMoedict(
  term: string,
  signal?: AbortSignal,
): Promise<DictResult | null> {
  const res = await fetch(`https://www.moedict.tw/uni/${encodeURIComponent(term)}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`萌典返回 ${res.status}`);

  const data = (await res.json()) as MoedictResponse;
  const heteronyms = data.heteronyms ?? [];
  if (!heteronyms.length) return null;

  const blocks: DictBlock[] = [];
  for (const h of heteronyms.slice(0, 3)) {
    const lines: string[] = [];
    for (const d of (h.definitions ?? []).slice(0, 4)) {
      if (d.type) lines.push(`〔${d.type}〕${d.def ?? ''}`.trim());
      else if (d.def) lines.push(d.def);
      if (d.example?.length) lines.push(`例：${d.example[0]}`);
      if (d.antonyms) lines.push(`反义：${d.antonyms}`);
    }
    if (!lines.length) continue;
    // 注音已经单独显示在词头旁边，小节标题里就不再重复一遍
    const heading = h.bopomofo ?? h.pinyin ?? '';
    blocks.push({ heading, lines });
  }
  if (!blocks.length) return null;

  return {
    term: data.title ?? term,
    channelId: 'moedict',
    source: '萌典',
    phonetic: heteronyms[0]?.bopomofo,
    url: moedictUrl(term),
    blocks,
  };
}

export const moedictChannel: DictChannel = {
  id: 'moedict',
  label: '萌典',
  langs: ['zh'],
  url: moedictUrl,
  lookup: lookupMoedict,
};
