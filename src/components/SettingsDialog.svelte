<script lang="ts">
  import { app } from '../stores/app.svelte';
  import { FONT_STACKS, THEMES } from '../lib/reader/theme';
  import { DEFAULT_SETTINGS } from '../lib/storage/settings';
  import { customFontStack, isCustomStack } from '../lib/reader/fonts';
  import type { KeyScrollMode } from '../lib/types';

  const s = $derived(app.settings);

  /** 0 = 关闭；预取过多会持续占用后端连接 */
  const PREFETCH_OPTIONS = [0, 3, 5, 10];

  const SCROLL_MODES: { value: KeyScrollMode; label: string; desc: string }[] = [
    { value: 'page', label: '整屏', desc: '按一次滚动约一屏，带缓动动画（原有行为）。' },
    { value: 'half', label: '半屏', desc: '按一次滚动半屏，翻页更细，不容易跳过内容。' },
    { value: 'line', label: '逐行', desc: '按一次滚动一行，适合逐句细读或校对。' },
    { value: 'continuous', label: '按住连滚', desc: '按住 ↑↓ 持续滚动，松开即停；速度可调。' },
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

<div class="backdrop">
  <div class="modal" style:width="560px">
    <div class="modal-header">
      <div>
        <div class="modal-title">阅读设置</div>
        <div class="modal-desc">所有设置保存在本地浏览器，换设备不会同步。</div>
      </div>
      <button class="btn ghost sm" onclick={close}>✕</button>
    </div>

    <div class="modal-body">
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
          数值越大，翻页动画越快、按住滚动越快；PageUp / PageDown / 空格始终翻一整屏。 到底继续按 ↓
          进入下一章，到顶按 ↑ 回到上一章末尾。
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
    </div>

    <div class="modal-footer">
      <button class="btn ghost" onclick={() => app.updateSettings({ ...DEFAULT_SETTINGS })}
        >恢复默认</button
      >
      <button class="btn primary" onclick={close}>完成</button>
    </div>
  </div>
</div>

<style>
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
</style>
