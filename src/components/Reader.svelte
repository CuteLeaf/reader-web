<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../stores/app.svelte';
  import { themeById } from '../lib/reader/theme';
  import CatalogDrawer from './CatalogDrawer.svelte';
  import SettingsDialog from './SettingsDialog.svelte';

  let scroller = $state<HTMLDivElement | null>(null);
  // 换章后停在哪：上一章往回翻时停在底部，否则回到顶部
  let pendingAnchor: 'top' | 'bottom' = 'top';
  const theme = $derived(themeById(app.settings.theme));
  const progress = $derived(
    app.chapters.length ? ((app.chapterIndex + 1) / app.chapters.length) * 100 : 0,
  );

  $effect(() => {
    void app.scrollToken;
    // 正文还没渲染时（骨架屏）算出来的 scrollHeight 是假的，等真正上屏后再定位
    if (app.contentLoading) return;
    const el = scroller;
    if (!el) return;
    if (pendingAnchor === 'bottom') {
      el.scrollTop = el.scrollHeight;
      pendingAnchor = 'top';
      return;
    }
    // 和手机端同步过进度时，回到上次读到的位置
    const restore = app.takeRestorePos();
    if (restore > 0) {
      scrollToCharOffset(el, restore);
      return;
    }
    el.scrollTop = 0;
  });

  /** 把滚动位置换算成「本章内已读字符数」，与后端 durChapterPos 同义 */
  function charOffsetAt(el: HTMLDivElement): number {
    const content = el.querySelector('.content');
    if (!content) return 0;
    const lineTop = el.getBoundingClientRect().top + 4;
    let offset = 0;
    for (const p of content.querySelectorAll('p')) {
      if (p.getBoundingClientRect().bottom > lineTop) return offset;
      offset += p.textContent?.length ?? 0;
    }
    return offset;
  }

  /** 按字符偏移滚到对应段落，用于恢复上次的阅读位置 */
  function scrollToCharOffset(el: HTMLDivElement, pos: number): void {
    const content = el.querySelector('.content');
    if (!content) return;
    let offset = 0;
    for (const p of content.querySelectorAll('p')) {
      offset += p.textContent?.length ?? 0;
      if (offset >= pos) {
        const delta = p.getBoundingClientRect().top - el.getBoundingClientRect().top;
        el.scrollTop += delta - 8;
        return;
      }
    }
    el.scrollTop = el.scrollHeight;
  }

  let scrollRaf = 0;

  /** 滚动只上报位置，落盘与回传由 store 做防抖 */
  function onScroll(): void {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const el = scroller;
      if (!el || app.contentLoading) return;
      app.reportProgress(charOffsetAt(el));
    });
  }

  const PAGE_RATIO = 0.88;

  function atBottom(): boolean {
    const el = scroller;
    return !!el && el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
  }

  function atTop(): boolean {
    return !!scroller && scroller.scrollTop <= 8;
  }

  /** 向下翻一屏；到底了自动进入下一章 */
  async function pageDown() {
    const el = scroller;
    if (!el) return;
    if (atBottom()) {
      await go(1);
      return;
    }
    el.scrollBy({ top: el.clientHeight * PAGE_RATIO, behavior: 'smooth' });
  }

  /** 向上翻一屏；到顶了回到上一章的末尾 */
  async function pageUp() {
    const el = scroller;
    if (!el) return;
    if (atTop()) {
      pendingAnchor = 'bottom';
      await go(-1);
      return;
    }
    el.scrollBy({ top: -el.clientHeight * PAGE_RATIO, behavior: 'smooth' });
  }

  async function go(delta: number) {
    if (delta > 0) await app.nextChapter();
    else await app.prevChapter();
    await tick();
  }

  function onKeydown(e: KeyboardEvent) {
    if (app.catalogOpen || app.settingsOpen) {
      if (e.key === 'Escape') {
        app.catalogOpen = false;
        app.settingsOpen = false;
      }
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        void go(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        void go(1);
        break;
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        void pageDown();
        break;
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        void pageUp();
        break;
      case 'Escape':
        app.backToShelf();
        break;
    }
  }
</script>

<svelte:window
  onkeydown={onKeydown}
  onpagehide={() => void app.flushProgress({ force: true, keepalive: true })}
/>

<div
  class="reader"
  class:night={theme.night}
  style:--r-body={theme.body}
  style:--r-content={theme.content}
  style:--r-text={theme.text}
  style:--r-sub={theme.textSub}
  style:--r-border={theme.border}
>
  <div class="progress"><div class="fill" style:width={`${progress}%`}></div></div>

  <nav class="tools left">
    <button onclick={() => (app.catalogOpen = true)} title="目录">
      <svg viewBox="0 0 24 24" width="16" height="16"
        ><path
          d="M4 6h16M4 12h16M4 18h10"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          fill="none"
        /></svg
      >
      <span>目录</span>
    </button>
    <button onclick={() => (app.settingsOpen = true)} title="设置">
      <svg viewBox="0 0 24 24" width="16" height="16"
        ><circle
          cx="12"
          cy="12"
          r="3.2"
          stroke="currentColor"
          stroke-width="1.6"
          fill="none"
        /><path
          d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        /></svg
      >
      <span>设置</span>
    </button>
    <button onclick={() => app.backToShelf()} title="返回书架">
      <svg viewBox="0 0 24 24" width="16" height="16"
        ><path
          d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"
          stroke="currentColor"
          stroke-width="1.6"
          fill="none"
          stroke-linejoin="round"
        /></svg
      >
      <span>书架</span>
    </button>
    <button onclick={() => scroller?.scrollTo({ top: 0, behavior: 'smooth' })} title="回到顶部">
      <svg viewBox="0 0 24 24" width="16" height="16"
        ><path
          d="M12 19V6M6 12l6-6 6 6"
          stroke="currentColor"
          stroke-width="1.7"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
      <span>顶部</span>
    </button>
  </nav>

  <div class="scroller" bind:this={scroller} onscroll={onScroll}>
    <article
      class="paper"
      class:loading={app.contentLoading}
      style:max-width={`${app.settings.readWidth}px`}
      style:font-size={`${app.settings.fontSize}px`}
      style:line-height={app.settings.lineHeight}
      style:font-family={app.settings.fontFamily}
      style:--letter-gap={`${app.settings.letterSpacing}px`}
      style:--para-gap={`${app.settings.paragraphSpacing}em`}
    >
      <header class="chapter-head">
        <span class="book-name">{app.current?.title}</span>
        <h2>{app.chapterTitle}</h2>
        <span class="chapter-no">{app.chapterIndex + 1} / {app.chapters.length}</span>
      </header>

      {#if app.contentLoading}
        <div class="skeleton">
          {#each [92, 100, 97, 99, 88, 100, 94, 60] as w, i (i)}
            <div class="line" style:width={`${w}%`}></div>
          {/each}
        </div>
      {:else}
        <div class="content">
          {#each app.paragraphs as p, i (i)}
            <p>{p}</p>
          {/each}
        </div>
      {/if}

      <footer class="chapter-foot">
        <button class="btn nav-btn" onclick={() => go(-1)} disabled={app.chapterIndex === 0}>
          ← 上一章
        </button>
        <button class="btn nav-btn" onclick={() => (app.catalogOpen = true)}>目录</button>
        <button
          class="btn nav-btn"
          onclick={() => go(1)}
          disabled={app.chapterIndex >= app.chapters.length - 1}>下一章 →</button
        >
      </footer>
    </article>
  </div>

  {#if app.catalogOpen}<CatalogDrawer />{/if}
  {#if app.settingsOpen}<SettingsDialog />{/if}
</div>

<style>
  .reader {
    position: relative;
    height: 100vh;
    height: 100dvh;
    background: var(--r-body);
    color: var(--r-text);
    transition:
      background 0.2s ease,
      color 0.2s ease;
  }

  .progress {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: color-mix(in srgb, var(--r-text) 12%, transparent);
    z-index: 60;
  }

  .fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.24s ease;
  }

  .tools.left {
    position: fixed;
    left: 18px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 6px;
    border-radius: 14px;
    background: var(--r-content);
    border: 1px solid var(--r-border);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.07);
    z-index: 50;
  }

  .tools button {
    width: 52px;
    padding: 7px 0 5px;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    color: var(--r-sub);
    transition:
      background 0.16s ease,
      color 0.16s ease;
  }

  .tools button span {
    font-size: 10px;
    letter-spacing: 0.5px;
  }

  .tools button:hover {
    background: color-mix(in srgb, var(--r-text) 8%, transparent);
    color: var(--r-text);
  }

  /* 正文区：上下贴边不留白，左右保留纸张色块与边框，两侧衬底用 body 色 */
  .scroller {
    height: 100%;
    overflow-y: auto;
    padding: 0;
    background: var(--r-body);
  }

  .paper {
    margin: 0 auto;
    min-height: 100%;
    background: var(--r-content);
    border-left: 1px solid var(--r-border);
    border-right: 1px solid var(--r-border);
    padding: 40px 56px 64px;
  }

  .chapter-head {
    text-align: center;
    margin-bottom: 40px;
  }

  .book-name {
    display: block;
    font-size: 11px;
    letter-spacing: 1.4px;
    color: var(--r-sub);
    margin-bottom: 12px;
    text-transform: uppercase;
  }

  .chapter-head h2 {
    margin: 0;
    font-size: 1.32em;
    font-weight: 600;
    line-height: 1.5;
    letter-spacing: 0.5px;
  }

  .chapter-no {
    display: inline-block;
    margin-top: 12px;
    font-size: 11px;
    color: var(--r-sub);
    letter-spacing: 1px;
  }

  /* 字距只作用于正文，标题和按钮保持原样 */
  .content {
    letter-spacing: var(--letter-gap, 0);
  }

  .content p {
    margin: 0 0 var(--para-gap, 0.95em);
    text-indent: 2em;
    word-break: break-word;
    hyphens: auto;
  }

  .content p:last-child {
    margin-bottom: 0;
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 6px 0;
  }

  .line {
    height: 12px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--r-text) 9%, transparent);
    animation: shimmer 1.2s ease-in-out infinite;
  }

  @keyframes shimmer {
    50% {
      opacity: 0.45;
    }
  }

  .chapter-foot {
    margin-top: 48px;
    padding-top: 20px;
    border-top: 1px solid var(--r-border);
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  /* 加载时只有几行骨架占位，撑不满一屏；改用弹性布局把翻章/目录按钮沉到纸张底部 */
  .paper.loading {
    display: flex;
    flex-direction: column;
  }

  .paper.loading .skeleton {
    margin-bottom: 28px;
  }

  .paper.loading .chapter-foot {
    margin-top: auto;
  }

  .nav-btn {
    background: transparent;
    border-color: var(--r-border);
    color: var(--r-sub);
  }

  .night .nav-btn:hover {
    color: #fff;
  }

  @media (max-width: 860px) {
    .scroller {
      padding: 0;
    }

    .paper {
      padding: 22px 18px 104px;
      max-width: 100% !important;
      border-left: none;
      border-right: none;
    }

    .tools.left {
      left: 50%;
      top: auto;
      bottom: 14px;
      transform: translateX(-50%);
      flex-direction: row;
      padding: 6px 8px;
      border-radius: 18px;
    }

    .tools button {
      width: 58px;
    }

    .chapter-head {
      margin-bottom: 26px;
    }

    .chapter-foot {
      margin-top: 32px;
    }
  }
</style>
