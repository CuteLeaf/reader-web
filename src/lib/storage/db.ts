/**
 * 极简 IndexedDB 封装（无第三方依赖）。
 *
 * 设计要点：
 *  - books    书架元数据，keyPath=id；按 durChapterTime 建索引，方便「最近阅读」排序
 *  - chapters 章节目录，复合主键 [bookId, index]；TXT 只存标题与字符偏移，不存正文
 *  - texts    正文整串（TXT 用偏移切片，EPUB 用 href 取章）
 *  - files    原始文件 Blob，用于「导出/重解析」，不参与阅读主流程
 *  - kv       杂项（订阅的后端地址、每本书的阅读进度、设置备份）
 */
import type { Book, Chapter } from '../types';

const DB_NAME = 'reader-web';
const DB_VERSION = 2;

export const STORE = {
  books: 'books',
  chapters: 'chapters',
  texts: 'texts',
  files: 'files',
  kv: 'kv',
  fonts: 'fonts',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE.books)) {
        const books = db.createObjectStore(STORE.books, { keyPath: 'id' });
        books.createIndex('byTime', 'durChapterTime');
      }
      if (!db.objectStoreNames.contains(STORE.chapters)) {
        const chapters = db.createObjectStore(STORE.chapters, { keyPath: ['bookId', 'index'] });
        chapters.createIndex('byBook', 'bookId');
      }
      if (!db.objectStoreNames.contains(STORE.texts)) {
        db.createObjectStore(STORE.texts, { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains(STORE.files)) {
        db.createObjectStore(STORE.files, { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains(STORE.kv)) {
        db.createObjectStore(STORE.kv, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE.fonts)) {
        db.createObjectStore(STORE.fonts, { keyPath: 'id' });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('数据库被其他标签页占用，请关闭后重试'));
  });
  return dbPromise;
}

/* ----------------------------- books ----------------------------- */

export async function listBooks(): Promise<Book[]> {
  const db = await openDb();
  const rows = await req(
    db.transaction(STORE.books, 'readonly').objectStore(STORE.books).getAll() as IDBRequest<Book[]>,
  );
  return rows.sort(
    (a, b) => (b.durChapterTime ?? b.addedAt ?? 0) - (a.durChapterTime ?? a.addedAt ?? 0),
  );
}

export async function getBook(id: string): Promise<Book | undefined> {
  const db = await openDb();
  return req(
    db.transaction(STORE.books, 'readonly').objectStore(STORE.books).get(id) as IDBRequest<Book>,
  );
}

export async function putBook(book: Book): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE.books, 'readwrite');
  tx.objectStore(STORE.books).put(book);
  await txDone(tx);
}

export async function patchBook(id: string, patch: Partial<Book>): Promise<Book | undefined> {
  const current = await getBook(id);
  if (!current) return undefined;
  const next = { ...current, ...patch, id };
  await putBook(next);
  return next;
}

/** 删除书籍及其目录、正文、原始文件 */
export async function deleteBook(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE.books, STORE.chapters, STORE.texts, STORE.files], 'readwrite');
  tx.objectStore(STORE.books).delete(id);
  tx.objectStore(STORE.texts).delete(id);
  tx.objectStore(STORE.files).delete(id);
  const idx = tx.objectStore(STORE.chapters).index('byBook');
  const keys = await req(idx.getAllKeys(IDBKeyRange.only(id)));
  for (const key of keys) tx.objectStore(STORE.chapters).delete(key);
  await txDone(tx);
}

/* --------------------------- chapters --------------------------- */

type StoredChapter = Chapter & { bookId: string };

export async function getChapters(bookId: string): Promise<Chapter[]> {
  const db = await openDb();
  const idx = db
    .transaction(STORE.chapters, 'readonly')
    .objectStore(STORE.chapters)
    .index('byBook');
  const rows = await req(idx.getAll(IDBKeyRange.only(bookId)) as IDBRequest<StoredChapter[]>);
  return rows.sort((a, b) => a.index - b.index).map(({ bookId: _drop, ...c }) => c);
}

export async function putChapters(bookId: string, chapters: Chapter[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE.chapters, 'readwrite');
  const store = tx.objectStore(STORE.chapters);
  // 先清空旧目录，避免改版后残留
  const keys = await req(store.index('byBook').getAllKeys(IDBKeyRange.only(bookId)));
  for (const key of keys) store.delete(key);
  for (const c of chapters) store.put({ ...c, bookId });
  await txDone(tx);
}

/* ----------------------------- texts ---------------------------- */

export async function getText(bookId: string): Promise<string | undefined> {
  const db = await openDb();
  const row = await req(
    db.transaction(STORE.texts, 'readonly').objectStore(STORE.texts).get(bookId) as IDBRequest<
      { text: string } | undefined
    >,
  );
  return row?.text;
}

export async function putText(bookId: string, text: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE.texts, 'readwrite');
  tx.objectStore(STORE.texts).put({ bookId, text });
  await txDone(tx);
}

/* ----------------------------- files ---------------------------- */

export async function putFile(
  bookId: string,
  blob: Blob,
  meta?: { name?: string; type?: string },
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE.files, 'readwrite');
  tx.objectStore(STORE.files).put({ bookId, blob, ...meta });
  await txDone(tx);
}

export async function getFile(bookId: string): Promise<Blob | undefined> {
  const db = await openDb();
  const row = await req(
    db.transaction(STORE.files, 'readonly').objectStore(STORE.files).get(bookId) as IDBRequest<
      { blob: Blob } | undefined
    >,
  );
  return row?.blob;
}

/* ------------------------------ kv ------------------------------ */

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const row = await req(
    db.transaction(STORE.kv, 'readonly').objectStore(STORE.kv).get(key) as IDBRequest<
      { value: T } | undefined
    >,
  );
  return row?.value;
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE.kv, 'readwrite');
  tx.objectStore(STORE.kv).put({ key, value });
  await txDone(tx);
}

export async function kvDel(key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE.kv, 'readwrite');
  tx.objectStore(STORE.kv).delete(key);
  await txDone(tx);
}

/** 估算已用空间（部分浏览器不支持，返回 undefined） */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | undefined> {
  if (!navigator.storage?.estimate) return undefined;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

/* ----------------------------- fonts ---------------------------- */

export interface StoredFont {
  id: string;
  /** 用户看到的名字（通常是文件名） */
  name: string;
  /** 注册到 document.fonts 的族名 */
  family: string;
  size: number;
  createdAt: number;
  data: ArrayBuffer;
}

export async function listFonts(): Promise<StoredFont[]> {
  const db = await openDb();
  const rows = await req(
    db.transaction(STORE.fonts, 'readonly').objectStore(STORE.fonts).getAll() as IDBRequest<
      StoredFont[]
    >,
  );
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putFont(font: StoredFont): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE.fonts, 'readwrite');
  tx.objectStore(STORE.fonts).put(font);
  await txDone(tx);
}

export async function deleteFont(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE.fonts, 'readwrite');
  tx.objectStore(STORE.fonts).delete(id);
  await txDone(tx);
}
