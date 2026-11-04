<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../stores/app.svelte';
  import { themeById } from '../lib/reader/theme';

  const theme = $derived(themeById(app.settings.theme));
  let keyword = $state('');
  let listEl = $state<HTMLDivElement | null>(null);

  const filtered = $derived(
    keyword.trim() ? app.chapters.filter((c) => c.title.includes(keyword.trim())) : app.chapters,
  );

  onMount(() => {
    const active = listEl?.querySelector('.item.active');
    active?.scrollIntoView({ block: 'center' });
  });
</script>

<div class="scrim" onclick={() => (app.catalogOpen = false)} role="presentation"></div>

<aside
  class="drawer"
  style:--c-bg={theme.content}
  style:--c-text={theme.text}
  style:--c-sub={theme.textSub}
  style:--c-line={theme.border}
>
  <header>
    <div>
      <h3>目录</h3>
      <p>{app.current?.title} · 共 {app.chapters.length} 章</p>
    </div>
    <button class="close" onclick={() => (app.catalogOpen = false)} aria-label="关闭">✕</button>
  </header>

  <div class="filter">
    <input class="input" placeholder="搜索章节" bind:value={keyword} />
  </div>

  <div class="list" bind:this={listEl}>
    {#each filtered as chapter (chapter.index)}
      <button
        class="item"
        class:active={chapter.index === app.chapterIndex}
        onclick={() => app.jumpTo(chapter.index)}
      >
        <span class="idx">{chapter.index + 1}</span>
        <span class="name">{chapter.title}</span>
        {#if chapter.index === app.chapterIndex}<span class="here">当前</span>{/if}
      </button>
    {/each}
    {#if filtered.length === 0}
      <p class="none">没有匹配的章节</p>
    {/if}
  </div>
</aside>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 120;
    background: rgba(20, 18, 14, 0.24);
    animation: fade 0.16s ease;
  }

  .drawer {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 130;
    width: min(340px, 86vw);
    display: flex;
    flex-direction: column;
    background: var(--c-bg);
    color: var(--c-text);
    border-right: 1px solid var(--c-line);
    box-shadow: 8px 0 32px rgba(0, 0, 0, 0.12);
    animation: slide 0.2s cubic-bezier(0.2, 0.8, 0.3, 1);
  }

  @keyframes slide {
    from {
      transform: translateX(-16px);
      opacity: 0.4;
    }
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 20px 18px 12px;
  }

  header h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 1px;
  }

  header p {
    margin: 3px 0 0;
    font-size: 11px;
    color: var(--c-sub);
  }

  .close {
    color: var(--c-sub);
    font-size: 13px;
    padding: 4px;
  }

  .filter {
    padding: 0 14px 10px;
  }

  .filter :global(.input) {
    background: color-mix(in srgb, var(--c-text) 5%, transparent);
    border-color: var(--c-line);
    color: var(--c-text);
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 16px;
  }

  .item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    text-align: left;
    font-size: 12.5px;
    color: color-mix(in srgb, var(--c-text) 78%, transparent);
    transition: background 0.14s ease;
  }

  .item:hover {
    background: color-mix(in srgb, var(--c-text) 6%, transparent);
  }

  .item.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .idx {
    flex: 0 0 32px;
    font-size: 10px;
    color: var(--c-sub);
    font-variant-numeric: tabular-nums;
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .here {
    font-size: 9.5px;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--accent);
    color: #fff;
  }

  .none {
    text-align: center;
    font-size: 12px;
    color: var(--c-sub);
    padding: 24px 0;
  }
</style>
