/**
 * BookSource 字段表（对齐 LegadoTeam/legado 的 data/entities/BookSource.kt 与 rule/*.kt）。
 * 只用于生成表单，不参与业务逻辑；未知字段在保存时原样保留。
 */

export type TabKey = 'basic' | 'search' | 'explore' | 'info' | 'toc' | 'content' | 'other';

export const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'basic', label: '基础' },
  { key: 'search', label: '搜索' },
  { key: 'explore', label: '发现' },
  { key: 'info', label: '详情' },
  { key: 'toc', label: '目录' },
  { key: 'content', label: '正文' },
  { key: 'other', label: '其他' },
];

export type FieldType = 'text' | 'area' | 'code' | 'number' | 'bool' | 'select';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  hint?: string;
  options?: Array<{ label: string; value: string | number }>;
}

export const BASIC_FIELDS: FieldDef[] = [
  {
    key: 'bookSourceType',
    label: '源类型',
    type: 'select',
    options: [
      { label: '文本', value: 0 },
      { label: '音频', value: 1 },
      { label: '图片', value: 2 },
      { label: '文件', value: 3 },
      { label: '视频', value: 4 },
    ],
  },
  {
    key: 'bookSourceUrl',
    label: '源 URL',
    type: 'text',
    hint: '必填，通常是网站主页，如 https://www.qidian.com',
  },
  { key: 'bookSourceName', label: '源名称', type: 'text', hint: '显示在源列表里' },
  { key: 'bookSourceGroup', label: '源分组', type: 'text', hint: '多个分组用逗号分隔' },
  { key: 'bookSourceComment', label: '源注释', type: 'area', hint: '说明、作者、更新地址等' },
  {
    key: 'bookUrlPattern',
    label: '详情页正则',
    type: 'text',
    hint: '书籍 URL 正则，用于从网页直接打开书籍',
  },
  { key: 'customOrder', label: '排序号', type: 'number', hint: '数字越大越靠前' },
  { key: 'weight', label: '排序权重', type: 'number', hint: '智能排序用' },
  { key: 'enabled', label: '启用', type: 'bool' },
  { key: 'enabledExplore', label: '启用发现', type: 'bool' },
];

export const OTHER_FIELDS: FieldDef[] = [
  { key: 'header', label: '请求头', type: 'code', hint: 'JSON 格式，每个请求都会带上' },
  { key: 'loginUrl', label: '登录地址', type: 'text', hint: '仅在需要登录的源使用' },
  { key: 'loginUi', label: '登录界面', type: 'code', hint: '自定义登录 UI 的 JSON' },
  { key: 'loginCheckJs', label: '登录检测 JS', type: 'code' },
  { key: 'coverDecodeJs', label: '封面解密 JS', type: 'code' },
  {
    key: 'concurrentRate',
    label: '并发率',
    type: 'text',
    hint: '如 1000（访问间隔 1000ms）或 1/1000（1000ms 内 1 次）',
  },
  { key: 'variableComment', label: '变量说明', type: 'area' },
  { key: 'jsLib', label: 'JS 库', type: 'code', hint: '书源内可复用的 JS' },
  { key: 'mainJs', label: 'JS 源主脚本', type: 'code', hint: '填写后走纯 JS 单文件书源流程' },
  { key: 'eventListener', label: '事件监听', type: 'bool' },
  { key: 'customButton', label: '自定义按钮', type: 'bool' },
];

export interface RuleGroup {
  path: string;
  label: string;
  fields: FieldDef[];
}

const listRule: FieldDef[] = [
  { key: 'bookList', label: '书籍列表', type: 'code' },
  { key: 'name', label: '书名', type: 'code' },
  { key: 'author', label: '作者', type: 'code' },
  { key: 'kind', label: '分类', type: 'code' },
  { key: 'lastChapter', label: '最新章节', type: 'code' },
  { key: 'updateTime', label: '更新时间', type: 'code' },
  { key: 'bookUrl', label: '详情页链接', type: 'code' },
  { key: 'coverUrl', label: '封面链接', type: 'code' },
  { key: 'intro', label: '简介', type: 'code' },
  { key: 'wordCount', label: '字数', type: 'code' },
];

