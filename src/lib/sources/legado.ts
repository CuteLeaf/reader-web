/**
 * 「Legado 3.0」Web 后端客户端。
 *
 * 该后端由安卓端「阅读」（legado）内置的 web 服务提供，默认端口 1122，
 * 接口以「Legado 3.0」内置 Web 服务为准：
 *   GET /getBookshelf                        -> { data: Book[] }
 *   GET /getChapterList?url=<bookUrl>        -> { data: Chapter[] }
 *   GET /getBookContent?url=<bookUrl>&index= -> { data: "正文纯文本" }
 * 返回体有的版本直接给数组/字符串，这里统一做兼容拆包。
 */
import type { Book, Chapter } from '../types';
import { isLocalHost, isLocalNetworkBlocked } from './net';

export interface ProbeResult {
  base: string;
  latency: number;
  bookCount: number;
  titles: string[];
}

export class LegadoError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'cors' | 'http' | 'parse' | 'mixed-content' | 'auth' | 'lna',
  ) {
    super(message);
    this.name = 'LegadoError';
  }
}

const DEFAULT_TIMEOUT = 5000;

/** 把用户随手输入的地址补全成 http://host:port 形式 */
export function normalizeBase(input: string): string {
  let v = input.trim();
  if (!v) throw new LegadoError('地址为空', 'parse');
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  // 允许用户粘贴 /getBookshelf 这类接口地址
  v = v.replace(/\/(getBookshelf|getChapterList|getBookContent).*$/i, '');
  v = v.replace(/\/+$/, '');
  // 未写端口时补默认 1122
  try {
    const u = new URL(v);
    if (!u.port && u.protocol === 'http:') u.port = '1122';
    return u.origin;
  } catch {
    throw new LegadoError(`无法识别的地址：${input}`, 'parse');
  }
}

/**
 * 严格意义的混合内容：HTTPS 页面请求「公网」HTTP 地址。
 *
 * 私有 IP 字面值（192.168.x.x、10.x.x.x 等）与 .local 域名在 Chrome 的 Local Network
 * Access 规范里免于混合内容检查，改由「访问本地网络」权限提示把关，因此不算混合内容。
 * 若这里把它们一并拦掉，HTTPS 站点就永远连不上局域网后端了。
 */
function isMixedContent(base: string): boolean {
  if (typeof location === 'undefined' || location.protocol !== 'https:') return false;
  if (!base.startsWith('http://')) return false;
  try {
    if (isLocalHost(new URL(base).hostname)) return false;
  } catch {
    /* 解析失败交给后续流程报错 */
  }
  return true;
}

async function rawFetch(
  url: string,
  timeout = DEFAULT_TIMEOUT,
  signal?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new LegadoError('请求超时', 'network');
    // HTTP 公网页面访问局域网设备时，Chrome 会在发起请求前就拒绝（LNA 权限只给安全上下文），
    // 报错同样是 TypeError；这种情况和 CORS 无关，必须给出不同的提示。
    if (isLocalNetworkBlocked(url)) {
      throw new LegadoError(
        '浏览器限制：HTTP 页面不能访问局域网设备，请启用 HTTPS 或改用局域网地址打开本站',
        'lna',
      );
    }
    // fetch 因 CORS 失败时统一抛 TypeError，浏览器不暴露具体原因
    throw new LegadoError('网络不可达或被 CORS 拦截', 'cors');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

async function getRaw<T>(url: string, timeout = DEFAULT_TIMEOUT, signal?: AbortSignal): Promise<T> {
  const res = await rawFetch(url, timeout, signal);
  if (!res.ok) throw new LegadoError(`服务返回 ${res.status}`, 'http');
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new LegadoError('返回内容不是合法 JSON', 'parse');
  }
}

async function getJson<T>(
  url: string,
  timeout = DEFAULT_TIMEOUT,
  signal?: AbortSignal,
): Promise<T> {
  return unwrap<T>(await getRaw<unknown>(url, timeout, signal));
}

/** 探测一个地址是否是「Legado 3.0」后端；成功返回书架摘要 */
export async function probeEndpoint(base: string, timeout = 3000): Promise<ProbeResult> {
  if (isMixedContent(base)) {
    throw new LegadoError(
      '当前页面是 HTTPS，不能请求公网 HTTP 地址；请改用 HTTPS 后端或反向代理',
      'mixed-content',
    );
  }
  const t0 = performance.now();
  const shelf = await getJson<LegadoBook[]>(`${base}/getBookshelf`, timeout);
  const latency = Math.round(performance.now() - t0);
  const list = Array.isArray(shelf) ? shelf : [];
  return {
    base,
    latency,
    bookCount: list.length,
    titles: list
      .slice(0, 3)
      .map((b) => b.name)
      .filter((name): name is string => !!name),
  };
}

