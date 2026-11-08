/**
 * 应用本地业务数据的统一管理入口。
 *
 * 覆盖范围：轻量业务数据（阅读设置、书架筛选、上次连接的后端、书源令牌，
 * 以及后端地址 / 阅读进度这类可增删的记录）集中存成一份带版本的快照；
 * 书籍正文、原始文件、字体、词典词库等大体积内容仍由 IndexedDB 各自管理，
 * 见 LOCAL_DATA_SCOPES。这样既有单一真源，也不会把几十 MB 的正文塞进 localStorage。
 *
 * 设计要点：
 *  - 内存快照 + 显式 save()/reload()：改动先落内存，保存才写盘；重新加载丢弃未保存改动
 *  - 读盘时统一做规范化：坏 JSON、缺字段、旧版本、旧的散落 key 都能安全恢复
 *  - storage 可注入：隐私模式 / 单元测试 / 浏览器扩展都能用同一套逻辑
 */
import type { Book, ReaderSettings } from '../types.ts';
import { listBooks, listFonts } from './db.ts';

/** 版本化 key：结构变更时递增 LOCAL_DATA_VERSION 并在 normalizeSnapshot 里补迁移 */
export const LOCAL_DATA_KEY = 'reader:local-data:v1';
export const LOCAL_DATA_VERSION = 1;

/** 本地数据职责清单，便于排查「哪类数据存在哪里」 */
export const LOCAL_DATA_SCOPES = [
  { scope: '阅读设置 / 书架筛选 / 后端地址 / 书源令牌', store: 'localStorage', owner: 'localData' },
  { scope: '本地书籍 / 目录 / 正文 / 原始文件', store: 'IndexedDB', owner: 'db' },
  { scope: '阅读进度备份', store: 'IndexedDB kv', owner: 'db' },
  { scope: '自定义字体', store: 'IndexedDB', owner: 'fonts' },
  { scope: '词典查询缓存 / 离线词库', store: 'IndexedDB', owner: 'dict' },
] as const;

export type ShelfFilter = 'all' | 'local' | 'remote';

/** 只依赖 getCurrent 的三个方法，便于替换为内存实现或隐私模式下的兜底 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type LocalDataErrorCode = 'invalid' | 'duplicate' | 'not-found' | 'write';

export class LocalDataError extends Error {
  code: LocalDataErrorCode;

  constructor(code: LocalDataErrorCode, message: string) {
    super(message);
    this.name = 'LocalDataError';
    this.code = code;
  }
}

/* --------------------------- 数据结构 --------------------------- */

/** 所有可增删记录的公共字段 */
export interface LocalRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
}

/** 记住 / 手动添加的局域网后端 */
export interface EndpointRecord extends LocalRecord {
  base: string;
  label?: string;
  lastUsedAt?: number;
}

/** 每个后端一个书源访问令牌，base 即业务唯一键 */
export interface TokenRecord extends LocalRecord {
  base: string;
  token: string;
}

/** 阅读进度的轻量记录（正文等大数据仍在 IndexedDB） */
export interface ProgressRecord extends LocalRecord {
  bookId: string;
  index: number;
  pos: number;
  title?: string;
  time?: number;
}

export interface CollectionMap {
  endpoints: EndpointRecord;
  tokens: TokenRecord;
  progress: ProgressRecord;
}

export type CollectionKey = keyof CollectionMap;

/** 单值偏好：不参与记录的增删改，用 setPreferences 整体打补丁 */
export interface LocalPreferences {
  settings: Partial<ReaderSettings>;
  /** 上次成功连接的后端，空串表示没有 */
  endpoint: string;
  filter: ShelfFilter;
  /** 默认主题从纯白改米黄的一次性迁移标记 */
  themeMigrated: boolean;
}

/** 落盘快照 */
export interface LocalDataSnapshot {
  version: number;
  updatedAt: number;
  preferences: LocalPreferences;
  endpoints: EndpointRecord[];
  tokens: TokenRecord[];
  progress: ProgressRecord[];
}

export type NewRecord<K extends CollectionKey> = Omit<CollectionMap[K], keyof LocalRecord> & {
  id?: string;
};

/* --------------------------- 工具函数 --------------------------- */

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function finiteTime(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback;
}

function nonNegative(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function defaultId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* 非安全上下文下 crypto 可能不可用 */
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 没有 localStorage 时（Node / 隐私模式）退化为进程内存储，保证模块始终可用 */
export function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function browserStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {
    /* 禁用存储时属性访问本身就会抛 */
  }
  return memoryStorage();
}

