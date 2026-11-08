/**
 * 朗读断句：先按句末标点切分，超长句再按逗号类标点二次切分。
 *
 * Chrome 的 speechSynthesis 对超长 utterance 会在十几秒后静默中断（不触发 onend），
 * 所以单句必须压在 MAX_CHUNK 以内，否则会出现「读到一半没声了」。
 *
 * 同时返回每个句子在**原始文本**中的偏移，用于把朗读位置映射回 DOM（自动滚动）。
 */

/** 单句字符上限 */
export const MAX_CHUNK = 120;

/** 句末标点：命中即切句，标点留在前一句末尾 */
const HARD = new Set(['。', '！', '？', '!', '?', '；', ';', '…']);

/** 句末标点之后可能紧跟的收尾符号，一并并入同一句 */
const TRAIL = new Set(['”', '’', '」', '』', '）', ')', '】', '》', '"', "'"]);

/** 超长句的次级断点 */
const SOFT = new Set(['，', ',', '、', '：', ':', '—', '·']);

export interface SentenceRange {
  /** 在原始文本中的起始下标 */
  start: number;
  /** 在原始文本中的结束下标（不含） */
  end: number;
  /** 用于朗读与展示的文本：空白已折叠 */
  text: string;
}

/** 空白折叠：朗读不需要保留排版换行 */
function normalize(chunk: string): string {
  return chunk.replace(/\s+/g, ' ').trim();
}

/**
 * 把一段文字切成句子，并保留每句在原文中的位置。
 * 段落在原文里以换行分隔，切句时换行会被并入前一句的尾巴，再在展示时折叠成空格。
 */
export function splitSentenceRanges(input: string): SentenceRange[] {
  const text = String(input ?? '');
  if (!text.trim()) return [];

  const out: SentenceRange[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (!HARD.has(text[i])) continue;
    // 「？！。」「……。」这类连续标点属于同一句，不要切碎
    let end = i + 1;
    while (end < text.length && (HARD.has(text[end]) || TRAIL.has(text[end]))) end += 1;
    push(text, start, end, out);
    start = end;
    i = end - 1;
  }
  if (start < text.length) push(text, start, text.length, out);
  return out;
}

/** 只要句子文本时的便捷入口 */
export function splitSentences(input: string): string[] {
  return splitSentenceRanges(input).map((range) => range.text);
}

function push(text: string, from: number, to: number, out: SentenceRange[]): void {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  if (start >= end) return;
  out.push(...splitLong(text, start, end));
}

/** 单句超长时按次级标点切，找不到合适位置就硬切 */
function splitLong(text: string, from: number, to: number): SentenceRange[] {
  if (to - from <= MAX_CHUNK) {
    return [{ start: from, end: to, text: normalize(text.slice(from, to)) }];
  }

  const out: SentenceRange[] = [];
  let start = from;
  while (to - start > MAX_CHUNK) {
    let cut = -1;
    // 从上限前一位往前找最近的逗号类标点，避免切在词中间
    for (let i = start + MAX_CHUNK - 1; i >= start + Math.floor(MAX_CHUNK / 2); i -= 1) {
      if (SOFT.has(text[i])) {
        cut = i + 1;
        break;
      }
    }
    if (cut <= start) cut = start + MAX_CHUNK;
    out.push({ start, end: cut, text: normalize(text.slice(start, cut)) });
    start = cut;
  }
  if (start < to) out.push({ start, end: to, text: normalize(text.slice(start, to)) });
  return out.filter((range) => range.text);
}
