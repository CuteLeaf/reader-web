<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { app } from '../stores/app.svelte';
  import {
    guessLocalSubnet,
    parseTarget,
    scan,
    subnetFromLocation,
    type ScanCandidate,
  } from '../lib/sources/scan';
  import { normalizeBase } from '../lib/sources/legado';
  import { pageCannotUseLocalNetwork } from '../lib/sources/net';

  let prefix = $state('');
  let portsText = $state('1122');
  let manual = $state('');
  let scanning = $state(false);
  let progress = $state({ done: 0, total: 0 });
  let candidates = $state<ScanCandidate[]>([]);
  let scanError = $state('');
  let connecting = $state<string | null>(null);
  let subnetSource = $state<'page' | 'webrtc' | 'manual' | 'none'>('none');
  let ctrl: AbortController | null = null;

  const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
  /** HTTP 公网页面：浏览器不允许访问本地网络（LNA 权限只在安全上下文可用） */
  const lnaBlocked = pageCannotUseLocalNetwork();
  const LNA_HINT =
    '当前是 HTTP 公网页面，Chrome 会直接拒绝访问局域网设备（本地网络访问权限只在 HTTPS 下可用）。请改用 HTTPS 打开，或用局域网地址访问本站。';
  const pct = $derived(progress.total ? Math.round((progress.done / progress.total) * 100) : 0);
  const target = $derived(parseTarget(prefix));
  const isSingleHost = $derived(target?.kind === 'host');

  const parsedPorts = $derived(
    portsText
      .split(/[，,\s]+/)
      .map((p) => Number(p.trim()))
      .filter((p) => Number.isInteger(p) && p > 0 && p < 65536),
  );

  /** 手动地址对应的「能不能通」自测链接 */
  const manualBase = $derived.by(() => {
    if (!manual.trim()) return '';
    try {
      return normalizeBase(manual);
    } catch {
      return '';
    }
  });

  const COMMON = ['192.168.1', '192.168.0', '192.168.31', '192.168.2', '10.0.0'];
  /** 常见家用/办公网段：浏览器拿不到本机 IP 时，全试一遍 */
  const ALL_COMMON = [...COMMON, '192.168.10', '172.16.0'];

  /** 用 localhost 打开时，浏览器不给任何内网线索 */
  const isLoopbackHost =
    typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname);

  /** 扫描耗时估算，写死一个数容易吓人或误导 */
  const estimate = $derived.by(() => {
    if (isSingleHost) return '约 3 秒';
    const total = 254 * (parsedPorts.length || 1);
    return `约 ${Math.max(3, Math.ceil((total * 1.2) / 48))} 秒`;
  });

  onMount(async () => {
    const fromPage = subnetFromLocation();
    if (fromPage) {
      prefix = fromPage;
      subnetSource = 'page';
      return;
    }
    const guess = await guessLocalSubnet();
    if (guess) {
      prefix = guess;
      subnetSource = 'webrtc';
    } else {
      prefix = '192.168.1';
      subnetSource = 'none';
    }
  });

  onDestroy(() => ctrl?.abort());

  async function startScan() {
    if (scanning) {
      ctrl?.abort();
      scanning = false;
      return;
    }
    if (lnaBlocked) {
      scanError = LNA_HINT;
      return;
    }
    candidates = [];
    scanError = '';
    progress = { done: 0, total: 0 };
    scanning = true;
    ctrl = new AbortController();
    const signal = ctrl.signal;

    try {
      // 直接扫全段：结果实时出现，通常 3 秒内就能看到第一台设备
      await scan({
        prefix: prefix.trim() || null,
        ports: parsedPorts.length ? parsedPorts : [1122],
        signal,
        onProgress: (done, total) => (progress = { done, total }),
        onFound: (c) => (candidates = [...candidates.filter((x) => x.base !== c.base), c]),
      });
    } catch (e) {
      scanError = (e as Error).message;
    } finally {
      scanning = false;
      if (ctrl?.signal === signal) ctrl = null;
    }
  }

  /** 兜底：把常见网段一次扫掉（初始就全量探测，约 20–30 秒） */
  async function scanWide() {
    if (scanning) return;
    if (lnaBlocked) {
      scanError = LNA_HINT;
      return;
    }
    candidates = [];
    scanError = '';
    progress = { done: 0, total: 0 };
    scanning = true;
    ctrl = new AbortController();
    const signal = ctrl.signal;
    const others = ALL_COMMON.filter((x) => x !== prefix.trim());
    try {
      await scan({
        prefixes: others,
        ports: parsedPorts.length ? parsedPorts : [1122],
        signal,
        onProgress: (done, total) => (progress = { done, total }),
        onFound: (c) => (candidates = [...candidates.filter((x) => x.base !== c.base), c]),
      });
    } catch (e) {
      scanError = (e as Error).message;
    } finally {
      scanning = false;
      if (ctrl?.signal === signal) ctrl = null;
    }
  }

  async function connect(base: string) {
    connecting = base;
    const ok = await app.connect(base);
    connecting = null;
    if (ok) app.connectOpen = false;
  }

  async function connectManual() {
    if (!manual.trim()) return;
    let base: string;
    try {
      base = normalizeBase(manual);
    } catch (e) {
      scanError = (e as Error).message;
      return;
    }
    await connect(base);
  }

  function useSuggestion(value: string) {
    prefix = value;
    subnetSource = 'manual';
  }

  const close = () => (app.connectOpen = false);
