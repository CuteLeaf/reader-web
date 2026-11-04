/**
 * EPUB 解析（零依赖解压用 fflate）。
 *
 * 流程：unzip → META-INF/container.xml 找 OPF → 读 manifest/spine/toc →
 *      按 spine 顺序取 XHTML 正文 → 拼成「带章节标记的整串文本」。
 * 这样 EPUB 与 TXT 在存储层完全同构：一份 text + 若干字符偏移，阅读器只需一套逻辑。
 */
import { unzipSync } from 'fflate';
import { decodeBuffer, normalizeText } from './text';

export interface ParsedEpub {
  title?: string;
  author?: string;
  coverDataUrl?: string;
  /** 每章一段，title 为章节名 */
  sections: Array<{ title: string; text: string }>;
}

function normalizePath(path: string): string {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function textOf(node: Document | Element | null, tag: string): string | undefined {
  const el = node?.getElementsByTagName(tag)[0];
  return el?.textContent?.trim() || undefined;
}

function htmlToText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  // eslint-disable-next-line no-control-regex -- \u0001 是章节标记用的私有分隔符
  return (div.textContent ?? '').replace(/\u0001/g, '');
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export function parseEpub(buf: ArrayBuffer): ParsedEpub {
  const files = unzipSync(new Uint8Array(buf)) as Record<string, Uint8Array>;
  const fileNames = Object.keys(files);
  if (fileNames.length === 0) throw new Error('EPUB 解压失败：文件为空');

  const containerRaw = files['META-INF/container.xml'];
  if (!containerRaw) throw new Error('不是合法的 EPUB：缺少 META-INF/container.xml');
  const container = parseXml(decodeBuffer(toArrayBuffer(containerRaw)).text);
  const rootfile = container.querySelector('rootfile');
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB 缺少 OPF 文件');

  const opfDir = dirOf(opfPath);
  const opfRaw = files[opfPath];
  if (!opfRaw) throw new Error(`EPUB 内容缺失：${opfPath}`);
  const opf = parseXml(decodeBuffer(toArrayBuffer(opfRaw)).text);

  const title = textOf(opf, 'dc:title') ?? textOf(opf, 'title');
  const author = textOf(opf, 'dc:creator') ?? textOf(opf, 'creator');

  // manifest: id -> { href(绝对路径), type, properties }
  const manifest = new Map<string, { href: string; type: string; properties: string }>();
  for (const item of Array.from(opf.getElementsByTagName('item'))) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!id || !href) continue;
    manifest.set(id, {
      href: normalizePath(`${opfDir}/${decodeURIComponent(href)}`),
      type: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? '',
    });
  }

  // spine 顺序
  const spine: string[] = [];
  for (const ref of Array.from(opf.getElementsByTagName('itemref'))) {
    const idref = ref.getAttribute('idref');
    const item = idref ? manifest.get(idref) : undefined;
    if (item && /xhtml|html/.test(item.type)) spine.push(item.href);
  }

  // 目录标题：优先 nav.xhtml，其次 toc.ncx
  const tocTitles = new Map<string, string>();
  const navItem = [...manifest.values()].find((i) => /nav/.test(i.properties));
  if (navItem && files[navItem.href]) {
    const navDoc = new DOMParser().parseFromString(
      decodeBuffer(toArrayBuffer(files[navItem.href])).text,
      'text/html',
    );
    const navDir = dirOf(navItem.href);
    for (const a of Array.from(navDoc.querySelectorAll('nav a[href]'))) {
      const href = normalizePath(
        `${navDir}/${decodeURIComponent(a.getAttribute('href') ?? '').split('#')[0]}`,
      );
      const name = a.textContent?.trim();
      if (href && name && !tocTitles.has(href)) tocTitles.set(href, name);
    }
  }
  if (tocTitles.size === 0) {
    const ncxItem = [...manifest.values()].find((i) => /ncx/.test(i.type));
    if (ncxItem && files[ncxItem.href]) {
      const ncx = parseXml(decodeBuffer(toArrayBuffer(files[ncxItem.href])).text);
      const ncxDir = dirOf(ncxItem.href);
      for (const nav of Array.from(ncx.getElementsByTagName('navPoint'))) {
        const label = nav.getElementsByTagName('text')[0]?.textContent?.trim();
        const src = nav.getElementsByTagName('content')[0]?.getAttribute('src');
        if (!label || !src) continue;
        const href = normalizePath(`${ncxDir}/${decodeURIComponent(src).split('#')[0]}`);
        if (!tocTitles.has(href)) tocTitles.set(href, label);
      }
    }
  }

  // 正文
  const sections: Array<{ title: string; text: string }> = [];
  const targets =
    spine.length > 0
      ? spine
      : [...manifest.values()].filter((i) => /xhtml|html/.test(i.type)).map((i) => i.href);
  for (const href of targets) {
    const raw = files[href];
    if (!raw) continue;
    const html = decodeBuffer(toArrayBuffer(raw)).text;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const heading = doc.querySelector('h1, h2, h3, title')?.textContent?.trim();
    const name = tocTitles.get(href) || heading || `第 ${sections.length + 1} 节`;

    // 正文里的首个标题元素与章节名重复，页面已单独显示标题，这里去掉
    const bodyHeading = doc.querySelector('body h1, body h2, body h3');
    if (bodyHeading && bodyHeading.textContent?.trim() === name) bodyHeading.remove();

    const body = htmlToText(doc.body?.innerHTML ?? '');
    const text = normalizeText(body).trim();
    if (!text) continue;
    sections.push({ title: name.length > 60 ? name.slice(0, 60) : name, text });
  }

  // 封面
  let coverDataUrl: string | undefined;
  const coverItem =
    [...manifest.values()].find((i) => /cover-image/.test(i.properties)) ??
    [...manifest.values()].find((i) => /cover/i.test(i.href) && /image/.test(i.type));
  if (coverItem && files[coverItem.href] && files[coverItem.href].length < 400 * 1024) {
    coverDataUrl = toDataUrl(files[coverItem.href], coverItem.type || 'image/jpeg');
  }

  if (sections.length === 0) throw new Error('EPUB 中没有解析出可读正文');
  return { title, author, coverDataUrl, sections };
}
