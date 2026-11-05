<script lang="ts">
  /**
   * 通用「书源访问令牌」验证组件。
   *
   * 书源 / 订阅源管理、书源搜索共用同一套校验流程、状态反馈、错误提示与视觉样式；
   * 各场景只通过 props 保留必要差异（文案、按钮名、验证通过后的动作）。
   *
   * 是否出现，先由 app.needsSourceToken 这个全项目唯一判断决定：
   *  - MD3 等没有令牌机制的后端：整个组件（含成功提示）一律不渲染
   *  - 真的报了令牌错误时由 app.markTokenAuthError() 打开能力，再走同一套流程
   *
   * 需要令牌时，显隐只跟着验证结果走：
   *  - 验证进行中：保持可见，避免输入框闪烁
   *  - 明确失败：保持可见，方便就地修改重试
   *  - 成功 / 取消 / 结果过期：立即隐藏，只留一行通过提示
   *  - 尚未验证但被展开：可见
   */
  import { tick } from 'svelte';
  import { app } from '../stores/app.svelte';

  type Phase = 'idle' | 'verifying' | 'ok' | 'fail';

  interface Props {
    /** 是否展开；验证结束且非失败时组件会自动置 false */
    open?: boolean;
    /** 验证状态，父组件可读取以决定其它 UI（如收起入口） */
    phase?: Phase;
    /** 反馈文案；父组件也可写入初始错误（如已存令牌失效） */
    message?: string;
    title?: string;
    description?: string;
    actionLabel?: string;
    placeholder?: string;
    /** 书源管理已有自己的「已通过令牌校验」状态条，可关掉组件内的通过提示 */
    successHint?: boolean;
    /** 手动点「验证」前通知父组件清理在飞请求 */
    onBeforeVerify?: () => void;
    /** 验证通过（令牌已写入本机）后执行各场景自己的动作 */
    onVerified?: (token: string) => void;
  }

  let {
    open = $bindable(false),
    phase = $bindable<Phase>('idle'),
    message = $bindable(''),
    title = '这个后端需要书源访问令牌',
    description = '手机端「阅读 → 我的 → 设置 → 其他设置 → Web 服务 → 书源访问令牌」里设置一个口令，填到下面验证通过后才会继续（令牌只保存在本机浏览器）。',
    actionLabel = '验证并保存',
    placeholder = '粘贴手机端显示的令牌',
    successHint = true,
    onBeforeVerify,
    onVerified,
  }: Props = $props();

  let token = $state(app.sourceToken);
  let inputEl = $state<HTMLInputElement | null>(null);
  /** 每次验证一个序号，只有最新一次的结果有权改写界面 */
  let seq = 0;

  const available = $derived(app.needsSourceToken);
  const busy = $derived(phase === 'verifying');
  const visible = $derived(
    available && (phase === 'verifying' || phase === 'fail' || (phase === 'idle' && open)),
  );

  /** 换到不需要令牌的后端时，收起门禁并清掉旧状态，避免父组件的门禁标记把内容挡住 */
  $effect(() => {
    if (available) return;
    if (open || phase !== 'idle' || message) {
      seq += 1;
      open = false;
      phase = 'idle';
      message = '';
    }
  });

  /** 统一落地验证结果：只有非失败结果才收起窗口 */
  function settle(next: Phase, text: string): void {
    phase = next;
    message = text;
    if (next === 'ok' || next === 'idle') open = false;
  }

  /** 展开窗口；可带初始提示或一条明确的失败原因 */
  export function show(text = '', next: Phase = 'idle'): void {
    // 没有令牌机制的后端绝不展开：避免父组件的门禁标记把内容挡住却不渲染面板
    if (!app.needsSourceToken) return;
    seq += 1;
    open = true;
    phase = next;
    message = text;
    token = app.sourceToken || token;
    void tick().then(() => inputEl?.focus());
  }

  /** 取消在飞的验证：结果作废，按「非失败」立即隐藏 */
  export function cancel(): void {
    if (phase !== 'verifying') return;
    seq += 1;
    settle('idle', '');
  }

  /** 统一校验入口：面板按钮与父组件的自动校验都走这里 */
  export async function verify(tokenToUse?: string): Promise<boolean> {
    const value = (tokenToUse ?? token).trim();
    if (!value) {
      seq += 1;
      settle('fail', '请先输入手机端显示的书源访问令牌');
      return false;
    }
    const mySeq = ++seq;
    settle('verifying', '');
    let ok = false;
    try {
      const res = await app.verifySourceToken(value);
      if (mySeq !== seq) return false;
      settle(res.ok ? 'ok' : 'fail', res.message);
      ok = res.ok;
      if (ok) token = app.sourceToken;
    } catch (e) {
      if (mySeq !== seq) return false;
      settle('fail', `无法验证令牌：${(e as Error)?.message ?? '未知错误'}`);
    }
    // 放到 try 之外：场景动作的异常不能被误判成令牌校验失败
    if (ok) onVerified?.(token);
    return ok;
  }

  async function submit(): Promise<void> {
    onBeforeVerify?.();
    await verify();
  }
