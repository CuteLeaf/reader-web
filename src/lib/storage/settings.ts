/**
 * 阅读设置与本机偏好的对外入口。
 *
 * 持久化统一交给 localData 模块（版本化快照 + 旧 key 迁移），这里只保留原有的
 * 函数签名与一次性主题迁移语义，调用方不需要知道底层存储换了。
 */
import type { ReaderSettings } from '../types';
import { appLocalData, type ShelfFilter } from './localData.ts';

export type { ShelfFilter };

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
  keyScrollMode: 'page',
  scrollSpeed: 1,
  stealthMode: false,
  showStatusBar: true,
  showProgressBar: false,
  ttsRate: 1,
  dictChannel: '',
  // 网页版拿不到浏览器默认搜索引擎，给一个中文场景可达的默认值；扩展版走 chrome.search
  searchEngine: 'baidu',
};

/** 默认主题从纯白改成米黄，老用户的旧设置做一次性迁移 */
export function loadSettings(): ReaderSettings {
  const prefs = appLocalData.getPreferences();
  const settings = { ...DEFAULT_SETTINGS, ...prefs.settings };

  // 只迁移一次：旧存档里的 theme=0 多半是历史默认值，而不是用户主动挑的纯白。
  // 迁移后用户再手动挑回纯白，标记已存在，不会再被改回来。
  if (!prefs.themeMigrated) {
    if (settings.theme === 0) settings.theme = 1;
    appLocalData.setPreferences({ settings, themeMigrated: true });
    try {
      appLocalData.save();
    } catch {
      /* 隐私模式下忽略，内存里本次会话仍然生效 */
    }
  }
  return settings;
}

export function saveSettings(s: ReaderSettings): void {
  try {
    appLocalData.setPreferences({ settings: s });
    appLocalData.save();
  } catch {
    /* 隐私模式下忽略 */
  }
}

/** 记住上次连接的后端，下次打开直接「回连」 */
export function loadLastEndpoint(): string | undefined {
  return appLocalData.getPreferences().endpoint || undefined;
}

export function saveLastEndpoint(base: string): void {
  try {
    appLocalData.setPreferences({ endpoint: base });
    appLocalData.save();
  } catch {
    /* ignore */
  }
}

/** 书架筛选：记住上次选的「全部 / 本地 / 局域网」，刷新后不回弹 */
export function loadShelfFilter(): ShelfFilter {
  return appLocalData.getPreferences().filter;
}

export function saveShelfFilter(f: ShelfFilter): void {
  try {
    appLocalData.setPreferences({ filter: f });
    appLocalData.save();
  } catch {
    /* 隐私模式下忽略 */
  }
}
