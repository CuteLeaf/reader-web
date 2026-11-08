/**
 * 选中文字后「搜索」。
 *
 * 浏览器扩展：用 chrome.search.query() 直接交给用户设置的默认搜索引擎，
 *             新标签页打开（Chrome 87+，manifest 需声明 "search" 权限）。
 * 普通网页  ：Web 平台拿不到「浏览器默认搜索引擎」，只能拼一个固定搜索地址；
 *             引擎由阅读设置里的 searchEngine 决定，可在设置面板切换。
 */

export const SEARCH_ENGINES = {
  baidu: (q: string) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
  bing: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  google: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
} as const;

export type SearchEngine = keyof typeof SEARCH_ENGINES;

/** chrome.search 只在扩展上下文里存在；普通网页的 window.chrome 没有这个命名空间 */
interface SearchApi {
  query(info: {
    text: string;
    disposition?: 'CURRENT_TAB' | 'NEW_TAB' | 'NEW_WINDOW';
  }): Promise<void> | void;
}

function extensionSearch(): SearchApi | null {
  const c = (globalThis as typeof globalThis & { chrome?: { search?: SearchApi } }).chrome;
  return c?.search && typeof c.search.query === 'function' ? c.search : null;
}

/** 清洗选区文本：合并空白、去首尾、超长截断，避免 URL 过长 */
export function cleanQuery(text: string): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

/** 生成固定引擎的搜索地址（纯函数）；纯空白返回空串 */
export function buildSearchUrl(text: string, engine: SearchEngine = 'baidu'): string {
  const q = cleanQuery(text);
  if (!q) return '';
  const make = SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.baidu;
  return make(q);
}

export type SearchMode = 'default' | 'url' | '';

/**
 * 在新标签页搜索选中文字。
 * 返回 'default'（用了浏览器默认引擎）、'url'（固定引擎兜底）或 ''（没有可搜内容）。
 */
export function openSearch(text: string, engine: SearchEngine = 'baidu'): SearchMode {
  const q = cleanQuery(text);
  if (!q) return '';

  const search = extensionSearch();
  if (search) {
    // 权限缺失或调用失败时兜底到固定引擎，不让按钮点了没反应
    void Promise.resolve(search.query({ text: q, disposition: 'NEW_TAB' })).catch(() => {
      globalThis.window?.open(buildSearchUrl(q, engine), '_blank', 'noopener,noreferrer');
    });
    return 'default';
  }

  globalThis.window?.open(buildSearchUrl(q, engine), '_blank', 'noopener,noreferrer');
  return 'url';
}
