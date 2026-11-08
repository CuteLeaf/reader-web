/**
 * 把正文的纯文本与 DOM 节点建立对应关系，用于「朗读到哪一句就滚到哪」。
 *
 * 正文是 `<p>` 里的一段段纯文本，段落之间用一个换行符占位，
 * 这样选区偏移、句子偏移和 DOM Range 用的是同一套坐标。
 */

export interface TextSpan {
  node: Text;
  start: number;
  end: number;
}

export interface ParagraphRange {
  /** 段落文本在 map.text 中的起止位置（不含段末换行） */
  start: number;
  end: number;
}

export interface TextMap {
  text: string;
  spans: TextSpan[];
  paras: ParagraphRange[];
}

/** 收集容器内所有段落的文本，段落之间补一个换行符 */
export function buildTextMap(root: HTMLElement): TextMap {
  const spans: TextSpan[] = [];
  const paras: ParagraphRange[] = [];
  let text = '';

  for (const block of Array.from(root.querySelectorAll('p'))) {
    const paraStart = text.length;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const t = node as Text;
      if (t.data) {
        spans.push({ node: t, start: text.length, end: text.length + t.data.length });
        text += t.data;
      }
      node = walker.nextNode();
    }
    paras.push({ start: paraStart, end: text.length });
    text += '\n';
  }

  return { text, spans, paras };
}

/** 把字符偏移换算成 DOM 位置 */
function locate(map: TextMap, index: number): { node: Text; offset: number } | null {
  if (!map.spans.length) return null;

  let low = 0;
  let high = map.spans.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (map.spans[mid].end <= index) low = mid + 1;
    else high = mid;
  }

  const span = map.spans[low];
  const offset = Math.min(Math.max(index - span.start, 0), span.node.data.length);
  return { node: span.node, offset };
}

/** 用文本偏移构造 Range；越界时返回 null */
export function rangeOf(map: TextMap, start: number, end: number): Range | null {
  const from = locate(map, start);
  const to = locate(map, end);
  if (!from || !to) return null;

  const range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  } catch {
    return null;
  }
  return range;
}
