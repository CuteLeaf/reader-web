<script lang="ts">
  import { app } from '../stores/app.svelte';
  import { tts } from '../lib/tts/player.svelte';
  import { offline } from '../lib/dict/offlineStore.svelte';
  import {
    channelAvailable,
    channelsFor,
    lookup,
    resolveChannel,
    type DictChannel,
    type DictResult,
  } from '../lib/dict';

  let { term, onclose }: { term: string; onclose: () => void } = $props();

  let phase = $state<'loading' | 'ok' | 'missing' | 'error' | 'blocked'>('loading');
  let result = $state<DictResult | null>(null);
  let error = $state('');
  let attempt = $state(0);
  let active = $state('');
  /** 首选渠道不可用自动换渠道时的说明 */
  let fallbackNote = $state('');

  // 离线词库没下载时不出现在渠道列表里，避免点开是空的
  const channels = $derived(channelsFor(term).filter((c) => c.id !== 'offline' || offline.ready));
  const current = $derived(channels.find((c) => c.id === active) ?? channels[0] ?? null);
  const pageUrl = $derived(current?.url?.(term) ?? '');

  // 打开面板时同步离线词库状态
  $effect(() => {
    void offline.refresh();
  });

  // 词条或渠道变化时先选好渠道：沿用上次用的，语言不匹配就用该语言第一个
  $effect(() => {
    const word = term;
    const preferred = app.settings.dictChannel;
    const picked = resolveChannel(word, preferred);
    active = picked?.id ?? '';
    fallbackNote = '';
  });

  // 真正发起查询；换渠道会重新查，但命中缓存时是同步返回
  $effect(() => {
    const word = term;
    const channel = current;
    void attempt;

    if (!channel) {
      phase = 'missing';
      return;
    }

    // 没有 CORS 头的站点在普通网页里读不到响应，直接给出解释而不是抛错
    if (!channelAvailable(channel)) {
      phase = 'blocked';
      result = null;
      return;
    }

    const ctrl = new AbortController();
    phase = 'loading';
    result = null;
    error = '';

    void run(word, channel, ctrl.signal);

    return () => ctrl.abort();
  });

  /**
   * 依次尝试当前渠道和它后面的可用渠道。
   * 首选渠道连不上（被墙、超时）或没收录时自动换下一个，并在面板里说明，
   * 避免「打开就是一句查询失败」。
   */
  async function run(word: string, channel: DictChannel, signal: AbortSignal): Promise<void> {
    const usable = channels.filter((c) => channelAvailable(c));
    const startIndex = Math.max(
      0,
      usable.findIndex((c) => c.id === channel.id),
    );
    const order = [...usable.slice(startIndex), ...usable.slice(0, startIndex)];
    let lastError = '';
    let missed = false;

    for (const target of order) {
      try {
        const hit = await lookup(word, target, signal);
        if (signal.aborted) return;
        if (hit) {
          result = hit;
          phase = 'ok';
          // 结果来自别的渠道时，把标签也切过去，并说明为什么换了：
          // 连不上是「不可用」，查不到是「未收录」，两者对用户含义不同
          if (target.id !== channel.id) {
            active = target.id;
            fallbackNote = lastError
              ? `「${channel.label}」暂时不可用，已改用「${target.label}」`
              : `「${channel.label}」未收录，已改用「${target.label}」`;
          }
          return;
        }
        missed = true;
      } catch (e: unknown) {
        if (signal.aborted) return;
        lastError = (e as Error)?.message || '查询失败';
      }
    }
    void missed;

    if (signal.aborted) return;
    if (lastError) {
      // 有渠道是「连不上」而不是「没收录」时，别说成未收录
      error = lastError;
      phase = 'error';
      return;
    }
    phase = 'missing';
  }

  function switchChannel(id: string): void {
    if (id === active) return;
    active = id;
    fallbackNote = '';
    app.updateSettings({ dictChannel: id });
  }

  function readWord(): void {
    const ok = tts.play(term);
    if (!ok) app.toast('当前浏览器不支持语音朗读', 'error');
  }
</script>

