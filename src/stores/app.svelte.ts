/**
 * 全局状态（Svelte 5 runes）。
 *
 * 单一 store 承担三件事：
 *  1. 数据源编排：本地 IndexedDB 书籍 + 局域网「Legado 3.0」后端书架，合并成同一个书架
 *  2. 阅读器状态：当前书、目录、章节正文、进度落库
 *  3. 全局 UI：面板开关、Toast、视图切换（hash 路由）
 */
import type { Book, Chapter, ReaderSettings } from '../lib/types';
import {
  deleteBook,
  getChapters as dbGetChapters,
  getText,
  listBooks,
  patchBook,
  kvSet,
  kvDel,
} from '../lib/storage/db';
import {
  DEFAULT_SETTINGS,
  loadLastEndpoint,
  loadShelfFilter,
  loadSettings,
  saveLastEndpoint,
  saveShelfFilter,
  saveSettings,
  type ShelfFilter,
} from '../lib/storage/settings';
import {
  fetchBookshelf,
  fetchChapterContent,
  fetchChapters,
  probeEndpoint,
  saveBookProgress,
} from '../lib/sources/legado';
import {
  deleteRemoteBook,
  fetchTokenRequired,
  type AnySource,
  type SourceKind,
} from '../lib/sources/sources';
import {
  customFontStack,
  importFontFile,
  isCustomStack,
  loadStoredFonts,
  removeFont as removeStoredFont,
  type LocalFont,
} from '../lib/reader/fonts';

export type ToastKind = 'info' | 'error' | 'success';
export interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

let toastSeq = 0;

class AppStore {
  /* ------------------------- 数据源 ------------------------- */
  endpoint = $state<string | null>(null);
  endpointState = $state<'idle' | 'connecting' | 'online' | 'offline'>('idle');
  /** 连接过程提示：唤醒中 / 第 2 次重试，给连接框显示，避免看着像卡死 */
  connectNote = $state('');
  localBooks = $state<Book[]>([]);
  remoteBooks = $state<Book[]>([]);
  filter = $state<ShelfFilter>('all');
  search = $state('');
  busy = $state(false);
  busyText = $state('');

  /* ------------------------- 阅读器 ------------------------- */
  view = $state<'shelf' | 'reader'>('shelf');
  current = $state<Book | null>(null);
  chapters = $state<Chapter[]>([]);
  chapterIndex = $state(0);
  paragraphs = $state<string[]>([]);
  chapterTitle = $state('');
  contentLoading = $state(false);
  scrollToken = $state(0);
  /** 本章已读到的字符偏移，语义与后端 durChapterPos 一致 */
  chapterPos = $state(0);

  /* --------------------------- UI --------------------------- */
  settings = $state<ReaderSettings>({ ...DEFAULT_SETTINGS });
  /** 用户从本地导入的字体（存在 IndexedDB） */
  fonts = $state<LocalFont[]>([]);
  connectOpen = $state(false);
  sourcesOpen = $state(false);
  /** 书源/订阅源编辑器 */
  editorOpen = $state(false);
  editorKind = $state<SourceKind>('book');
  editorSource = $state<AnySource | null>(null);
  /** 保存后自增，列表据此刷新 */
  sourcesVersion = $state(0);
  /** 每个后端一个书源访问令牌：{ [base]: token }，只存本机 */
  private tokens = $state<Record<string, string>>({});
  /** 后端是否要求令牌：true/false 明确，null = 该版本没有令牌机制（如 MD3 分支） */
  sourceTokenRequired = $state<boolean | null>(null);

  get sourceToken(): string {
    return this.endpoint ? (this.tokens[this.endpoint] ?? '') : '';
  }
  importOpen = $state(false);
  catalogOpen = $state(false);
  settingsOpen = $state(false);
  toasts = $state<ToastItem[]>([]);

  /* ------------------------ 内部缓存 ------------------------ */
  private catalogCache = new Map<string, Chapter[]>();
  private contentCache = new Map<string, string[]>();
  /** 同一章正在请求中的任务：预取和正常翻章撞上时共用一次请求 */
  private contentInflight = new Map<string, Promise<string[]>>();
  private localTextCache = new Map<string, string>();
  private abort: AbortController | null = null;
  /** 预取队列：按章节顺序取，翻到哪章先说哪章 */
  private prefetchQueue: number[] = [];
  private prefetching = false;
  private prefetchBookId: string | null = null;
  private prefetchCtrl: AbortController | null = null;
  /** 进度落盘/回传的防抖句柄 */
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  /** 上一次成功回传给后端的进度，用来避免重复请求 */
  private lastPushed = { index: -1, pos: -1 };
  /** 打开书时待恢复的章节内偏移，交给阅读页消费一次 */
  private pendingRestorePos = 0;
  /** 同一会话里同步失败的提示只弹一次 */
  private progressWarned = false;