</script>

{#if available && successHint && phase === 'ok'}
  <div class="ok-hint" role="status">✓ {message || '令牌验证通过，已保存在本机'}</div>
{:else if visible}
  <!-- token-box / token-row / token-msg 为既有交互与自动化保留的定位别名 -->
  <div class="gate token-box" class:bad={phase === 'fail'}>
    <div class="gate-icon" aria-hidden="true">🔒</div>
    <div class="gate-head">
      <b>{title}</b>
      {#if phase === 'verifying'}
        <span class="badge">验证中…</span>
      {:else if phase === 'fail'}
        <span class="badge bad">✗ 未通过</span>
      {:else}
        <span class="badge">待验证</span>
      {/if}
    </div>
    <p>{description}</p>
    <div class="gate-row token-row">
      <input
        class="input"
        type="password"
        autocomplete="off"
        spellcheck="false"
        {placeholder}
        bind:this={inputEl}
        bind:value={token}
        onkeydown={(e) => e.key === 'Enter' && void submit()}
      />
      <button class="btn primary" disabled={busy} onclick={() => void submit()}>
        {busy ? '验证中…' : actionLabel}
      </button>
    </div>
    {#if message}
      <div class="gate-msg token-msg" class:bad={phase === 'fail'}>{message}</div>
    {/if}
  </div>
{/if}

<style>
  .gate {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
    padding: 20px;
    margin: 0 0 12px;
    border-radius: 12px;
    border: 1px dashed var(--line-strong);
    background: var(--panel-soft);
  }

  .gate.bad {
    border-color: #e3b7b0;
  }

  .gate-icon {
    font-size: 20px;
    line-height: 1;
  }

  .gate-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .gate-head b {
    font-size: 13.5px;
    color: var(--ink);
  }

  .gate p {
    margin: 0;
    font-size: 11.5px;
    color: var(--sub);
    line-height: 1.7;
    max-width: 560px;
  }

  .badge {
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 999px;
    color: var(--sub);
    border: 1px solid var(--line);
    white-space: nowrap;
  }

  .badge.bad {
    color: var(--danger);
    border-color: #f0d2cb;
  }

  .gate-row {
    display: flex;
    gap: 8px;
    width: 100%;
    max-width: 460px;
  }

  .gate-row > .input {
    flex: 1 1 200px;
    min-width: 0;
  }

  .gate-msg {
    width: 100%;
    max-width: 560px;
    padding: 8px 11px;
    border-radius: 8px;
    font-size: 11.5px;
    line-height: 1.7;
    color: var(--sub);
    background: var(--panel);
    border: 1px solid var(--line);
    word-break: break-word;
  }

  .gate-msg.bad {
    background: #fdecea;
    border-color: #f5c6c0;
    color: #a33325;
  }

  .ok-hint {
    display: block;
    color: #2f7a5b;
    font-size: 11.5px;
    line-height: 1.7;
    margin-bottom: 12px;
  }

  @media (max-width: 640px) {
    .gate-row {
      flex-wrap: wrap;
    }

    .gate-row > .input {
      flex-basis: 100%;
    }
  }
</style>
