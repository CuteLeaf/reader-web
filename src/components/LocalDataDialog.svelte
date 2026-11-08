<script lang="ts">
  /**
   * 本地数据管理面板：应用里所有需要本机保存的轻量业务数据都在这里查看与维护。
   *
   * 交互沿用设置面板的风格：未保存的改动先留在内存，点「保存」才写盘；
   * 「重新加载」以磁盘为准丢弃改动。大体积数据（书籍正文、字体、词库）仍由
   * IndexedDB 管理，这里只展示条数与职责说明，不搬动它们。
   */
  import { app } from '../stores/app.svelte';
  import { normalizeBase } from '../lib/sources/legado';
  import {
    appLocalData,
    inspectLocalData,
    LocalDataError,
    LOCAL_DATA_KEY,
    LOCAL_DATA_SCOPES,
    type CollectionKey,
    type LocalDataOverview,
    type LocalDataSnapshot,
    type NewRecord,
    type ShelfFilter,
  } from '../lib/storage/localData';

  type Row = Record<string, unknown> & { id: string; createdAt: number; updatedAt: number };

  interface FieldDef {
    name: string;
    label: string;
    placeholder?: string;
    required?: boolean;
    number?: boolean;
  }

  const COLLECTIONS: { key: CollectionKey; label: string; desc: string }[] = [
    {
      key: 'endpoints',
      label: '后端地址',
      desc: '连接后端时会自动记下地址，可改备注、删除或一键连接，连接窗口也能直接选用。',
    },
    { key: 'tokens', label: '书源令牌', desc: '每个后端一个访问令牌，只存在本机。' },
    { key: 'progress', label: '阅读进度', desc: '章节与位置的轻量记录，正文仍在本地数据库。' },
  ];

  const FIELDS: Record<CollectionKey, FieldDef[]> = {
    endpoints: [
      { name: 'base', label: '后端地址', required: true, placeholder: 'http://192.168.1.5:1122' },
      { name: 'label', label: '备注', placeholder: '可留空，例如「书房手机」' },
    ],
    tokens: [
      { name: 'base', label: '后端地址', required: true, placeholder: 'http://192.168.1.5:1122' },
      { name: 'token', label: '访问令牌', required: true, placeholder: '后端设置的令牌' },
    ],
    progress: [
      { name: 'bookId', label: '书籍 id', required: true, placeholder: '书架里的书籍标识' },
      { name: 'index', label: '章节序号', required: true, number: true },
      { name: 'pos', label: '章节内位置', required: true, number: true },
      { name: 'title', label: '章节标题', placeholder: '可留空' },
    ],
  };

  let collection = $state<CollectionKey>('endpoints');
  let snapshot = $state<LocalDataSnapshot>(appLocalData.view());
  let overview = $state<LocalDataOverview | null>(null);
  let dirty = $state(appLocalData.isDirty);
  let degraded = $state(appLocalData.isDegraded);
  let message = $state('');
  let error = $state('');
  let formOpen = $state(false);
  let editingId = $state<string | null>(null);
  let detailId = $state<string | null>(null);
  let form = $state<Record<string, string>>({});
  let prefEditing = $state(false);
  let connectingBase = $state<string | null>(null);
  let prefEndpoint = $state('');
  let prefFilter = $state<ShelfFilter>('all');
  let importInput = $state<HTMLInputElement | null>(null);

  const rows = $derived(
    (snapshot[collection] as unknown as Row[]).slice().sort((a, b) => a.createdAt - b.createdAt),
  );
  const activeCollection = $derived(
    COLLECTIONS.find((c) => c.key === collection) ?? COLLECTIONS[0],
  );
  const prefs = $derived(snapshot.preferences);

  $effect(() => {
    void loadOverview();
    syncPrefForm();
  });

  async function loadOverview(): Promise<void> {
    try {
      overview = await inspectLocalData();
    } catch {
      overview = null;
    }
  }

  function syncPrefForm(): void {
    prefEndpoint = appLocalData.getPreferences().endpoint;
    prefFilter = appLocalData.getPreferences().filter;
  }

  function refresh(): void {
    snapshot = appLocalData.view();
    dirty = appLocalData.isDirty;
    degraded = appLocalData.isDegraded;
    detailId = null;
    syncPrefForm();
    void loadOverview();
  }

  function notify(text: string): void {
    message = text;
    error = '';
  }

  function fail(e: unknown): void {
    error = e instanceof Error ? e.message : String(e);
    message = '';
  }

  function fmtTime(ts: number): string {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString('zh-CN', { hour12: false });
    } catch {
      return '—';
    }
  }

  function mask(value: string): string {
    return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
  }

  function primary(key: CollectionKey, row: Row): string {
    if (key === 'progress') return String(row.title || row.bookId || '（未命名）');
    return String(row.base ?? '');
  }

  function secondary(key: CollectionKey, row: Row): string {
    if (key === 'endpoints') {
      const used = row.lastUsedAt
        ? ` · 最近连接 ${new Date(Number(row.lastUsedAt)).toLocaleDateString('zh-CN')}`
        : '';
      return `${String(row.label || '无备注')}${used}`;
    }
    if (key === 'tokens') return `令牌 ${mask(String(row.token ?? ''))}`;
    return `第 ${Number(row.index ?? 0) + 1} 章 · 位置 ${row.pos ?? 0} · ${row.bookId ?? ''}`;
  }

  function detailJSON(key: CollectionKey, row: Row): string {
    const view = { ...row };
    if (key === 'tokens') view.token = mask(String(view.token ?? ''));
    return JSON.stringify(view, null, 2);
  }

  function switchCollection(key: CollectionKey): void {
    collection = key;
    formOpen = false;
    editingId = null;
    detailId = null;
    error = '';
  }

  function openCreate(): void {
    const next: Record<string, string> = {};
    for (const f of FIELDS[collection]) next[f.name] = f.number ? '0' : '';
    form = next;
    editingId = null;
    formOpen = true;
    detailId = null;
    error = '';
  }

  function openEdit(row: Row): void {
    const next: Record<string, string> = {};
    for (const f of FIELDS[collection]) next[f.name] = String(row[f.name] ?? (f.number ? '0' : ''));
    form = next;
    editingId = row.id;
    formOpen = true;
    detailId = null;
    error = '';
  }

  function closeForm(): void {
    formOpen = false;
    editingId = null;
    error = '';
  }

  function buildInput(): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const f of FIELDS[collection]) {
      const raw = (form[f.name] ?? '').trim();
      if (f.required && !raw) throw new LocalDataError('invalid', `${f.label}不能为空`);
      // 地址统一成后端探测用的规范形式，避免「192.168.1.5」与连接成功写回的
      // 「http://192.168.1.5:1122」被当成两条不同记录
      let value = raw;
      if (collection === 'endpoints' && f.name === 'base' && raw) {
        try {
          value = normalizeBase(raw);
        } catch (err) {
          throw new LocalDataError('invalid', (err as Error).message || '后端地址格式不正确');
        }
      }
      if (f.number) {
        const n = Number(raw || 0);
        if (!Number.isFinite(n) || n < 0) {
          throw new LocalDataError('invalid', `${f.label}必须是非负数字`);
        }
        data[f.name] = n;
      } else if (raw || !f.required) {
        data[f.name] = value;
      }
    }
    return data;
  }

  function createRecord(key: CollectionKey, input: Record<string, unknown>): void {
    if (key === 'endpoints') {
      appLocalData.create('endpoints', input as unknown as NewRecord<'endpoints'>);
    } else if (key === 'tokens') {
      appLocalData.create('tokens', input as unknown as NewRecord<'tokens'>);
    } else {
      appLocalData.create('progress', input as unknown as NewRecord<'progress'>);
    }
  }

  function updateRecord(key: CollectionKey, id: string, patch: Record<string, unknown>): void {
    if (key === 'endpoints') {
      appLocalData.update('endpoints', id, patch as Partial<NewRecord<'endpoints'>>);
    } else if (key === 'tokens') {
      appLocalData.update('tokens', id, patch as Partial<NewRecord<'tokens'>>);
    } else {
      appLocalData.update('progress', id, patch as Partial<NewRecord<'progress'>>);
    }
  }

  function submitForm(e: Event): void {
    e.preventDefault();
    try {
      const input = buildInput();
      if (editingId) updateRecord(collection, editingId, input);
      else createRecord(collection, input);
      closeForm();
      refresh();
      notify('已写入内存，尚未保存到本机；点「保存」后重启仍可恢复');
    } catch (err) {
      fail(err);
    }
  }

  /** 从记录里一键连接：与连接窗口走同一个 app.connect，成功后自动更新最近连接时间 */
  async function connectEndpoint(row: Row): Promise<void> {
    const base = String(row.base ?? '').trim();
    if (!base) return;
    connectingBase = base;
    try {
      const ok = await app.connect(base, { silent: true });
      if (ok) {
        refresh();
        app.localDataOpen = false;
        app.toast(`已连接 · ${base.replace(/^https?:\/\//, '')}`, 'success');
      } else {
        fail(new Error(`连不上 ${base}，请确认手机端 Web 服务已开启`));
      }
    } finally {
      connectingBase = null;
    }
  }

  function removeRow(id: string): void {
    appLocalData.remove(collection, id);
    if (detailId === id) detailId = null;
    refresh();
    notify('记录已删除，点「保存」写入本机');
  }

  function clearRows(): void {
    if (!rows.length) return;
    if (!confirm(`确定清空「${activeCollection.label}」的 ${rows.length} 条记录？保存后生效。`))
      return;
    appLocalData.clear(collection);
    formOpen = false;
    refresh();
    notify('已清空，点「保存」写入本机');
  }

  function save(): void {
    try {
      appLocalData.save();
      app.syncLocalData();
      refresh();
      notify('已保存到本机，重启应用后仍可恢复');
    } catch (err) {
      fail(err);
    }
  }

  function reload(): void {
    if (dirty && !confirm('有未保存的改动，重新加载会丢弃它们。继续？')) return;
    appLocalData.reload();
    app.syncLocalData();
    formOpen = false;
    prefEditing = false;
    refresh();
    notify('已按本机数据重新加载');
  }

  function exportBackup(): void {
    const blob = new Blob([appLocalData.snapshotJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reader-local-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('已导出当前数据快照');
  }

  async function importBackup(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (!confirm('导入备份会覆盖当前本机数据，确定继续？')) return;
      appLocalData.restore(text);
      app.syncLocalData();
      formOpen = false;
      prefEditing = false;
      refresh();
      notify('备份已恢复并写入本机');
    } catch (err) {
      fail(err);
    } finally {
      input.value = '';
    }
  }

  function submitPrefs(e: Event): void {
    e.preventDefault();
    appLocalData.setPreferences({ endpoint: prefEndpoint.trim(), filter: prefFilter });
    prefEditing = false;
    refresh();
    notify('偏好已修改，点「保存」写入本机');
  }

  function localDataOpenSettings(): void {
    app.localDataOpen = false;
    app.settingsOpen = true;
  }

  function close(): void {
    app.localDataOpen = false;
  }
</script>

<div class="ld-backdrop" role="presentation">
  <div class="panel" role="dialog" aria-label="本地数据管理" data-ld="panel">
    <div class="panel-head">
      <div>
        <div class="panel-title">本地数据管理</div>
        <div class="panel-desc">查看、编辑、删除本机记录，保存后重启依然可用。</div>
      </div>
      <button class="btn ghost sm" onclick={close} aria-label="关闭">✕</button>
    </div>

    <div class="status" data-ld="status">
      <span class="tag">{LOCAL_DATA_KEY}</span>
      <span class="tag">v{snapshot.version}</span>
      <span>更新于 {fmtTime(snapshot.updatedAt)}</span>
      {#if dirty}<span class="tag accent" data-ld="dirty">有未保存改动</span>
      {:else}<span class="tag ok">已保存</span>{/if}
      {#if degraded}<span class="tag warn">数据曾损坏，已自动修复</span>{/if}
    </div>

    <div class="panel-body">
      <section class="block">
        <div class="block-head">
          <div>
            <div class="label">数据总览</div>
            <p class="hint">书籍正文、字体与词库体积较大，仍由 IndexedDB 单独管理。</p>
          </div>
          <button class="btn sm ghost" onclick={() => void loadOverview()}>刷新</button>
        </div>
        <div class="stats">
          <div class="stat">
            <b>{overview?.counts.endpoints ?? snapshot.endpoints.length}</b><span>后端地址</span>
          </div>
          <div class="stat">
            <b>{overview?.counts.tokens ?? snapshot.tokens.length}</b><span>书源令牌</span>
          </div>
          <div class="stat">
            <b>{overview?.counts.progress ?? snapshot.progress.length}</b><span>阅读进度</span>
          </div>
          <div class="stat"><b>{overview?.counts.books ?? '—'}</b><span>本地书籍</span></div>
          <div class="stat"><b>{overview?.counts.fonts ?? '—'}</b><span>自定义字体</span></div>
        </div>
        <div class="scopes">
          {#each LOCAL_DATA_SCOPES as item (item.scope)}
            <div class="scope-row">
              <span>{item.scope}</span>
              <span class="tag">{item.store}</span>
            </div>
          {/each}
        </div>
      </section>

      <section class="block">
        <div class="block-head">
          <div>
            <div class="label">记录管理 <b>{rows.length} 条</b></div>
            <p class="hint">{activeCollection.desc}</p>
          </div>
          <button class="btn sm primary" data-ld="new" onclick={openCreate}>＋ 新增</button>
        </div>

        <div class="seg tabs" role="group" aria-label="记录类型">
          {#each COLLECTIONS as c (c.key)}
            <button
              class:active={collection === c.key}
              aria-pressed={collection === c.key}
              data-ld={`tab-${c.key}`}
              onclick={() => switchCollection(c.key)}
            >
              {c.label} <i>{snapshot[c.key].length}</i>
            </button>
          {/each}
        </div>

        {#if formOpen}
          <form class="form" onsubmit={submitForm} data-ld="form">
            <div class="form-title">{editingId ? '编辑记录' : '新增记录'}</div>
            {#each FIELDS[collection] as f (f.name)}
              <label class="field">
                <span
                  >{f.label}{#if f.required}<em>*</em>{/if}</span
                >
                <input
                  class="input"
                  type={f.number ? 'number' : 'text'}
                  min={f.number ? '0' : undefined}
                  step={f.number ? '1' : undefined}
                  placeholder={f.placeholder ?? ''}
                  value={form[f.name] ?? ''}
                  data-ld-input={f.name}
                  oninput={(e) => (form[f.name] = e.currentTarget.value)}
                />
              </label>
            {/each}
            <div class="form-actions">
              <button class="btn sm primary" type="submit" data-ld="submit">
                {editingId ? '保存修改' : '添加'}
              </button>
              <button class="btn sm ghost" type="button" onclick={closeForm}>取消</button>
            </div>
          </form>
        {/if}

        {#if rows.length === 0}
          <div class="empty" data-ld="empty">暂无记录，点「＋ 新增」添加一条。</div>
        {:else}
          <div class="list">
            {#each rows as row (row.id)}
              <div class="item" data-ld="row">
                <div class="item-main">
                  <div class="item-title" title={primary(collection, row)}>
                    {primary(collection, row)}
                  </div>
                  <div class="item-sub">{secondary(collection, row)}</div>
                  <div class="item-meta">更新于 {fmtTime(row.updatedAt)}</div>
                </div>
                <div class="item-actions">
                  {#if collection === 'endpoints'}
                    <button
                      class="btn sm ghost accent"
                      data-ld="connect"
                      disabled={connectingBase === row.base}
                      onclick={() => void connectEndpoint(row)}
                    >
                      {connectingBase === row.base ? '连接中…' : '连接'}
                    </button>
                  {/if}
                  <button
                    class="btn sm ghost"
                    data-ld="view"
                    onclick={() => (detailId = detailId === row.id ? null : row.id)}>查看</button
                  >
                  <button class="btn sm ghost" data-ld="edit" onclick={() => openEdit(row)}
                    >编辑</button
                  >
                  <button
                    class="btn sm ghost danger"
                    data-ld="del"
                    onclick={() => removeRow(row.id)}>删除</button
                  >
                </div>
                {#if detailId === row.id}
                  <pre class="detail" data-ld="detail">{detailJSON(collection, row)}</pre>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <section class="block">
        <div class="block-head">
          <div>
            <div class="label">本机偏好</div>
            <p class="hint">
              阅读设置共 {Object.keys(prefs.settings).length} 项，可在阅读设置里调整。
            </p>
          </div>
          {#if !prefEditing}
            <button class="btn sm ghost" onclick={() => (prefEditing = true)}>编辑</button>
          {/if}
        </div>
        {#if prefEditing}
          <form class="form" onsubmit={submitPrefs}>
            <label class="field">
              <span>上次连接的后端</span>
              <input class="input" bind:value={prefEndpoint} placeholder="留空表示不自动回连" />
            </label>
            <label class="field">
              <span>书架筛选</span>
              <select
                class="input"
                value={prefFilter}
                onchange={(e) => (prefFilter = e.currentTarget.value as ShelfFilter)}
              >
                <option value="all">全部</option>
                <option value="local">本地</option>
                <option value="remote">局域网</option>
              </select>
            </label>
            <div class="form-actions">
              <button class="btn sm primary" type="submit">应用</button>
              <button class="btn sm ghost" type="button" onclick={() => (prefEditing = false)}
                >取消</button
              >
            </div>
          </form>
        {:else}
          <div class="pref-view">
            <span>上次后端：<b>{prefs.endpoint || '未设置'}</b></span>
            <span
              >书架筛选：<b
                >{prefs.filter === 'all' ? '全部' : prefs.filter === 'local' ? '本地' : '局域网'}</b
              ></span
            >
            <button class="btn sm ghost" onclick={localDataOpenSettings}>去阅读设置</button>
          </div>
        {/if}
      </section>
    </div>

    <div class="panel-foot">
      <div class="foot-msg">
        {#if error}<span class="msg error" data-ld="error">{error}</span>
        {:else if message}<span class="msg ok" data-ld="message">{message}</span>
        {:else}<span class="note">改动先留在内存，点「保存」才写入本机；刷新会丢弃未保存改动。</span
          >{/if}
      </div>
      <div class="foot-actions">
        <button class="btn sm ghost" data-ld="export" onclick={exportBackup}>导出备份</button>
        <button class="btn sm ghost" data-ld="import" onclick={() => importInput?.click()}>
          导入备份
        </button>
        <input
          bind:this={importInput}
          type="file"
          accept=".json,application/json"
          hidden
          data-ld="import-file"
          onchange={(e) => void importBackup(e)}
        />
        <button class="btn sm ghost" data-ld="clear" onclick={clearRows} disabled={!rows.length}
          >清空</button
        >
        <button class="btn sm ghost" data-ld="reload" onclick={reload}>重新加载</button>
        <button class="btn sm primary" data-ld="save" onclick={save}>保存</button>
      </div>
    </div>
  </div>
</div>

<style>
  .ld-backdrop {
    position: fixed;
    inset: 0;
    z-index: 150;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(24, 22, 18, 0.42);
    backdrop-filter: blur(3px);
  }

  .panel {
    display: flex;
    flex-direction: column;
    width: min(680px, 100%);
    max-height: min(86vh, 780px);
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--panel);
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.18);
  }

  .panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--line);
  }

  .panel-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
  }

  .panel-desc {
    margin-top: 3px;
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--sub);
  }

  .status {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 16px;
    font-size: 11px;
    color: var(--sub);
    border-bottom: 1px solid var(--line);
    background: var(--panel-soft);
  }

  .tag.warn {
    background: #fdf1e6;
    color: #a26a2c;
    border-color: transparent;
  }

  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 16px;
  }

  .block {
    padding: 14px 0;
    border-bottom: 1px solid var(--line);
  }

  .block:last-child {
    border-bottom: none;
  }

  .block-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .block-head > div {
    min-width: 0;
  }

  .label {
    font-size: 12.5px;
    color: var(--ink-soft);
  }

  .label b {
    font-weight: 600;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .hint {
    margin: 3px 0 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--sub);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 9px 4px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel-soft);
  }

  .stat b {
    font-size: 17px;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }

  .stat span {
    font-size: 10.5px;
    color: var(--sub);
    white-space: nowrap;
  }

  .scopes {
    margin-top: 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
  }

  .scope-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 5px 10px;
    font-size: 11px;
    color: var(--ink-soft);
    border-bottom: 1px solid var(--line);
  }

  .scope-row:last-child {
    border-bottom: none;
  }

  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: 9px;
    background: var(--line);
  }

  .tabs {
    margin-bottom: 10px;
  }

  .seg button {
    padding: 5px 10px;
    border-radius: 7px;
    font-size: 11.5px;
    color: var(--sub);
  }

  .seg button i {
    font-style: normal;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }

  .seg button.active {
    background: var(--panel);
    color: var(--accent);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 12px;
    padding: 12px;
    margin-bottom: 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel-soft);
  }

  .form-title {
    grid-column: 1 / -1;
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .field span {
    font-size: 11px;
    color: var(--sub);
  }

  .field em {
    color: var(--danger);
    font-style: normal;
  }

  .field .input {
    height: 30px;
    font-size: 12px;
  }

  .form-actions {
    grid-column: 1 / -1;
    display: flex;
    gap: 8px;
  }

  .empty {
    padding: 20px 10px;
    text-align: center;
    font-size: 11.5px;
    color: var(--sub);
    border: 1px dashed var(--line-strong);
    border-radius: 10px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 9px 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel-soft);
  }

  .item-main {
    flex: 1 1 200px;
    min-width: 0;
  }

  .item-title {
    font-size: 12px;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-sub {
    margin-top: 2px;
    font-size: 11px;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-meta {
    margin-top: 2px;
    font-size: 10px;
    color: var(--sub);
  }

  .item-actions {
    display: flex;
    gap: 2px;
    flex: 0 0 auto;
  }

  .item-actions .btn {
    padding: 0 7px;
  }

  .btn.danger:hover {
    color: var(--danger);
    border-color: var(--danger);
  }

  .btn.accent {
    color: var(--accent);
  }

  .detail {
    flex: 1 1 100%;
    margin: 4px 0 0;
    padding: 8px 10px;
    max-height: 180px;
    overflow: auto;
    border-radius: 8px;
    background: var(--panel);
    border: 1px solid var(--line);
    font-size: 10.5px;
    line-height: 1.6;
    color: var(--ink-soft);
  }

  .pref-view {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 11.5px;
    color: var(--sub);
  }

  .pref-view b {
    color: var(--ink-soft);
    font-weight: 600;
  }

  .pref-view .btn {
    margin-left: auto;
  }

  .panel-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 16px 12px;
    border-top: 1px solid var(--line);
  }

  .foot-msg {
    flex: 1 1 220px;
    min-width: 0;
    font-size: 10.5px;
    line-height: 1.5;
  }

  .note {
    color: var(--sub);
  }

  .msg.ok {
    color: var(--green);
  }

  .msg.error {
    color: var(--danger);
  }

  .foot-actions {
    display: flex;
    gap: 6px;
    flex: 0 0 auto;
    margin-left: auto;
  }

  @media (max-width: 760px) {
    .ld-backdrop {
      padding: 8px;
    }

    .panel {
      max-height: 92vh;
    }

    .stats {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .form {
      grid-template-columns: 1fr;
    }

    .foot-msg {
      flex-basis: 100%;
    }

    .foot-actions {
      flex-wrap: wrap;
      margin-left: 0;
    }
  }
</style>
