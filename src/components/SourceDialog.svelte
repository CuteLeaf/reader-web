<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { app } from '../stores/app.svelte';
  import {
    deleteSources,
    fetchSources,
    metaOf,
    parseSourceJson,
    saveSource,
    saveSources,
    verifyToken,
    type AnySource,
    type SourceKind,
  } from '../lib/sources/sources';
  import { describeError } from '../lib/sources/legado';

  const PAGE_SIZE = 40;

  let kind = $state<SourceKind>('book');
  let lists = $state<Record<SourceKind, AnySource[]>>({ book: [], rss: [] });
  let loaded = $state<Record<SourceKind, boolean>>({ book: false, rss: false });
  let loading = $state(false);
  let error = $state('');
  let keyword = $state('');
  let onlyEnabled = $state(false);
  let page = $state(1);
  let tokenInput = $state(app.sourceToken);
  /** 需要令牌但还没验证通过时，先不给加载 */
  let gated = $state(false);
  let gateToken = $state(app.sourceToken);
  let gateError = $state('');
  let verifying = $state(false);
  let showImport = $state(false);
  let importText = $state('');
  let importing = $state(false);
  let busyUrl = $state<string | null>(null);
  let importInput = $state<HTMLInputElement | null>(null);

  const endpointLabel = $derived(app.endpoint?.replace(/^https?:\/\//, '') ?? '');
  const all = $derived(lists[kind]);
  const filtered = $derived.by(() => {
    const q = keyword.trim().toLowerCase();
    return all.filter((s) => {
      const m = metaOf(kind, s);
      if (onlyEnabled && !m.enabled) return false;
      if (!q) return true;
      return `${m.name} ${m.group} ${m.url}`.toLowerCase().includes(q);
    });
  });
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const pageItems = $derived(filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
  const enabledCount = $derived(all.filter((s) => metaOf(kind, s).enabled).length);
  const tokenRequired = $derived(app.sourceTokenRequired);
  /** 只有后端明确要求时才带令牌头 */
  const writeToken = $derived(tokenRequired === true ? app.sourceToken || undefined : undefined);

  $effect(() => {
    void keyword;
    void onlyEnabled;
    page = 1;
  });

  onMount(() => {
    void init();
  });

  // 编辑器保存后刷新当前列表（只依赖版本号，避免读 loaded/kind 触发自身）
  let lastVersion = 0;
  $effect(() => {
    const v = app.sourcesVersion;
    untrack(() => {
      if (v === lastVersion) return;
      lastVersion = v;
      if (!gated) void load(kind, true);
    });
  });

  async function init() {
    if (!app.endpoint) return;
    if (app.sourceTokenRequired === null) await app.probeSourceToken();

    if (app.sourceTokenRequired === true) {
      // 该版本要令牌：先校验，通过了才去拉源列表（书源可能很大，不想白拉）
      if (!app.sourceToken) {
        gated = true;
        return;
      }
      const ok = await verifyToken(app.endpoint, app.sourceToken);
      if (!ok) {
        gated = true;
        gateError = '令牌无效或已过期，请重新输入';
        return;
      }
    }
    await load('book');
  }

  async function unlockWithToken() {
    if (!app.endpoint) return;
    const token = gateToken.trim();
    if (!token) {
      gateError = '请输入令牌';
      return;
    }
    verifying = true;
    gateError = '';
    try {
      const ok = await verifyToken(app.endpoint, token);
      if (!ok) {
        gateError = '令牌不正确，检查手机上的「书源访问令牌」';
        return;
      }
      app.setSourceToken(token);
      app.sourceTokenRequired = true;
      gated = false;
      await load(kind, true);
    } finally {
      verifying = false;
    }
  }

  async function load(target: SourceKind, force = false) {
    if (!app.endpoint) return;
    if (loaded[target] && !force) return;
    loading = true;
    error = '';
    try {
      const list = await fetchSources(app.endpoint, target);
      lists = { ...lists, [target]: list };
      loaded = { ...loaded, [target]: true };
    } catch (e) {
      error = describeError(e);
    } finally {
      loading = false;
    }
  }

  async function switchKind(next: SourceKind) {
    kind = next;
    page = 1;
    keyword = '';
    await load(next);
  }

  function sameSource(a: AnySource, b: AnySource): boolean {
    const ma = metaOf(kind, a);
    const mb = metaOf(kind, b);
    return ma.url === mb.url;
  }

  async function toggle(source: AnySource) {
    if (!app.endpoint) return;
    const meta = metaOf(kind, source);
    if (tokenRequired === true && !app.sourceToken) {
      error = '需要先在下方填入访问令牌才能修改源';
      return;
    }
    busyUrl = meta.url;
    const next = { ...source, enabled: !meta.enabled };
    const prev = lists[kind];
    lists = { ...lists, [kind]: prev.map((s) => (sameSource(s, source) ? next : s)) };
    try {
      await saveSource(app.endpoint, kind, next, writeToken);
    } catch (e) {
      lists = { ...lists, [kind]: prev };
      error = describeError(e);
      if ((e as { kind?: string }).kind === 'auth') app.sourceTokenRequired = true;
    } finally {
      busyUrl = null;
    }
  }

  async function remove(source: AnySource) {
    if (!app.endpoint) return;
    const meta = metaOf(kind, source);
    if (
      !confirm(
        `删除${kind === 'book' ? '书源' : '订阅源'}「${meta.name || meta.url}」？手机上会立即消失。`,
      )
    )
      return;
    busyUrl = meta.url;
    try {
      await deleteSources(app.endpoint, kind, [source], writeToken);
      lists = { ...lists, [kind]: lists[kind].filter((s) => !sameSource(s, source)) };
      app.toast(`已删除「${meta.name || meta.url}」`, 'info');
    } catch (e) {
      error = describeError(e);
      if ((e as { kind?: string }).kind === 'auth') app.sourceTokenRequired = true;
    } finally {
      busyUrl = null;
    }
  }

  async function doImport() {
    if (!app.endpoint) return;
    let sources: AnySource[];
    try {
      sources = parseSourceJson(importText);
    } catch (e) {
      error = (e as Error).message;
      return;
    }
    const valid = sources.filter((s) => {
      const m = metaOf(kind, s);
      return m.name && m.url;
    });
    if (!valid.length) {
      error = `没有识别到合法的${kind === 'book' ? '书源' : '订阅源'}（需要名称和 URL 字段）`;
      return;
    }
    importing = true;
    try {
      if (valid.length === 1) await saveSource(app.endpoint, kind, valid[0], writeToken);
      else await saveSources(app.endpoint, kind, valid, writeToken);
      await load(kind, true);
      app.toast(`已导入 ${valid.length} 个${kind === 'book' ? '书源' : '订阅源'}`, 'success');
      importText = '';
      showImport = false;
    } catch (e) {
      error = describeError(e);
      if ((e as { kind?: string }).kind === 'auth') app.sourceTokenRequired = true;
    } finally {
      importing = false;
    }
  }

  function onImportFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => (importText = String(reader.result ?? ''));
    reader.readAsText(file);
    input.value = '';
  }

  const close = () => (app.sourcesOpen = false);
  const accept = $derived(kind === 'book' ? '.json,.txt' : '.json,.txt');
</script>

<div class="backdrop" onclick={(e) => e.target === e.currentTarget && close()} role="presentation">
  <div class="modal" style:width="900px">
    <div class="modal-header">
      <div>
        <div class="modal-title">书源 · 订阅源</div>
        <div class="modal-desc">直接读写手机上的「阅读」，改动即时生效（写操作需要访问令牌）。</div>
      </div>
      <button class="btn ghost sm" onclick={close}>✕</button>
    </div>

    <div class="modal-body">
      {#if tokenRequired === true && app.sourceToken && !gated}
        <div class="hint-bar ok">已通过令牌校验，可读写源。</div>
      {:else if tokenRequired === false}
        <div class="hint-bar">该后端未启用令牌校验，可直接修改源。</div>
      {:else if tokenRequired === null}
        <div class="hint-bar">
          这个版本的后端没有令牌机制（如 legado-with-MD3 分支），写操作会直接提交；
          若提示令牌错误，再填入令牌即可。
        </div>
      {/if}

      {#if gated}
        <div class="gate">
          <div class="gate-icon">🔒</div>
          <b>这个后端需要书源访问令牌</b>
          <p>
            手机端「阅读 → 我的 → 设置 → 其他设置 → Web 服务 → 书源访问令牌」里设置一个口令，
            填到下面验证通过后才会加载源列表（令牌只保存在本机浏览器）。
          </p>
          <div class="gate-row">
            <input
              class="input"
              type="password"
              placeholder="粘贴令牌"
              bind:value={gateToken}
              onkeydown={(e) => e.key === 'Enter' && unlockWithToken()}
            />
            <button class="btn primary" onclick={unlockWithToken} disabled={verifying}>
              {verifying ? '验证中…' : '验证并加载'}
            </button>
          </div>
          {#if gateError}
            <div class="err">{gateError}</div>
          {/if}
        </div>
      {:else}
        <div class="tabs">
          <button class="tab" class:active={kind === 'book'} onclick={() => switchKind('book')}>
            书源 <span>{lists.book.length || '—'}</span>
          </button>
          <button class="tab" class:active={kind === 'rss'} onclick={() => switchKind('rss')}>
            订阅源 <span>{lists.rss.length || '—'}</span>
          </button>
          <div class="spacer"></div>
          <input class="input search" placeholder="搜索名称 / 分组 / 地址" bind:value={keyword} />
          <button
            class="btn sm"
            class:primary={onlyEnabled}
            onclick={() => (onlyEnabled = !onlyEnabled)}
          >
            只看启用
          </button>
          <button class="btn sm" onclick={() => load(kind, true)} disabled={loading}>刷新</button>
          <button class="btn sm" onclick={() => (showImport = !showImport)}>导入</button>
          <button class="btn sm primary" onclick={() => app.openEditor(kind, null)}>新建</button>
        </div>

        {#if showImport}
          <div class="import">
            <textarea
              class="input area"
              placeholder={`粘贴${kind === 'book' ? '书源' : '订阅源'} JSON：单条对象或数组都行`}
              bind:value={importText}></textarea>
            <div class="import-actions">
              <button class="btn sm" onclick={() => importInput?.click()}>选择 JSON 文件</button>
              <input bind:this={importInput} type="file" {accept} hidden onchange={onImportFile} />
              <div class="spacer"></div>
              <button class="btn sm" onclick={() => (showImport = false)}>取消</button>
              <button
                class="btn sm primary"
                onclick={doImport}
                disabled={importing || !importText.trim()}
              >
                {importing ? '导入中…' : '导入'}
              </button>
            </div>
          </div>
        {/if}

        {#if error}
          <div class="err" role="alert">{error}</div>
        {/if}

        <div class="stats">
          {#if loading && !all.length}
            正在读取，书源多时可能要几秒…
          {:else}
            共 {all.length} 个，启用 {enabledCount} 个{#if keyword || onlyEnabled}，筛选出 {filtered.length}
              个{/if}
          {/if}
        </div>

        <div class="list">
          {#if loading && !all.length}
            {#each Array(6) as _, i (i)}
              <div class="row skeleton"><i></i></div>
            {/each}
          {:else if filtered.length === 0}
            <p class="none">{all.length ? '没有匹配的源' : '还没有加载到源'}</p>
          {:else}
            {#each pageItems as source, i (metaOf(kind, source).url + i)}
              {@const meta = metaOf(kind, source)}
              <div class="row" class:dim={!meta.enabled}>
                <div class="main">
                  <div class="name">
                    {meta.name || '（未命名）'}
                    {#if meta.group}<span class="tag">{meta.group}</span>{/if}
                  </div>
                  <div class="url" title={meta.url}>{meta.url}</div>
                </div>
                <button class="edit" title="编辑" onclick={() => app.openEditor(kind, source)}
                  >编辑</button
                >
                <button
                  class="switch"
                  class:on={meta.enabled}
                  title={meta.enabled ? '点击停用' : '点击启用'}
                  disabled={busyUrl === meta.url}
                  onclick={() => toggle(source)}
                  aria-pressed={meta.enabled}
                >
                  <i></i>
                </button>
                <button
                  class="del"
                  title="删除"
                  disabled={busyUrl === meta.url}
                  onclick={() => remove(source)}>✕</button
                >
              </div>
            {/each}
          {/if}
        </div>

        {#if pageCount > 1}
          <div class="pager">
            <button
              class="btn sm"
              onclick={() => (page = Math.max(1, page - 1))}
              disabled={page === 1}>上一页</button
            >
            <span>{page} / {pageCount}</span>
            <button
              class="btn sm"
              onclick={() => (page = Math.min(pageCount, page + 1))}
              disabled={page === pageCount}
            >
              下一页
            </button>
          </div>
        {/if}
      {/if}
    </div>

    <div class="modal-footer">
      <span class="foot">{endpointLabel}</span>
      <div class="spacer"></div>
      {#if tokenRequired === true && !gated}
        <input
          class="input token"
          placeholder="访问令牌 x-legado-token"
          bind:value={tokenInput}
          onkeydown={(e) => e.key === 'Enter' && app.setSourceToken(tokenInput)}
        />
        <button class="btn sm" onclick={() => app.setSourceToken(tokenInput)}>保存令牌</button>
      {/if}
      <button class="btn primary" onclick={close}>关闭</button>
    </div>
  </div>
</div>

<style>
  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .hint-bar.ok {
    color: var(--green);
    background: #f3faf6;
    border-color: #cfe6d9;
  }

  .hint-bar {
    font-size: 11px;
    color: var(--green);
    background: #f3faf6;
    border: 1px solid #cfe6d9;
    border-radius: 8px;
    padding: 6px 10px;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .tab {
    height: 30px;
    padding: 0 12px;
    border-radius: 8px;
    font-size: 12.5px;
    color: var(--sub);
    border: 1px solid transparent;
  }

  .tab span {
    font-size: 10.5px;
    opacity: 0.7;
  }

  .tab.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }

  .search {
    width: 200px;
    height: 30px;
    font-size: 12px;
  }

  .import {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border-radius: 10px;
    background: var(--panel-soft);
    border: 1px solid var(--line);
  }

  .area {
    height: 120px;
    padding: 8px 10px;
    font-size: 11.5px;
    line-height: 1.6;
    font-family: var(--font-mono, monospace);
    resize: vertical;
  }

  .import-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .err {
    padding: 8px 11px;
    border-radius: 8px;
    font-size: 11.5px;
    background: #fdecea;
    border: 1px solid #f5c6c0;
    color: #a33325;
  }

  .stats {
    font-size: 11px;
    color: var(--sub);
  }

  .gate {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
    padding: 26px 20px;
    margin: 6px 0 12px;
    border-radius: 12px;
    border: 1px dashed var(--line-strong);
    background: var(--panel-soft);
  }

  .gate-icon {
    font-size: 20px;
  }

  .gate b {
    font-size: 13.5px;
  }

  .gate p {
    margin: 0;
    font-size: 11.5px;
    color: var(--sub);
    line-height: 1.7;
    max-width: 560px;
  }

  .gate-row {
    display: flex;
    gap: 8px;
    width: 100%;
    max-width: 460px;
  }

  .gate .err {
    width: 100%;
  }

  .list {
    flex: 1;
    min-height: 220px;
    max-height: 52vh;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
  }

  .row:last-child {
    border-bottom: none;
  }

  .row.dim .name,
  .row.dim .url {
    opacity: 0.55;
  }

  .row.skeleton {
    height: 44px;
  }

  .row.skeleton i {
    display: block;
    width: 60%;
    height: 10px;
    border-radius: 4px;
    background: var(--line);
    animation: shimmer 1.2s infinite;
  }

  @keyframes shimmer {
    50% {
      opacity: 0.45;
    }
  }

  .main {
    min-width: 0;
    flex: 1;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .url {
    font-size: 10.5px;
    color: var(--sub);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 1px;
  }

  .switch {
    flex: 0 0 auto;
    width: 38px;
    height: 22px;
    border-radius: 999px;
    background: var(--line-strong);
    position: relative;
    transition: background 0.16s ease;
  }

  .switch i {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    transition: transform 0.16s ease;
  }

  .switch.on {
    background: var(--accent);
  }

  .switch.on i {
    transform: translateX(16px);
  }

  .edit {
    flex: 0 0 auto;
    height: 22px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 11px;
    color: var(--sub);
    border: 1px solid var(--line);
  }

  .edit:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .del {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    font-size: 10px;
    color: var(--sub);
  }

  .del:hover {
    color: var(--danger);
    background: rgba(0, 0, 0, 0.06);
  }

  .none {
    text-align: center;
    font-size: 12px;
    color: var(--sub);
    padding: 40px 0;
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    font-size: 11.5px;
    color: var(--sub);
  }

  .modal-footer {
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .foot {
    font-size: 11px;
    color: var(--sub);
    font-variant-numeric: tabular-nums;
  }

  .token {
    width: 190px;
    height: 30px;
    font-size: 11.5px;
  }

  @media (max-width: 760px) {
    .search {
      width: 100%;
    }
    .list {
      max-height: 40vh;
    }
  }
</style>
