/**
 * 纯文本解析：编码嗅探 + 章节切分。
 *
 * 本地 TXT 的真实形态非常杂：UTF-8 / GBK / UTF-16、CRLF、全角空格缩进、章节标题五花八门。
 * 这里只做两件事：稳定地解出字符串，稳定地找出章节边界（用字符偏移量表示，不复制正文）。
 */

export interface RawChapter {
  title: string;
  start: number;
  end: number;
}

/** 编码嗅探：BOM > 严格 UTF-8 > GB18030 兜底 */
export function decodeBuffer(buf: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8 (BOM)' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16LE' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16BE' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    try {
      return { text: new TextDecoder('gb18030').decode(bytes), encoding: 'GB18030' };
    } catch {
      return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8 (lossy)' };
    }
  }
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

const CN_NUM = '0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟';
const CHAPTER_RE = new RegExp(
  [
    // 第一章 / 第12回 / 第三卷
    `^[\\t \\u3000]{0,6}第[${CN_NUM}]{1,12}[章节節回卷篇集部话話][^\\n]{0,50}$`,
    // 序章 / 楔子 / 番外 / 尾声
    `^[\\t \\u3000]{0,6}(?:序章|序言|楔子|引子|前言|后记|後記|尾声|尾聲|终章|終章|大结局|番外)[^\\n]{0,50}$`,
    // Chapter 12 / CHAPTER XII
    `^[\\t \\u3000]{0,6}(?:Chapter|CHAPTER|chapter)\\s+[0-9IVXLCivxlc]{1,8}[^\\n]{0,50}$`,
    // 1. 标题 这类纯数字编号（必须有分隔符，避免误判正文）
    `^[\\t \\u3000]{0,6}[0-9]{1,4}[.、,，]\\s?\\S[^\\n]{0,40}$`,
  ].join('|'),
  'gm',
);

/** 找出所有章节起始位置 */
export function detectChapters(text: string): RawChapter[] {
  const starts: Array<{ title: string; start: number }> = [];
  CHAPTER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHAPTER_RE.exec(text))) {
    const raw = m[0];
    const title = raw.trim();
    const start = m.index;
    // 标题不可能太长，且必须占独立行（正则已保证）
    if (title.length > 1 && title.length <= 46) {
      starts.push({ start, title });
    }
    if (CHAPTER_RE.lastIndex === m.index) CHAPTER_RE.lastIndex += 1;
  }

  const chapters: RawChapter[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1].start : text.length;
    chapters.push({ title: starts[i].title, start: starts[i].start, end });
  }
  return chapters;
}

/** 没有章节标题时按长度兜底切分，尽量落在段落边界 */
export function splitBySize(text: string, size = 4000): RawChapter[] {
  const out: RawChapter[] = [];
  let cursor = 0;
  let n = 1;
  while (cursor < text.length) {
    let end = Math.min(cursor + size, text.length);
    if (end < text.length) {
      const nextBreak = text.indexOf('\n', end);
      const prevBreak = text.lastIndexOf('\n', end);
      if (prevBreak > cursor + size * 0.6) end = prevBreak;
      else if (nextBreak !== -1 && nextBreak - end < 400) end = nextBreak;
    }
    out.push({ title: `第 ${n} 节`, start: cursor, end });
    cursor = end;
    n += 1;
  }
  return out;
}

/** 把 TXT 切成章节；开头若有大段前言，单独成章 */
export function splitTxt(text: string): RawChapter[] {
  const detected = detectChapters(text);
  if (detected.length >= 2) {
    const first = detected[0];
    const preface = text.slice(0, first.start).trim();
    if (preface.length > 80) {
      return [{ title: '前言', start: 0, end: first.start }, ...detected];
    }
    return detected;
  }
  return splitBySize(text);
}

/** Markdown / HTML 已转成纯文本时，用标题切章 */
export function splitByHeadings(marked: string): { chapters: RawChapter[]; text: string } {
  // 约定：标题以 "\u0001" 前缀标记，正文里不会出现该字符
  // eslint-disable-next-line no-control-regex -- \u0001 是章节标记用的私有分隔符
  const text = marked.replace(/\u0001/g, '');
  const chapters: RawChapter[] = [];
  const marks: Array<{ title: string; pos: number }> = [];
  // eslint-disable-next-line no-control-regex -- 同上，按 \u0001 切出标题行
  const re = /\u0001([^\n]*)/g;
  let m: RegExpExecArray | null;
  let removed = 0;
  while ((m = re.exec(marked))) {
    // 标记符本身会被删掉，所以清理后的偏移要减去已删除的标记数量
    marks.push({ title: m[1].trim(), pos: m.index - removed });
    removed += 1;
  }
  if (marks.length === 0) return { text, chapters: splitBySize(text) };
  for (let i = 0; i < marks.length; i += 1) {
    chapters.push({
      title: marks[i].title || `第 ${i + 1} 节`,
      start: marks[i].pos,
      end: i + 1 < marks.length ? marks[i + 1].pos : text.length,
    });
  }
  return { text, chapters };
}
