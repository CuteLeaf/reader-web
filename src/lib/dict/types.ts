/** 词典渠道的公共数据结构：各渠道把结果整理成「小节 + 正文行」，面板只负责展示 */

export interface DictBlock {
  /** 小节标题，可为空 */
  heading: string;
  lines: string[];
}

export interface DictResult {
  term: string;
  /** 渠道 id，用于缓存与高亮当前渠道 */
  channelId: string;
  /** 渠道显示名 */
  source: string;
  /** 注音 / 音标，中文渠道一般是注音，英文是音标 */
  phonetic?: string;
  /** 词条页面地址，供「浏览器打开」 */
  url: string;
  blocks: DictBlock[];
  /** 补充说明，例如「按繁体『書店』查询」 */
  note?: string;
}

/** 语言：只区分中文与英文，够覆盖小说阅读场景 */
export type DictLang = 'zh' | 'en';

export interface DictChannel {
  id: string;
  label: string;
  langs: DictLang[];
  /**
   * 跨域能力：open 表示带 CORS 头，网页版也能读；
   * extension 表示没有 CORS 头，只有扩展（host_permissions）能读到响应。
   */
  cors?: 'open' | 'extension';
  /** 词条网页地址，未收录时也能「浏览器打开」 */
  url?: (term: string) => string;
  /** 未收录返回 null，网络/服务异常抛错 */
  lookup(term: string, signal?: AbortSignal): Promise<DictResult | null>;
}