</script>

<div class="backdrop" onclick={(e) => e.target === e.currentTarget && close()} role="presentation">
  <div class="modal">
    <div class="modal-header">
      <div>
        <div class="modal-title">连接「Legado 3.0」后端</div>
        <div class="modal-desc">
          手机与电脑需在同一局域网，手机上打开「阅读 → 我的 → Web 服务」，页面上会显示地址与端口。
        </div>
      </div>
      <button class="btn ghost sm" onclick={close}>✕</button>
    </div>

    <div class="modal-body">
      {#if isHttps}
        <div class="notice warn">
          当前页面是 <b>HTTPS</b>，浏览器会拦截对局域网 <code>http://</code> 服务的请求。请用
          <code>http://</code> 地址打开本站，或为后端配置 HTTPS 反向代理。
        </div>
      {/if}

      <div class="scan-line">
        <div class="field">
          <label for="subnet">网段{isSingleHost ? '（当前为单个 IP）' : ''}</label>
          <input
            id="subnet"
            class="input"
            placeholder="192.168.31 或 192.168.31.187"
            bind:value={prefix}
            disabled={scanning}
            oninput={() => (subnetSource = 'manual')}
          />
        </div>
        <div class="field narrow">
          <label for="ports">端口</label>
          <input
            id="ports"
            class="input"
            placeholder="1122"
            bind:value={portsText}
            disabled={scanning}
          />
        </div>
        <div class="field actions">
          <button class="btn primary" onclick={startScan}>
            {scanning ? '停止扫描' : '扫描'}
          </button>
        </div>
      </div>

      <div class="hints">
        <div class="chips">
          {#each COMMON as c (c)}
            <button
              class="chip"
              class:active={prefix === c}
              onclick={() => useSuggestion(c)}
              disabled={scanning}
            >
              {c}.x
            </button>
          {/each}
        </div>
        <span class="muted">
          {#if subnetSource === 'page'}
            已从页面地址推断网段
          {:else if subnetSource === 'webrtc'}
            已用 WebRTC 推断网段
          {:else if subnetSource === 'none'}
            未识别网段，请手动填写
          {:else}
            手动指定
          {/if}
          ·「扫描」遍历 {isSingleHost ? '这一个 IP' : '该网段 .1–.254'} 的 {parsedPorts.length || 1} 个端口，{estimate}
        </span>
        {#if isLoopbackHost}
          <span class="muted loopback">
            当前页面是用 <code>localhost</code> 打开的，浏览器不会暴露本机内网 IP——换用
            <code>http://本机内网IP:端口</code> 打开本站，就能自动识别网段。
          </span>
        {/if}
      </div>

      {#if scanning || progress.total > 0}
        <div class="progress-block">
          <div class="bar"><div class="bar-fill" style:width={`${pct}%`}></div></div>
          <div class="bar-text">
            {#if scanning}
              正在扫描 {progress.done} / {progress.total}
              <span class="muted">（找到的设备会立即出现在下方）</span>
            {:else}
              扫描完成，共探测 {progress.total} 个地址
            {/if}
          </div>
        </div>
      {/if}

      {#if scanError}
        <div class="notice error">{scanError}</div>
      {/if}

      {#if candidates.length > 0}
        <ul class="results">
          {#each candidates as c (c.base)}
            <li class="result" class:blocked={c.cors === 'blocked'}>
              <div class="r-main">
                <div class="r-top">
                  <b>{c.base.replace(/^https?:\/\//, '')}</b>
                  {#if c.cors === 'ok'}
                    <span class="tag ok">可用 · {c.bookCount} 本</span>
                    <span class="tag">{c.latency} ms</span>
                  {:else}
                    <span class="tag warn">端口有响应</span>
                  {/if}
                </div>
                <p class="r-sub">
                  {#if c.cors === 'ok'}
                    {c.titles.join(' / ') || '书架为空'}
                  {:else}
                    {c.titles[0] ?? '该地址能连通但读不到数据，可能未放开 CORS'}
                  {/if}
                </p>
              </div>
              <button
                class="btn sm primary"
                onclick={() => connect(c.base)}
                disabled={connecting === c.base}
              >
                {connecting === c.base ? '连接中…' : '连接'}
              </button>
            </li>
          {/each}
        </ul>
      {:else if !scanning && progress.total > 0 && !scanError}
        <div class="empty-diagnosis">
          <b>这个网段里没找到服务。</b>
          <ul>
            <li>手机端「Web 服务」是否已开启、屏幕是否常亮（锁屏后服务可能停）</li>
            <li>端口是否改过：阅读里显示的端口不是 1122 时，填到上面「端口」再扫</li>
            <li>手机 Wi-Fi 是否和电脑同网段（手机 IP 在 WLAN 详情里，形如 192.168.31.187）</li>
            <li>已知手机 IP 时最快：把整个 IP 填进「网段」框，只扫这一台</li>
            <li>路由器若开了 AP 隔离 / 访客网络，设备之间互相不可见</li>
          </ul>
          <p class="muted">
            也可以在手机浏览器里访问 <code>http://127.0.0.1:1122/getBookshelf</code>，能弹出 JSON
            就说明服务本身是好的。
          </p>
          <div class="wide-scan">
            <button class="btn sm" onclick={scanWide} disabled={scanning}>
              不知道网段：自动尝试 {ALL_COMMON.length - 1} 个常见网段
            </button>
            <span class="muted">192.168.0/1/2/10/31、10.0.0、172.16.0，约 30 秒</span>
          </div>
        </div>
      {/if}

      <div class="divider"></div>

      <div class="manual">
        <div class="field grow">
          <label for="manual">手动输入地址（推荐：照抄手机上的地址）</label>
          <input
            id="manual"
            class="input"
            placeholder="192.168.31.187:1122"
            bind:value={manual}
            onkeydown={(e) => e.key === 'Enter' && connectManual()}
          />
        </div>
        <button class="btn" onclick={connectManual} disabled={!manual.trim() || !!connecting}
          >连接</button
        >
      </div>

      {#if manualBase}
        <p class="test-link">
          连不上先自测：
          <a href={`${manualBase}/getBookshelf`} target="_blank" rel="noreferrer"
            >{manualBase}/getBookshelf</a
          >
          <span class="muted"
            >能显示 JSON = 网络通、问题在跨域；打不开 = 服务没开或地址/端口不对</span
          >
        </p>
      {/if}

      {#if lnaBlocked}
        <p class="test-link">
          <span class="muted"
            >当前是 HTTP 页面：Chrome 的「本地网络访问」权限只在 HTTPS 下可用，会直接拒绝访问
            192.168.x.x 这类局域网地址。启用 HTTPS，或改用局域网地址打开本站，才能连接。</span
          >
        </p>
      {/if}

      <p class="foot-note">连接信息只保存在本机 localStorage，不会上传。</p>
    </div>

    <div class="modal-footer">
      <button class="btn ghost" onclick={close}>稍后再说</button>
      <button
        class="btn"
        onclick={() => {
          close();
          app.importOpen = true;
        }}>只用本地阅读</button
      >
    </div>
  </div>
</div>

<style>
  .scan-line {
    display: flex;
    gap: 10px;
    align-items: flex-end;
    flex-wrap: wrap;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex: 1;
  }

  .field.narrow {
    flex: 0 0 104px;
  }

  .field.actions {
    flex: 0 0 auto;
    flex-direction: row;
    gap: 8px;
  }

  .field label {
    font-size: 11px;
    color: var(--sub);
    letter-spacing: 0.3px;
  }

  .hints {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-top: 10px;
  }

  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .chip {
    height: 24px;
    padding: 0 9px;
    border-radius: 7px;
    font-size: 11px;
    color: var(--sub);
    border: 1px solid var(--line);
    background: var(--panel);
    font-variant-numeric: tabular-nums;
    transition: all 0.14s ease;
  }

  .chip:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .chip.active {
    background: var(--accent-soft);
    border-color: transparent;
    color: var(--accent);
  }

  .muted {
    font-size: 11px;
    color: var(--sub);
    line-height: 1.6;
  }

  .progress-block {
    margin-top: 12px;
  }

  .bar {
    height: 4px;
    border-radius: 3px;
    background: var(--line);
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s ease;
  }

  .bar-text {
    margin-top: 6px;
    font-size: 11px;
    color: var(--sub);
    font-variant-numeric: tabular-nums;
  }

  .results {
    list-style: none;
    padding: 0;
    margin: 12px 0 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .result {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 13px;
    border-radius: 11px;
    border: 1px solid var(--line);
    background: var(--panel-soft);
  }

  .result.blocked {
    border-style: dashed;
  }

  .r-main {
    flex: 1;
    min-width: 0;
  }

  .r-top {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .r-top b {
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  .r-sub {
    margin: 3px 0 0;
    font-size: 11.5px;
    color: var(--sub);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag.warn {
    background: #fdf1e3;
    color: #a9702a;
    border-color: transparent;
  }

  .notice {
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    font-size: 11.5px;
    line-height: 1.7;
    background: var(--panel-soft);
    color: var(--ink-soft);
    border: 1px solid var(--line);
  }

  .notice.warn {
    background: #fdf6e7;
    border-color: #f0dfb8;
    color: #8a6a26;
  }

  .notice.error {
    background: #fdecea;
    border-color: #f5c6c0;
    color: #a33325;
  }

  .notice code,
  .empty-diagnosis code {
    font-size: 11px;
    padding: 1px 4px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.06);
  }

  .empty-diagnosis {
    margin-top: 12px;
    padding: 12px 14px;
    border-radius: 11px;
    background: var(--panel-soft);
    border: 1px solid var(--line);
    font-size: 11.5px;
    color: var(--ink-soft);
    line-height: 1.75;
  }

  .empty-diagnosis b {
    font-size: 12.5px;
  }

  .empty-diagnosis ul {
    margin: 6px 0 8px;
    padding-left: 18px;
  }

  .empty-diagnosis li {
    margin-bottom: 2px;
  }

  .empty-diagnosis p {
    margin: 0;
  }

  .wide-scan {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--line);
  }

  .loopback {
    padding: 6px 9px;
    border-radius: 8px;
    background: #fdf6e7;
    color: #8a6a26;
  }

  .loopback code,
  .empty-diagnosis code {
    font-size: 11px;
    padding: 1px 4px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.06);
  }

  .manual {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }

  .field.grow {
    flex: 1;
  }

  .test-link {
    margin: 8px 0 0;
    font-size: 11px;
    color: var(--sub);
    line-height: 1.7;
  }

  .test-link a {
    color: var(--accent);
    word-break: break-all;
  }

  .foot-note {
    margin: 10px 0 0;
    font-size: 11px;
    color: var(--sub);
    line-height: 1.7;
  }

  @media (max-width: 620px) {
    .field.narrow {
      flex: 1 1 90px;
    }
    .field.actions {
      flex: 1 1 100%;
    }
    .field.actions .btn {
      flex: 1;
    }
  }
</style>
