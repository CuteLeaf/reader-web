<script lang="ts">
  import type { Book } from '../lib/types';

  let { book, onopen, onremove }: { book: Book; onopen: () => void; onremove?: () => void } =
    $props();

  const initial = $derived((book.title || '书').trim().charAt(0));
  const hue = $derived(
    [...(book.title || '')].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 7),
  );
  let coverBroken = $state(false);
  const showCover = $derived(!!book.coverUrl && !coverBroken);
</script>

<div
  class="card"
  onclick={onopen}
  role="button"
  tabindex="0"
  onkeydown={(e) => e.key === 'Enter' && onopen()}
>
  <div
    class="cover"
    style:background={showCover
      ? undefined
      : `linear-gradient(150deg, hsl(${hue} 26% 88%), hsl(${(hue + 28) % 360} 22% 78%))`}
  >
    {#if showCover}
      <img
        src={book.coverUrl}
        alt={book.title}
        loading="lazy"
        onerror={() => (coverBroken = true)}
      />
    {:else}
      <span class="glyph" style:color={`hsl(${hue} 34% 34%)`}>{initial}</span>
    {/if}
    {#if book.source === 'local'}
      <span class="badge">{book.format?.toUpperCase() ?? '本地'}</span>
    {/if}
  </div>

  <div class="meta">
    <h3 title={book.title}>{book.title}</h3>
    <p class="author">{book.author || '未知作者'}</p>
    <p class="progress">
      {#if book.durChapterTitle}
        读至 · {book.durChapterTitle}
      {:else}
        尚未开始阅读
      {/if}
    </p>
    <p class="foot">
      {#if book.totalChapterNum}{book.totalChapterNum} 章{/if}
      {#if book.source === 'legado'}<span class="dot">·</span>局域网{/if}
    </p>
  </div>

  {#if onremove}
    <button
      class="remove"
      title="移除书籍"
      onclick={(e) => {
        e.stopPropagation();
        onremove?.();
      }}>✕</button
    >
  {/if}
</div>

<style>
  .card {
    position: relative;
    display: flex;
    gap: 14px;
    /* 允许在窄容器里收缩：否则封面 + nowrap 文案的 min-content 会把卡片撑宽 */
    min-width: 0;
    padding: 14px;
    border-radius: 14px;
    background: var(--panel);
    border: 1px solid var(--line);
    cursor: pointer;
    transition:
      transform 0.18s ease,
      box-shadow 0.18s ease,
      border-color 0.18s ease;
  }

  .card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
    border-color: transparent;
  }

  .card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .cover {
    position: relative;
    flex: 0 0 76px;
    width: 76px;
    height: 102px;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.05);
  }

  /* 绝对定位 + object-fit，避免不同长宽比的封面把卡片撑高或被顶到一边 */
  .cover img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .glyph {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-family: var(--font-serif);
    font-size: 32px;
    line-height: 1;
    opacity: 0.9;
  }

  .badge {
    position: absolute;
    left: 0;
    bottom: 0;
    padding: 1px 5px;
    font-size: 9px;
    letter-spacing: 0.4px;
    color: #fff;
    background: rgba(31, 35, 40, 0.62);
    border-radius: 0 6px 0 0;
  }

  .meta {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
  }

  h3 {
    margin: 0;
    font-size: 14.5px;
    font-weight: 600;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .author,
  .progress,
  .foot {
    margin: 0;
    font-size: 12px;
    color: var(--sub);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .progress {
    margin-top: 4px;
    color: var(--ink-soft);
    opacity: 0.82;
  }

  .foot {
    margin-top: 6px;
    font-size: 11px;
  }

  .dot {
    margin: 0 4px;
  }

  .remove {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 11px;
    color: var(--sub);
    background: var(--panel-soft);
    border: 1px solid var(--line);
    opacity: 0;
    transition:
      opacity 0.15s ease,
      color 0.15s ease;
  }

  .card:hover .remove {
    opacity: 1;
  }

  .remove:hover {
    color: var(--danger);
    border-color: var(--danger);
  }
</style>
