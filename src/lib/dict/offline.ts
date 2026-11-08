import { openDb, requestToPromise, transactionDone } from '../storage/idb.ts';
import { definitionLines, parseShard, parseWordShard, type OfflineRow } from './offlineParse.ts';
import type { DictChannel, DictResult } from './types.ts';

/**
 * 离线词典：不打包进构建产物，由用户在设置面板里手动下载到 IndexedDB。
 *
 * 数据源是 npm 包 `zidian` 的词语分片（简体释义，约 26 万条），
 * 下载后查词完全本地，不联网、也不受第三方接口波动影响。
 */

const PKG = 'https://unpkg.com/zidian@0.0.3/dist';
/** 词语：ci/0.json … ci/440.json，441 片，每片约 600 条 */
const CI_COUNT = 441;
/** 汉字：word/0.json … word/538.json，539 片，每片 30 字（共约 1.6 万字） */
const WORD_COUNT = 539;
/** 分片总数，用于下载进度 */
export const SHARD_COUNT = CI_COUNT + WORD_COUNT;
/** 同时下载的分片数：兼顾速度与对 CDN 的礼貌 */
const CONCURRENCY = 5;

const DB = 'reader-dict-offline';
const STORE = 'word';
const META = 'meta';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= openDb(DB, VERSION, (database) => {
    if (!database.objectStoreNames.contains(STORE))
      database.createObjectStore(STORE, { keyPath: 'k' });
    if (!database.objectStoreNames.contains(META)) database.createObjectStore(META);
  });
  return dbPromise;
}

export interface OfflineMeta {
  count: number;
  updatedAt: number;
}

export async function offlineMeta(): Promise<OfflineMeta> {
  try {
    const tx = (await db()).transaction(STORE, 'readonly');
    const count = await requestToPromise<number>(tx.objectStore(STORE).count());
    const metaTx = (await db()).transaction(META, 'readonly');
    const updatedAt =
      (await requestToPromise<number | undefined>(metaTx.objectStore(META).get('updatedAt'))) ?? 0;
    return { count, updatedAt };
  } catch {
    return { count: 0, updatedAt: 0 };
  }
}

async function writeRows(database: IDBDatabase, rows: OfflineRow[]): Promise<void> {
  if (!rows.length) return;
  const tx = database.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const row of rows) store.put(row);
  await transactionDone(tx);
}

export interface DownloadOptions {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** 下载并写入完整的词语库；中途失败会保留已写入的部分 */
export async function downloadOffline(options: DownloadOptions = {}): Promise<number> {
  const { onProgress, signal } = options;
  const database = await db();

  // 重新下载时清空旧数据，避免残留不完整的版本
  const clearTx = database.transaction(STORE, 'readwrite');
  clearTx.objectStore(STORE).clear();
  await transactionDone(clearTx);

  // 先下载词语，再下载汉字：两者都进同一张表，查询时不用关心来源
  const shards: { url: string; parse: (raw: string) => OfflineRow[]; label: string }[] = [
    ...Array.from({ length: CI_COUNT }, (_, i) => ({
      url: `${PKG}/ci/${i}.json`,
      parse: parseShard,
      label: `ci/${i}`,
    })),
    ...Array.from({ length: WORD_COUNT }, (_, i) => ({
      url: `${PKG}/word/${i}.json`,
      parse: parseWordShard,
      label: `word/${i}`,
    })),
  ];
  let done = 0;
  let written = 0;

  for (let start = 0; start < shards.length; start += CONCURRENCY) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const batch = shards.slice(start, start + CONCURRENCY);
    const rows = (
      await Promise.all(
        batch.map(async (shard) => {
          const res = await fetch(shard.url, { signal });
          if (!res.ok) throw new Error(`${shard.label} 下载失败（${res.status}）`);
          return shard.parse(await res.text());
        }),
      )
    ).flat();

    await writeRows(database, rows);
    written += rows.length;
    done += batch.length;
    onProgress?.(done, shards.length);
  }

  const metaTx = database.transaction(META, 'readwrite');
  metaTx.objectStore(META).put(Date.now(), 'updatedAt');
  await transactionDone(metaTx);

  return written;
}

export async function clearOffline(): Promise<void> {
  const database = await db();
  const tx = database.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await transactionDone(tx);
  const metaTx = database.transaction(META, 'readwrite');
  metaTx.objectStore(META).clear();
  await transactionDone(metaTx);
}

async function getWord(term: string): Promise<OfflineRow | undefined> {
  const tx = (await db()).transaction(STORE, 'readonly');
  return requestToPromise<OfflineRow | undefined>(tx.objectStore(STORE).get(term));
}

export async function lookupOffline(term: string): Promise<DictResult | null> {
  const row = await getWord(term.trim());
  if (!row) return null;
  const lines = definitionLines(row.d);
  if (!lines.length) return null;

  return {
    term: row.k,
    channelId: 'offline',
    source: '离线词典',
    phonetic: row.p,
    url: '',
    blocks: [{ heading: '', lines }],
  };
}

export const offlineChannel: DictChannel = {
  id: 'offline',
  label: '离线词典',
  langs: ['zh'],
  cors: 'open',
  lookup: lookupOffline,
};
