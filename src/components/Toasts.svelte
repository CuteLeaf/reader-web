<script lang="ts">
  import { app } from '../stores/app.svelte';
</script>

<div class="toasts">
  {#each app.toasts as t (t.id)}
    <div class="toast {t.kind}" onclick={() => app.dismissToast(t.id)} role="presentation">
      <span class="dot"></span>
      <span class="text">{t.text}</span>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: 26px;
    transform: translateX(-50%);
    z-index: 400;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(520px, 86vw);
    padding: 9px 14px;
    border-radius: 10px;
    background: rgba(28, 26, 22, 0.92);
    color: #f4f1ea;
    font-size: 12.5px;
    box-shadow: 0 10px 28px rgba(20, 18, 12, 0.28);
    animation: rise 0.2s cubic-bezier(0.2, 0.8, 0.3, 1);
    cursor: pointer;
    backdrop-filter: blur(6px);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #c9c2b4;
    flex: 0 0 auto;
  }

  .toast.success .dot {
    background: #6fcf97;
  }

  .toast.error .dot {
    background: #f2725f;
  }

  .text {
    line-height: 1.5;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
