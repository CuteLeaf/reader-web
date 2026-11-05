/** 统一的数据模型：把「Legado 3.0 后端」与「本地导入」两种来源抹平成同一套结构。 */

export type SourceKind = 'legado' | 'local';

export type LocalFormat = 'txt' | 'epub' | 'md' | 'html';

/** 书架条目（两种来源共用） */
export interface Book {
  /** legado:<bookUrl> | local:<uuid> */
  id: string;
  source: SourceKind;
  title: string;
  author?: string;
  coverUrl?: string;
  totalChapterNum?: number;
  latestChapterTitle?: string;
  durChapterTitle?: string;
  durChapterIndex: number;
  /** 章节内字符偏移，用于「同步进度」时续读到原位置 */
  durChapterPos?: number;
  durChapterTime?: number;

  /* ---- 仅本地书籍 ---- */
  format?: LocalFormat;
  size?: number;
  addedAt?: number;
  /** legado 后端原始 bookUrl，重新连接同地址后可继续接续 */
  bookUrl?: string;
  /** 仅远端书籍：后端返回的原始对象（删除、回写时原样提交，避免字段丢失） */
  raw?: Record<string, unknown>;
}

export interface Chapter {
  index: number;
  title: string;
  /** legado：章节 url；本地：空 */
  url?: string;
  /** 本地 TXT：字符偏移量 */
  start?: number;
  end?: number;
  /** 本地 EPUB：资源路径 */
  href?: string;
}

/** 扫描/手动添加得到的候选后端 */
export interface Endpoint {
  base: string;
  latency: number;
  bookCount: number;
  /** 服务能返回书架，但内容接口可能因 CORS 被拦 */
  cors: 'ok' | 'blocked' | 'unknown';
  titles: string[];
  discoveredBy: 'auto' | 'manual' | 'recall';
}

export interface ReaderSettings {
  /** 0-5，对应主题列表索引 */
  theme: number;
  fontSize: number;
  lineHeight: number;
  /** 字距，px，可为负 */
  letterSpacing: number;
  /** 段距，单位 em（乘字号） */
  paragraphSpacing: number;
  fontFamily: string;
  /** 阅读区宽度 px */
  readWidth: number;
  /** 翻章后是否记住进度 */
  autoSave: boolean;
  /** 预加载后续章节数：0 关闭，只对局域网书籍生效 */
  prefetchCount: number;
  /** ↑↓ 的滚动方式 */
  keyScrollMode: KeyScrollMode;
  /** 滚动速度倍率：0.5 ~ 3，1 为标准 */
  scrollSpeed: number;
}

/**
 * ↑↓ 键的滚动方式：
 *  - page：一次一屏（原有行为）
 *  - half：一次半屏
 *  - line：一次一行，细读/校对用
 *  - continuous：按住不放持续滚动，松开即停
 */
export type KeyScrollMode = 'page' | 'half' | 'line' | 'continuous';