function emptyPreferences(): LocalPreferences {
  return { settings: {}, endpoint: '', filter: 'all', themeMigrated: false };
}

function emptySnapshot(at: number): LocalDataSnapshot {
  return {
    version: LOCAL_DATA_VERSION,
    updatedAt: at,
    preferences: emptyPreferences(),
    endpoints: [],
    tokens: [],
    progress: [],
  };
}

/** 偏好里的值只接受标量，挡掉 null / 嵌套对象 / NaN 这类会污染设置的无效输入 */
function normalizePreferences(v: unknown): LocalPreferences {
  const base = emptyPreferences();
  if (!isObject(v)) return base;
  const settings: Record<string, unknown> = {};
  if (isObject(v.settings)) {
    for (const [key, value] of Object.entries(v.settings)) {
      if (typeof value === 'boolean' || typeof value === 'string') settings[key] = value;
      else if (typeof value === 'number' && Number.isFinite(value)) settings[key] = value;
    }
  }
  return {
    settings: settings as Partial<ReaderSettings>,
    endpoint: typeof v.endpoint === 'string' ? v.endpoint : '',
    filter: v.filter === 'local' || v.filter === 'remote' ? v.filter : 'all',
    themeMigrated: v.themeMigrated === true,
  };
}

/** 业务唯一键：同一个后端 / 同一本书只允许一条记录 */
function uniqueKey(key: CollectionKey, row: Record<string, unknown>): string | null {
  if (key === 'endpoints' || key === 'tokens') {
    return `base:${typeof row.base === 'string' ? row.base.trim() : ''}`;
  }
  if (key === 'progress') {
    return `book:${typeof row.bookId === 'string' ? row.bookId.trim() : ''}`;
  }
  return null;
}

function validateRecord(key: CollectionKey, row: Record<string, unknown>): void {
  if (key === 'endpoints' || key === 'tokens') {
    if (typeof row.base !== 'string' || !row.base.trim()) {
      throw new LocalDataError('invalid', '后端地址不能为空');
    }
  }
  if (key === 'tokens' && (typeof row.token !== 'string' || !row.token.trim())) {
    throw new LocalDataError('invalid', '令牌不能为空');
  }
  if (key === 'endpoints' && row.label !== undefined && typeof row.label !== 'string') {
    throw new LocalDataError('invalid', '后端备注必须是文字');
  }
  if (key === 'progress') {
    if (typeof row.bookId !== 'string' || !row.bookId.trim()) {
      throw new LocalDataError('invalid', '书籍 id 不能为空');
    }
    if (!nonNegative(row.index) || !nonNegative(row.pos)) {
      throw new LocalDataError('invalid', '章节序号与位置必须是非负数字');
    }
    if (row.title !== undefined && typeof row.title !== 'string') {
      throw new LocalDataError('invalid', '章节标题必须是文字');
    }
  }
}

interface Context {
  now: () => number;
  id: () => string;
}

