/**
 * 局域网扫描：浏览器里没有 ARP / UDP，能用的只有「大量并发 HTTP 探测」。
 *
 * 策略：
 *  1. 网段来源优先级：页面自身地址（用 http://192.168.31.5:4173 打开时可直接取前三段）
 *     > WebRTC host candidate（Chrome 常返回 mDNS 名，拿不到就交给用户手填）
 *  2. probeHost()：先 no-cors 探活（不受 CORS 限制，能判断端口是否有人监听），再 cors 拉 /getBookshelf 确认是阅读后端
 *  3. scan()：受限并发（默认 32）+ 单点超时（默认 700ms），边扫边回调，UI 实时出结果
 *     quick 模式只探常见主机位（快但会漏），调用方应在无结果时自动升级为全段扫描
 *
 * 注意：页面为 HTTPS 时浏览器会拦掉所有 http:// 请求（混合内容），此时扫描必然全灭，需要 http 访问或反代。
 */
import { describeError, probeEndpoint } from './legado';

export interface ScanCandidate {
  base: string;
  latency: number;
  bookCount: number;
  titles: string[];
  cors: 'ok' | 'blocked' | 'unknown';
}

export interface ScanOptions {
  /** "192.168.1" 形式；为空则用 subnetFromLocation / WebRTC 推断 */
  prefix?: string | null;
  /** 一次扫多个网段（浏览器拿不到本机 IP 时的兜底：把常见网段全试一遍） */
  prefixes?: string[];
  /** 端口列表，Legado 3.0 默认 1122 */
  ports?: number[];
  /** 单点超时 ms（默认：单台 3000 / 网段 1500） */
  timeout?: number;
  /** 并发数 */
  concurrency?: number;
  /** 快速模式：只探常见主机位 */
  quick?: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  onFound?: (c: ScanCandidate) => void;
}

const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

export function isPrivateIPv4(ip: string): boolean {
  return PRIVATE.some((re) => re.test(ip));
}

/** 页面本身就是用内网 IP 打开的（如 http://192.168.31.5:4173），直接取前三段，比 WebRTC 可靠 */
export function subnetFromLocation(): string | null {
  if (typeof location === 'undefined') return null;
  const host = location.hostname;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
  if (host.startsWith('127.') || !isPrivateIPv4(host)) return null;
  return host.split('.').slice(0, 3).join('.');
}

export type ScanTarget = { kind: 'subnet'; prefix: string } | { kind: 'host'; host: string };

/**
 * 解析用户输入：
 *  - "192.168.31"    -> 扫该 /24 网段
 *  - "192.168.31.7"  -> 只扫这一台（知道手机 IP 时最快）
 *  - "http://192.168.31.7:1122" -> 只扫这一台
 */
export function parseTarget(input: string): ScanTarget | null {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
  if (!cleaned) return null;
  const parts = cleaned.split('.');
  if (parts.some((p) => !/^\d{1,3}$/.test(p)) || parts.some((p) => Number(p) > 255)) return null;
  if (parts.length === 3) return { kind: 'subnet', prefix: parts.join('.') };
  if (parts.length === 4) return { kind: 'host', host: parts.join('.') };
  return null;
}

/** 通过 WebRTC host candidate 猜测本机网段（返回 "a.b.c"） */
export function guessLocalSubnet(timeout = 1600): Promise<string | null> {
  return new Promise((resolve) => {
    const RTC = (window as unknown as { RTCPeerConnection?: typeof RTCPeerConnection })
      .RTCPeerConnection;
    if (!RTC) return resolve(null);
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      resolve(value);
    };

    const pc = new RTC({ iceServers: [] });
    try {
      pc.createDataChannel('probe');
      pc.onicecandidate = (ev) => {
        const line = ev.candidate?.candidate;
        if (!line) {
          if (!ev.candidate) finish(null);
          return;
        }
        const m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(line);
        if (m && isPrivateIPv4(m[1]) && m[1] !== '127.0.0.1') {
          finish(m[1].split('.').slice(0, 3).join('.'));
        }
      };
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => finish(null));
    } catch {
      finish(null);
    }
    setTimeout(() => finish(null), timeout);
  });
}

async function livenessProbe(url: string, timeout: number, signal?: AbortSignal): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await fetch(url, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: ctrl.signal,
      credentials: 'omit',
    });
    // 拿到响应头就够判断「这个端口有人」，立刻中断，避免把几 MB 的书架 JSON 拖下来
    ctrl.abort();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** 探测单个 host:port */
