<script lang="ts">
  import { onMount } from 'svelte';
  import Shelf from './Shelf.svelte';
  import Reader from './Reader.svelte';
  import ConnectDialog from './ConnectDialog.svelte';
  import ImportDialog from './ImportDialog.svelte';
  import SourceDialog from './SourceDialog.svelte';
  import SourceEditor from './SourceEditor.svelte';
  import LocalDataDialog from './LocalDataDialog.svelte';
  import Toasts from './Toasts.svelte';
  import { app } from '../stores/app.svelte';

  onMount(() => {
    document.getElementById('boot')?.remove();
    void app.init();

    // 浏览器扩展里不注册 Service Worker：扩展页面有自己的更新与缓存机制，
    // 且 chrome-extension:// 下注册会直接失败
    const isExtension = location.protocol === 'chrome-extension:';
    if (import.meta.env.PROD && !isExtension && 'serviceWorker' in navigator) {
      const base = import.meta.env.BASE_URL;
      navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
        /* 离线缓存失败不影响主流程 */
      });
    }
  });
</script>

{#if app.view === 'reader' && app.current}
  <Reader />
{:else}
  <Shelf />
{/if}

{#if app.connectOpen}
  <ConnectDialog />
{/if}

{#if app.importOpen}
  <ImportDialog />
{/if}

{#if app.sourcesOpen}
  <SourceDialog />
{/if}

{#if app.editorOpen}
  <SourceEditor />
{/if}

{#if app.localDataOpen}
  <LocalDataDialog />
{/if}

<Toasts />