function normalizeRows<K extends CollectionKey>(
  key: K,
  value: unknown,
  ctx: Context,
): CollectionMap[K][] {
  if (!Array.isArray(value)) return [];
  const at = ctx.now();
  const out: LocalRecord[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  for (const item of value) {
    if (!isObject(item)) continue;
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : ctx.id();
    if (seenIds.has(id)) continue;
    const createdAt = finiteTime(item.createdAt, at);
    const row = {
      ...item,
      id,
      createdAt,
      updatedAt: finiteTime(item.updatedAt, createdAt),
    } as Record<string, unknown>;
    try {
      validateRecord(key, row);
    } catch {
      // 坏记录直接跳过，不能让一条脏数据把整个本地库带崩
      continue;
    }
    const uk = uniqueKey(key, row);
    if (uk) {
      if (seenKeys.has(uk)) continue;
      seenKeys.add(uk);
    }
    seenIds.add(id);
    out.push(row as unknown as LocalRecord);
  }
  return out as unknown as CollectionMap[K][];
}

/**
 * 把任意来源的数据规范成当前版本快照：兼容缺字段、旧版本号、类型不对的旧存档。
 * degraded 表示数据被修复过，调用方可据此提示用户。
 */
export function normalizeSnapshot(
  raw: unknown,
  ctx: Context = { now: () => Date.now(), id: defaultId },
): { snapshot: LocalDataSnapshot; degraded: boolean } {
  if (!isObject(raw)) return { snapshot: emptySnapshot(ctx.now()), degraded: true };
  const version = typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : 0;
  // 比当前还新的版本不能猜，按空数据处理，避免把未来结构读坏
  if (version > LOCAL_DATA_VERSION) {
    return { snapshot: emptySnapshot(ctx.now()), degraded: true };
  }
  const snapshot: LocalDataSnapshot = {
    version: LOCAL_DATA_VERSION,
    updatedAt: finiteTime(raw.updatedAt, ctx.now()),
    preferences: normalizePreferences(raw.preferences),
    endpoints: normalizeRows('endpoints', raw.endpoints, ctx),
    tokens: normalizeRows('tokens', raw.tokens, ctx),
    progress: normalizeRows('progress', raw.progress, ctx),
  };
  return { snapshot, degraded: version < LOCAL_DATA_VERSION };
}

const LEGACY_KEYS = {
  settings: 'reader:settings:v2',
  endpoint: 'reader:endpoint',
  filter: 'reader:shelf-filter',
  tokens: 'reader:sourceTokens',
  token: 'reader:sourceToken',
  themeMigrated: 'reader:theme-migrated:beige',
} as const;

/* ----------------------------- 管理器 ----------------------------- */

export interface LocalDataManagerOptions {
  storage?: StorageLike;
  now?: () => number;
  id?: () => string;
}

export class LocalDataManager {
  private storage: StorageLike;
  private snapshot: LocalDataSnapshot;
  private readonly now: () => number;
  private readonly id: () => string;
  private dirty = false;
  private degraded = false;

  constructor(options: LocalDataManagerOptions = {}) {
    this.storage = options.storage ?? browserStorage();
    this.now = options.now ?? (() => Date.now());
    this.id = options.id ?? defaultId;
    this.snapshot = this.read();
  }

  private get ctx(): Context {
    return { now: this.now, id: this.id };
  }

  private legacyValue(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  /** 从旧版散落的 key 合成第一份快照；旧 key 保留不删，方便用户回退旧版本 */
  private fromLegacy(): LocalDataSnapshot | null {
    const values = Object.values(LEGACY_KEYS).map((key) => this.legacyValue(key));
    if (!values.some((v) => v !== null && v !== '')) return null;

    const snap = emptySnapshot(this.now());
    const rawSettings = this.legacyValue(LEGACY_KEYS.settings);
    if (rawSettings) {
      try {
        snap.preferences = normalizePreferences({ settings: JSON.parse(rawSettings) });
      } catch {
        /* 旧设置坏了就留默认值 */
      }
    }
    snap.preferences.endpoint = this.legacyValue(LEGACY_KEYS.endpoint) ?? '';
    const filter = this.legacyValue(LEGACY_KEYS.filter);
    snap.preferences.filter = filter === 'local' || filter === 'remote' ? filter : 'all';
    snap.preferences.themeMigrated = this.legacyValue(LEGACY_KEYS.themeMigrated) !== null;

    const rawTokens = this.legacyValue(LEGACY_KEYS.tokens);
    const at = this.now();
    let tokens: Record<string, string> = {};
    if (rawTokens) {
      try {
        const parsed = JSON.parse(rawTokens) as unknown;
        if (isObject(parsed)) {
          for (const [base, token] of Object.entries(parsed)) {
            if (base.trim() && typeof token === 'string' && token.trim()) tokens[base] = token;
          }
        }
      } catch {
        /* 旧令牌坏了当作没有 */
      }
    }
    const legacyToken = this.legacyValue(LEGACY_KEYS.token);
    if (!Object.keys(tokens).length && legacyToken) tokens = { __legacy: legacyToken };
    snap.tokens = Object.entries(tokens).map(([base, token]) => ({
      id: base,
      base,
      token,
      createdAt: at,
      updatedAt: at,
    }));
    return snap;
  }

  private read(): LocalDataSnapshot {
    // undefined 表示读盘就失败了，与「没有这份数据」(null) 区分开
    let raw: string | null | undefined;
    try {
      raw = this.storage.getItem(LOCAL_DATA_KEY);
    } catch {
      this.degraded = true;
    }
    if (raw === undefined) return emptySnapshot(this.now());

    let parsed: unknown = null;
    if (raw !== null && raw.trim() !== '') {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        parsed = null;
        this.degraded = true;
      }
    }
    const legacy = this.fromLegacy();
    const result = parsed === null ? null : normalizeSnapshot(parsed, this.ctx);
    const snapshot = result?.snapshot ?? legacy ?? emptySnapshot(this.now());
    // 全新用户（既没有新快照也没有旧 key）是「空数据」，不算降级
    this.degraded = this.degraded || result?.degraded === true;

    // 迁移 / 修复的结果立刻落盘，下次启动就是干净结构；写失败不影响本次启动
    if (legacy && !result) {
      try {
        this.snapshot = snapshot;
        this.save();
      } catch {
        this.degraded = true;
      }
    }
    return snapshot;
  }

  /** 保存内存改动到磁盘；写失败抛 LocalDataError，由调用方决定提示还是静默降级 */
  save(): void {
    this.snapshot.updatedAt = this.now();
    try {
      this.storage.setItem(LOCAL_DATA_KEY, JSON.stringify(this.snapshot));
      this.dirty = false;
    } catch (e) {
      throw new LocalDataError('write', `本地数据写入失败：${(e as Error).message}`);
    }
  }

  /** 重新加载：以磁盘为准，丢弃所有未保存的改动 */
  reload(): LocalDataSnapshot {
    this.degraded = false;
    this.snapshot = this.read();
    this.dirty = false;
    return this.view();
  }

  /** 查看完整快照（深拷贝，改返回值不会影响内部状态） */
  view(): LocalDataSnapshot {
    return JSON.parse(JSON.stringify(this.snapshot)) as LocalDataSnapshot;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  /** 读盘时是否发生过降级（坏 JSON / 旧版本 / 无存储权限） */
  get isDegraded(): boolean {
    return this.degraded;
  }

  private rows<K extends CollectionKey>(key: K): CollectionMap[K][] {
    return this.snapshot[key] as unknown as CollectionMap[K][];
  }

  private assertNoDuplicate(
    key: CollectionKey,
    row: Record<string, unknown>,
    exceptId?: string,
  ): void {
    const existing = this.rows(key) as unknown as Array<Record<string, unknown> & LocalRecord>;
    // 编辑时自己那条的 id 相同是正常情况，只排除它即可
    if (existing.some((r) => r.id === row.id && r.id !== exceptId)) {
      throw new LocalDataError('duplicate', '记录 id 已存在');
    }
    const uk = uniqueKey(key, row);
    if (uk && existing.some((r) => r.id !== exceptId && uniqueKey(key, r) === uk)) {
      throw new LocalDataError('duplicate', '已存在相同的业务记录');
    }
  }

  /** 查看某类记录（按创建时间排序，返回副本） */
  list<K extends CollectionKey>(key: K): CollectionMap[K][] {
    return (this.rows(key) as Array<CollectionMap[K] & LocalRecord>)
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((row) => ({ ...row }));
  }

  get<K extends CollectionKey>(key: K, id: string): CollectionMap[K] | undefined {
    const row = this.rows(key).find((r) => r.id === id);
    return row ? { ...row } : undefined;
  }

  /** 新增一条记录：校验必填、生成 id 与时间戳、挡住重复 */
  create<K extends CollectionKey>(key: K, input: NewRecord<K>): CollectionMap[K] {
    const data = { ...input } as Record<string, unknown>;
    const at = this.now();
    const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : this.id();
    const row = { ...data, id, createdAt: at, updatedAt: at };
    validateRecord(key, row);
    this.assertNoDuplicate(key, row);
    (this.rows(key) as unknown as LocalRecord[]).push(row as unknown as LocalRecord);
    this.dirty = true;
    return { ...row } as unknown as CollectionMap[K];
  }

  /** 编辑记录：id / createdAt 不可改，业务唯一键仍要过重复校验 */
  update<K extends CollectionKey>(
    key: K,
    id: string,
    patch: Partial<NewRecord<K>>,
  ): CollectionMap[K] {
    const rows = this.rows(key) as unknown as Array<Record<string, unknown> & LocalRecord>;
    const index = rows.findIndex((r) => r.id === id);
    if (index < 0) throw new LocalDataError('not-found', '记录不存在');
    const next = {
      ...rows[index],
      ...(patch as Record<string, unknown>),
      id,
      createdAt: rows[index].createdAt,
      updatedAt: this.now(),
    };
    validateRecord(key, next);
    this.assertNoDuplicate(key, next, id);
    rows[index] = next;
    this.dirty = true;
    return { ...next } as unknown as CollectionMap[K];
  }

  /** 删除记录，不存在时返回 false（不抛错，便于批量清理） */
  remove<K extends CollectionKey>(key: K, id: string): boolean {
    const rows = this.rows(key) as unknown as LocalRecord[];
    const index = rows.findIndex((r) => r.id === id);
    if (index < 0) return false;
    rows.splice(index, 1);
    this.dirty = true;
    return true;
  }

  clear<K extends CollectionKey>(key: K): void {
    (this.snapshot[key] as unknown as LocalRecord[]).length = 0;
    this.dirty = true;
  }

  getPreferences(): LocalPreferences {
    const p = this.snapshot.preferences;
    return { ...p, settings: { ...p.settings } };
  }

  setPreferences(patch: Partial<LocalPreferences>): LocalPreferences {
    const merged = normalizePreferences({ ...this.snapshot.preferences, ...patch });
    this.snapshot.preferences = merged;
    this.dirty = true;
    return this.getPreferences();
  }

  /**
   * 记住一个成功连接过的后端，供连接窗口与本地数据面板共用同一份记录。
   * 按规范化后的地址去重：已有记录只更新 lastUsedAt，用户写的备注不会被覆盖。
   */
  rememberEndpoint(base: string, label?: string): EndpointRecord {
    const key = base.trim();
    if (!key) throw new LocalDataError('invalid', '后端地址不能为空');
    const at = this.now();
    const found = this.list('endpoints').find((r) => r.base === key);
    let row: EndpointRecord;
    if (found) {
      const patch: Partial<NewRecord<'endpoints'>> = { lastUsedAt: at };
      if (label && !found.label) patch.label = label;
      row = this.update('endpoints', found.id, patch);
    } else {
      row = this.create('endpoints', {
        base: key,
        ...(label ? { label } : {}),
        lastUsedAt: at,
      });
    }
    this.save();
    return row;
  }

  /** 令牌的便捷读写，供 store 使用（保持原来 { [base]: token } 的语义） */
  tokenMap(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const row of this.list('tokens')) out[row.base] = row.token;
    return out;
  }

  setToken(base: string, value: string): void {
    const key = base.trim();
    if (!key) throw new LocalDataError('invalid', '后端地址不能为空');
    const token = value.trim();
    const found = this.list('tokens').find((r) => r.base === key);
    if (!token) {
      if (found) this.remove('tokens', found.id);
    } else if (found) {
      this.update('tokens', found.id, { token });
    } else {
      this.create('tokens', { id: key, base: key, token } as NewRecord<'tokens'>);
    }
    this.save();
  }

  /** 备份：导出当前快照 JSON */
  snapshotJSON(): string {
    return JSON.stringify(this.snapshot);
  }

  /** 恢复：校验并规范化外部数据后写盘，未来版本拒绝导入 */
  restore(raw: string): LocalDataSnapshot {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new LocalDataError('invalid', '备份内容不是合法 JSON');
    }
    if (
      isObject(parsed) &&
      typeof parsed.version === 'number' &&
      parsed.version > LOCAL_DATA_VERSION
    ) {
      throw new LocalDataError('invalid', '备份来自更新版本，无法在当前应用恢复');
    }
    const { snapshot } = normalizeSnapshot(parsed, this.ctx);
    this.snapshot = snapshot;
    this.save();
    return this.view();
  }
}

