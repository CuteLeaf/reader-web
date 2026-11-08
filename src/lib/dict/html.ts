/**
 * HTML 抓取与文本抽取：海词、有道这类站点没有开放 JSON API，
 * 手机端「阅读」是用书源规则解析页面的，这里用同样的思路——取回 HTML，
 * 挑出正文容器，再压成按行排列的纯文本。
 *
 * 注意：这些站点没有 CORS 头，只有扩展（host_permissions）能读到响应，
 * 普通网页里会被浏览器拦掉，调用方需先判断环境。
 */

export interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
}

export async function fetchText(
  url: string,
  options: FetchOptions = {},
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    body: options.body,
    headers: options.headers,
    signal,
    credentials: 'omit',
  });
  if (!res.ok) throw new Error(`站点返回 ${res.status}`);
  return res.text();
}

export function parseDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** 把一段 HTML 片段压成按行排列的文本，保留块级元素的分行 */
export function htmlToLines(html: string): string[] {
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|td|dd|dt|section|article|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));

  return withBreaks
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean);
}

/** 取页面里某个容器的文本，并先删掉噪音节点 */
export function linesOf(html: string, selector: string, drop?: string, limit = 12): string[] {
  const doc = parseDocument(html);
  doc.querySelectorAll('script,style,noscript,svg,iframe').forEach((el) => el.remove());
  if (drop) doc.querySelectorAll(drop).forEach((el) => el.remove());
  const root = doc.querySelector(selector);
  if (!root) return [];
  return htmlToLines(root.innerHTML).slice(0, limit);
}

/** 取某个元素的纯文本 */
export function textOf(html: string, selector: string): string {
  const doc = parseDocument(html);
  doc.querySelectorAll('script,style,noscript').forEach((el) => el.remove());
  return (doc.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
