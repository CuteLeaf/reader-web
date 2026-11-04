/**
 * RssSource 字段表（对齐 LegadoTeam/legado 的 data/entities/RssSource.kt）。
 * 与书源不同，订阅源的规则是一组扁平字符串（ruleArticles / ruleTitle ...），
 * 没有 ruleSearch 那种嵌套子对象，所以这里只需要一层字段表。
 */
import type { FieldDef } from './bookSourceSchema';

export type RssTabKey = 'basic' | 'list' | 'content' | 'web' | 'other';

export const RSS_TABS: Array<{ key: RssTabKey; label: string }> = [
  { key: 'basic', label: '基础' },
  { key: 'list', label: '列表' },
  { key: 'content', label: '正文' },
  { key: 'web', label: '网页' },
  { key: 'other', label: '其他' },
];

export const RSS_FIELDS: Record<RssTabKey, FieldDef[]> = {
  basic: [
    { key: 'sourceUrl', label: '源 URL', type: 'text', hint: '必填，订阅源主键，编辑时不可修改' },
    { key: 'sourceName', label: '源名称', type: 'text', hint: '显示在订阅列表里' },
    { key: 'sourceIcon', label: '图标', type: 'text', hint: '图标地址，可留空' },
    { key: 'sourceGroup', label: '源分组', type: 'text', hint: '多个分组用逗号分隔' },
    { key: 'sourceComment', label: '源注释', type: 'area', hint: '说明、作者、更新地址等' },
    {
      key: 'type',
      label: '类型',
      type: 'select',
      options: [
        { label: '网页', value: 0 },
        { label: '图片', value: 1 },
        { label: '视频', value: 2 },
      ],
    },
    { key: 'enabled', label: '启用', type: 'bool' },
    { key: 'enableReadRecord', label: '记录阅读历史', type: 'bool' },
    { key: 'customOrder', label: '排序号', type: 'number', hint: '数字越大越靠前' },
  ],
  list: [
    { key: 'searchUrl', label: '搜索链接', type: 'code', hint: '可留空；支持 {{key}} {{page}}' },
    { key: 'sortUrl', label: '分类链接', type: 'code', hint: '名称::链接 的列表，支持 JSON' },
    {
      key: 'articleStyle',
      label: '列表样式',
      type: 'select',
      options: [
        { label: '0 · 默认（标题+描述）', value: 0 },
        { label: '1 · 标题+图片', value: 1 },
        { label: '2 · 标题+时间', value: 2 },
        { label: '3 · 图片列表', value: 3 },
        { label: '4 · 卡片', value: 4 },
      ],
    },
    { key: 'ruleArticles', label: '列表规则', type: 'code', hint: '定位每一条文章的节点' },
    { key: 'ruleNextPage', label: '下一页规则', type: 'code' },
    { key: 'ruleTitle', label: '标题规则', type: 'code' },
    { key: 'ruleLink', label: '链接规则', type: 'code' },
    { key: 'ruleImage', label: '图片规则', type: 'code' },
    { key: 'ruleDescription', label: '描述规则', type: 'code' },
    { key: 'rulePubDate', label: '发布日期规则', type: 'code' },
    {
      key: 'singleUrl',
      label: '单 URL 源',
      type: 'bool',
      hint: '开启后列表里的链接直接当正文地址',
    },
  ],
  content: [
    {
      key: 'ruleContent',
      label: '正文规则',
      type: 'code',
      hint: '留空则由 WebView 直接显示原网页',
    },
    { key: 'nextContentUrl', label: '正文下一页', type: 'code' },
    { key: 'contentWhitelist', label: '正文白名单', type: 'code', hint: '只允许这些 URL 进入正文' },
    { key: 'contentBlacklist', label: '正文黑名单', type: 'code' },
    {
      key: 'shouldOverrideUrlLoading',
      label: '跳转拦截 JS',
      type: 'code',
      hint: '返回 true 拦截该 URL',
    },
    { key: 'coverDecodeJs', label: '图片解密 JS', type: 'code' },
  ],
  web: [
    { key: 'style', label: 'WebView 样式', type: 'code', hint: '注入到网页里的 CSS' },
    { key: 'injectJs', label: '注入 JS', type: 'code' },
    { key: 'preloadJs', label: '预注入 JS', type: 'code', hint: '页面加载前执行' },
    { key: 'startHtml', label: '起始页 HTML', type: 'code', hint: '网页形式源的入口页' },
    { key: 'startStyle', label: '起始页样式', type: 'code' },
    { key: 'startJs', label: '起始页 JS', type: 'code' },
    { key: 'enableJs', label: '启用 JS', type: 'bool' },
    { key: 'loadWithBaseUrl', label: '以 BaseUrl 加载', type: 'bool' },
    { key: 'showWebLog', label: '输出网页日志', type: 'bool' },
    { key: 'preload', label: '预加载', type: 'bool' },
    { key: 'cacheFirst', label: '优先读缓存', type: 'bool' },
  ],
  other: [
    { key: 'header', label: '请求头', type: 'code', hint: 'JSON 格式，每个请求都会带上' },
    { key: 'loginUrl', label: '登录地址', type: 'text' },
    { key: 'loginUi', label: '登录界面', type: 'code', hint: '自定义登录 UI 的 JSON' },
    { key: 'loginCheckJs', label: '登录检测 JS', type: 'code' },
    { key: 'concurrentRate', label: '并发率', type: 'text', hint: '如 1000 或 1/1000' },
    { key: 'enabledCookieJar', label: '自动保存 Cookie', type: 'bool' },
    { key: 'variableComment', label: '变量说明', type: 'area' },
    { key: 'jsLib', label: 'JS 库', type: 'code', hint: '订阅源内可复用的 JS' },
  ],
};

/** 新建订阅源时的空壳（默认值与 RssSource.kt 保持一致） */
export function blankRssSource(): Record<string, unknown> {
  return {
    sourceUrl: '',
    sourceName: '',
    sourceIcon: '',
    sourceGroup: null,
    sourceComment: null,
    enabled: true,
    enableReadRecord: true,
    variableComment: null,
    jsLib: null,
    enabledCookieJar: true,
    concurrentRate: null,
    header: null,
    loginUrl: null,
    loginUi: null,
    loginCheckJs: null,
    coverDecodeJs: null,
    sortUrl: null,
    singleUrl: false,
    articleStyle: 0,
    ruleArticles: null,
    ruleNextPage: null,
    ruleTitle: null,
    rulePubDate: null,
    ruleDescription: null,
    ruleImage: null,
    ruleLink: null,
    ruleContent: null,
    nextContentUrl: null,
    contentWhitelist: null,
    contentBlacklist: null,
    shouldOverrideUrlLoading: null,
    style: null,
    enableJs: true,
    loadWithBaseUrl: true,
    injectJs: null,
    preloadJs: null,
    startHtml: null,
    startStyle: null,
    startJs: null,
    showWebLog: false,
    lastUpdateTime: 0,
    customOrder: 0,
    type: 0,
    preload: false,
    cacheFirst: false,
    searchUrl: null,
  };
}

/** 复制一条订阅源用于「新建副本」：清掉主键相关的元数据 */
export function cloneRssAsNew(src: Record<string, unknown>): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(src)) as Record<string, unknown>;
  next.sourceUrl = '';
  next.sourceName = `${String(src.sourceName ?? '')}（副本）`;
  next.lastUpdateTime = 0;
  return next;
}
