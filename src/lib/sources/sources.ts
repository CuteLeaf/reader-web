/**
 * 书源 / 订阅源管理接口（阅读 3.0 Web 服务）。
 *
 * 路由与参数以 LegadoTeam/legado 的 HttpServer.kt + BookSourceController.kt 为准：
 *   GET  /getBookSources            -> { data: BookSource[] }      无需令牌
 *   GET  /getRssSources             -> { data: RssSource[] }       无需令牌
 *   GET  /getJsSourceApiTokenRequired -> { data: boolean }         是否需要 x-legado-token
 *   POST /saveBookSource | /saveRssSource      单条 source JSON    需要令牌
 *   POST /saveBookSources | /saveRssSources    source 数组         需要令牌
 *   POST /deleteBookSources | /deleteRssSources  source 对象数组   需要令牌
 *
 * 注意：delete 接口收的是「source 对象数组」而不是 url 数组（源码里 GSON.fromJsonArray<BookSource>）。
 */
import { LegadoError } from './legado';

export type SourceKind = 'book' | 'rss';

export interface AnySource {
  [key: string]: unknown;
}

/** 书源用 bookSourceName/bookSourceUrl，订阅源用 sourceName/sourceUrl */
export interface SourceMeta {
  name: string;
  url: string;
  group: string;
  enabled: boolean;
}

export function metaOf(kind: SourceKind, source: AnySource): SourceMeta {
  const pick = (k: string) => (typeof source[k] === 'string' ? (source[k] as string) : '');
  return {
    name: kind === 'book' ? pick('bookSourceName') : pick('sourceName'),
    url: kind === 'book' ? pick('bookSourceUrl') : pick('sourceUrl'),
    group: kind === 'book' ? pick('bookSourceGroup') : pick('sourceGroup'),
    enabled: source.enabled !== false,
  };
}

const TIMEOUT = 60_000;

class SourceError extends LegadoError {}

async function request(
  url: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ data?: unknown; errorMsg?: string; isSuccess?: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  const { token, headers, ...rest } = init;
  try {
    const res = await fetch(url, {
      ...rest,
      cache: 'no-store',
      credentials: 'omit',
      signal: ctrl.signal,
      headers: {
        ...(headers as Record<string, string> | undefined),
        ...(token ? { 'x-legado-token': token } : {}),
      },
    });
    if (res.status === 404) throw new SourceError('这个版本的后端没有该接口', 'http');
    const text = await res.text();
    let payload: { data?: unknown; errorMsg?: string; isSuccess?: boolean } = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new SourceError('返回内容不是合法 JSON', 'parse');
    }
    if (payload.errorMsg) {
      const tokenIssue = payload.errorMsg.includes('令牌');
      throw new SourceError(payload.errorMsg, tokenIssue ? 'auth' : 'http');
    }
    return payload;
  } catch (e) {
    if (e instanceof SourceError) throw e;
    if ((e as Error).name === 'AbortError')
      throw new SourceError('请求超时（源列表可能很大）', 'network');
    throw new SourceError('请求失败，检查与后端的连接', 'network');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 后端是否要求写操作携带访问令牌。
 * - true/false：后端明确答复（LegadoTeam/legado 3.x）
 * - null：后端没有 /getJsSourceApiTokenRequired（HapeLee/legado-with-MD3、更老的 3.0），
 *   这种情况**绝不能**擅自加 x-legado-token：MD3 的 CORS 只放行 content-type，
 *   多一个自定义头会让预检直接失败。此时先不带令牌提交，报令牌错再补。
 */
export async function fetchTokenRequired(base: string): Promise<boolean | null> {
  try {
    const payload = await request(`${base}/getJsSourceApiTokenRequired`);
    return payload.data === true;
  } catch (e) {
    if (e instanceof LegadoError && /没有该接口|404/.test(e.message)) return null;
    return null;
  }
}

/** 令牌校验结果：成功 / 失败及可直接展示的原因 */
export interface TokenCheckResult {
  ok: boolean;
  message: string;
}

/**
 * 唯一的令牌校验实现：书源 / 订阅源管理都由通用验证组件调用。
 *
 * 用无副作用探测：向 /saveBookSource 提交空对象，后端先校验令牌，
 * 通过后只会回「源名称和URL不能为空」，不会真的写库。这里把
 * 「令牌不对 / 接口不存在 / 网络不通」分开，避免把网络故障误报成令牌正确。
 */
export async function checkSourceToken(base: string, token: string): Promise<TokenCheckResult> {
  const value = token.trim();
  if (!value) return { ok: false, message: '请先输入书源访问令牌' };
  try {
    await request(`${base}/saveBookSource`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      token: value,
    });
    return { ok: true, message: '令牌验证通过，已保存在本机' };
  } catch (e) {
    if (!(e instanceof LegadoError)) {
      return { ok: false, message: `无法验证令牌：${(e as Error)?.message ?? '未知错误'}` };
    }
    if (e.kind === 'auth') {
      return { ok: false, message: '令牌不正确或已过期，请核对手机端「书源访问令牌」后重试' };
    }
    // 后端已经放行令牌，只是空对象过不了书源的业务校验
    if (/源名称和URL不能为空|数据不能为空|转换源失败|格式不对/.test(e.message)) {
      return { ok: true, message: '令牌验证通过，已保存在本机' };
    }
    if (/没有该接口|404/.test(e.message)) {
      return { ok: false, message: '这个版本的后端没有提供令牌校验接口，可直接重试搜索' };
    }
    return { ok: false, message: `无法验证令牌：${e.message}` };
  }
}

