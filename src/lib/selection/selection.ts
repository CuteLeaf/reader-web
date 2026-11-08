/**
 * 选区读取：把 window.getSelection() 的结果整理成「可直接用」的结构。
 *
 * 正文是 `<article class="paper">` 里一串 `<p>`，没有内联标签，
 * 所以只需要记下「第几段第几个字」，朗读进度和划线都以这个坐标为锚点。
 */

export interface SelectionPoint {
  /** 段落索引，对应 app.paragraphs 的下标 */
  para: number;
  /** 段落内字符偏移 */
  offset: number;
}

export interface SelectionInfo {
  text: string;
  /** 视口坐标：首行顶部、末行底部、左右边界，用于浮层定位 */
  top: number;
  bottom: number;
  left: number;
  right: number;
  from: SelectionPoint | null;
  to: SelectionPoint | null;
}

/** 选中文字后读取选区；没有选区或选区不在正文里则返回 null */
export function readSelection(container: HTMLElement): SelectionInfo | null {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const text = sel
    .toString()
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!text) return null;

  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  const fallback = range.getBoundingClientRect();
  const first = rects[0] ?? fallback;
  const last = rects[rects.length - 1] ?? first;

  return {
    text,
    top: first.top,
    bottom: last.bottom,
    left: Math.min(...rects.map((r) => r.left), first.left),
    right: Math.max(...rects.map((r) => r.right), first.right),
    from: pointOf(container, range.startContainer, range.startOffset),
    to: pointOf(container, range.endContainer, range.endOffset),
  };
}

/** 把 DOM 里的 (节点, 偏移) 换算成「第几段第几个字」 */
function pointOf(container: HTMLElement, node: Node, offset: number): SelectionPoint | null {
  const paragraphs = Array.from(container.querySelectorAll('p'));
  let el: Node | null = node;
  while (el && el !== container && !(el.nodeType === Node.ELEMENT_NODE && el.nodeName === 'P')) {
    el = el.parentNode;
  }
  if (!el || el === container) return null;

  const para = paragraphs.indexOf(el as HTMLParagraphElement);
  if (para < 0) return null;

  const r = document.createRange();
  r.selectNodeContents(el);
  try {
    r.setEnd(node, offset);
  } catch {
    return { para, offset: 0 };
  }
  return { para, offset: r.toString().length };
}

/**
 * 从选区里挑一个要查的词。
 * 短语/短句（≤ 12 字）整体查；长选区只取开头第一个词，
 * 中文按连字截到 4 个字（够覆盖绝大多数词与成语），英文按单词边界。
 */
export function pickTerm(text: string): string {
  const cleaned = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
  if (!cleaned) return '';
  if (cleaned.length <= 12) return cleaned;

  const cjk = cleaned.match(/[\u4e00-\u9fa5]{2,}/);
  if (cjk) return cjk[0].slice(0, 4);

  const word = cleaned.match(/[A-Za-z][A-Za-z'-]{0,30}/);
  if (word) return word[0];

  return cleaned.slice(0, 8);
}