interface LegadoBook {
  bookUrl?: string;
  name?: string;
  author?: string;
  coverUrl?: string;
  durChapterTitle?: string;
  durChapterIndex?: number;
  durChapterPos?: number;
  durChapterTime?: number;
  latestChapterTitle?: string;
  totalChapterNum?: number;
}

export async function fetchBookshelf(base: string, signal?: AbortSignal): Promise<Book[]> {
  const shelf = await getJson<LegadoBook[]>(`${base}/getBookshelf`, 20000, signal);
  if (!Array.isArray(shelf)) throw new LegadoError('书架数据格式异常', 'parse');
  return shelf
    .filter((b) => b && b.bookUrl)
    .map((b) => ({
      raw: b as unknown as Record<string, unknown>,
      id: `legado:${b.bookUrl}`,
      source: 'legado' as const,
      bookUrl: b.bookUrl,
      title: b.name?.trim() || '未命名',
      author: b.author,
      coverUrl: b.coverUrl || undefined,
      durChapterTitle: b.durChapterTitle,
      durChapterIndex: Number.isFinite(b.durChapterIndex) ? Number(b.durChapterIndex) : 0,
      durChapterPos: Number.isFinite(b.durChapterPos) ? Number(b.durChapterPos) : 0,
      durChapterTime: b.durChapterTime,
      latestChapterTitle: b.latestChapterTitle,
      totalChapterNum: b.totalChapterNum,
    }))
    .sort((a, b) => (b.durChapterTime ?? 0) - (a.durChapterTime ?? 0));
}

interface LegadoChapter {
  title?: string;
  url?: string;
  index?: number;
}

export async function fetchChapters(
  base: string,
  bookUrl: string,
  signal?: AbortSignal,
): Promise<Chapter[]> {
  const list = await getJson<LegadoChapter[]>(
    `${base}/getChapterList?url=${encodeURIComponent(bookUrl)}`,
    10000,
    signal,
  );
  if (!Array.isArray(list)) throw new LegadoError('目录数据格式异常', 'parse');
  return list.map((c, i) => ({
    index: Number.isFinite(c.index) ? Number(c.index) : i,
    title: c.title?.trim() || `第 ${i + 1} 章`,
    url: c.url,
  }));
}

export async function fetchChapterContent(
  base: string,
  bookUrl: string,
  chapterIndex: number,
  chapterTitle?: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const url = `${base}/getBookContent?url=${encodeURIComponent(bookUrl)}&index=${chapterIndex}`;

  // 阅读端遇到未缓存的章节要去源站抓，3~8 秒很常见；偶发还会碰上被复用的死连接，
  // 所以给 30 秒预算，并在超时/网络错误时重试一次（新连接通常就好了）。
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await getRaw<{ data?: unknown; errorMsg?: string } | string>(url, 30000, signal);
      let content: string | undefined;
      if (typeof raw === 'string') content = raw;
      else if (typeof raw?.data === 'string') content = raw.data;
      else if (raw?.errorMsg) throw new LegadoError(`后端返回：${raw.errorMsg}`, 'http');
      if (typeof content !== 'string') throw new LegadoError('正文数据格式异常', 'parse');

      const paragraphs = content
        .replace(/\r\n?/g, '\n')
        .split(/\n+/)
        .map((p) => p.replace(/^[\s\u3000]+/, '').trim())
        .filter(Boolean);

      if (chapterTitle && paragraphs[0] && paragraphs[0] === chapterTitle.trim())
        paragraphs.shift();
      return paragraphs.length ? paragraphs : ['（本章无内容）'];
    } catch (e) {
      lastError = e;
      const kind = e instanceof LegadoError ? e.kind : 'parse';
      const retryable = kind === 'network' || kind === 'cors';
      if (!retryable || attempt === 1 || signal?.aborted) break;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastError;
}

export interface RemoteBookProgress {
  name: string;
  author: string;
  /** 后端支持用 url 精确定位书籍，避免同名书串位 */
  bookUrl?: string;
  durChapterIndex: number;
  /** 章节内字符偏移 */
  durChapterPos: number;
  durChapterTime: number;
  durChapterTitle?: string;
}

