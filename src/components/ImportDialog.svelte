<script lang="ts">
  import { app } from '../stores/app.svelte';
  import { importFile } from '../lib/local/import';
  import { uploadBook } from '../lib/sources/legado';

  type Target = 'local' | 'remote';

  interface QueueItem {
    id: string;
    name: string;
    size: number;
    status: 'pending' | 'working' | 'done' | 'error';
    message: string;
    progress?: number;
  }

  const LOCAL_EXT = ['.txt', '.md', '.markdown', '.html', '.htm', '.epub'];
  /** Legado 3.0 的 /addLocalBook 只收这些格式 */
  const REMOTE_EXT = ['.txt', '.epub', '.umd', '.pdf', '.mobi', '.azw3', '.azw'];

  let target = $state<Target>('local');
  let items = $state<QueueItem[]>([]);
  let pendingFiles: File[] = [];
  let dragging = $state(false);
  let running = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);

  const hasBackend = $derived(!!app.endpoint && app.endpointState === 'online');
  const endpointLabel = $derived(app.endpoint?.replace(/^https?:\/\//, '') ?? '');
  const accept = $derived((target === 'local' ? LOCAL_EXT : REMOTE_EXT).join(','));
  const pendingCount = $derived(items.filter((i) => i.status === 'pending').length);

  function extOf(name: string): string {
    const i = name.lastIndexOf('.');
    return i === -1 ? '' : name.slice(i).toLowerCase();
  }

  function human(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function addFiles(list: FileList | File[]) {
    const allowed = target === 'local' ? LOCAL_EXT : REMOTE_EXT;
    const next: QueueItem[] = [];
    for (const file of Array.from(list)) {
      const ext = extOf(file.name);
      const ok = allowed.includes(ext);
      next.push({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        size: file.size,
        status: ok ? 'pending' : 'error',
        message: ok
          ? target === 'local'
            ? '等待解析'
            : '等待上传'
          : target === 'local'
            ? `本地模式不支持 ${ext || '该格式'}`
            : `手机端不支持 ${ext || '该格式'}`,
      });
    }
    items = [...items, ...next];
  }

  function patch(id: string, patch: Partial<QueueItem>) {
    items = items.map((i) => (i.id === id ? { ...i, ...patch } : i));
  }

  async function runLocal(targets: QueueItem[], files: Map<string, File>) {
    for (const item of targets) {
      patch(item.id, { status: 'working', message: '解析中…' });
      const file = files.get(item.name + item.size);
      if (!file) {
        patch(item.id, { status: 'error', message: '文件已失效，请重选' });
        continue;
      }
      try {
        const res = await importFile(file);
        patch(item.id, {
          status: 'done',
          message: `${res.chapters.length} 章 · ${res.encoding ?? '—'}`,
        });
      } catch (e) {
        patch(item.id, { status: 'error', message: (e as Error).message });
      }
    }
    await app.reloadLocal();
    const ok = items.filter((i) => i.status === 'done').length;
    if (ok) app.toast(`已导入 ${ok} 本到本地书架`, 'success');
  }

  async function runRemote(targets: QueueItem[], files: Map<string, File>) {
    const base = app.endpoint;
    if (!base) {
      app.toast('还没有连接局域网后端', 'error');
      return;
    }
    for (const item of targets) {
      patch(item.id, { status: 'working', message: '上传中 0%', progress: 0 });
      const file = files.get(item.name + item.size);
      if (!file) {
        patch(item.id, { status: 'error', message: '文件已失效，请重选' });
        continue;
      }
      try {
        await uploadBook(base, file, {
          onProgress: (loaded, total) =>
            patch(item.id, {
              progress: total ? Math.round((loaded / total) * 100) : 0,
              message: `上传中 ${total ? Math.round((loaded / total) * 100) : 0}%`,
            }),
        });
        patch(item.id, { status: 'done', message: '已上传到手机，正在刷新书架…' });
      } catch (e) {
        patch(item.id, { status: 'error', message: (e as Error).message });
      }
    }
    await app.refreshRemote();
    const ok = items.filter((i) => i.status === 'done').length;
    if (ok) {
      items = items.map((i) => (i.status === 'done' ? { ...i, message: '已上传到手机' } : i));
      app.toast(`已上传 ${ok} 本到手机书架`, 'success');
      app.setFilter('all');
    }
  }

  async function run() {
    const targets = items.filter((i) => i.status === 'pending');
    if (!targets.length) return;
    if (target === 'remote' && !hasBackend) {
      app.toast('先连接局域网后端再上传', 'error');
      return;
    }
    running = true;
    // 只在这个同步流程里做临时索引，不需要响应式
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const files = new Map<string, File>();
    for (const f of pendingFiles) files.set(f.name + f.size, f);
    try {
      if (target === 'remote') await runRemote(targets, files);
      else await runLocal(targets, files);
    } finally {
      running = false;
    }
  }

  function switchTarget(next: Target) {
    if (running || next === target) return;
    target = next;
    // 换目标后格式要求变了，清空队列避免混着传
    items = [];
    pendingFiles = [];
  }

  function handleInput(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (input.files?.length) {
      pendingFiles.push(...Array.from(input.files));
      addFiles(input.files);
      input.value = '';
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files?.length) {
      pendingFiles.push(...Array.from(e.dataTransfer.files));
      addFiles(e.dataTransfer.files);
    }
  }

  const close = () => {
    if (running) return;
    app.importOpen = false;
  };
</script>

<div class="backdrop">
  <div class="modal" style:width="640px">
    <div class="modal-header">
      <div>
        <div class="modal-title">导入书籍</div>
        <div class="modal-desc">
          {target === 'local'
            ? '存到这台设备的浏览器（IndexedDB），不上传，断网也能读。'
            : `上传到手机上的「阅读」，传完会出现在书架里（手机端需保持 Web 服务开启）。`}
        </div>
      </div>
      <button class="btn ghost sm" onclick={close} disabled={running}>✕</button>
    </div>

    <div class="modal-body">
      <div class="targets">
        <button
          class="target"
          class:active={target === 'local'}
          onclick={() => switchTarget('local')}
          disabled={running}
        >
          <b>存到本地</b>
          <span>这台浏览器，可离线阅读</span>
          <span class="tag">TXT · EPUB · MD · HTML</span>
        </button>
        <button
          class="target"
          class:active={target === 'remote'}
          onclick={() => switchTarget('remote')}
          disabled={running || !hasBackend}
          title={hasBackend ? '' : '先连接局域网后端'}
        >
          <b>传到手机</b>
          <span>{hasBackend ? endpointLabel : '未连接后端，先去连接'}</span>
          <span class="tag">TXT · EPUB · UMD · PDF · MOBI · AZW3</span>
        </button>
      </div>

      <div
        class="dropzone"
        class:active={dragging}
        onclick={() => inputEl?.click()}
        ondragover={(e) => {
          e.preventDefault();
          dragging = true;
        }}
        ondragleave={() => (dragging = false)}
        ondrop={handleDrop}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && inputEl?.click()}
      >
        <div class="dz-icon">⇪</div>
        <b>{target === 'local' ? '把书拖到这里，或点击选择' : '把书拖到这里，直接传到手机'}</b>
        <p>
          {target === 'local'
            ? '解析后存在本机，随时可删'
            : '走阅读自带的 /addLocalBook 接口，与网页版上传页一致'}
        </p>
        <input bind:this={inputEl} type="file" {accept} multiple hidden onchange={handleInput} />
      </div>

      {#if items.length > 0}
        <ul class="queue">
          {#each items as item (item.id)}
            <li
              class="q-item"
              class:done={item.status === 'done'}
              class:err={item.status === 'error'}
            >
              <div class="q-name">
                <b>{item.name}</b>
                <span>{human(item.size)}</span>
              </div>
              <div class="q-status">
                {#if item.status === 'working'}<span class="spinner"></span>{/if}
                {item.message}
              </div>
              {#if item.status === 'working' && item.progress !== undefined}
                <div class="q-bar"><i style:width={`${item.progress}%`}></i></div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if target === 'local'}
        <div class="tips">
          <p>
            <b>TXT</b>：自动识别 UTF-8 / GBK，按「第 N 章」等标题切章，无标题时按约 4000 字分节。
          </p>
          <p><b>EPUB</b>：读取 OPF 目录与 spine 顺序，提取封面，正文按章节存储。</p>
        </div>
      {:else}
        <div class="tips">
          <p>上传是直接写进手机上的「阅读」，用的是它自带上传页同一个接口，所以格式限制也一致。</p>
          <p>大文件（如 PDF）传完手机端要解析一会儿，书架刷新可能延迟几秒。</p>
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn ghost" onclick={close} disabled={running}>关闭</button>
      <button class="btn primary" onclick={run} disabled={running || !pendingCount}>
        {running
          ? target === 'local'
            ? '导入中…'
            : '上传中…'
          : `${target === 'local' ? '开始导入' : '开始上传'} (${pendingCount})`}
      </button>
    </div>
  </div>
</div>

<style>
  .targets {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 14px;
  }

  .target {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 11px 13px;
    border-radius: 11px;
    border: 1px solid var(--line);
    background: var(--panel);
    text-align: left;
    transition: all 0.16s ease;
  }

  .target b {
    font-size: 13px;
    font-weight: 600;
  }

  .target span {
    font-size: 11px;
    color: var(--sub);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .target .tag {
    align-self: flex-start;
    margin-top: 4px;
    font-size: 9.5px;
  }

  .target:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .target.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .target.active b {
    color: var(--accent);
  }

  .target:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .dropzone {
    border: 1.5px dashed var(--line-strong);
    border-radius: 14px;
    padding: 26px 20px;
    text-align: center;
    cursor: pointer;
    transition: all 0.16s ease;
    background: var(--panel-soft);
  }

  .dropzone:hover,
  .dropzone.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .dz-icon {
    font-size: 22px;
    color: var(--accent);
    margin-bottom: 6px;
  }

  .dropzone b {
    display: block;
    font-size: 13.5px;
    font-weight: 600;
  }

  .dropzone p {
    margin: 4px 0 0;
    font-size: 11.5px;
    color: var(--sub);
  }

  .queue {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .q-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    padding: 9px 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
    font-size: 12px;
  }

  .q-item.done {
    border-color: #cfe6d9;
    background: #f3faf6;
  }

  .q-item.err {
    border-color: #f2cdc7;
    background: #fdf4f2;
  }

  .q-name {
    display: flex;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
    flex: 1;
  }

  .q-name b {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 300px;
  }

  .q-name span {
    font-size: 10.5px;
    color: var(--sub);
    flex: 0 0 auto;
  }

  .q-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--sub);
    flex: 0 0 auto;
  }

  .q-item.done .q-status {
    color: var(--green);
  }

  .q-item.err .q-status {
    color: var(--danger);
  }

  .q-bar {
    flex: 1 1 100%;
    height: 3px;
    border-radius: 2px;
    background: var(--line);
    overflow: hidden;
  }

  .q-bar i {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s ease;
  }

  .spinner {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid var(--line-strong);
    border-top-color: var(--accent);
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .tips {
    margin-top: 14px;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--panel-soft);
    border: 1px solid var(--line);
  }

  .tips p {
    margin: 0 0 4px;
    font-size: 11px;
    color: var(--sub);
    line-height: 1.65;
  }

  .tips p:last-child {
    margin-bottom: 0;
  }

  .tips b {
    color: var(--ink-soft);
  }
</style>
