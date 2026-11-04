<script lang="ts">
  import { app } from '../stores/app.svelte';
  import { saveSource, type AnySource } from '../lib/sources/sources';
  import { describeError } from '../lib/sources/legado';
  import {
    blankBookSource,
    RULE_GROUPS,
    TABS,
    TAB_FIELDS,
    type FieldDef,
  } from '../lib/sources/bookSourceSchema';
  import { blankRssSource, RSS_FIELDS, RSS_TABS } from '../lib/sources/rssSourceSchema';

  const isBook = $derived(app.editorKind === 'book');
  const original = $derived(app.editorSource);
  /** 编辑已存在的源：主键 URL 不能改，改了就是另建一条 */
  const isEdit = $derived(!!original);

  const tabs = $derived(isBook ? TABS : RSS_TABS);
  const fields = $derived(isBook ? TAB_FIELDS : (RSS_FIELDS as unknown as typeof TAB_FIELDS));
  const groups = $derived(isBook ? RULE_GROUPS : ({} as typeof RULE_GROUPS));
  const nameKey = $derived(isBook ? 'bookSourceName' : 'sourceName');
  const urlKey = $derived(isBook ? 'bookSourceUrl' : 'sourceUrl');

  // 用 $state.raw：避免 JSON.stringify 在 effect 里把每个字段都变成依赖，导致自我触发
  let draft = $state.raw<Record<string, any>>({});
  let tab = $state<string>('basic');
  let jsonMode = $state(false);
  let jsonText = $state('');
  let saving = $state(false);
  let error = $state('');

  $effect(() => {
    const src = original;
    const book = app.editorKind === 'book';
    // 先算出普通对象再用它，千万不要在 effect 里回读 draft：
    // 那会让 effect 依赖自己刚写过的状态，直接 effect_update_depth_exceeded。
    // 新建两种源走各自的空壳（订阅源的空壳字段和书源完全不同，不能共用 {}）。
    const next = src
      ? (JSON.parse(JSON.stringify(src)) as Record<string, any>)
      : book
        ? blankBookSource()
        : blankRssSource();
    draft = next;
    jsonMode = false;
    jsonText = JSON.stringify(next, null, 2);
    error = '';
    tab = 'basic';
  });

  function get(path: string): any {
    return path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), draft);
  }

  function set(path: string, value: unknown): void {
    const parts = path.split('.');
    const next = JSON.parse(JSON.stringify(draft)) as Record<string, any>;
    let cur: Record<string, any> = next;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const k = parts[i];
      if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
    draft = next;
  }

  function onText(field: FieldDef, path: string, raw: string): void {
    if (field.type === 'number') {
      if (raw.trim() === '') return set(path, null);
      const n = Number(raw);
      set(path, Number.isFinite(n) ? n : null);
      return;
    }
    set(path, raw === '' ? null : raw);
  }

  function toggleJson(): void {
    if (!jsonMode) jsonText = JSON.stringify(draft, null, 2);
    jsonMode = !jsonMode;
  }

  function applyJson(): void {
    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed) || typeof parsed !== 'object' || parsed === null) {
        throw new Error('需要是一个 JSON 对象');
      }
      draft = parsed as Record<string, any>;
      error = '';
    } catch (e) {
      error = `JSON 解析失败：${(e as Error).message}`;
    }
  }

  const title = $derived(`${isEdit ? '编辑' : '新建'}${isBook ? '书源' : '订阅源'}`);

  async function save(): Promise<void> {
    if (!app.endpoint) return;
    error = '';
    if (jsonMode) applyJson();

    let payload: AnySource;
    try {
      payload = JSON.parse(JSON.stringify(draft)) as AnySource;
    } catch {
      error = '内容无法序列化，请检查 JSON';
      return;
    }

    const name = String(payload[nameKey] ?? '').trim();
    const url = String(payload[urlKey] ?? '').trim();
    if (!name) {
      error = isBook ? '源名称不能为空' : '源名称不能为空';
      return;
    }
    if (!url) {
      error = '源 URL 不能为空（它是这条源的唯一标识）';
      return;
    }

    // 编辑时主键不变；万一被改（比如从 JSON 视图改的），这里拦一下，免得静默建了条新源
    if (isEdit) {
      const originUrl = String((original as any)?.[urlKey] ?? '').trim();
      if (originUrl && url !== originUrl) {
        error = `编辑时不能修改源 URL（${originUrl}）。要换地址请新建一条源。`;
        return;
      }
    }

    saving = true;
    try {
      const token = app.sourceTokenRequired === true ? app.sourceToken || undefined : undefined;
      await saveSource(app.endpoint, app.editorKind, payload, token);
      app.toast(`已保存「${name}」`, 'success');
      app.editorOpen = false;
      app.sourcesVersion += 1;
    } catch (e) {
      error = describeError(e);
      if ((e as { kind?: string }).kind === 'auth') app.sourceTokenRequired = true;
    } finally {
      saving = false;
    }
  }

  const close = () => (app.editorOpen = false);
