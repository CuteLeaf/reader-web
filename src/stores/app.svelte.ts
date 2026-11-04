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
  private localTextCache = new Map<string, string>();
  private abort: AbortController | null = null;

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
      await this.connect(preset, { silent: true });
      this.restoreFromHash();
    } else if (last) {
      void this.connect(last, { silent: true }).then(() => this.restoreFromHash());
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
    try {
      const info = await probeEndpoint(rawBase, 5000);
      this.endpoint = info.base;
      saveLastEndpoint(info.base);
      const books = await fetchBookshelf(info.base);
      this.remoteBooks = books;
      this.endpointState = 'online';
      void this.probeSourceToken(info.base);
      if (!opts.silent) this.toast(`已连接 · ${info.base} · 书架 ${books.length} 本`, 'success');
      return true;
    } catch (e) {
      this.endpointState = 'offline';
      this.remoteBooks = [];
      // 记住的「局域网」筛选在后端连不上时只会显示空书架，暂时回退到全部；
      // 不写回 localStorage，下次启动仍按用户的选择尝试
      if (this.filter === 'remote') this.filter = 'all';
      if (!opts.silent) this.toast((e as Error).message || '连接失败', 'error');
      return false;
    }
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
    this.remoteBooks = [];
    this.catalogCache.clear();
    this.contentCache.clear();
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
    this.paragraphs = [];
    this.chapterTitle = book.title;
    this.chapterIndex = book.durChapterIndex ?? 0;
    this.contentLoading = true;
    if (!opts.skipHash) history.replaceState(null, '', `#/read/${encodeURIComponent(book.id)}`);

    try {
      const chapters = await this.ensureChapters(book);
      this.chapters = chapters;
      const idx = Math.min(
        Math.max(book.durChapterIndex ?? 0, 0),
        Math.max(chapters.length - 1, 0),
      );
      await this.loadChapter(idx, { silent: true });
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

  async loadChapter(index: number, opts: { silent?: boolean } = {}): Promise<void> {
    const book = this.current;
    if (!book || index < 0 || index >= this.chapters.length) return;
    this.abort?.abort();
    this.abort = new AbortController();
    const ctrl = this.abort;

    this.chapterIndex = index;
    this.contentLoading = true;
    const chapter = this.chapters[index];
    this.chapterTitle = chapter.title;

    try {
      this.paragraphs = await this.readChapter(book, chapter, ctrl.signal);
      this.scrollToken += 1;
      if (this.settings.autoSave) void this.saveProgress(index);
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
    if (!this.endpoint || !book.bookUrl) throw new Error('后端未连接');
    const paragraphs = await fetchChapterContent(
      this.endpoint,
      book.bookUrl,
      chapter.index,
      chapter.title,
      signal,
    );
    if (this.contentCache.size > 40) this.contentCache.clear();
    this.contentCache.set(key, paragraphs);
    return paragraphs;
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

  private async saveProgress(index: number): Promise<void> {
    const book = this.current;
    if (!book) return;
    const chapter = this.chapters[index];
    await kvSet(`progress:${book.id}`, { index, title: chapter?.title ?? '', time: Date.now() });
  }

  backToShelf(): void {
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
