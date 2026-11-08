<script lang="ts">
  import { app } from '../stores/app.svelte';
  import { FONT_STACKS, THEMES } from '../lib/reader/theme';
  import { DEFAULT_SETTINGS } from '../lib/storage/settings';
  import { customFontStack, isCustomStack } from '../lib/reader/fonts';
  import { offline } from '../lib/dict/offlineStore.svelte';
  import type { KeyScrollMode, ReaderSettings } from '../lib/types';

  const s = $derived(app.settings);

  // 打开面板时同步一次离线词库状态（是否已下载、条目数）
  $effect(() => {
    void offline.refresh();
  });

  /** 0 = 关闭；预取过多会持续占用后端连接 */
  const PREFETCH_OPTIONS = [0, 3, 5, 10];

  const SCROLL_MODES: { value: KeyScrollMode; label: string; desc: string }[] = [
    { value: 'page', label: '整屏', desc: '按一次滚动约一屏，带缓动动画（原有行为）。' },
    { value: 'half', label: '半屏', desc: '按一次滚动半屏，翻页更细，不容易跳过内容。' },
    { value: 'line', label: '逐行', desc: '按一次滚动一行，适合逐句细读或校对。' },
    { value: 'continuous', label: '按住连滚', desc: '按住 ↑↓ 持续滚动，松开即停；速度可调。' },
  ];

  const SEARCH_ENGINE_OPTIONS: { value: ReaderSettings['searchEngine']; label: string }[] = [
    { value: 'baidu', label: '百度' },
    { value: 'bing', label: '必应' },
    { value: 'google', label: '谷歌' },
  ];

  const formatSpeed = (v: number): string => v.toFixed(2).replace(/\.?0+$/, '');

  let fontInput = $state<HTMLInputElement | null>(null);
  let importing = $state(false);

  async function onFontPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    importing = true;
    await app.importFont(file);
    importing = false;
    input.value = '';
  }

  function close() {
    app.settingsOpen = false;
  }
</script>