export async function fetchSources(
  base: string,
  kind: SourceKind,
  signal?: AbortSignal,
): Promise<AnySource[]> {
  const path = kind === 'book' ? '/getBookSources' : '/getRssSources';
  try {
    const payload = await request(`${base}${path}`, { signal });
    return Array.isArray(payload.data) ? (payload.data as AnySource[]) : [];
  } catch (e) {
    // 空列表时后端返回的是 errorMsg「源列表为空」，不算错误
    if (e instanceof LegadoError && /为空|还没有/.test(e.message)) return [];
    throw e;
  }
}

export async function saveSources(
  base: string,
  kind: SourceKind,
  sources: AnySource[],
  token?: string,
): Promise<void> {
  const path = kind === 'book' ? '/saveBookSources' : '/saveRssSources';
  await request(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sources),
    token,
  });
}

export async function saveSource(
  base: string,
  kind: SourceKind,
  source: AnySource,
  token?: string,
): Promise<void> {
  const path = kind === 'book' ? '/saveBookSource' : '/saveRssSource';
  await request(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source),
    token,
  });
}

export async function deleteSources(
  base: string,
  kind: SourceKind,
  sources: AnySource[],
  token?: string,
): Promise<void> {
  const path = kind === 'book' ? '/deleteBookSources' : '/deleteRssSources';
  await request(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sources),
    token,
  });
}

/** 解析导入的 JSON：支持单条、数组、以及 { data: [...] } 包装 */
export function parseSourceJson(text: string): AnySource[] {
  const raw = text.trim();
  if (!raw) throw new Error('内容为空');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON 解析失败：${(e as Error).message}`, { cause: e });
  }
  if (Array.isArray(parsed)) return parsed as AnySource[];
  if (parsed && typeof parsed === 'object') {
    const data = (parsed as { data?: unknown }).data;
    if (Array.isArray(data)) return data as AnySource[];
    return [parsed as AnySource];
  }
  throw new Error('不是合法的书源 / 订阅源 JSON');
}

/** 删除远端书籍：POST /deleteBook，body 是 Book 对象 */
export async function deleteRemoteBook(
  base: string,
  book: Record<string, unknown>,
  token?: string,
): Promise<void> {
  await request(`${base}/deleteBook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(book),
    token,
  });
}
