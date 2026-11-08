import type { DictBlock, DictChannel, DictResult } from './types.ts';

/**
 * Wiktionary（中文）：词条覆盖面广，含成语、专名与外来词，API 支持 `origin=*`。
 * 部分网络环境访问不了，因此作为备选渠道而不是默认渠道。
 */

const API = 'https://zh.wiktionary.org/w/api.php';

interface WikiPage {
  extract?: string;
  missing?: string;
}

interface WikiResponse {
  query?: { pages?: Record<string, WikiPage> };
}

export const wiktionaryUrl = (term: string): string =>
  `https://zh.wiktionary.org/wiki/${encodeURIComponent(term)}`;

export async function lookupWiktionary(
  term: string,
  signal?: AbortSignal,
): Promise<DictResult | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    prop: 'extracts',
    explaintext: '1',
    redirects: '1',
    titles: term,
  });

  const res = await fetch(`${API}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Wiktionary 返回 ${res.status}`);

  const json = (await res.json()) as WikiResponse;
  const page = Object.values(json.query?.pages ?? {})[0];
  if (!page || page.missing !== undefined || !page.extract) return null;

  return {
    term,
    channelId: 'wiktionary',
    source: 'Wiktionary',
    url: wiktionaryUrl(term),
    blocks: toBlocks(page.extract),
  };
}

/**
 * 把纯文本词条整理成「小节 + 正文」。
 * extract 是带空行的纯文本，短行基本是小节标题（如「汉语」「释义」）。
 */
function toBlocks(text: string): DictBlock[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks: DictBlock[] = [];
  let current: DictBlock = { heading: '', lines: [] };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = lines[i + 1] ?? '';
    const isHeading =
      line.length <= 14 && !/[。！？；，、：]$/.test(line) && next.length > line.length;
    if (isHeading && current.lines.length) {
      blocks.push(current);
      current = { heading: line, lines: [] };
    } else if (isHeading && !current.heading && !current.lines.length) {
      current.heading = line;
    } else {
      current.lines.push(line);
    }
    if (blocks.length >= 6) break;
  }
  if (current.lines.length || current.heading) blocks.push(current);

  return blocks
    .map((b) => ({ heading: b.heading, lines: b.lines.slice(0, 6) }))
    .slice(0, 5)
    .filter((b) => b.heading || b.lines.length);
}

export const wiktionaryChannel: DictChannel = {
  id: 'wiktionary',
  label: '维基词典',
  langs: ['zh'],
  url: wiktionaryUrl,
  lookup: lookupWiktionary,
};
