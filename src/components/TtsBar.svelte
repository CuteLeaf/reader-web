<script lang="ts">
  import { app } from '../stores/app.svelte';
  import { tts } from '../lib/tts/player.svelte';

  const RATES = [0.75, 1, 1.25, 1.5];

  // 语速存在阅读设置里，换设备/刷新后仍生效
  $effect(() => {
    tts.setRate(app.settings.ttsRate);
  });

  function cycleRate(): void {
    const index = RATES.indexOf(tts.rate);
    const next = RATES[(index + 1) % RATES.length] ?? 1;
    app.updateSettings({ ttsRate: next });
  }
</script>

{#if tts.state !== 'idle'}
  <div class="tts-bar" role="region" aria-label="朗读控制">
    <button
      class="round"
      onclick={() => tts.toggle()}
      title={tts.state === 'playing' ? '暂停' : '继续'}
      aria-label={tts.state === 'playing' ? '暂停' : '继续'}
    >
      {#if tts.state === 'playing'}
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <rect x="7" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" />
          <rect x="13.4" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
        </svg>
      {/if}
    </button>

    <button class="round sm" onclick={() => tts.prev()} disabled={tts.index === 0} title="上一句">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          d="M7 5v14M19 6v12l-9-6z"
          fill="currentColor"
          stroke="currentColor"
          stroke-width="1.2"
        />
      </svg>
    </button>

    <button
      class="round sm"
      onclick={() => tts.next()}
      disabled={tts.index >= tts.total - 1}
      title="下一句"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          d="M17 5v14M5 6v12l9-6z"
          fill="currentColor"
          stroke="currentColor"
          stroke-width="1.2"
        />
      </svg>
    </button>

    <div class="meta">
      <span class="count">{tts.index + 1} / {tts.total}</span>
      <span class="piece" title={tts.current}>{tts.current}</span>
    </div>

    <button class="rate" onclick={cycleRate} title="切换语速">{tts.rate}x</button>

    <button class="round sm" onclick={() => tts.stop()} title="停止朗读" aria-label="停止朗读">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          d="M7 7l10 10M17 7L7 17"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </div>
{/if}

<style>
  .tts-bar {
    position: fixed;
    left: 50%;
    bottom: 16px;
    z-index: 75;
    transform: translateX(-50%);
    width: min(560px, calc(100vw - 24px));
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    border-radius: 14px;
    background: var(--panel);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-md);
  }

  .round {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    cursor: pointer;
  }

  .round.sm {
    width: 28px;
    height: 28px;
    background: var(--panel-soft);
    color: var(--ink);
  }

  .round:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .meta {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 0 4px;
  }

  .count {
    flex: 0 0 auto;
    font-size: 10.5px;
    color: var(--sub);
    font-variant-numeric: tabular-nums;
  }

  .piece {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 12px;
    color: var(--ink-soft);
  }

  .rate {
    flex: 0 0 auto;
    height: 26px;
    padding: 0 7px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: transparent;
    color: var(--sub);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  .rate:hover {
    color: var(--ink);
    border-color: var(--accent);
  }

  /* 窄屏底部工具条高度约 60px，朗读条要压在它上面 */
  @media (max-width: 760px) {
    .tts-bar {
      bottom: 76px;
    }
  }
</style>