export async function probeHost(
  host: string,
  port: number,
  timeout = 700,
  signal?: AbortSignal,
): Promise<ScanCandidate | null> {
  const base = `http://${host}:${port}`;
  // 用根路径探活：Legado 3.0 的 / 是 2KB 导航页，比 /getBookshelf（实测 2.2MB）便宜两个数量级
  const alive = await livenessProbe(`${base}/`, timeout, signal);
  if (!alive) return null;

  try {
    // 探活已经筛掉了没人的地址，这里只剩少量候选，确认阶段可以等久一点
    // （书架几千本时 /getBookshelf 本身就有几 MB，1~2 秒很正常）
    const info = await probeEndpoint(base, Math.max(timeout, 8000));
    return {
      base: info.base,
      latency: info.latency,
      bookCount: info.bookCount,
      titles: info.titles,
      cors: 'ok',
    };
  } catch (e) {
    // 端口有人监听但读不到数据：多半是 CORS 未放开，仍然列出来并给出提示
    return {
      base,
      latency: -1,
      bookCount: -1,
      titles: [describeError(e)],
      cors: 'blocked',
    };
  }
}

const QUICK_HOSTS = [1, 2, 3, 100, 101, 102, 103, 104, 105, 106, 107, 110, 120, 150, 200, 254];

export async function scan(opts: ScanOptions = {}): Promise<ScanCandidate[]> {
  if (typeof location !== 'undefined' && location.protocol === 'https:') {
    throw new Error(
      '当前是 HTTPS 页面，浏览器禁止访问局域网 http 服务，扫描会被全部拦截。请用 http 打开本站，或给后端配置 HTTPS 反向代理。',
    );
  }

  const target = opts.prefix ? parseTarget(opts.prefix) : null;
  if (opts.prefix && !target) {
    throw new Error(`网段格式不对：${opts.prefix}，应形如 192.168.1 或 192.168.1.23`);
  }

  const ports = opts.ports?.length ? opts.ports : [1122];
  // 单台主机可以等久一点；扫全网段则要短，否则 254 个点会拖到十几秒
  const timeout = opts.timeout ?? (target?.kind === 'host' ? 3000 : 1500);
  const concurrency = opts.concurrency ?? (opts.prefixes?.length ? 80 : 48);

  let hosts: string[];
  if (target?.kind === 'host') {
    // 用户直接给了具体 IP，不再展开
    hosts = [target.host];
  } else {
    let prefixes: string[] = [];
    if (opts.prefixes?.length) {
      prefixes = opts.prefixes
        .map((p) => parseTarget(p))
        .map((t) => (t?.kind === 'subnet' ? t.prefix : null))
        .filter((p): p is string => !!p);
    } else {
      const one =
        target?.kind === 'subnet'
          ? target.prefix
          : subnetFromLocation() || (await guessLocalSubnet());
      if (one) prefixes = [one];
    }
    if (!prefixes.length) throw new Error('未能自动识别网段，请手动填写，例如 192.168.1');

    const expand = (prefix: string): string[] =>
      opts.quick
        ? QUICK_HOSTS.map((n) => `${prefix}.${n}`)
        : Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
    hosts = prefixes.flatMap(expand);
  }

  const queue: Array<{ host: string; port: number }> = [];
  for (const host of hosts) for (const port of ports) queue.push({ host, port });

  const total = queue.length;
  let done = 0;
  const found: ScanCandidate[] = [];
  const seen = new Set<string>();

  const worker = async () => {
    for (;;) {
      if (opts.signal?.aborted) return;
      const task = queue.shift();
      if (!task) return;
      try {
        const hit = await probeHost(task.host, task.port, timeout, opts.signal);
        if (hit && !seen.has(hit.base)) {
          seen.add(hit.base);
          found.push(hit);
          found.sort((a, b) =>
            a.cors === b.cors ? a.latency - b.latency : a.cors === 'ok' ? -1 : 1,
          );
          opts.onFound?.(hit);
        }
      } catch {
        /* 单点失败不影响整体 */
      } finally {
        done += 1;
        if (done % 4 === 0 || done === total) opts.onProgress?.(done, total);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  opts.onProgress?.(total, total);
  return found;
}
