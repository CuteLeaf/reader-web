<script lang="ts">
  import { onMount } from 'svelte';
  import BookCard from './BookCard.svelte';
  import { app } from '../stores/app.svelte';
  import { storageEstimate } from '../lib/storage/db';
  import { describeError } from '../lib/sources/legado';
  import type { Book } from '../lib/types';

  /** 侧栏左上角的标记与 favicon 用同一份图形，改一处两边都变 */
  const brandMark = `${import.meta.env.BASE_URL}favicon.svg`;
  const REPO_URL = 'https://github.com/CuteLeaf/reader-web';

  let usage = $state<{ usage: number; quota: number } | null>(null);

  /** 上千本书一次渲染会卡，按批追加（IntersectionObserver 触底加载） */
  const PAGE = 48;
  let limit = $state(PAGE);
  let sentinel = $state<HTMLDivElement | null>(null);

  onMount(() => {
    void storageEstimate().then((v) => (usage = v ?? null));
  });

  const books = $derived(app.allBooks);
  const shown = $derived(books.slice(0, limit));
  const localCount = $derived(app.localBooks.length);
  const remoteCount = $derived(app.remoteBooks.length);

  function fmtMB(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  // 换筛选/搜索时重置分页
  $effect(() => {
    void app.filter;
    void app.search;
    limit = PAGE;
  });

  $effect(() => {
    const el = sentinel;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) limit = Math.min(limit + PAGE, books.length);
      },
      { rootMargin: '800px' },
    );
    io.observe(el);
    return () => io.disconnect();
  });

  async function handleRemove(book: Book) {
    if (book.source === 'local') {
      if (!confirm(`从本地书架移除《${book.title}》？正文会一并删除，不可恢复。`)) return;
      await app.removeLocalBook(book);
      usage = (await storageEstimate()) ?? null;
      return;
    }
    if (!confirm(`从手机的书架删除《${book.title}》？这会同步删除手机上的记录。`)) return;
    try {
      await app.removeRemoteBook(book);
    } catch (e) {
      app.toast(describeError(e), 'error');
    }
  }

  const statusText = $derived(
    app.endpointState === 'connecting'
      ? '正在连接…'
      : app.endpointState === 'online'
        ? (app.endpoint ?? '').replace(/^https?:\/\//, '')
        : app.endpointState === 'offline'
          ? '连接失败'
          : '未连接后端',
  );
</script>

{#snippet githubLink()}
  <a
    class="gh"
    href={REPO_URL}
    target="_blank"
    rel="noopener noreferrer"
    title="reader-web"
    aria-label="reader-web"
  >
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  </a>
{/snippet}

<div class="shelf">
  <aside class="side">
    <header class="brand">
      <img class="mark" src={brandMark} alt="" width="38" height="38" />
      <div>
        <h1>阅读</h1>
        <p>清风不识字，何故乱翻书</p>
      </div>
      {@render githubLink()}
    </header>

    <div class="segmented" role="tablist">
      <button class:active={app.filter === 'all'} onclick={() => app.setFilter('all')} role="tab">
        全部 <span>{localCount + remoteCount}</span>
      </button>
      <button
        class:active={app.filter === 'local'}
        onclick={() => app.setFilter('local')}
        role="tab"
      >
        本地 <span>{localCount}</span>
      </button>
      <button
        class:active={app.filter === 'remote'}
        onclick={() => app.setFilter('remote')}
        role="tab"
      >
        局域网 <span>{remoteCount}</span>
      </button>
    </div>

    <div class="search">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M16.5 16.5 21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <input class="search-input" placeholder="搜索书名 / 作者" bind:value={app.search} />
    </div>

    <section class="status">
      <div class="status-head">
        <span
          class="dot"
          class:online={app.endpointState === 'online'}
          class:pending={app.endpointState === 'connecting'}
        ></span>
        <span class="status-text" title={app.endpoint ?? ''}>{statusText}</span>
      </div>
      <div class="status-actions">
        <button class="btn sm primary" onclick={() => (app.connectOpen = true)}>
          扫描 / 连接
        </button>
        {#if app.endpoint}
          <button class="btn sm ghost" onclick={() => app.disconnect()}>断开</button>
        {/if}
      </div>
    </section>

    <section class="actions">
      <button class="action" onclick={() => (app.importOpen = true)}>
        <span class="ico">＋</span>
        <span>
          <b>导入 / 传书</b>
          <em>存到本地，或传到手机</em>
        </span>
      </button>
      <button class="action" onclick={() => (app.connectOpen = true)}>
        <span class="ico">◎</span>
        <span>
          <b>发现局域网后端</b>
          <em>Legado 3.0 Web 服务</em>
        </span>
      </button>
      {#if app.endpoint}
        <button class="action" onclick={() => (app.sourcesOpen = true)}>
          <span class="ico">≡</span>
          <span>
            <b>书源 / 订阅源</b>
            <em>启停、删除、导入</em>
          </span>
        </button>
      {/if}
      <button class="action" data-ld="open" onclick={() => (app.localDataOpen = true)}>
        <span class="ico">▤</span>
        <span>
          <b>本地数据</b>
          <em>查看、编辑与备份本机记录</em>
        </span>
      </button>
    </section>

    <footer class="side-foot">
      {#if usage}
        <span class="usage">本地已用 {fmtMB(usage.usage)}</span>
      {:else}
        <span class="usage">本地存储</span>
      {/if}
      <div class="foot-right">
        <span class="ver">reader-web v1.0.2</span>
        {@render githubLink()}
      </div>
    </footer>
  </aside>

  <main class="main">
    {#if books.length > 0}
      <div class="grid">
        {#each shown as book (book.id)}
          <BookCard {book} onopen={() => app.openBook(book)} onremove={() => handleRemove(book)} />
        {/each}
      </div>
      {#if limit < books.length}
        <div class="more" bind:this={sentinel}>
          <button class="btn sm" onclick={() => (limit = Math.min(limit + PAGE * 2, books.length))}>
            加载更多（已显示 {shown.length} / {books.length}）
          </button>
        </div>
      {:else if books.length > PAGE}
        <div class="more muted">已全部加载 · {books.length} 本</div>
      {/if}
    {:else}
      <div class="empty">
        <div class="empty-art">
          <span></span><span></span><span></span>
        </div>
        <h2>{app.search ? '没有匹配的书' : '书架还是空的'}</h2>
        <p>
          {#if app.search}
            换个关键词试试，或者清空搜索框。
          {:else}
            连接同一局域网里「Legado 3.0」的 Web 服务，或直接把本地书籍导入进来。
          {/if}
        </p>
        {#if !app.search}
          <div class="empty-actions">
            <button class="btn primary" onclick={() => (app.connectOpen = true)}>扫描局域网</button>
            <button class="btn" onclick={() => (app.importOpen = true)}>导入本地书</button>
          </div>
        {/if}
      </div>
    {/if}
  </main>
</div>

<style>
  .shelf {
    display: grid;
    grid-template-columns: 272px 1fr;
    height: 100vh;
    height: 100dvh;
  }

  .side {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 18px;
    padding: 30px 22px 16px;
    border-right: 1px solid var(--line);
    background: var(--panel-soft);
  }

  .brand {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .mark {
    width: 38px;
    height: 38px;
    border-radius: 9px;
    display: block;
    flex: 0 0 auto;
    box-shadow: 0 4px 12px rgba(181, 83, 60, 0.28);
  }

  .brand h1 {
    margin: 0;
    font-size: 17px;
    letter-spacing: 3px;
    font-family: var(--font-serif);
  }

  .brand p {
    margin: 1px 0 0;
    font-size: 11px;
    color: var(--sub);
    letter-spacing: 0.5px;
  }

  .segmented {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    background: rgba(31, 35, 40, 0.045);
    padding: 3px;
    border-radius: 10px;
    gap: 2px;
  }

  .segmented button {
    height: 28px;
    padding: 0 2px;
    border-radius: 7px;
    font-size: 11.5px;
    white-space: nowrap;
    overflow: hidden;
    color: var(--sub);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    transition: all 0.16s ease;
  }

  .segmented button span {
    font-size: 10px;
    opacity: 0.7;
  }

  .segmented button.active {
    background: var(--panel);
    color: var(--ink);
    box-shadow: var(--shadow-sm);
    font-weight: 600;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 11px;
    border-radius: 9px;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    color: var(--sub);
  }

  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .search-input {
    border: none;
    background: none;
    outline: none;
    width: 100%;
    font-size: 12.5px;
    color: var(--ink);
  }

  .status {
    padding: 11px 12px;
    border-radius: 11px;
    background: var(--panel);
    border: 1px solid var(--line);
  }

  .status-head {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 9px;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #c3c8ce;
    flex: 0 0 auto;
  }

  .dot.online {
    background: #4caf7d;
    box-shadow: 0 0 0 3px rgba(76, 175, 125, 0.16);
  }

  .dot.pending {
    background: #e0a33c;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  .status-text {
    font-size: 12px;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-actions {
    display: flex;
    gap: 6px;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .action {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 11px;
    border-radius: 11px;
    background: var(--panel);
    border: 1px dashed var(--line-strong);
    text-align: left;
    transition: all 0.16s ease;
  }

  .action:hover {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .action .ico {
    font-size: 15px;
    color: var(--accent);
    width: 18px;
    text-align: center;
  }

  .action b {
    display: block;
    font-size: 12.5px;
    font-weight: 600;
  }

  .action em {
    display: block;
    font-style: normal;
    font-size: 10.5px;
    color: var(--sub);
    margin-top: 1px;
  }

  .side-foot {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10.5px;
    /* 与 .gh 的 22px 点击区同高，保证两侧文字与图标共用一条水平中心线 */
    line-height: 22px;
    color: var(--sub);
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }

  .foot-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .gh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    color: var(--sub);
    text-decoration: none;
    transition:
      color 0.16s ease,
      background 0.16s ease;
  }

  .gh:hover,
  .gh:focus-visible {
    color: var(--ink);
    background: color-mix(in srgb, var(--ink) 8%, transparent);
  }

  /* 品牌行里的那份只在窄屏出现，桌面端用页脚里的 */
  .brand > .gh {
    display: none;
  }

  .main {
    min-width: 0;
    overflow: auto;
    padding: 28px 30px 60px;
  }

  /* 不设上限：2K/4K 屏上让网格铺满，列数由 auto-fill 决定；
     下限用 min(300px, 100%)，窄屏容器不足 300px 时也不会把列撑出容器 */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
    gap: 12px;
    min-width: 0;
  }

  .more {
    display: flex;
    justify-content: center;
    padding: 22px 0 8px;
  }

  .more.muted {
    font-size: 11.5px;
    color: var(--sub);
  }

  .empty {
    height: 100%;
    min-height: 60vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--sub);
  }

  .empty-art {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    margin-bottom: 22px;
  }

  .empty-art span {
    width: 26px;
    height: 76px;
    border-radius: 4px;
    background: linear-gradient(160deg, #fff, #efece3);
    border: 1px solid var(--line-strong);
  }

  .empty-art span:nth-child(2) {
    height: 92px;
    background: linear-gradient(160deg, #fdf3ef, #f0dcd4);
  }

  .empty-art span:nth-child(3) {
    height: 66px;
  }

  .empty h2 {
    margin: 0 0 6px;
    font-size: 16px;
    font-weight: 600;
    color: var(--ink);
  }

  .empty p {
    margin: 0;
    font-size: 12.5px;
    max-width: 340px;
    line-height: 1.7;
  }

  .empty-actions {
    display: flex;
    gap: 10px;
    margin-top: 20px;
  }

  /* 大屏只放大留白与间距，卡片宽度保持 300 上下，靠列数去铺满 */
  @media (min-width: 1600px) {
    .main {
      padding: 32px 40px 80px;
    }

    .grid {
      gap: 14px;
    }
  }

  @media (min-width: 2200px) {
    .main {
      padding: 36px 48px 96px;
    }

    .grid {
      gap: 16px;
    }
  }

  @media (max-width: 860px) {
    .shelf {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto 1fr;
      height: auto;
      min-height: 100dvh;
    }

    .side {
      border-right: none;
      border-bottom: 1px solid var(--line);
      padding: 18px 16px 14px;
      gap: 12px;
    }

    .brand p,
    .side-foot {
      display: none;
    }

    /* 窄屏把 GitHub 入口放进品牌行，顶到右侧与「阅读」标题同行居中 */
    .brand > .gh {
      display: inline-flex;
      margin-left: auto;
    }

    .actions {
      flex-direction: row;
    }

    .action {
      flex: 1;
      padding: 9px 10px;
      border-style: solid;
    }

    .action em {
      display: none;
    }
    .main {
      padding: 16px;
    }

    /* 单列时用 minmax(0, 1fr)：1fr 的最小值是 auto，会被卡片内容（封面 + nowrap 文案）
       顶到 391px 左右，窄屏下就撑出容器、右侧被裁掉 */
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* 浏览器侧栏最窄约 300px：入口竖排，避免标题折字 */
  @media (max-width: 340px) {
    .actions {
      flex-direction: column;
    }

    .action {
      flex: 0 0 auto;
    }
  }
</style>