<div class="settings-layer" role="dialog" aria-label="阅读设置">
  <aside class="panel">
    <div class="panel-head">
      <div>
        <div class="panel-title">阅读设置</div>
        <div class="panel-desc">改动即时生效，可以对照正文实时预览。</div>
      </div>
      <button class="btn ghost sm" onclick={close} aria-label="关闭">✕</button>
    </div>

    <div class="panel-body">
      <section>
        <span class="label">主题</span>
        <div class="themes">
          {#each THEMES as t (t.id)}
            <button
              class="theme"
              class:active={s.theme === t.id}
              onclick={() => app.updateSettings({ theme: t.id })}
              title={t.name}
            >
              <span class="swatch" style:background={t.content} style:border-color={t.border}>
                <i style:background={t.text}></i>
              </span>
              <span class="tname">{t.name}</span>
            </button>
          {/each}
        </div>
      </section>

      <section class="row">
        <div class="label"><span>排版</span></div>
        <div class="grid2">
          <div>
            <label class="label" for="fs">字号 <b>{s.fontSize}px</b></label>
            <input
              id="fs"
              type="range"
              min="12"
              max="48"
              step="1"
              value={s.fontSize}
              oninput={(e) => app.updateSettings({ fontSize: +e.currentTarget.value })}
            />
          </div>
          <div>
            <label class="label" for="lh">行距 <b>{s.lineHeight.toFixed(1)}</b></label>
            <input
              id="lh"
              type="range"
              min="1.2"
              max="3"
              step="0.1"
              value={s.lineHeight}
              oninput={(e) => app.updateSettings({ lineHeight: +e.currentTarget.value })}
            />
          </div>
          <div>
            <label class="label" for="ls">
              字距 <b>{s.letterSpacing > 0 ? '+' : ''}{s.letterSpacing}px</b>
            </label>
            <input
              id="ls"
              type="range"
              min="-1"
              max="6"
              step="0.5"
              value={s.letterSpacing}
              oninput={(e) => app.updateSettings({ letterSpacing: +e.currentTarget.value })}
            />
          </div>
          <div>
            <label class="label" for="ps">段距 <b>{s.paragraphSpacing.toFixed(1)}em</b></label>
            <input
              id="ps"
              type="range"
              min="0"
              max="2.5"
              step="0.1"
              value={s.paragraphSpacing}
              oninput={(e) => app.updateSettings({ paragraphSpacing: +e.currentTarget.value })}
            />
          </div>
        </div>
      </section>

      <section class="row">
        <label class="label" for="rw">版心宽度 <b>{s.readWidth}px</b></label>
        <input
          id="rw"
          type="range"
          min="480"
          max="1600"
          step="20"
          value={s.readWidth}
          oninput={(e) => app.updateSettings({ readWidth: +e.currentTarget.value })}
        />
        <p class="hint">← → 换章，Esc 回书架。</p>
      </section>

      <section class="row">
        <div class="label"><span>↑ ↓ 滚动方式</span></div>
        <div class="seg modes" role="group" aria-label="上下键滚动方式">
          {#each SCROLL_MODES as m (m.value)}
            <button
              class:active={s.keyScrollMode === m.value}
              title={m.desc}
              aria-pressed={s.keyScrollMode === m.value}
              onclick={() => app.updateSettings({ keyScrollMode: m.value })}
            >
              {m.label}
            </button>
          {/each}
        </div>
        <p class="hint">{SCROLL_MODES.find((m) => m.value === s.keyScrollMode)?.desc}</p>

        <label class="label" for="ss">
          滚动速度 <b>{formatSpeed(s.scrollSpeed)}×</b>
        </label>
        <input
          id="ss"
          type="range"
          min="0.5"
          max="3"
          step="0.25"
          value={s.scrollSpeed}
          oninput={(e) => app.updateSettings({ scrollSpeed: +e.currentTarget.value })}
        />
        <p class="hint">
          数值越大，翻页动画越快、按住滚动越快、自动滚屏也越快；PageUp / PageDown /
          空格始终翻一整屏。 到底继续按 ↓ 进入下一章，到顶按 ↑ 回到上一章末尾。
        </p>
      </section>

      <section class="row">
        <div class="label">
          <span>字体</span>
          <button class="btn sm" onclick={() => fontInput?.click()} disabled={importing}>
            {importing ? '解析中…' : '＋ 导入本地字体'}
          </button>
        </div>
        <input
          bind:this={fontInput}
          type="file"
          accept=".ttf,.otf,.woff,.woff2,.ttc"
          hidden
          onchange={onFontPick}
        />
        <div class="fonts">
          {#each FONT_STACKS as f (f.label)}
            <button
              class="font-chip"
              class:active={s.fontFamily === f.value}
              onclick={() => app.updateSettings({ fontFamily: f.value })}
            >
              <span class="preview" style:font-family={f.value}>永</span>
              <span class="fname">{f.label}</span>
            </button>
          {/each}
          {#each app.fonts as f (f.id)}
            <button
              class="font-chip"
              class:active={isCustomStack(s.fontFamily, f.family)}
              title={f.name}
              onclick={() => app.updateSettings({ fontFamily: customFontStack(f.family) })}
            >
              <span class="preview" style:font-family={f.family}>永</span>
              <span class="fname">{f.name}</span>
              <span
                class="del"
                role="presentation"
                title="删除这个字体"
                onclick={(e) => {
                  e.stopPropagation();
                  app.removeFont(f.id);
                }}>✕</span
              >
            </button>
          {/each}
        </div>
        <p class="hint">支持 ttf / otf / woff / woff2；字体文件只保存在本机浏览器，不会上传。</p>
      </section>

      <section class="row inline">
        <div>
          <div class="label">预加载后续章节</div>
          <p class="hint">读完当前章前先取下一批正文，翻章几乎不用等；只对局域网书籍生效。</p>
        </div>
        <div class="seg" role="group" aria-label="预加载章节数">
          {#each PREFETCH_OPTIONS as n (n)}
            <button
              class:active={s.prefetchCount === n}
              onclick={() => app.updateSettings({ prefetchCount: n })}
            >
              {n === 0 ? '关闭' : `${n} 章`}
            </button>
          {/each}
        </div>
      </section>

      <section class="row inline">
        <div>
          <div class="label">自动记录进度</div>
          <p class="hint">滚动与翻章后自动保存，局域网书籍还会把进度同步回手机。</p>
        </div>
        <button
          class="switch"
          class:on={s.autoSave}
          onclick={() => app.updateSettings({ autoSave: !s.autoSave })}
          aria-pressed={s.autoSave}
          aria-label="自动记录进度"
        >
          <i></i>
        </button>
      </section>

      <section class="row inline">
        <div>
          <div class="label">摸鱼模式</div>
          <p class="hint">
            鼠标移出页面时用一份工作文档盖住正文，移回立即恢复；不刷新页面，阅读进度与位置都不变。
          </p>
        </div>
        <button
          class="switch"
          class:on={s.stealthMode}
          onclick={() => app.updateSettings({ stealthMode: !s.stealthMode })}
          aria-pressed={s.stealthMode}
          aria-label="摸鱼模式"
        >
          <i></i>
        </button>
      </section>

      <section class="row inline">
        <div>
          <div class="label">底部状态栏</div>
          <p class="hint">在纸张底部常驻一行，显示章节名与本章阅读进度。</p>
        </div>
        <button
          class="switch"
          class:on={s.showStatusBar}
          onclick={() => app.updateSettings({ showStatusBar: !s.showStatusBar })}
          aria-pressed={s.showStatusBar}
          aria-label="显示底部状态栏"
        >
          <i></i>
        </button>
      </section>

      <section class="row inline">
        <div>
          <div class="label">状态栏进度条</div>
          <p class="hint">在状态栏上沿加一条本章进度细线；关闭后只留右侧的百分比。</p>
        </div>
        <button
          class="switch"
          class:on={s.showProgressBar}
          disabled={!s.showStatusBar}
          onclick={() => app.updateSettings({ showProgressBar: !s.showProgressBar })}
          aria-pressed={s.showProgressBar}
          aria-label="显示状态栏进度条"
        >
          <i></i>
        </button>
      </section>

      <section class="row offline">
        <div class="offline-head">
          <div>
            <div class="label">离线词典</div>
            <p class="hint">
              下载后查词完全本地，不再联网。词库不随安装包分发，约 26 万条词语、 下载 27 MB
              左右，占用浏览器存储。
            </p>
          </div>
          {#if offline.downloading}
            <button class="btn sm" disabled>下载中…</button>
          {:else if offline.ready}
            <button class="btn sm ghost" onclick={() => void offline.remove()}>删除</button>
          {:else}
            <button class="btn sm primary" onclick={() => void offline.download()}>下载</button>
          {/if}
        </div>

        {#if offline.downloading}
          <div
            class="progress"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax={offline.total}
            aria-valuenow={offline.done}
          >
            <i style:width={`${Math.round((offline.done / Math.max(1, offline.total)) * 100)}%`}
            ></i>
          </div>
          <p class="hint small">{offline.done} / {offline.total} 个分片</p>
        {:else if offline.ready}
          <p class="hint small">
            已安装 {offline.count.toLocaleString('zh-CN')} 条
            {#if offline.updatedAt}· 更新于 {new Date(offline.updatedAt).toLocaleDateString(
                'zh-CN',
              )}{/if}
          </p>
        {/if}

        {#if offline.error}
          <p class="hint error">{offline.error}</p>
        {/if}
      </section>

      <section class="row">
        <div class="label"><span>选中文字后搜索</span></div>
        <div class="seg modes" role="group" aria-label="网页版搜索引擎">
          {#each SEARCH_ENGINE_OPTIONS as m (m.value)}
            <button
              class:active={s.searchEngine === m.value}
              aria-pressed={s.searchEngine === m.value}
              onclick={() => app.updateSettings({ searchEngine: m.value })}
            >
              {m.label}
            </button>
          {/each}
        </div>
        <p class="hint">
          浏览器扩展会直接用你在浏览器里设置的默认搜索引擎；网页读不到默认引擎，只能在这里指定一个固定引擎。搜索结果在新标签页打开。
        </p>
      </section>

      <section class="row inline">
        <div>
          <div class="label">本地数据</div>
          <p class="hint">查看、编辑、删除本机记录，可保存、重新加载或导出备份。</p>
        </div>
        <button
          class="btn sm"
          data-ld="open"
          onclick={() => {
            close();
            app.localDataOpen = true;
          }}>管理</button
        >
      </section>
    </div>

    <div class="panel-foot">
      <span class="panel-note">设置仅保存在本机</span>
      <div class="foot-actions">
        <button class="btn ghost" onclick={() => app.updateSettings({ ...DEFAULT_SETTINGS })}
          >恢复默认</button
        >
        <button class="btn primary" onclick={close}>完成</button>
      </div>
    </div>
  </aside>
</div>

<style>
  /* 右侧浮动面板：正文保持可见，改动可以即时对照 */
  .settings-layer {
    position: fixed;
    inset: 0;
    z-index: 70;
    /* 面板以外不拦截点击，阅读页仍可正常滚动 */
    pointer-events: none;
  }

  .panel {
    position: absolute;
    top: 12px;
    left: 12px;
    bottom: 12px;
    width: min(380px, calc(100vw - 24px));
    display: flex;
    flex-direction: column;
    pointer-events: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.18);
    overflow: hidden;
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

  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 16px;
  }

  .panel-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px 12px;
    border-top: 1px solid var(--line);
  }

  .panel-note {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--sub);
  }

  .foot-actions {
    display: flex;
    gap: 8px;
    flex: 0 0 auto;
    margin-left: auto;
  }

  @media (max-width: 760px) {
    /* 窄屏改为底部抽屉，上方正文仍可见 */
    .panel {
      top: auto;
      left: 8px;
      right: 8px;
      bottom: 8px;
      width: auto;
      max-height: 62vh;
    }

    .panel-note {
      display: none;
    }
  }

  section {
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }

  section:last-child {
    border-bottom: none;
  }

  .label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12.5px;
    color: var(--ink-soft);
    margin-bottom: 9px;
  }

  .label b {
    font-weight: 600;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .themes {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
  }

  .theme {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 6px 0;
    border-radius: 10px;
    border: 1px solid transparent;
  }

  .theme.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .swatch {
    width: 100%;
    height: 42px;
    border-radius: 7px;
    border: 1px solid var(--line);
    display: grid;
    place-items: center;
  }

  .swatch i {
    width: 60%;
    height: 3px;
    border-radius: 2px;
    opacity: 0.55;
    box-shadow: 0 6px 0 currentColor;
  }

  .tname {
    font-size: 10.5px;
    color: var(--sub);
  }

  .theme.active .tname {
    color: var(--accent);
  }

  input[type='range'] {
    width: 100%;
    height: 4px;
    border-radius: 3px;
    background: var(--line);
    appearance: none;
    outline: none;
  }

  input[type='range']::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent);
    border: 3px solid #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24);
    cursor: pointer;
  }

  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 18px;
  }

  .grid2 .label {
    margin-bottom: 6px;
  }

  .fonts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    gap: 8px;
  }

  .font-chip {
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 8px;
    border-radius: 9px;
    border: 1px solid var(--line);
    background: var(--panel);
    transition: all 0.14s ease;
  }

  .font-chip:hover {
    border-color: var(--line-strong);
  }

  .font-chip.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .preview {
    flex: 0 0 20px;
    width: 20px;
    text-align: center;
    font-size: 17px;
    line-height: 1;
    color: var(--ink);
  }

  .fname {
    flex: 1;
    min-width: 0;
    font-size: 11.5px;
    color: var(--ink-soft);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .font-chip.active .fname {
    color: var(--accent);
    font-weight: 600;
  }

  .del {
    flex: 0 0 auto;
    font-size: 10px;
    color: var(--sub);
    padding: 1px 3px;
    border-radius: 4px;
  }

  .del:hover {
    color: var(--danger);
    background: rgba(0, 0, 0, 0.06);
  }

  .row.inline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .row.inline > div:first-child {
    flex: 1 1 220px;
    min-width: 0;
  }

  .seg {
    flex: 0 0 auto;
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: 9px;
    background: var(--line);
  }

  .seg button {
    padding: 5px 9px;
    border-radius: 7px;
    font-size: 11.5px;
    color: var(--sub);
    transition:
      background 0.14s ease,
      color 0.14s ease;
  }

  .seg button:hover {
    color: var(--ink-soft);
  }

  .seg button.active {
    background: var(--panel);
    color: var(--accent);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .modes {
    margin-bottom: 9px;
  }

  .modes button {
    min-width: 62px;
  }

  .offline-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .offline-head > div {
    min-width: 0;
  }

  .progress {
    margin-top: 10px;
    height: 6px;
    border-radius: 999px;
    background: var(--panel-soft);
    overflow: hidden;
  }

  .progress i {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s ease;
  }

  .hint.small {
    margin-top: 6px;
    font-size: 11px;
  }

  .hint.error {
    color: var(--danger);
  }

  .hint {
    margin: 0;
    font-size: 11px;
    color: var(--sub);
  }

  .switch {
    width: 42px;
    height: 24px;
    border-radius: 999px;
    background: var(--line-strong);
    position: relative;
    transition: background 0.18s ease;
    flex: 0 0 auto;
  }

  .switch i {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.18s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .switch.on {
    background: var(--accent);
  }

  .switch.on i {
    transform: translateX(18px);
  }

  .switch:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
