import { isExtension } from '../env.ts';
import { englishChannel } from './english.ts';
import { haiciEnChannel, haiciZhChannel } from './haici.ts';
import { moedictChannel } from './moedict.ts';
import { offlineChannel } from './offline.ts';
import { readCache, writeCache } from './cache.ts';
import type { DictChannel, DictLang, DictResult } from './types.ts';
import { wiktionaryChannel } from './wiktionary.ts';
import { translateChannel } from './translate.ts';
import { youdaoChannel } from './youdao.ts';

export type { DictBlock, DictChannel, DictLang, DictResult } from './types.ts';

/**
 * 词典渠道：对齐手机端「阅读」内置的那几条规则（萌典、海词中文、海词英文、有道），
 * 外加跨域友好的维基词典与英文词典作为补充。
 *
 * 手机端能直接跑这些渠道，是因为它在原生环境发请求并解析页面；
 * 浏览器里没有 CORS 头的站点只有扩展能读，因此渠道上标了 `cors` 能力。
 */
export const CHANNELS: DictChannel[] = [
  offlineChannel,
  moedictChannel,
  haiciZhChannel,
  wiktionaryChannel,
  youdaoChannel,
  englishChannel,
  translateChannel,
  haiciEnChannel,
];

/** 每个语言下的推荐顺序：先跨域可用的（网页版也能用），再是仅扩展的 */
const PREFERRED: Record<DictLang, string[]> = {
  // 离线词库下载后排在最前：本地查询最快，也不依赖网络
  zh: ['offline', 'wiktionary', 'moedict', 'haici-zh', 'youdao'],
  // 英文词优先给中文译文，其次才是英文释义与扩展内渠道
  en: ['translate', 'english', 'haici-en', 'youdao'],
};

/** 按词条判断语言，决定可用渠道 */
export function langOf(term: string): DictLang {
  return /[\u4e00-\u9fff]/.test(term) ? 'zh' : 'en';
}

/** 当前环境能否使用该渠道 */
export function channelAvailable(channel: DictChannel): boolean {
  return channel.cors !== 'extension' || isExtension();
}

/** 当前词条可用的渠道，按推荐顺序排列 */
export function channelsFor(term: string): DictChannel[] {
  const lang = langOf(term);
  const order = PREFERRED[lang];
  const list = order
    .map((id) => CHANNELS.find((channel) => channel.id === id))
    .filter((channel): channel is DictChannel => !!channel && channel.langs.includes(lang));
  // 兜底：以后新增但没写进 PREFERRED 的渠道也要能出现
  for (const channel of CHANNELS) {
    if (channel.langs.includes(lang) && !list.includes(channel)) list.push(channel);
  }
  return list;
}

/** 选渠道：优先沿用用户上次选择，语言不匹配时回落到该语言第一个可用渠道 */
export function resolveChannel(term: string, preferred?: string): DictChannel | null {
  const list = channelsFor(term);
  if (!list.length) return null;
  // 用户明确选过的渠道就按他的选择来；当前环境用不了时由面板解释原因，
  // 而不是悄悄换一个渠道让他以为是这个渠道的结果
  if (preferred) {
    const picked = list.find((channel) => channel.id === preferred);
    if (picked) return picked;
  }
  return list.find(channelAvailable) ?? list[0];
}

/** 进程内缓存：同一本书里反复查同一个词不必重新请求 */
const cache = new Map<string, DictResult | null>();

/** 单个渠道的超时时间：维基类站点在部分网络下会一直挂着，不能让面板无限转圈 */
const TIMEOUT_MS = 4500;

export async function lookup(
  term: string,
  channel: DictChannel,
  signal?: AbortSignal,
): Promise<DictResult | null> {
  const key = `${channel.id}:${term}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  // 本地词库直接读，没必要经过持久化缓存
  if (channel.id !== 'offline') {
    const cached = await readCache(key);
    if (cached.hit) {
      cache.set(key, cached.result);
      return cached.result;
    }
  }

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const result = await channel.lookup(term, merged).catch((e: unknown) => {
    const name = (e as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new Error('请求超时');
    throw e;
  });
  cache.set(key, result);
  if (channel.id !== 'offline') void writeCache(key, result);
  return result;
}
