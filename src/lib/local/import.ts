/**
 * 本地导入：File → 解析 → 落库（IndexedDB）→ 返回统一 Book 模型。
 * 支持 .txt / .md / .markdown / .html / .htm / .epub。
 */
import type { Book, Chapter, LocalFormat } from '../types';
import { putBook, putChapters, putFile, putText } from '../storage/db';
import { uuid } from '../uuid';
import { decodeBuffer, normalizeText, splitByHeadings, splitTxt } from './text';
import { parseEpub } from './epub';

export interface ImportResult {
  book: Book;
  chapters: Chapter[];
  encoding?: string;
}

const EXT_MAP: Record<string, LocalFormat> = {
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  epub: 'epub',
};

export function detectFormat(fileName: string): LocalFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext] ?? null;
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/** Markdown → 带章节标记的纯文本 */
function markdownToMarked(src: string): string {
  return src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) return `\u0001${h[2].trim()}`;
      return line
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~]{1,3}([^*_`~]+)[*_`~]{1,3}/g, '$1');
    })
    .join('\n');
}

/** HTML → 带章节标记的纯文本 */
function htmlToMarked(src: string): string {
  const doc = new DOMParser().parseFromString(src, 'text/html');
  doc.querySelectorAll('script, style, nav, header, footer').forEach((el) => el.remove());
  const parts: string[] = [];
  const root = doc.body ?? doc.documentElement;
  root.querySelectorAll('h1, h2, h3, p, div, li, blockquote, br').forEach((el) => {
    if (/^h[1-3]$/i.test(el.tagName)) {
      const t = el.textContent?.trim();
      if (t) parts.push(`\u0001${t}`);
      return;
    }
    if (!el.textContent?.trim()) return;
    // 只取直接文本，避免嵌套 div 重复输出
    const direct = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim();
    if (direct) parts.push(direct);
  });
  return parts.join('\n');
}

function buildChapters(raw: Array<{ title: string; start: number; end: number }>): Chapter[] {
  return raw.map((c, i) => ({ index: i, title: c.title, start: c.start, end: c.end }));
}

export async function importFile(file: File): Promise<ImportResult> {
  const format = detectFormat(file.name);
  if (!format) throw new Error(`不支持的文件类型：${file.name}（仅支持 txt / md / html / epub）`);
  if (file.size > 120 * 1024 * 1024) throw new Error('文件超过 120MB，浏览器内存可能吃不住');

  const buf = await file.arrayBuffer();
  const now = Date.now();
  const id = `local:${uuid()}`;

  let text: string;
  let chapters: Chapter[];
  let title = stripExt(file.name);
  let author: string | undefined;
  let coverUrl: string | undefined;
  let encoding: string | undefined;

  if (format === 'epub') {
    const parsed = parseEpub(buf);
    text = parsed.sections.map((s) => `\u0001${s.title}\n${s.text}`).join('\n\n');
    const built = splitByHeadings(text);
    text = built.text;
    chapters = buildChapters(built.chapters);
    title = parsed.title || title;
    author = parsed.author;
    coverUrl = parsed.coverDataUrl;
    encoding = 'EPUB';
  } else {
    const decoded = decodeBuffer(buf);
    encoding = decoded.encoding;
    const plain = normalizeText(decoded.text);
    if (format === 'md') {
      const built = splitByHeadings(markdownToMarked(plain));
      text = built.text;
      chapters = buildChapters(built.chapters);
    } else if (format === 'html') {
      const built = splitByHeadings(htmlToMarked(plain));
      text = built.text;
      chapters = buildChapters(built.chapters);
    } else {
      text = plain;
      chapters = buildChapters(splitTxt(text));
    }
    // TXT 首行常常就是书名
    const firstLine = text
      .slice(0, 120)
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean);
    if (firstLine && firstLine.length <= 30 && /《.+》|作者[:：]/.test(firstLine)) {
      title =
        firstLine
          .replace(/[《》]/g, '')
          .replace(/作者[:：].*$/, '')
          .trim() || title;
    }
  }

  if (text.trim().length === 0) throw new Error('文件里没有可读文本');

  const book: Book = {
    id,
    source: 'local',
    title,
    author,
    coverUrl,
    format,
    size: file.size,
    addedAt: now,
    totalChapterNum: chapters.length,
    durChapterIndex: 0,
    durChapterTitle: chapters[0]?.title,
    durChapterTime: now,
    latestChapterTitle: chapters[chapters.length - 1]?.title,
  };

  await putText(id, text);
  await putChapters(id, chapters);
  await putFile(id, file, { name: file.name, type: file.type });
  await putBook(book);

  return { book, chapters, encoding };
}
