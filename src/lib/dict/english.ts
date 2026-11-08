import type { DictBlock, DictChannel, DictResult } from './types.ts';

/**
 * 英文词典：dictionaryapi.dev（免费、无 key、CORS 开放）。
 * 中文小说里常夹英文单词或书名，选词后如果判定为英文就走这里。
 */

interface EnPhonetic {
  text?: string;
}

interface EnDefinition {
  definition?: string;
  example?: string;
}

interface EnMeaning {
  partOfSpeech?: string;
  definitions?: EnDefinition[];
}

interface EnEntry {
  word?: string;
  phonetic?: string;
  phonetics?: EnPhonetic[];
  meanings?: EnMeaning[];
}

export const englishDictUrl = (term: string): string =>
  `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`;

export async function lookupEnglish(
  term: string,
  signal?: AbortSignal,
): Promise<DictResult | null> {
  const res = await fetch(englishDictUrl(term), { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`英文词典返回 ${res.status}`);

  const data = (await res.json()) as EnEntry[];
  const entry = Array.isArray(data) ? data[0] : undefined;
  if (!entry?.meanings?.length) return null;

  const blocks: DictBlock[] = [];
  for (const meaning of entry.meanings.slice(0, 4)) {
    const lines = (meaning.definitions ?? [])
      .slice(0, 3)
      .map((d) => (d.example ? `${d.definition ?? ''}（例：${d.example}）` : (d.definition ?? '')))
      .filter(Boolean);
    if (!lines.length) continue;
    blocks.push({ heading: meaning.partOfSpeech ?? '', lines });
  }
  if (!blocks.length) return null;

  return {
    term: entry.word ?? term,
    channelId: 'english',
    source: 'dictionaryapi.dev',
    phonetic: entry.phonetic ?? entry.phonetics?.find((p) => p.text)?.text,
    url: `https://www.merriam-webster.com/dictionary/${encodeURIComponent(term)}`,
    blocks,
  };
}

export const englishChannel: DictChannel = {
  id: 'english',
  label: '英文词典',
  langs: ['en'],
  url: (term: string) => `https://www.merriam-webster.com/dictionary/${encodeURIComponent(term)}`,
  lookup: lookupEnglish,
};
