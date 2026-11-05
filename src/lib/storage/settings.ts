/**
 * 阅读设置持久化：localStorage + 版本化 key，加载时做字段补全，避免旧存档缺字段导致白屏。
 */
import type { ReaderSettings } from '../types';

const KEY = 'reader:settings:v2';

export const DEFAULT_SETTINGS: ReaderSettings = {
  // 米黄（THEMES[1]）：阅读页默认用暖色纸质底，比纯白省眼
  theme: 1,
  fontSize: 18,
  lineHeight: 1.8,
  letterSpacing: 0,
  paragraphSpacing: 0.95,
  fontFamily: `'Microsoft YaHei', 'PingFang SC', -apple-system, 'Noto Sans SC', sans-serif`,
  readWidth: 720,
  autoSave: true,
  prefetchCount: 5,
};

/** 默认主题从纯白改成米黄，老用户的旧设置做一次性迁移 */
const THEME_MIGRATION_KEY = 'reader:theme-migrated:beige';

export function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      localStorage.setItem(THEME_MIGRATION_KEY, '1');
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    const settings = { ...DEFAULT_SETTINGS, ...parsed };

    // 只迁移一次：旧存档里的 theme=0 多半是历史默认值，而不是用户主动挑的纯白。
    // 迁移后用户再手动挑回纯白，标记已存在，不会再被改回来。
    if (!localStorage.getItem(THEME_MIGRATION_KEY)) {
      localStorage.setItem(THEME_MIGRATION_KEY, '1');
      if (settings.theme === 0) {
        settings.theme = 1;
        // 迁移结果要落盘，否则下次启动读到的还是旧的 theme=0
        localStorage.setItem(KEY, JSON.stringify(settings));
      }
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: ReaderSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式下忽略 */
  }
}

/** 记住上次连接的后端，下次打开直接「回连」 */
const ENDPOINT_KEY = 'reader:endpoint';

export function loadLastEndpoint(): string | undefined {
  try {
    return localStorage.getItem(ENDPOINT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveLastEndpoint(base: string): void {
  try {
    localStorage.setItem(ENDPOINT_KEY, base);
  } catch {
    /* ignore */
  }
}

/** 书架筛选：记住上次选的「全部 / 本地 / 局域网」，刷新后不回弹 */
export type ShelfFilter = 'all' | 'local' | 'remote';
// 旧版 reader:mode 只存两态（library / local），特意不读取，避免把用户拉回「本地」
const FILTER_KEY = 'reader:shelf-filter';

export function loadShelfFilter(): ShelfFilter {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    return v === 'local' || v === 'remote' ? v : 'all';
  } catch {
    return 'all';
  }
}

export function saveShelfFilter(f: ShelfFilter): void {
  try {
    localStorage.setItem(FILTER_KEY, f);
  } catch {
    /* 隐私模式下忽略 */
  }
}
