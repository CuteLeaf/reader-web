import { openDb, requestToPromise, transactionDone } from '../storage/idb.ts';
import type { DictResult } from './types.ts';

/**
 * 线上查词结果的持久化缓存：
 * 同一个词在换书、刷新之后仍然命中，不用反复请求第三方接口。
 *
 * 命中过（有结果）缓存 7 天，未收录也缓存 1 天——否则生僻词每次都重新联网。
 */

const DB = 'reader-dict-cache';
const STORE = 'lookup';
const VERSION = 1;
const TTL_HIT = 7 * 24 * 3600_000;
const TTL_MISS = 24 * 3600_000;

interface CacheRow {
  key: string;
  at: number;
  result: DictResult | null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= openDb(DB, VERSION, (database) => {
    if (!database.objectStoreNames.contains(STORE))
      database.createObjectStore(STORE, { keyPath: 'key' });
  });
  return dbPromise;
}

export interface CacheHit {
  /** 是否命中且未过期 */
  hit: boolean;
  result: DictResult | null;
}

export async function readCache(key: string): Promise<CacheHit> {
  try {
    const store = (await db()).transaction(STORE, 'readonly');
    const row = await requestToPromise<CacheRow | undefined>(store.objectStore(STORE).get(key));
    if (!row) return { hit: false, result: null };

    const ttl = row.result ? TTL_HIT : TTL_MISS;
    if (Date.now() - row.at > ttl) return { hit: false, result: null };
    return { hit: true, result: row.result };
  } catch {
    return { hit: false, result: null };
  }
}

export async function writeCache(key: string, result: DictResult | null): Promise<void> {
  try {
    const store = (await db()).transaction(STORE, 'readwrite');
    store.objectStore(STORE).put({ key, at: Date.now(), result } satisfies CacheRow);
    await transactionDone(store);
  } catch {
    /* 隐私模式或配额不足时忽略，缓存只是加速手段 */
  }
}

export async function clearCache(): Promise<void> {
  const store = (await db()).transaction(STORE, 'readwrite');
  store.objectStore(STORE).clear();
  await transactionDone(store);
}
