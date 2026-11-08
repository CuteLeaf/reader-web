/**
 * 离线词库的分片解析（纯函数，便于单测）。
 *
 * 数据来自 npm 包 `zidian`（汉字/词语/成语查询），每个分片是一个
 * `{ "0": { ci, explanation, pinyin? }, ... }` 的对象，一次 600 条。
 */

export interface OfflineRow {
  /** 词条 */
  k: string;
  /** 释义（保留原文的编号与换行） */
  d: string;
  /** 拼音，可能为空 */
  p?: string;
}

interface ShardItem {
  ci?: string;
  word?: string;
  explanation?: string;
  pinyin?: string;
  radicals?: string;
  strokes?: string;
}

export function parseShard(raw: string): OfflineRow[] {
  let data: Record<string, ShardItem>;
  try {
    data = JSON.parse(raw) as Record<string, ShardItem>;
  } catch {
    return [];
  }

  const rows: OfflineRow[] = [];
  for (const item of Object.values(data)) {
    const word = (item.ci ?? '').trim();
    const definition = (item.explanation ?? '').trim();
    if (!word || !definition) continue;
    rows.push({ k: word, d: definition, p: item.pinyin?.trim() || undefined });
  }
  return rows;
}

/**
 * 汉字分片（/dist/word/*.json）：一个分片 30 个字，
 * 每条带拼音、部首、笔画与解释，拼成一条可读的释义。
 */
export function parseWordShard(raw: string): OfflineRow[] {
  let data: Record<string, ShardItem>;
  try {
    data = JSON.parse(raw) as Record<string, ShardItem>;
  } catch {
    return [];
  }

  const rows: OfflineRow[] = [];
  for (const item of Object.values(data)) {
    const word = (item.word ?? '').trim();
    if (!word) continue;

    const meta: string[] = [];
    if (item.radicals) meta.push(`部首 ${item.radicals}`);
    if (item.strokes) meta.push(`${item.strokes} 画`);
    const body = (item.explanation ?? '').trim();
    if (!meta.length && !body) continue;

    const lines = [meta.join(' · '), ...body.split(/\n{2,}/).map((line) => line.trim())].filter(
      Boolean,
    );
    rows.push({ k: word, d: lines.join('\n'), p: item.pinyin?.trim() || undefined });
  }
  return rows;
}

/** 把释义拆成一行一条，去掉空行 */
export function definitionLines(definition: string, limit = 12): string[] {
  return definition
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}
