<script lang="ts">
  import type { SelectionInfo } from '../lib/selection/selection';

  let {
    info,
    onread,
    ondict,
    oncopy,
  }: {
    info: SelectionInfo;
    onread: () => void;
    ondict: () => void;
    oncopy: () => void;
  } = $props();

  /** 浮层高度（含内边距），用于判断上方是否放得下 */
  const HEIGHT = 42;
  /** 与选区之间的间距 */
  const GAP = 10;
  /** 浮层宽度的一半，用于把浮层钳制在视口内 */
  const HALF = 96;

  /**
   * 定位：默认浮在选区上方；上方空间不足（比如选中的是第一行）就翻到下方。
   * 水平方向以选区中心对齐，再钳制进视口，避免窄侧栏里被裁掉。
   */
  const position = $derived.by(() => {
    const viewport = typeof window === 'undefined' ? 400 : window.innerWidth;
    const above = info.top > HEIGHT + GAP + 8;
    const top = above ? info.top - HEIGHT - GAP : info.bottom + GAP;
    const center = (info.left + info.right) / 2;
    const left = Math.min(Math.max(center, HALF + 6), Math.max(viewport - HALF - 6, HALF + 6));
    return `top:${Math.round(top)}px;left:${Math.round(left)}px`;
  });
</script>

<div class="sel-menu" style={position} role="toolbar" aria-label="选中文字的操作">
  <button type="button" onclick={onread}>
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M4 9v6h4l5 4V5L8 9H4z"
        fill="currentColor"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
      <path
        d="M17 8.5a4.5 4.5 0 0 1 0 7"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
    朗读
  </button>
  <button type="button" onclick={ondict}>
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      <path
        d="M8.5 8.5h5M8.5 12h5"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
    查词
  </button>
  <button type="button" onclick={oncopy}>
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <rect
        x="9"
        y="9"
        width="10"
        height="11"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <path
        d="M15 9V6.5A1.5 1.5 0 0 0 13.5 5H6.5A1.5 1.5 0 0 0 5 6.5v9A1.5 1.5 0 0 0 6.5 17H9"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
    复制
  </button>
</div>

<style>
  .sel-menu {
    position: fixed;
    z-index: 80;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-md);
    /* 窄侧栏里不换行，宁可按钮再紧凑一点 */
    white-space: nowrap;
    animation: sel-in 0.12s ease-out;
  }

  @keyframes sel-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(2px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    padding: 0 9px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--ink);
    font-size: 12.5px;
    line-height: 1;
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  button:hover {
    background: var(--panel-soft);
  }

  button:active {
    transform: translateY(1px);
  }

  @media (max-width: 360px) {
    button {
      padding: 0 7px;
      font-size: 12px;
    }
  }
</style>