  get allBooks(): Book[] {
    const list = [...this.remoteBooks, ...this.localBooks];
    const q = this.search.trim().toLowerCase();
    const filtered = list.filter((b) => {
      if (this.filter === 'local' && b.source !== 'local') return false;
      if (this.filter === 'remote' && b.source !== 'legado') return false;
      if (!q) return true;
      return b.title.toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q);
    });
    return filtered.sort(
      (a, b) => (b.durChapterTime ?? b.addedAt ?? 0) - (a.durChapterTime ?? a.addedAt ?? 0),
    );
  }

  get hasAnyBook(): boolean {
    return this.localBooks.length + this.remoteBooks.length > 0;
  }

  /* ========================= 生命周期 ========================= */

  async init(): Promise<void> {
    this.settings = loadSettings();
    try {
      const raw = localStorage.getItem('reader:sourceTokens');
      this.tokens = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      // 兼容早期只存一个令牌的存档
      const legacy = localStorage.getItem('reader:sourceToken');
      if (legacy && !Object.keys(this.tokens).length) {
        this.tokens = { ...this.tokens, __legacy: legacy };
      }
    } catch {
      /* ignore */
    }
    try {
      this.fonts = await loadStoredFonts();
    } catch (e) {
      console.warn('[fonts] 加载已存字体失败', e);
    }
    this.filter = loadShelfFilter();
    await this.reloadLocal();

    // 支持 ?endpoint=http://192.168.1.5:1122 打开即连（方便收藏夹/分享链接）
    const preset = new URLSearchParams(location.search).get('endpoint');
    const last = preset || loadLastEndpoint();

    if (preset) {
      const ok = await this.connect(preset, { silent: true });
      this.restoreFromHash();
      if (!ok) this.retryConnectLater(preset);
    } else if (last) {
      void this.connect(last, { silent: true }).then((ok) => {
        this.restoreFromHash();
        if (!ok) this.retryConnectLater(last);
      });
    } else {
      this.restoreFromHash();
    }

    window.addEventListener('hashchange', () => this.restoreFromHash());
  }

  private restoreFromHash(): void {
    const m = /^#\/read\/(.+)$/.exec(location.hash);
    if (!m) {
      if (this.view === 'reader') this.view = 'shelf';
      return;
    }
    const id = decodeURIComponent(m[1]);
    if (this.current?.id === id && this.view === 'reader') return;
    const book = [...this.localBooks, ...this.remoteBooks].find((b) => b.id === id);
    if (book) void this.openBook(book, { skipHash: true });
  }

  /* ========================= 数据源 ========================= */

  async reloadLocal(): Promise<void> {
    this.localBooks = (await listBooks()).filter((b) => b.source === 'local');
  }

  async connect(rawBase: string, opts: { silent?: boolean } = {}): Promise<boolean> {
    this.endpointState = 'connecting';
    this.connectNote = '';
    try {
      // 手机端 Web 服务会休眠：首包常超时，重试一次通常就通，所以给 3 次机会。
      // probeEndpoint 顺手把书架解析好，这里不再单独发一遍 /getBookshelf（大书架能省十几兆流量）
      const info = await probeEndpoint(rawBase, 6000, {
        attempts: 3,
        onAttempt: (attempt, attempts) => {
          this.connectNote =
            attempt === 1 ? '正在唤醒手机端服务…' : `第 ${attempt}/${attempts} 次重试…`;
        },
      });
      this.connectNote = '';
      this.endpoint = info.base;
      saveLastEndpoint(info.base);
      this.remoteBooks = info.books;
      this.endpointState = 'online';
      void this.probeSourceToken(info.base);
      if (!opts.silent)
        this.toast(`已连接 · ${info.base} · 书架 ${info.books.length} 本`, 'success');
      return true;
    } catch (e) {
      this.connectNote = '';
      this.endpointState = 'offline';
      this.remoteBooks = [];
      // 记住的「局域网」筛选在后端连不上时只会显示空书架，暂时回退到全部；
      // 不写回 localStorage，下次启动仍按用户的选择尝试
      if (this.filter === 'remote') this.filter = 'all';
      if (!opts.silent) this.toast((e as Error).message || '连接失败', 'error');
      return false;
    }
  }

  /**
   * 启动时的静默连接失败后再补一次：Android 端 Web 服务可能要十几秒才醒过来，
   * 用户往往就是「再点一次就连上了」。这里替他把这一次补上（只补一次）。
   */
  private retryConnectLater(base: string): void {
    setTimeout(() => {
      if (this.endpoint || this.endpointState === 'connecting') return;
      void this.connect(base, { silent: true }).then((ok) => {
        if (ok) this.restoreFromHash();
      });
    }, 5000);
  }

  openEditor(kind: SourceKind, source: AnySource | null): void {
    this.editorKind = kind;
    // 传进来的可能是 $state 代理，先转成普通对象再交给编辑器
    this.editorSource = source ? (JSON.parse(JSON.stringify(source)) as AnySource) : null;
    this.editorOpen = true;
  }

  setSourceToken(token: string): void {
    const base = this.endpoint;
    if (!base) return;
    const value = token.trim();
    const next = { ...this.tokens };
    if (value) next[base] = value;
    else delete next[base];
    this.tokens = next;
    try {
      localStorage.setItem('reader:sourceTokens', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  /** 问一下后端要不要令牌（MD3 等分支没有这个接口） */
  async probeSourceToken(base = this.endpoint): Promise<void> {
    if (!base) return;
    this.sourceTokenRequired = await fetchTokenRequired(base);
  }

  /** 删除远端书籍（走 /deleteBook，body 是 Book 对象） */
  async removeRemoteBook(book: Book): Promise<void> {
    if (!this.endpoint || !book.bookUrl) return;
    const body = book.raw ?? { bookUrl: book.bookUrl, name: book.title, author: book.author ?? '' };
    // 只有后端明确要求时才带自定义头：MD3 的 CORS 只放行 content-type，多带头会让预检失败
    const token = this.sourceTokenRequired === true ? this.sourceToken || undefined : undefined;
    await deleteRemoteBook(this.endpoint, body, token);
    this.remoteBooks = this.remoteBooks.filter((b) => b.id !== book.id);
    if (this.current?.id === book.id) this.backToShelf();
    this.toast(`已从手机删除《${book.title}》`, 'info');
  }

  /** 重新拉一次远端书架（上传书籍后用来刷新） */
  async refreshRemote(): Promise<void> {
    if (!this.endpoint || this.endpointState !== 'online') return;
    try {
      this.remoteBooks = await fetchBookshelf(this.endpoint);
    } catch {
      /* 刷新失败不影响已有列表 */
    }
  }

  disconnect(): void {
    this.endpoint = null;
    this.sourceTokenRequired = null;
    this.endpointState = 'idle';
    this.connectNote = '';
    this.remoteBooks = [];
    this.catalogCache.clear();
    this.contentCache.clear();
    this.contentInflight.clear();
    this.resetPrefetch();
    this.toast('已断开局域网后端', 'info');
  }

  setFilter(f: ShelfFilter): void {
    this.filter = f;
    saveShelfFilter(f);
  }

  /* ========================= 阅读器 ========================= */

  async openBook(book: Book, opts: { skipHash?: boolean } = {}): Promise<void> {
    this.view = 'reader';
    this.current = book;
    this.resetPrefetch();
    this.paragraphs = [];
    this.chapterTitle = book.title;
    this.chapterIndex = book.durChapterIndex ?? 0;
    this.chapterPos = book.durChapterPos ?? 0;
    this.pendingRestorePos = this.chapterPos;
    this.lastPushed = { index: -1, pos: -1 };
    this.contentLoading = true;
    if (!opts.skipHash) history.replaceState(null, '', `#/read/${encodeURIComponent(book.id)}`);

    try {
      const chapters = await this.ensureChapters(book);
      this.chapters = chapters;
      const idx = Math.min(
        Math.max(book.durChapterIndex ?? 0, 0),
        Math.max(chapters.length - 1, 0),
      );
      await this.loadChapter(idx, { silent: true, keepPos: true });
    } catch (e) {
      this.contentLoading = false;
      this.toast((e as Error).message || '加载目录失败', 'error');
    }
  }

  async ensureChapters(book: Book): Promise<Chapter[]> {
    const cached = this.catalogCache.get(book.id);
    if (cached?.length) return cached;
    let chapters: Chapter[];
    if (book.source === 'local') {
      chapters = await dbGetChapters(book.id);
    } else {
      if (!this.endpoint || !book.bookUrl) throw new Error('后端未连接，无法获取目录');
      chapters = await fetchChapters(this.endpoint, book.bookUrl);
    }
    if (!chapters.length) throw new Error('目录为空');
    this.catalogCache.set(book.id, chapters);
    return chapters;
  }

  async loadChapter(
    index: number,
    opts: { silent?: boolean; keepPos?: boolean } = {},
  ): Promise<void> {
    const book = this.current;
    if (!book || index < 0 || index >= this.chapters.length) return;
    this.abort?.abort();
    this.abort = new AbortController();
    const ctrl = this.abort;

    this.chapterIndex = index;
    // 换章默认从章首算起；打开书那一趟保留后端给的章节内位置
    if (!opts.keepPos) {
      this.chapterPos = 0;
      this.pendingRestorePos = 0;
    }
    this.contentLoading = true;
    const chapter = this.chapters[index];
    this.chapterTitle = chapter.title;

    try {
      const paragraphs = await this.readChapter(book, chapter, ctrl.signal);
      // 慢请求可能在用户已经换章之后才回来，别把旧正文盖到新章上
      if (ctrl.signal.aborted || this.abort !== ctrl) return;
      this.paragraphs = paragraphs;
      this.scrollToken += 1;
      this.schedulePrefetch(index);
      if (this.settings.autoSave) this.scheduleProgressSync(opts.keepPos ? 4000 : 1200);
      if (!opts.silent) {
        const updated = await patchBook(book.id, {
          durChapterIndex: index,
          durChapterTitle: chapter.title,
          durChapterTime: Date.now(),
        });
        if (updated) this.current = updated;
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      const reason = (e as Error)?.message || '加载正文失败';
      this.paragraphs = [`（章节加载失败：${reason}）`];
      // 出错一定要说出来，silent 只用来压掉「正在加载」这类噪音
      this.toast(reason, 'error');
    } finally {
      if (this.abort === ctrl) this.contentLoading = false;
    }
  }

  private async readChapter(book: Book, chapter: Chapter, signal: AbortSignal): Promise<string[]> {
    if (book.source === 'local') {
      let text = this.localTextCache.get(book.id);
      if (!text) {
        text = (await getText(book.id)) ?? '';
        if (!text) throw new Error('本地正文丢失，请重新导入该书');
        this.localTextCache.set(book.id, text);
      }
      const start = chapter.start ?? 0;
      const end = chapter.end ?? text.length;
      const slice = text.slice(start, end);
      return this.toParagraphs(slice, chapter.title);
    }

    const key = `${book.id}#${chapter.index}`;
    const cached = this.contentCache.get(key);
    if (cached) return cached;
    // 预取中的章节被翻到时直接等同一个请求，不重复发
    const pending = this.contentInflight.get(key);
    if (pending) return pending;
    if (!this.endpoint || !book.bookUrl) throw new Error('后端未连接');
    const base = this.endpoint;
    const bookUrl = book.bookUrl;

    const task = (async (): Promise<string[]> => {
      try {
        const paragraphs = await fetchChapterContent(
          base,
          bookUrl,
          chapter.index,
          chapter.title,
          signal,
        );
        // 缓存上限只是防止长时间阅读把内存撑爆，命中率比容量更重要
        if (this.contentCache.size > 60) this.contentCache.clear();
        this.contentCache.set(key, paragraphs);
        return paragraphs;
      } finally {
        this.contentInflight.delete(key);
      }
    })();
    this.contentInflight.set(key, task);
    return task;
  }

  /* ========================= 预加载 ========================= */

  /**
   * 预取后续章节：只排当前章之后的 N 章，顺序拉取。
   * 本地书正文是一次性读进内存再切片，没有网络开销，不需要预取。
   */
  private schedulePrefetch(from: number): void {
    const book = this.current;
    if (!book || book.source !== 'legado' || this.settings.prefetchCount <= 0) {
      this.prefetchQueue = [];
      return;
    }
    if (this.prefetchBookId !== book.id) {
      this.prefetchCtrl?.abort();
      this.prefetchCtrl = new AbortController();
      this.prefetchBookId = book.id;
    }
    if (this.prefetchCtrl?.signal.aborted) {
      this.prefetchCtrl = new AbortController();
    }

    const targets: number[] = [];
    for (let i = 1; i <= this.settings.prefetchCount; i += 1) {
      const index = from + i;
      if (index >= this.chapters.length) break;
      if (this.contentCache.has(`${book.id}#${index}`)) continue;
      targets.push(index);
    }
    this.prefetchQueue = targets;
    if (targets.length) void this.runPrefetch();
  }

  /** 单线程队列：后端多为单机服务，并发拉五章反而把当前章的带宽挤掉 */
  private async runPrefetch(): Promise<void> {
    if (this.prefetching) return;
    this.prefetching = true;
    try {
      while (this.prefetchQueue.length) {
        const book = this.current;
        const index = this.prefetchQueue.shift();
        if (index === undefined) break;
        if (!book || book.source !== 'legado' || book.id !== this.prefetchBookId) break;
        const ctrl = this.prefetchCtrl;
        if (!ctrl || ctrl.signal.aborted) break;
        if (index === this.chapterIndex) continue;
        const chapter = this.chapters[index];
        if (!chapter || this.contentCache.has(`${book.id}#${index}`)) continue;
        try {
          await this.readChapter(book, chapter, ctrl.signal);
        } catch {
          // 预取失败不打扰用户，翻到该章时仍会走正常加载并给出错误提示
        }
        // 让出一点时间给当前章的排版与滚动
        await new Promise((r) => setTimeout(r, 120));
      }
    } finally {
      this.prefetching = false;
    }
  }

  private resetPrefetch(): void {
    this.prefetchQueue = [];
    this.prefetchBookId = null;
    this.prefetchCtrl?.abort();
    this.prefetchCtrl = null;
  }

  /**
   * 切段：兼容两种常见排版
   *  - 空行分段（段落之间有空行）
   *  - 一行一段（每行以全角缩进开头）
   *  - 硬折行的正文（行尾不是句末标点则并回上一段）
   */
  private toParagraphs(slice: string, title: string): string[] {
    const lines = slice.replace(/\r\n?/g, '\n').split('\n');
    if (lines.length && lines[0].trim() === title.trim()) lines.shift();

    const paragraphs: string[] = [];
    let buffer = '';
    const flush = () => {
      if (buffer) paragraphs.push(buffer);
      buffer = '';
    };

    for (const line of lines) {
      if (!line.trim()) {
        flush();
        continue;
      }
      const indented = /^[\u3000]{1,}|^\s{2,}/.test(line);
      const prevEnded = /[。！？!?…”』」】）)\]]$/.test(buffer);
      if (!buffer) buffer = line.trim();
      else if (indented || prevEnded) {
        flush();
        buffer = line.trim();
      } else buffer += line.trim();
    }
    flush();
    return paragraphs.length ? paragraphs : ['（本章无内容）'];
  }

  async nextChapter(): Promise<void> {
    if (this.chapterIndex + 1 >= this.chapters.length) {
      this.toast('已经是最后一章', 'info');
      return;
    }
    await this.loadChapter(this.chapterIndex + 1);
  }

  async prevChapter(): Promise<void> {
    if (this.chapterIndex <= 0) {
      this.toast('已经是第一章', 'info');
      return;
    }
    await this.loadChapter(this.chapterIndex - 1);
  }

  async jumpTo(index: number): Promise<void> {
    this.catalogOpen = false;
    await this.loadChapter(index);
  }

  /** 阅读页滚动时上报本章内的字符偏移（节流由调用方负责） */
  reportProgress(pos: number): void {
    if (!Number.isFinite(pos) || pos < 0) return;
    const next = Math.round(pos);
    if (next === this.chapterPos) return;
    this.chapterPos = next;
    if (this.settings.autoSave) this.scheduleProgressSync();
  }

  /** 取走打开书时待恢复的章节内偏移，只消费一次 */
  takeRestorePos(): number {
    const pos = this.pendingRestorePos;
    this.pendingRestorePos = 0;
    return pos;
  }

  /** 滚动过程中不要每次都发请求：合并成一次落盘 */
  private scheduleProgressSync(delay = 2000): void {
    if (this.progressTimer) clearTimeout(this.progressTimer);
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null;
      void this.flushProgress();
    }, delay);
  }

  /**
   * 立刻落一次进度：
   *  - 所有书写本地 IndexedDB（刷新后能续读）
   *  - 远端书额外 POST /saveBookProgress 回手机端（手机书架、阅读界面跟着更新）
   */
  async flushProgress(opts: { force?: boolean; keepalive?: boolean } = {}): Promise<void> {
    if (this.progressTimer) {
      clearTimeout(this.progressTimer);
      this.progressTimer = null;
    }
    const book = this.current;
    if (!book) return;

    const index = this.chapterIndex;
    const pos = Math.max(0, Math.round(this.chapterPos));
    const title = this.chapters[index]?.title ?? this.chapterTitle;
    const time = Date.now();

    try {
      await kvSet(`progress:${book.id}`, { index, title, time });
    } catch {
      /* 本地写失败不影响回传后端 */
    }

    if (book.source !== 'legado' || !this.endpoint || !book.bookUrl) return;
    const last = this.lastPushed;
    if (!opts.force && last.index === index && Math.abs(pos - last.pos) < 40) return;
    this.lastPushed = { index, pos };

    // 后端用 name + author 精确匹配书籍，必须用远端原始字段（本地标题可能被 trim 过）
    const raw = book.raw ?? {};
    const name = typeof raw.name === 'string' ? raw.name : book.title;
    const author = typeof raw.author === 'string' ? raw.author : (book.author ?? '');
    // 只有后端明确要求令牌时才带头：MD3 的 CORS 只放行 content-type
    const token = this.sourceTokenRequired === true ? this.sourceToken || undefined : undefined;

    try {
      await saveBookProgress(
        this.endpoint,
        {
          name,
          author,
          bookUrl: book.bookUrl,
          durChapterIndex: index,
          durChapterPos: pos,
          durChapterTime: time,
          durChapterTitle: title,
        },
        token,
        { keepalive: opts.keepalive },
      );
      this.applyProgress(book.id, index, pos, title, time);
    } catch (e) {
      // 阅读中弹错误太吵：同一会话只提示一次，其余留在控制台
      console.warn('[reader] 同步阅读进度失败', e);
      if (!this.progressWarned) {
        this.progressWarned = true;
        this.toast(`阅读进度未能同步到手机：${(e as Error).message}`, 'error');
      }
      this.lastPushed = { index: -1, pos: -1 };
    }
  }

  /** 回写成功后同步内存里的书架条目，返回书架即可看到新的「读至」 */
  private applyProgress(id: string, index: number, pos: number, title: string, time: number): void {
    this.remoteBooks = this.remoteBooks.map((b) =>
      b.id === id
        ? {
            ...b,
            durChapterIndex: index,
            durChapterPos: pos,
            durChapterTitle: title,
            durChapterTime: time,
          }
        : b,
    );
    const cur = this.current;
    if (cur?.id === id) {
      this.current = {
        ...cur,
        durChapterIndex: index,
        durChapterPos: pos,
        durChapterTitle: title,
        durChapterTime: time,
      };
    }
  }

  backToShelf(): void {
    // 先取一次快照再清状态，避免最后几页的进度丢掉
    void this.flushProgress({ force: true, keepalive: true });
    this.resetPrefetch();
    this.abort?.abort();
    this.view = 'shelf';
    this.current = null;
    this.paragraphs = [];
    this.chapters = [];
    history.replaceState(null, '', location.pathname + location.search);
  }

  /* ========================= 设置 ========================= */

  async importFont(file: File): Promise<void> {
    try {
      const font = await importFontFile(file);
      this.fonts = [...this.fonts, font];
      this.updateSettings({ fontFamily: customFontStack(font.family) });
      this.toast(`已导入字体「${font.name}」`, 'success');
    } catch (e) {
      this.toast((e as Error).message || '导入字体失败', 'error');
    }
  }

  async removeFont(id: string): Promise<void> {
    const font = this.fonts.find((f) => f.id === id);
    try {
      await removeStoredFont(id);
    } catch (e) {
      this.toast((e as Error).message || '删除字体失败', 'error');
      return;
    }
    this.fonts = this.fonts.filter((f) => f.id !== id);
    if (font && isCustomStack(this.settings.fontFamily, font.family)) {
      this.updateSettings({ fontFamily: DEFAULT_SETTINGS.fontFamily });
    }
    if (font) this.toast(`已删除字体「${font.name}」`, 'info');
  }

  updateSettings(patch: Partial<ReaderSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
  }

  /* ========================= 本地书 ========================= */

  async removeLocalBook(book: Book): Promise<void> {
    await deleteBook(book.id);
    await kvDel(`progress:${book.id}`);
    this.localTextCache.delete(book.id);
    this.catalogCache.delete(book.id);
    await this.reloadLocal();
    if (this.current?.id === book.id) this.backToShelf();
    this.toast(`已删除《${book.title}》`, 'info');
  }

  /* ========================== UI ========================== */

  toast(text: string, kind: ToastKind = 'info'): void {
    const id = ++toastSeq;
    this.toasts = [...this.toasts, { id, text, kind }];
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    }, 3200);
  }

  dismissToast(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const app = new AppStore();
