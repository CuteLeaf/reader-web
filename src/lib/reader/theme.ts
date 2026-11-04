/** 阅读主题：6 套配色，按 body / content / popup 三层组织（页面底色、正文纸色、弹层）。 */
export interface Theme {
  id: number;
  name: string;
  body: string;
  content: string;
  popup: string;
  text: string;
  textSub: string;
  border: string;
  night: boolean;
}

export const THEMES: Theme[] = [
  {
    id: 0,
    name: '纯白',
    body: '#f7f7f7',
    content: '#ffffff',
    popup: '#ffffff',
    text: '#262626',
    textSub: '#8a8f98',
    border: '#e6e6e6',
    night: false,
  },
  {
    id: 1,
    name: '米黄',
    body: '#efe6d2',
    content: '#f8f2e4',
    popup: '#f8f2e4',
    text: '#3b352b',
    textSub: '#8d8271',
    border: '#e0d5bd',
    night: false,
  },
  {
    id: 2,
    name: '护眼',
    body: '#cde6cd',
    content: '#e3f0dd',
    popup: '#e3f0dd',
    text: '#2f3a2c',
    textSub: '#6c7a67',
    border: '#c2d8bd',
    night: false,
  },
  {
    id: 3,
    name: '灰调',
    body: '#dcdfe2',
    content: '#e9ebed',
    popup: '#e9ebed',
    text: '#33373d',
    textSub: '#7a8088',
    border: '#d0d4d8',
    night: false,
  },
  {
    id: 4,
    name: '夜间',
    body: '#1c1f23',
    content: '#262a2f',
    popup: '#2b3036',
    text: '#b9bec6',
    textSub: '#7c848e',
    border: '#383e45',
    night: true,
  },
  {
    id: 5,
    name: '纯黑',
    body: '#000000',
    content: '#0a0a0a',
    popup: '#141414',
    text: '#8f8f8f',
    textSub: '#5a5a5a',
    border: '#232323',
    night: true,
  },
];

export function themeById(id: number): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export const FONT_STACKS: Array<{ label: string; value: string }> = [
  {
    label: '系统默认',
    value: `'Microsoft YaHei', 'PingFang SC', -apple-system, 'Noto Sans SC', sans-serif`,
  },
  { label: '宋体', value: `'Songti SC', 'SimSun', 'Noto Serif SC', serif` },
  { label: '楷体', value: `'Kaiti SC', 'KaiTi', 'STKaiti', serif` },
  { label: '等宽', value: `'JetBrains Mono', 'Cascadia Code', Consolas, monospace` },
];