/**
 * 把阅读进度写回「Legado 3.0」后端：
 *   POST /saveBookProgress  { name, author, url?, durChapterIndex, durChapterPos, durChapterTime, durChapterTitle }
 *
 * 后端按 name + author（给了 url 时先按 url 找）定位到同一本书再更新，
 * 两边书名/作者不完全一致会直接返回「格式不对」，所以调用方要传后端原始字段而不是清洗过的标题。
 */
export async function saveBookProgress(
  base: string,
  progress: RemoteBookProgress,
  token?: string,
  opts: { keepalive?: boolean; timeout?: number } = {},
): Promise<void> {
  if (isMixedContent(base)) {
    throw new LegadoError(
      '当前页面是 HTTPS，不能请求公网 HTTP 地址；请改用 HTTPS 后端或反向代理',
      'mixed-content',
    );
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 8000);
  const url = `${base}/saveBookProgress`;
  const body = JSON.stringify({
    name: progress.name,
    author: progress.author,
    url: progress.bookUrl,
    durChapterIndex: progress.durChapterIndex,
    durChapterPos: progress.durChapterPos,
    durChapterTime: progress.durChapterTime,
    durChapterTitle: progress.durChapterTitle ?? '',
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      keepalive: opts.keepalive,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-legado-token': token } : {}),
      },
      body,
      signal: ctrl.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new LegadoError('同步进度超时', 'network');
    if (isLocalNetworkBlocked(url)) {
      throw new LegadoError(
        '浏览器限制：HTTP 页面不能访问局域网设备，请启用 HTTPS 或改用局域网地址打开本站',
        'lna',
      );
    }
    throw new LegadoError('网络不可达或被 CORS 拦截', 'cors');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let payload: { isSuccess?: boolean; errorMsg?: string } | null = null;
  try {
    payload = JSON.parse(text) as { isSuccess?: boolean; errorMsg?: string };
  } catch {
    /* 部分版本成功时直接返回空响应体 */
  }
  if (!res.ok) throw new LegadoError(`服务返回 ${res.status}`, 'http');
  if (payload?.isSuccess === false || (payload?.errorMsg && payload.errorMsg.length > 0)) {
    throw new LegadoError(payload.errorMsg || '后端拒绝了进度更新', 'http');
  }
}

/**
 * 上传书籍到「Legado 3.0」后端（和它自带的上传页 /uploadBook 走同一个接口）：
 *   POST /addLocalBook   multipart/form-data: fileName, fileData
 * 用 XHR 而不是 fetch，因为要用 upload.onprogress 拿上传进度。
 */
export function uploadBook(
  base: string,
  file: File,
  opts: { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  if (isMixedContent(base)) {
    return Promise.reject(
      new LegadoError(
        '当前页面是 HTTPS，不能向公网 HTTP 地址上传；请改用 HTTPS 后端或反向代理',
        'mixed-content',
      ),
    );
  }

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => {
      xhr.abort();
      done(() => reject(new DOMException('已取消', 'AbortError')));
    };

    xhr.open('POST', `${base}/addLocalBook`);
    xhr.timeout = 10 * 60 * 1000;

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) opts.onProgress?.(ev.loaded, ev.total);
    };

    xhr.onload = () => {
      let payload: { isSuccess?: boolean; errorMsg?: string } | null = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        /* 有些版本直接返回空响应体 */
      }
      if (xhr.status === 200 && payload?.isSuccess !== false && !payload?.errorMsg) {
        done(() => resolve());
        return;
      }
      done(() =>
        reject(new LegadoError(payload?.errorMsg || `上传失败（HTTP ${xhr.status}）`, 'http')),
      );
    };
    xhr.onerror = () =>
      done(() => reject(new LegadoError('上传失败：网络中断或被 CORS 拦截', 'network')));
    xhr.ontimeout = () => done(() => reject(new LegadoError('上传超时', 'network')));

    const fd = new FormData();
    fd.append('fileName', file.name);
    fd.append('fileData', file, file.name);

    opts.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.send(fd);
  });
}

export function describeError(e: unknown): string {
  if (e instanceof LegadoError) {
    switch (e.kind) {
      case 'cors':
        return '连不上：可能地址/端口不对、手机端服务未开启，或后端未放开 CORS';
      case 'lna':
        return 'Chrome 已拦截：HTTP 页面不能访问局域网设备。给本站启用 HTTPS（首次连接时允许「访问本地网络」），或用局域网地址打开本站';
      case 'mixed-content':
        return e.message;
      case 'network':
        return '请求超时，检查是否同一局域网';
      case 'http':
        return e.message;
      default:
        return e.message;
    }
  }
  return (e as Error)?.message ?? '未知错误';
}