export const RULE_GROUPS: Record<TabKey, RuleGroup[]> = {
  basic: [],
  search: [
    {
      path: 'ruleSearch',
      label: '搜索规则',
      fields: [{ key: 'checkKeyWord', label: '校验关键字', type: 'text' }, ...listRule],
    },
  ],
  explore: [{ path: 'ruleExplore', label: '发现规则', fields: listRule }],
  info: [
    {
      path: 'ruleBookInfo',
      label: '详情规则',
      fields: [
        { key: 'init', label: '初始化', type: 'code' },
        { key: 'name', label: '书名', type: 'code' },
        { key: 'author', label: '作者', type: 'code' },
        { key: 'kind', label: '分类', type: 'code' },
        { key: 'lastChapter', label: '最新章节', type: 'code' },
        { key: 'updateTime', label: '更新时间', type: 'code' },
        { key: 'intro', label: '简介', type: 'code' },
        { key: 'coverUrl', label: '封面链接', type: 'code' },
        { key: 'tocUrl', label: '目录链接', type: 'code' },
        { key: 'wordCount', label: '字数', type: 'code' },
        { key: 'canReName', label: '允许改名', type: 'code' },
        { key: 'downloadUrls', label: '下载链接', type: 'code' },
      ],
    },
  ],
  toc: [
    {
      path: 'ruleToc',
      label: '目录规则',
      fields: [
        { key: 'chapterList', label: '目录列表', type: 'code' },
        { key: 'chapterName', label: '章节名称', type: 'code' },
        { key: 'chapterUrl', label: '章节链接', type: 'code' },
        { key: 'formatJs', label: '格式化 JS', type: 'code' },
        { key: 'isVolume', label: '卷名', type: 'code' },
        { key: 'isVip', label: 'VIP', type: 'code' },
        { key: 'isPay', label: '购买', type: 'code' },
        { key: 'updateTime', label: '更新时间', type: 'code' },
        { key: 'nextTocUrl', label: '下一页目录', type: 'code' },
        { key: 'preUpdateJs', label: '更新前 JS', type: 'code' },
      ],
    },
  ],
  content: [
    {
      path: 'ruleContent',
      label: '正文规则',
      fields: [
        { key: 'content', label: '正文', type: 'code' },
        { key: 'subContent', label: '副文', type: 'code' },
        { key: 'title', label: '标题', type: 'code', hint: '有些网站标题只能在正文里取' },
        { key: 'nextContentUrl', label: '下一页正文', type: 'code' },
        { key: 'webJs', label: 'WebView JS', type: 'code' },
        { key: 'sourceRegex', label: '源码正则', type: 'code' },
        { key: 'replaceRegex', label: '替换规则', type: 'code' },
        { key: 'imageStyle', label: '图片样式', type: 'text', hint: '留空居中，FULL 为最大宽度' },
        { key: 'imageDecode', label: '图片解密 JS', type: 'code' },
        { key: 'payAction', label: '购买操作', type: 'code' },
        { key: 'callBackJs', label: '回调 JS', type: 'code' },
        { key: 'contentBatch', label: '批量正文', type: 'code' },
        { key: 'maxBatchSize', label: '批量数量', type: 'number', hint: '≤ 1 视为不支持批量' },
      ],
    },
  ],
  other: [],
};

export const TAB_FIELDS: Record<TabKey, FieldDef[]> = {
  basic: BASIC_FIELDS,
  search: [
    {
      key: 'searchUrl',
      label: '搜索链接',
      type: 'code',
      hint: '多个用换行分隔，可带 {{key}} {{page}}',
    },
  ],
  explore: [
    { key: 'exploreUrl', label: '发现链接', type: 'code', hint: '名称::链接 的列表，支持 JSON' },
    { key: 'exploreScreen', label: '发现筛选', type: 'code' },
  ],
  info: [],
  toc: [],
  content: [],
  other: OTHER_FIELDS,
};

/** 新建源时的空壳（字段与 BookSource 默认值一致） */
export function blankBookSource(): Record<string, unknown> {
  return {
    bookSourceUrl: '',
    bookSourceName: '',
    bookSourceGroup: null,
    bookSourceType: 0,
    bookUrlPattern: null,
    customOrder: 0,
    enabled: true,
    enabledExplore: true,
    jsLib: null,
    enabledCookieJar: true,
    concurrentRate: null,
    header: null,
    loginUrl: null,
    loginUi: null,
    loginCheckJs: null,
    coverDecodeJs: null,
    bookSourceComment: null,
    variableComment: null,
    lastUpdateTime: 0,
    respondTime: 180000,
    weight: 0,
    exploreUrl: null,
    exploreScreen: null,
    ruleExplore: null,
    searchUrl: null,
    ruleSearch: null,
    ruleBookInfo: null,
    ruleToc: null,
    ruleContent: null,
    mainJs: null,
    eventListener: false,
    customButton: false,
  };
}