<section class="dict" aria-label="词典释义">
  <header class="head">
    <div class="title">
      <b>{term}</b>
      {#if result?.phonetic}
        <span class="phonetic">{result.phonetic}</span>
      {/if}
    </div>
    <button class="close" onclick={onclose} title="关闭" aria-label="关闭">✕</button>
  </header>

  {#if channels.length > 1}
    <div class="channels" role="tablist" aria-label="词典渠道">
      {#each channels as channel (channel.id)}
        <button
          type="button"
          class="chip"
          class:on={channel.id === active}
          class:limited={!channelAvailable(channel)}
          role="tab"
          aria-selected={channel.id === active}
          title={channelAvailable(channel) ? channel.label : `${channel.label}（仅浏览器扩展可用）`}
          onclick={() => switchChannel(channel.id)}
        >
          {channel.label}
        </button>
      {/each}
      <span class="source">{current?.label ?? ''}</span>
    </div>
  {/if}

  <div class="body">
    {#if phase === 'loading'}
      <div class="skeleton">
        <span style:width="72%"></span>
        <span style:width="94%"></span>
        <span style:width="88%"></span>
        <span style:width="60%"></span>
      </div>
    {:else if phase === 'ok' && result}
      {#if fallbackNote}
        <p class="note">{fallbackNote}</p>
      {/if}
      {#if result.note}
        <p class="note">{result.note}</p>
      {/if}
      {#each result.blocks as block, i (i)}
        <div class="block">
          {#if block.heading && block.heading !== result.phonetic}
            <h4>{block.heading}</h4>
          {/if}
          {#each block.lines as line, j (j)}
            <p>{line}</p>
          {/each}
        </div>
      {/each}
    {:else if phase === 'missing'}
      <div class="empty">
        <b>「{term}」在{current?.label ?? '当前渠道'}里没有收录</b>
        <p>
          {#if channels.length > 1}
            换个渠道试试，或到浏览器里看是否有其他写法。
          {:else}
            可以到浏览器里看是否有其他写法。
          {/if}
        </p>
      </div>
    {:else if phase === 'blocked'}
      <div class="empty">
        <b>{current?.label} 仅能在浏览器扩展里使用</b>
        <p>该渠道没有开放跨域访问，普通网页读不到它的内容。换成「萌典」「维基词典」等渠道即可。</p>
      </div>
    {:else}
      <div class="empty">
        <b>查询失败</b>
        <p>
          {error || '网络或服务暂不可用'}{#if channels.length > 1}，换个渠道可能就好了{/if}
        </p>
      </div>
    {/if}
  </div>

  <footer class="foot">
    <button class="btn sm" onclick={readWord}>朗读该词</button>
    {#if phase === 'error'}
      <button class="btn sm" onclick={() => (attempt += 1)}>重试</button>
    {/if}
    {#if pageUrl}
      <a class="btn sm" href={result?.url ?? pageUrl} target="_blank" rel="noreferrer">浏览器打开</a
      >
    {/if}
    <span class="tip">释义来自{current?.label ?? '第三方词典'}</span>
  </footer>
</section>

<style>
  .dict {
    position: fixed;
    z-index: 90;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    width: min(520px, calc(100vw - 20px));
    max-height: min(62vh, 460px);
    display: flex;
    flex-direction: column;
    border-radius: 16px;
    background: var(--panel);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-md);
    animation: dict-in 0.16s ease-out;
  }

  @keyframes dict-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px 8px;
  }

  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .title b {
    font-size: 16px;
    font-family: var(--font-serif);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .phonetic {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--sub);
  }

  .close {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    border: 1px solid var(--line);
    border-radius: 50%;
    background: transparent;
    color: var(--sub);
    font-size: 12px;
    cursor: pointer;
  }

  .close:hover {
    color: var(--ink);
  }

  .channels {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    /* 上下都留出空间：标签贴着滚动容器边缘时，1px 边框会被裁掉一截 */
    padding: 6px 14px 8px;
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .channels::-webkit-scrollbar {
    display: none;
  }

  .chip {
    flex: 0 0 auto;
    height: 24px;
    padding: 0 9px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--sub);
    font-size: 11.5px;
    cursor: pointer;
    transition:
      color 0.15s ease,
      border-color 0.15s ease,
      background 0.15s ease;
  }

  .chip:hover {
    color: var(--ink);
  }

  .chip.on {
    color: var(--accent);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  /* 网页版里不可用的渠道：加个虚线下划线暗示，hover 有完整说明 */
  .chip.limited {
    border-style: dashed;
    opacity: 0.75;
  }

  .source {
    margin-left: auto;
    flex: 0 0 auto;
    font-size: 10.5px;
    color: var(--sub);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 10px 14px;
    font-size: 13px;
    line-height: 1.75;
    color: var(--ink-soft);
  }

  .note {
    margin: 0 0 8px;
    padding: 4px 8px;
    border-radius: 8px;
    background: var(--panel-soft);
    font-size: 11.5px;
    color: var(--sub);
  }

  .block + .block {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--line);
  }

  h4 {
    margin: 0 0 4px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--sub);
    letter-spacing: 0.3px;
  }

  p {
    margin: 0 0 2px;
  }

  .empty {
    padding: 8px 0 4px;
  }

  .empty b {
    display: block;
    font-size: 13px;
    color: var(--ink);
    margin-bottom: 4px;
  }

  .empty p {
    font-size: 12px;
    color: var(--sub);
    line-height: 1.7;
  }

  .skeleton {
    display: grid;
    gap: 8px;
    padding: 4px 0;
  }

  .skeleton span {
    height: 11px;
    border-radius: 6px;
    background: var(--panel-soft);
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.55;
    }
    50% {
      opacity: 1;
    }
  }

  .foot {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 14px 12px;
    border-top: 1px solid var(--line);
  }

  .tip {
    margin-left: auto;
    font-size: 10px;
    color: var(--sub);
  }

  a.btn {
    text-decoration: none;
  }

  @media (max-width: 760px) {
    .dict {
      bottom: 8px;
      width: calc(100vw - 16px);
      max-height: 62vh;
    }
  }
</style>