</script>

<div
  class="backdrop edit-backdrop"
  onclick={(e) => e.target === e.currentTarget && close()}
  role="presentation"
>
  <div class="modal" style:width="960px">
    <div class="modal-header">
      <div class="head">
        <button class="back" onclick={close} title="返回源列表" aria-label="返回源列表">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <!-- bbox 7..13 / 4..16，正好落在 20×20 的中心，避免箭头看着偏左 -->
            <path
              d="M13 4 7 10l6 6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <div class="titles">
          <div class="modal-title">{title}</div>
          <div class="modal-desc">
            {String(draft[nameKey] || draft[urlKey] || '未命名')}
            {#if isEdit}
              <span class="badge">已存在 · 主键锁定</span>
            {/if}
          </div>
        </div>
      </div>
      <div class="head-actions">
        <button class="btn sm" onclick={toggleJson}>{jsonMode ? '表单' : 'JSON'}</button>
        <button class="btn sm primary" onclick={save} disabled={saving}
          >{saving ? '保存中…' : '保存'}</button
        >
      </div>
    </div>

    {#if !jsonMode}
      <div class="tabs">
        {#each tabs as t (t.key)}
          <button class="tab" class:active={tab === t.key} onclick={() => (tab = t.key)}
            >{t.label}</button
          >
        {/each}
        <div class="spacer"></div>
        <span class="tip">
          {#if isBook}
            规则支持 CSS 选择器 / XPath / JSONPath / <code>@js:</code> 脚本
          {:else}
            订阅源规则是单条字符串，同样支持 CSS / XPath / JSONPath / <code>@js:</code>
          {/if}
        </span>
      </div>
    {/if}

    <div class="modal-body">
      {#if error}
        <div class="err">{error}</div>
      {/if}

      {#if isEdit && !jsonMode && tab === 'basic'}
        <div class="note">
          <b>编辑已有的源</b>：源 URL
          是主键，这里已锁定；想改地址请回列表点「新建」，否则会变成两条源。
        </div>
      {/if}

      {#if jsonMode}
        <textarea class="json" bind:value={jsonText} spellcheck="false"></textarea>
        <div class="json-actions">
          <button class="btn sm" onclick={applyJson}>应用到表单</button>
        </div>
      {:else}
        <div class="form">
          {#each fields[tab as keyof typeof fields] ?? [] as field (field.key)}
            {@render row(field, field.key, isEdit && field.key === urlKey)}
          {/each}

          {#each groups[tab as keyof typeof groups] ?? [] as group (group.path)}
            <div class="group">
              <div class="group-title">{group.label}</div>
              {#each group.fields as field (field.key)}
                {@render row(field, `${group.path}.${field.key}`, false)}
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      <span class="foot">{app.endpoint?.replace(/^https?:\/\//, '')}</span>
      <div class="spacer"></div>
      <button class="btn" onclick={close}>取消</button>
      <button class="btn primary" onclick={save} disabled={saving}
        >{saving ? '保存中…' : '保存'}</button
      >
    </div>
  </div>
</div>

{#snippet row(field: FieldDef, path: string, locked: boolean)}
  <div class="row" class:wide={field.type === 'area' || field.type === 'code'}>
    <label for={path}>
      {field.label}
      {#if locked}<span class="lock">主键</span>{/if}
    </label>
    <div class="control">
      {#if field.type === 'bool'}
        <button
          class="switch"
          class:on={get(path) !== false}
          onclick={() => set(path, get(path) === false)}
          aria-pressed={get(path) !== false}
          aria-label={field.label}
        >
          <i></i>
        </button>
      {:else if field.type === 'select'}
        <select
          class="input"
          value={String(get(path) ?? field.options?.[0]?.value ?? '')}
          onchange={(e) => set(path, Number(e.currentTarget.value))}
        >
          {#each field.options ?? [] as opt (opt.value)}
            <option value={String(opt.value)}>{opt.label}</option>
          {/each}
        </select>
      {:else if field.type === 'code' || field.type === 'area'}
        <textarea
          class="input area"
          class:code={field.type === 'code'}
          rows={2}
          value={String(get(path) ?? '')}
          placeholder={field.hint ?? ''}
          disabled={locked}
          oninput={(e) => onText(field, path, e.currentTarget.value)}></textarea>
      {:else}
        <input
          class="input"
          type={field.type === 'number' ? 'number' : 'text'}
          value={String(get(path) ?? '')}
          disabled={locked}
          oninput={(e) => onText(field, path, e.currentTarget.value)}
        />
      {/if}
      {#if locked}
        <span class="hint">编辑时不可修改，改地址等于新建一条源</span>
      {:else if field.hint && (field.type === 'text' || field.type === 'number')}
        <span class="hint">{field.hint}</span>
      {/if}
    </div>
  </div>
{/snippet}

<style>
  .edit-backdrop {
    z-index: 320;
  }

  .head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }

  /* 返回做成图标按钮：这个弹层是整页式的，文字按钮「← 返回」在这里很突兀 */
  .back {
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    margin-top: -2px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink-soft);
    display: grid;
    place-items: center;
    transition: all 0.15s ease;
  }

  .back:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-soft);
  }

  .back:active {
    transform: translateY(1px);
  }

  .titles {
    min-width: 0;
  }

  .head-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .badge {
    margin-left: 8px;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 10px;
    color: var(--accent);
    background: var(--accent-soft);
  }

  .note {
    margin-bottom: 10px;
    padding: 8px 11px;
    border-radius: 8px;
    font-size: 11.5px;
    line-height: 1.7;
    color: #7a5a1e;
    background: #fdf6e7;
    border: 1px solid #f0e0bd;
  }

  .lock {
    margin-left: 4px;
    padding: 0 4px;
    border-radius: 4px;
    font-size: 9.5px;
    color: var(--sub);
    background: rgba(0, 0, 0, 0.06);
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 24px 10px;
    border-bottom: 1px solid var(--line);
  }

  .tab {
    height: 28px;
    padding: 0 11px;
    border-radius: 7px;
    font-size: 12.5px;
    color: var(--sub);
  }

  .tab.active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }

  .tip {
    font-size: 10.5px;
    color: var(--sub);
  }

  .tip code {
    padding: 1px 4px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.06);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 4px;
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .row > label {
    flex: 0 0 96px;
    padding-top: 8px;
    font-size: 12px;
    color: var(--ink-soft);
    text-align: right;
  }

  .control {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .row.wide .control {
    gap: 4px;
  }

  .input {
    height: 32px;
    font-size: 12.5px;
  }

  .input:disabled {
    background: var(--panel-soft);
    color: var(--sub);
  }

  .area {
    height: auto;
    padding: 6px 10px;
    line-height: 1.55;
    resize: vertical;
    min-height: 34px;
    font-family: inherit;
  }

  .area.code {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11.5px;
  }

  .hint {
    font-size: 10.5px;
    color: var(--sub);
  }

  .group {
    margin-top: 8px;
    padding: 10px 12px 12px;
    border-radius: 10px;
    background: var(--panel-soft);
    border: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .group-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-soft);
    letter-spacing: 0.5px;
  }

  .group .row > label {
    flex-basis: 92px;
  }

  .json {
    width: 100%;
    height: min(60vh, 560px);
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11.5px;
    line-height: 1.6;
    resize: vertical;
    outline: none;
  }

  .json:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .json-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
  }

  .err {
    margin-bottom: 10px;
    padding: 8px 11px;
    border-radius: 8px;
    font-size: 11.5px;
    background: #fdecea;
    border: 1px solid #f5c6c0;
    color: #a33325;
  }

  .foot {
    font-size: 11px;
    color: var(--sub);
  }

  .switch {
    width: 38px;
    height: 22px;
    border-radius: 999px;
    background: var(--line-strong);
    position: relative;
    margin-top: 5px;
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

  @media (max-width: 760px) {
    .row {
      flex-direction: column;
      gap: 4px;
    }
    .row > label {
      flex-basis: auto;
      text-align: left;
      padding-top: 0;
    }
  }
</style>