/** 全应用共用的单例；浏览器里绑定 localStorage，Node 里自动退化为内存存储 */
export const appLocalData = new LocalDataManager();

/* ----------------------- 本地数据总览 ----------------------- */

export interface LocalDataOverview {
  key: string;
  version: number;
  updatedAt: number;
  degraded: boolean;
  dirty: boolean;
  counts: {
    endpoints: number;
    tokens: number;
    progress: number;
    books: number;
    fonts: number;
  };
  preferences: {
    hasSettings: boolean;
    endpoint: string;
    filter: ShelfFilter;
  };
  scopes: typeof LOCAL_DATA_SCOPES;
}

export interface LocalDataDeps {
  listBooks?: () => Promise<Book[]>;
  listFonts?: () => Promise<{ id: string }[]>;
}

/** 汇总查看所有本地数据（含 IndexedDB 里的书籍与字体），数据库不可用时按 0 计 */
export async function inspectLocalData(deps: LocalDataDeps = {}): Promise<LocalDataOverview> {
  let books = 0;
  let fonts = 0;
  try {
    books = (await (deps.listBooks ?? listBooks)()).length;
  } catch {
    /* IndexedDB 不可用时不让总览失败 */
  }
  try {
    fonts = (await (deps.listFonts ?? listFonts)()).length;
  } catch {
    /* 同上 */
  }
  const snap = appLocalData.view();
  return {
    key: LOCAL_DATA_KEY,
    version: snap.version,
    updatedAt: snap.updatedAt,
    degraded: appLocalData.isDegraded,
    dirty: appLocalData.isDirty,
    counts: {
      endpoints: snap.endpoints.length,
      tokens: snap.tokens.length,
      progress: snap.progress.length,
      books,
      fonts,
    },
    preferences: {
      hasSettings: Object.keys(snap.preferences.settings).length > 0,
      endpoint: snap.preferences.endpoint,
      filter: snap.preferences.filter,
    },
    scopes: LOCAL_DATA_SCOPES,
  };
}
