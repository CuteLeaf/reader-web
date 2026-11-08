<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { app } from '../stores/app.svelte';
  import { themeById } from '../lib/reader/theme';
  import CatalogDrawer from './CatalogDrawer.svelte';
  import SettingsDialog from './SettingsDialog.svelte';
  import SelectionMenu from './SelectionMenu.svelte';
  import TtsBar from './TtsBar.svelte';
  import DictSheet from './DictSheet.svelte';
  import { pickTerm, readSelection, type SelectionInfo } from '../lib/selection/selection';
  import { openSearch } from '../lib/selection/search';
  import { tts } from '../lib/tts/player.svelte';
  import { buildTextMap, rangeOf, type TextMap } from '../lib/reader/textMap';
  import { splitSentenceRanges, type SentenceRange } from '../lib/tts/segment';

  /** 站点默认标题，离开阅读页时还原 */
  const SITE_TITLE = '阅读 · 电子书 Web 阅读器';
  /** 摸鱼模式下伪装成一份 Word 文档 */
  const FAKE_TITLE = 'DeepSeek - 探索未至之境';

  /**
   * 窄屏工具栏：默认收起成右下角小把手，点开才展开六个按钮。
   * 桌面端仍是左侧常驻竖排，把手由 CSS 隐藏。
   */
  let toolsOpen = $state(false);
  /** 向下滚动时连把手一起隐藏，往回看或停下后恢复 */
  let handleHidden = $state(false);

  function closeTools(): void {
    toolsOpen = false;
  }

  /** 点工具栏/把手以外的地方就收起；滚动正文时也收起，避免展开的 dock 挡字 */
  function onWindowClick(e: MouseEvent): void {
    if (!toolsOpen) return;
    const target = e.target as Element | null;
    if (target?.closest?.('.tools.left, .tools-handle')) return;
    closeTools();
  }

  /**
   * 摸鱼模式：鼠标移出页面（或窗口失焦）时立刻盖上伪装页，
   * 鼠标移回 / 窗口重新聚焦时恢复。纯覆盖层，不卸载正文，进度与滚动位置都不变。
   */
  let stealth = $state(false);
  const stealthVisible = $derived(app.settings.stealthMode && stealth);

  /**
   * 侧栏与网页用同一套指针判定（离开就伪装、移回就恢复）；
   * 扩展环境额外支持全局快捷键 Ctrl/Cmd+Shift+H。
   */
  const isExtension = typeof location !== 'undefined' && location.protocol === 'chrome-extension:';

  onMount(() => {
    const original = document.title;
    const root = document.documentElement;

    /** 进入伪装的时刻：短时间内忽略残余 mousemove，避免刚盖上又被撤销 */
    let stealthAt = 0;
    const enterStealth = () => {
      stealth = true;
      stealthAt = performance.now();
    };
    const exitStealth = () => {
      stealth = false;
    };

    const cleanups: (() => void)[] = [
      () => {
        document.title = original;
      },
      // 离开阅读页时把朗读与自动滚动停掉
      () => tts.stop(),
      () => stopAutoScroll(),
      () => {
        if (handleTimer) clearTimeout(handleTimer);
      },
    ];

    // 侧栏与网页统一：指针离开当前页面就伪装，移回就恢复
    /**
     * 判定「指针离开文档」：relatedTarget 为空说明不是移到页面内某个元素。
     * 只靠 mouseleave 在部分浏览器/快速移出时会漏，所以 mouseout / pointerleave /
     * mouseleave 三条路径都挂上，任何一条命中就进入伪装（重复置 true 无副作用）。
     */
    const onOut = (e: MouseEvent) => {
      if (e.relatedTarget) return;
      enterStealth();
    };
    const onLeave = () => {
      enterStealth();
    };
    const onEnter = (e?: Event) => {
      if (!stealth) return;
      // 刚盖上时的残余 move 不算「移回」
      if (performance.now() - stealthAt < 150) return;
      // 指针贴着视口边缘时浏览器仍可能补发一次 move，这种也不算
      if (e instanceof MouseEvent) {
        const { clientX: x, clientY: y } = e;
        if (x <= 0 || y <= 0 || x >= window.innerWidth || y >= window.innerHeight) return;
      }
      exitStealth();
    };
    const onBlur = () => enterStealth();
    /** 切到别的标签页时也挡住，回来不会先闪一下正文 */
    const onVisibility = () => {
      if (document.hidden) enterStealth();
    };

    document.addEventListener('mouseout', onOut);
    // 窗口级 mouseout 在指针离开窗口时也会触发，作为又一条兜底
    window.addEventListener('mouseout', onOut);
    // pointerleave / mouseleave 不冒泡，必须绑在根元素上
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('mouseleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    // 指针回到页面（鼠标或笔）立即恢复；平时只在已伪装时做一次赋值
    document.addEventListener('mousemove', onEnter, { passive: true });
    document.addEventListener('pointermove', onEnter, { passive: true });
    window.addEventListener('focus', onEnter);

    cleanups.push(() => {
      document.removeEventListener('mouseout', onOut);
      window.removeEventListener('mouseout', onOut);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mousemove', onEnter);
      document.removeEventListener('pointermove', onEnter);
      window.removeEventListener('focus', onEnter);
    });

    // 侧栏额外保留全局快捷键（Ctrl/Cmd+Shift+H），窗口失焦也由上面的 blur 兜底
    if (isExtension) {
      const toggle = () => (stealth ? exitStealth() : enterStealth());
      type MessageListener = (msg: unknown) => void;
      const ext = (
        globalThis as {
          chrome?: {
            runtime?: {
              onMessage?: {
                addListener: (fn: MessageListener) => void;
                removeListener?: (fn: MessageListener) => void;
              };
            };
          };
        }
      ).chrome;
      const onMessage: MessageListener = (msg) => {
        if ((msg as { type?: string } | null)?.type === 'reader:toggle-stealth') toggle();
      };
      ext?.runtime?.onMessage?.addListener(onMessage);
      cleanups.push(() => ext?.runtime?.onMessage?.removeListener?.(onMessage));
    }

    return () => cleanups.forEach((fn) => fn());
  });

  // 关掉开关时立刻退出伪装，避免下次开启时残留
  $effect(() => {
    if (!app.settings.stealthMode) stealth = false;
  });

  $effect(() => {
    if (stealthVisible) {
      document.title = FAKE_TITLE;
      return;
    }
    const chapter = app.chapterTitle?.trim() ?? '';
    const book = app.current?.title?.trim() ?? '';
    document.title = chapter && book ? `${chapter} · ${book}` : book || chapter || SITE_TITLE;
  });

  let scroller = $state<HTMLDivElement | null>(null);

  /* ---------------- 选中文字后的操作：朗读 / 查词 / 复制 ---------------- */
  let selected = $state<SelectionInfo | null>(null);
  let menuOpen = $state(false);
  let dictTerm = $state('');
  let dictOpen = $state(false);

  /* ---------------- 自动滚动（免手动滚屏） ---------------- */
  let autoScroll = $state(false);
  let autoRaf = 0;
  let autoLast = 0;
  /** 1x 时的滚动速度，约每秒 34px，接近舒适阅读的节奏 */
  const AUTO_BASE_SPEED = 34;

  function autoTick(now: number): void {
    if (!autoScroll || !scroller) return;
    // 掉帧时 dt 可能很大，钳住避免一下跳好几屏
    const dt = autoLast ? Math.min(now - autoLast, 120) : 16;
    autoLast = now;

    const max = scroller.scrollHeight - scroller.clientHeight;
    if (scroller.scrollTop >= max - 1) {
      if (app.chapterIndex < app.chapters.length - 1) {
        void go(1);
        autoRaf = requestAnimationFrame(autoTick);
        return;
      }
      stopAutoScroll();
      app.toast('已经是最后一章了', 'info');
      return;
    }

    const px = AUTO_BASE_SPEED * app.settings.scrollSpeed * (dt / 1000);
    scroller.scrollTop = Math.min(max, scroller.scrollTop + px);
    autoRaf = requestAnimationFrame(autoTick);
  }

  function startAutoScroll(): void {
    if (autoScroll || !scroller) return;
    autoScroll = true;
    autoLast = 0;
    autoRaf = requestAnimationFrame(autoTick);
  }

  function stopAutoScroll(): void {
    autoScroll = false;
    if (autoRaf) cancelAnimationFrame(autoRaf);
    autoRaf = 0;
  }

  function toggleAutoScroll(): void {
    if (autoScroll) stopAutoScroll();
    else startAutoScroll();
  }

  /** 用户主动滚屏就退出自动模式，避免「我滚它也滚」 */
  $effect(() => {
    if (!autoScroll) return;
    const el = scroller;
    if (!el) return;
    const stop = () => stopAutoScroll();
    el.addEventListener('wheel', stop, { passive: true });
    el.addEventListener('touchstart', stop, { passive: true });
    return () => {
      el.removeEventListener('wheel', stop);
      el.removeEventListener('touchstart', stop);
    };
  });

  /** 朗读时用于定位的正文文本坐标（不参与响应式，避免重复构建） */
  let ttsMap: TextMap | null = null;
  let ttsBase = 0;
  let ttsRanges: SentenceRange[] = [];

  /**
   * 选区监听：pointerup 立刻响应，selectionchange 兜住移动端拖选手柄与键盘选择。
   * 只做一次去抖，避免拖选过程中浮层跟着跳。
   */
  $effect(() => {
    const root = scroller;
    if (!root) return;

    let timer = 0;
    const insideOverlay = (target: EventTarget | null) =>
      !!(target as Element | null)?.closest?.('.sel-menu, .dict');

    const refresh = () => {
      const info = readSelection(root);
      selected = info;
      menuOpen = !!info;
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = window.setTimeout(refresh, 120);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (insideOverlay(e.target)) return;
      schedule();
    };
    const onSelectionChange = () => schedule();
    const onPointerDown = (e: PointerEvent) => {
      // 点浮层本身不能收起，否则按钮的 click 还没触发就没了
      if (insideOverlay(e.target)) return;
      menuOpen = false;
    };
    const onScroll = () => {
      menuOpen = false;
    };

    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('selectionchange', onSelectionChange);
    root.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('selectionchange', onSelectionChange);
      root.removeEventListener('scroll', onScroll);
    };
  });

  /** 换章时停掉朗读，否则会继续念上一章的内容 */
  let lastChapter = -1;
  $effect(() => {
    const index = app.chapterIndex;
    if (lastChapter !== -1 && index !== lastChapter) tts.stop();
    lastChapter = index;
  });

  function readSelected(): void {
    if (!selected) return;

    // 先断句并记录每句在正文中的位置，朗读时据此滚动
    const content = scroller?.querySelector<HTMLElement>('.content');
    const from = selected.from;
    const to = selected.to;
    const map = content && from && to ? buildTextMap(content) : null;
    const startPara = map && from ? map.paras[from.para] : undefined;
    const endPara = map && to ? map.paras[to.para] : undefined;
    if (map && from && to && startPara && endPara) {
      const start = startPara.start + from.offset;
      const end = endPara.start + to.offset;
      const ranges = splitSentenceRanges(map.text.slice(start, end));
      if (ranges.length && tts.playChunks(ranges.map((r) => r.text))) {
        ttsMap = map;
        ttsBase = start;
        ttsRanges = ranges;
        menuOpen = false;
        return;
      }
    }

    ttsMap = null;
    ttsBase = 0;
    ttsRanges = [];
    const ok = tts.play(selected.text);
    if (!ok) app.toast('当前浏览器不支持语音朗读', 'error');
    menuOpen = false;
  }

  /** 当前句滚到视口上方三分之一处；已经在舒适区内就不动，避免频繁抖动 */
  function scrollToSentence(start: number, end: number): void {
    if (!scroller || !ttsMap) return;
    const range = rangeOf(ttsMap, start, end);
    if (!range) return;
    const rect = range.getBoundingClientRect();
    if (!rect.height) return;
    const box = scroller.getBoundingClientRect();
    const comfortableTop = box.top + 72;
    const comfortableBottom = box.bottom - 140;
    if (rect.top >= comfortableTop && rect.bottom <= comfortableBottom) return;
    const top = Math.max(0, scroller.scrollTop + (rect.top - box.top) - box.height * 0.3);
    scroller.scrollTo({ top, behavior: 'smooth' });
  }

  // 朗读进度变化时跟随滚动
  $effect(() => {
    const index = tts.index;
    const state = tts.state;
    if (state !== 'playing' || !ttsRanges.length) return;
    const range = ttsRanges[index];
    if (range) scrollToSentence(ttsBase + range.start, ttsBase + range.end);
  });

  function lookupSelected(): void {
    if (!selected) return;
    const term = pickTerm(selected.text);
    if (!term) {
      app.toast('选中内容里没有可查询的词', 'info');
      return;
    }
    dictTerm = term;
    dictOpen = true;
    menuOpen = false;
  }

  /** 选中文字直接在新标签页搜索，不打断当前阅读位置 */
  function searchSelected(): void {
    if (!selected) return;
    const mode = openSearch(selected.text, app.settings.searchEngine);
    if (!mode) {
      app.toast('选中内容为空，无法搜索', 'info');
      return;
    }
    menuOpen = false;
  }

  async function copySelected(): Promise<void> {
    const text = selected?.text ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      app.toast('已复制', 'success');
    } catch {
      app.toast('复制失败，请手动选择后复制', 'error');
    }
    menuOpen = false;
  }

  // 换章后停在哪：上一章往回翻时停在底部，否则回到顶部
  let pendingAnchor: 'top' | 'bottom' = 'top';
  const theme = $derived(themeById(app.settings.theme));
  /** 本章阅读进度：按正文滚动位置算，内容不足一屏时视为已读完 */
  let chapterPercent = $state(0);

  function updateChapterPercent(el: HTMLDivElement | null = scroller): void {
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    chapterPercent = max <= 1 ? 100 : Math.min(100, Math.round((el.scrollTop / max) * 100));
  }

  // 换章、正文渲染完、恢复上次位置、开关状态栏后都要重算，避免沿用旧的百分比
  $effect(() => {
    void app.scrollToken;
    void app.contentLoading;
    void app.chapterIndex;
    void app.settings.showStatusBar;
    requestAnimationFrame(() => updateChapterPercent());
  });

  $effect(() => {
    void app.scrollToken;
    // 换章后旧的滚动动画 / 按住滚动必须停掉，否则会把新章一起滚走
    stopAnim();
    stopHold();
    // 正文还没渲染时（骨架屏）算出来的 scrollHeight 是假的，等真正上屏后再定位
    if (app.contentLoading) return;
    const el = scroller;
    if (!el) return;
    if (pendingAnchor === 'bottom') {
      el.scrollTop = el.scrollHeight;
      pendingAnchor = 'top';
      return;
    }
    // 和手机端同步过进度时，回到上次读到的位置
    const restore = app.takeRestorePos();
    if (restore > 0) {
      scrollToCharOffset(el, restore);
      return;
    }
    el.scrollTop = 0;
  });

  /** 把滚动位置换算成「本章内已读字符数」，与后端 durChapterPos 同义 */
  function charOffsetAt(el: HTMLDivElement): number {
    const content = el.querySelector('.content');
    if (!content) return 0;
    const lineTop = el.getBoundingClientRect().top + 4;
    let offset = 0;
    for (const p of content.querySelectorAll('p')) {
      if (p.getBoundingClientRect().bottom > lineTop) return offset;
      offset += p.textContent?.length ?? 0;
    }
    return offset;
  }

  /** 按字符偏移滚到对应段落，用于恢复上次的阅读位置 */
  function scrollToCharOffset(el: HTMLDivElement, pos: number): void {
    const content = el.querySelector('.content');
    if (!content) return;
    let offset = 0;
    for (const p of content.querySelectorAll('p')) {
      offset += p.textContent?.length ?? 0;
      if (offset >= pos) {
        const delta = p.getBoundingClientRect().top - el.getBoundingClientRect().top;
        el.scrollTop += delta - 8;
        return;
      }
    }
    el.scrollTop = el.scrollHeight;
  }

  let scrollRaf = 0;

  /** 滚动只上报位置，落盘与回传由 store 做防抖 */
  let lastScrollTop = 0;
  let handleTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 下移隐藏 / 上移恢复。自动滚屏虽然一直在下移，但把手是唯一的暂停入口，
   * 所以这种情况下始终保持可见。
   */
  function updateHandleVisibility(): void {
    if (autoScroll) {
      if (handleTimer) clearTimeout(handleTimer);
      handleHidden = false;
      lastScrollTop = scroller?.scrollTop ?? lastScrollTop;
      return;
    }
    const el = scroller;
    if (!el) return;
    const top = el.scrollTop;
    const delta = top - lastScrollTop;
    lastScrollTop = top;
    if (delta > 4) handleHidden = true;
    else if (delta < -4) handleHidden = false;
    // 停下来后恢复，避免读完一段却找不到入口
    if (handleTimer) clearTimeout(handleTimer);
    handleTimer = setTimeout(() => {
      handleHidden = false;
    }, 1400);
  }

  function onScroll(): void {
    // 自动滚屏时正文一直在滚，此时不能收起 dock，否则「暂停」按钮一点开就消失
    if (toolsOpen && !autoScroll) closeTools();
    updateHandleVisibility();
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const el = scroller;
      if (!el) return;
      updateChapterPercent(el);
      if (app.contentLoading) return;
      app.reportProgress(charOffsetAt(el));
    });
  }

  const PAGE_RATIO = 0.88;
  /** 1× 速度下滚一屏的目标时长；用的是可控动画，原生 smooth 无法调速 */
  const BASE_DURATION = 340;
  /** 1× 速度下「按住连续滚动」每秒走过的像素 */
  const BASE_SPEED = 620;

  const maxScroll = (el: HTMLDivElement): number => Math.max(0, el.scrollHeight - el.clientHeight);
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const speed = (): number => clamp(Number(app.settings.scrollSpeed) || 1, 0.5, 3);

  let animRaf = 0;
  let animTarget = 0;
  let holdDir: -1 | 0 | 1 = 0;
  let holdRaf = 0;
  let holdLast = 0;

  function stopAnim(): void {
    if (animRaf) cancelAnimationFrame(animRaf);
    animRaf = 0;
    animTarget = 0;
  }

  function stopHold(): void {
    holdDir = 0;
    if (holdRaf) cancelAnimationFrame(holdRaf);
    holdRaf = 0;
  }

  /** 连按时按动画的目标位置判断边界，避免动画途中被误判成「还没到底」 */
  function currentTop(el: HTMLDivElement): number {
    return animRaf ? animTarget : el.scrollTop;
  }

  function atBottom(): boolean {
    const el = scroller;
    return !!el && currentTop(el) + el.clientHeight >= el.scrollHeight - 8;
  }

  function atTop(): boolean {
    const el = scroller;
    return !!el && currentTop(el) <= 8;
  }

  function animateTo(el: HTMLDivElement, target: number): void {
    stopAnim();
    stopHold();
    const from = el.scrollTop;
    const to = clamp(target, 0, maxScroll(el));
    const distance = Math.abs(to - from);
    if (distance < 1) return;

    // 距离越长动画略久，整体由设置里的速度倍率缩放
    const base = clamp(
      BASE_DURATION * Math.sqrt(distance / (el.clientHeight * PAGE_RATIO)),
      110,
      560,
    );
    const duration = base / speed();
    if (duration < 45) {
      el.scrollTop = to;
      return;
    }

    animTarget = to;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = clamp((now - t0) / duration, 0, 1);
      el.scrollTop = from + (to - from) * (1 - Math.pow(1 - t, 3));
      if (t < 1) {
        animRaf = requestAnimationFrame(step);
      } else {
        animRaf = 0;
        animTarget = 0;
        el.scrollTop = to;
      }
    };
    animRaf = requestAnimationFrame(step);
  }

  function stepAmount(el: HTMLDivElement, forcePage: boolean): number {
    const page = el.clientHeight * PAGE_RATIO;
    const mode = forcePage ? 'page' : app.settings.keyScrollMode;
    if (mode === 'half') return page / 2;
    if (mode === 'line')
      return Math.max(20, Math.round(app.settings.fontSize * app.settings.lineHeight));
    return page;
  }

  function scrollByStep(dir: 1 | -1, forcePage: boolean): void {
    const el = scroller;
    if (!el) return;
    animateTo(el, currentTop(el) + dir * stepAmount(el, forcePage));
  }

  /** 按住 ↑↓ 不放持续滚动；到章首 / 章末时按原逻辑换一次章就停 */
  function holdStep(now: number): void {
    holdRaf = 0;
    const el = scroller;
    if (!el || !holdDir || app.settings.keyScrollMode !== 'continuous') return;
    const dt = Math.min(64, Math.max(0, now - holdLast));
    holdLast = now;
    const limit = maxScroll(el);
    const next = clamp(el.scrollTop + holdDir * BASE_SPEED * speed() * (dt / 1000), 0, limit);
    el.scrollTop = next;
    if ((holdDir > 0 && next >= limit - 1) || (holdDir < 0 && next <= 1)) {
      const dir = holdDir;
      stopHold();
      if (dir < 0) pendingAnchor = 'bottom';
      void go(dir);
      return;
    }
    holdRaf = requestAnimationFrame(holdStep);
  }

  function startHold(dir: 1 | -1): void {
    if (holdDir === dir && holdRaf) return;
    stopAnim();
    holdDir = dir;
    holdLast = performance.now();
    holdRaf = requestAnimationFrame(holdStep);
  }

  /** 向下：到底了自动进入下一章 */
  async function pageDown(forcePage = false): Promise<void> {
    const el = scroller;
    if (!el) return;
    if (atBottom()) {
      await go(1);
      return;
    }
    if (!forcePage && app.settings.keyScrollMode === 'continuous') {
      startHold(1);
      return;
    }
    scrollByStep(1, forcePage);
  }

  /** 向上：到顶了回到上一章的末尾 */
  async function pageUp(forcePage = false): Promise<void> {
    const el = scroller;
    if (!el) return;
    if (atTop()) {
      pendingAnchor = 'bottom';
      await go(-1);
      return;
    }
    if (!forcePage && app.settings.keyScrollMode === 'continuous') {
      startHold(-1);
      return;
    }
    scrollByStep(-1, forcePage);
  }

  async function go(delta: number): Promise<void> {
    stopAnim();
    stopHold();
    if (delta > 0) await app.nextChapter();
    else await app.prevChapter();
    await tick();
  }

  function onKeyup(e: KeyboardEvent): void {
    if ((e.key === 'ArrowDown' && holdDir === 1) || (e.key === 'ArrowUp' && holdDir === -1)) {
      stopHold();
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    // 展开的工具栏是最上层浮层：Esc 只收起它，不要继续走到「退出阅读页」
    if (e.key === 'Escape' && toolsOpen) {
      closeTools();
      return;
    }
    if (app.catalogOpen || app.settingsOpen) {
      stopHold();
      if (e.key === 'Escape') {
        app.catalogOpen = false;
        app.settingsOpen = false;
      }
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;

    // 手动翻页/滚动视为接管，先退出自动滚动
    if (
      autoScroll &&
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown'].includes(e.key)
    ) {
      stopAutoScroll();
    }

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        void go(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        void go(1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        // 连续模式由「按下 / 松开」驱动，忽略键盘自动重复
        if (app.settings.keyScrollMode === 'continuous' && e.repeat) break;
        void pageDown();
        break;
      case 'PageDown':
      case ' ':
        e.preventDefault();
        void pageDown(true);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (app.settings.keyScrollMode === 'continuous' && e.repeat) break;
        void pageUp();
        break;
      case 'PageUp':
        e.preventDefault();
        void pageUp(true);
        break;
      case 'Escape':
        // 优先关掉选区块、词典与朗读，最后才是退出阅读页
        if (menuOpen) {
          menuOpen = false;
          break;
        }
        if (dictOpen) {
          dictOpen = false;
          break;
        }
        if (tts.state !== 'idle') {
          tts.stop();
          break;
        }
        stopAnim();
        stopHold();
        app.backToShelf();
        break;
    }
  }
</script>

<svelte:window
  onclick={onWindowClick}
  onkeydown={onKeydown}
  onkeyup={onKeyup}
  onresize={() => updateChapterPercent()}
  onblur={() => {
    stopAnim();
    stopHold();
  }}
  onpagehide={() => void app.flushProgress({ force: true, keepalive: true })}
/>

<div
  class="reader"
  class:with-status-bar={app.settings.showStatusBar}
  class:night={theme.night}
  style:--r-body={theme.body}
  style:--r-content={theme.content}
  style:--r-text={theme.text}
  style:--r-sub={theme.textSub}
  style:--r-border={theme.border}
>
  <button
    class="tools-handle"
    class:on={toolsOpen}
    class:pausing={autoScroll}
    class:hidden={handleHidden}
    onclick={() => {
      // 自动滚屏时把手直接兼作「暂停」，一步就能停，不必先展开再找按钮
      if (autoScroll) {
        stopAutoScroll();
        closeTools();
        return;
      }
      toolsOpen = !toolsOpen;
    }}
    aria-label={autoScroll ? '暂停自动滚动' : toolsOpen ? '收起工具栏' : '展开工具栏'}
    aria-expanded={toolsOpen}
    title={autoScroll ? '暂停自动滚动' : '展开工具栏'}
  >
    {#if autoScroll}
      <svg viewBox="0 0 24 24" width="18" height="18"
        ><rect x="7" y="6" width="3.6" height="12" rx="1.2" fill="currentColor" /><rect
          x="13.4"
          y="6"
          width="3.6"
          height="12"
          rx="1.2"
          fill="currentColor"
        /></svg
      >
    {:else}
      <svg viewBox="0 0 24 24" width="18" height="18"
        ><path
          d="M5 8h14M5 12h14M5 16h14"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          fill="none"
        /></svg
      >
    {/if}
  </button>

  <nav class="tools left" class:open={toolsOpen}>
    <button
      onclick={() => {
        closeTools();
        stopAutoScroll();
        app.catalogOpen = true;
      }}
      title="目录"
    >
      <svg viewBox="0 0 24 24" width="16" height="16"
        ><path
          d="M4 6h16M4 12h16M4 18h10"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          fill="none"
        /></svg
      >
      <span>目录</span>
    </button>
    <button
      onclick={() => {
        closeTools();
        stopAutoScroll();
        app.settingsOpen = true;
      }}
      title="设置"
    >
      <svg viewBox="0 0 24 24" width="16" height="16"
        ><circle
          cx="12"
          cy="12"
          r="3.2"
          stroke="currentColor"
          stroke-width="1.6"
          fill="none"
        /><path
          d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        /></svg
      >
      <span>设置</span>
    </button>
    <button
      class:on={autoScroll}
      onclick={() => {
        closeTools();
        toggleAutoScroll();
      }}
      title={autoScroll ? '暂停自动滚动' : '自动滚动'}
      aria-pressed={autoScroll}
    >
      {#if autoScroll}
        <svg viewBox="0 0 24 24" width="16" height="16"
          ><rect x="7" y="6" width="3.6" height="12" rx="1.2" fill="currentColor" /><rect
            x="13.4"
            y="6"
            width="3.6"
            height="12"
            rx="1.2"
            fill="currentColor"
          /></svg
        >
      {:else}
        <svg viewBox="0 0 24 24" width="16" height="16"
          ><path
            d="M6 6l6 6 6-6M6 13l6 6 6-6"
            stroke="currentColor"
            stroke-width="1.7"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          /></svg
        >
      {/if}
      <span>{autoScroll ? '暂停' : '滚动'}</span>
    </button>
    <button
      onclick={() => {
        closeTools();
        app.backToShelf();
      }}
      title="返回书架"
    >
      <svg viewBox="0 0 24 24" width="16" height="16"
        ><path
          d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"
          stroke="currentColor"
          stroke-width="1.6"
          fill="none"
          stroke-linejoin="round"
        /></svg
      >
      <span>书架</span>
    </button>
    <button
      onclick={() => {
        closeTools();
        scroller?.scrollTo({ top: 0, behavior: 'smooth' });
      }}
      title="回到顶部"
    >
      <svg viewBox="0 0 24 24" width="16" height="16"
        ><path
          d="M12 19V6M6 12l6-6 6 6"
          stroke="currentColor"
          stroke-width="1.7"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
      <span>顶部</span>
    </button>
    <button
      onclick={() => {
        closeTools();
        scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
      }}
      title="回到底部"
    >
      <svg viewBox="0 0 24 24" width="16" height="16"
        ><path
          d="M12 5v13M6 12l6 6 6-6"
          stroke="currentColor"
          stroke-width="1.7"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
      <span>底部</span>
    </button>
  </nav>

  <div class="scroller" bind:this={scroller} onscroll={onScroll}>
    <article
      class="paper"
      class:loading={app.contentLoading}
      style:max-width={`${app.settings.readWidth}px`}
      style:font-size={`${app.settings.fontSize}px`}
      style:line-height={app.settings.lineHeight}
      style:font-family={app.settings.fontFamily}
      style:--letter-gap={`${app.settings.letterSpacing}px`}
      style:--para-gap={`${app.settings.paragraphSpacing}em`}
    >
      <header class="chapter-head">
        <span class="book-name">{app.current?.title}</span>
        <h2>{app.chapterTitle}</h2>
        <span class="chapter-no">{app.chapterIndex + 1} / {app.chapters.length}</span>
      </header>

      {#if app.contentLoading}
        <div class="skeleton">
          {#each [92, 100, 97, 99, 88, 100, 94, 60] as w, i (i)}
            <div class="line" style:width={`${w}%`}></div>
          {/each}
        </div>
      {:else}
        <div class="content">
          {#each app.paragraphs as p, i (i)}
            <p>{p}</p>
          {/each}
        </div>
      {/if}

      <footer class="chapter-foot">
        <button class="btn nav-btn" onclick={() => go(-1)} disabled={app.chapterIndex === 0}>
          ← 上一章
        </button>
        <button class="btn nav-btn" onclick={() => (app.catalogOpen = true)}>目录</button>
        <button
          class="btn nav-btn"
          onclick={() => go(1)}
          disabled={app.chapterIndex >= app.chapters.length - 1}>下一章 →</button
        >
      </footer>
    </article>

    {#if app.settings.showStatusBar}
      <!-- 底部细状态栏：跟着纸张居中，左为章节名，右为本章阅读进度 -->
      <div class="status-bar" style:max-width={`${app.settings.readWidth}px`} aria-label="阅读状态">
        <div class="status-left">
          <span class="status-title" title={app.chapterTitle}>{app.chapterTitle || '正文'}</span>
        </div>
        <div class="status-progress" title="本章阅读进度">{chapterPercent}%</div>
        {#if app.settings.showProgressBar}
          <div class="progress"><div class="fill" style:width={`${chapterPercent}%`}></div></div>
        {/if}
      </div>
    {/if}
  </div>

  {#if app.catalogOpen}<CatalogDrawer />{/if}
  {#if app.settingsOpen}<SettingsDialog />{/if}

  {#if menuOpen && selected}
    <SelectionMenu
      info={selected}
      onread={readSelected}
      ondict={lookupSelected}
      onsearch={searchSelected}
      oncopy={() => void copySelected()}
    />
  {/if}

  {#if dictOpen}
    <DictSheet term={dictTerm} onclose={() => (dictOpen = false)} />
  {/if}

  <TtsBar />

  {#if stealthVisible}
    <div class="stealth" aria-hidden="true">
      <div class="ds-app">
        <aside class="ds-side">
          <div class="ds-brand">deepseek</div>
          <div class="ds-new">＋ 新建对话</div>
          <div class="ds-group">今天</div>
          <div class="ds-item on">前端首屏加载优化方案</div>
          <div class="ds-item">接口联调排期确认</div>
          <div class="ds-item">周报模板整理</div>
          <div class="ds-group">更早</div>
          <div class="ds-item">值班安排确认</div>
          <div class="ds-foot">叶工</div>
        </aside>

        <main class="ds-main">
          <header class="ds-top">
            <span class="ds-model">DeepSeek-V4-Pro <i>▾</i></span>
            <span class="ds-top-actions">分享 · 更多</span>
          </header>

          <div class="ds-chat">
            <div class="ds-msg user">
              <div class="ds-bubble">怎么优化首屏加载速度？现在页面打开要 3 秒多。</div>
            </div>

            <div class="ds-msg ai">
              <div class="ds-avatar">D</div>
              <div class="ds-bubble">
                <p>可以从几个方向排查，按收益排序：</p>
                <p>
                  <b>1. 资源体积</b>：首屏 JS/CSS 拆包、路由级懒加载，图片改用 WebP 并预留尺寸。
                </p>
                <p><b>2. 请求链路</b>：关键接口做服务端聚合，静态资源上 CDN，开启 HTTP/2。</p>
                <p>
                  <b>3. 渲染阻塞</b>：内联关键 CSS，非关键脚本加 defer，字体用 font-display: swap。
                </p>
                <p><b>4. 缓存</b>：HTML 短缓存，静态资源带 hash 长缓存，二次访问直接命中。</p>
                <p>建议先用 Lighthouse 跑一遍拿到具体瓶颈，再决定先改哪一块。</p>
              </div>
            </div>
          </div>

          <div class="ds-composer">
            <div class="ds-input">给 DeepSeek 发送消息</div>
            <div class="ds-tools"><span>深度思考 (R1)</span><span>联网搜索</span></div>
          </div>
        </main>
      </div>
    </div>
  {/if}
</div>

<style>
  .reader {
    /* 状态栏关掉时高度为 0，正文与浮层都回到原来的位置 */
    --status-h: 0px;
    /* 朗读条 / 查词面板跟着底部状态栏一起抬高 */
    --tts-bottom: calc(16px + var(--status-h));
    position: relative;
    height: 100vh;
    height: 100dvh;
    background: var(--r-body);
    color: var(--r-text);
    transition:
      background 0.2s ease,
      color 0.2s ease;
  }

  .reader.with-status-bar {
    --status-h: 26px;
  }

  @media (max-width: 760px) {
    /* 窄屏底部还有工具条，抬高的基数与 global.css 保持一致 */
    .reader {
      --tts-bottom: calc(76px + var(--status-h));
    }
  }

  /* 底部细状态栏：与纸张同宽、一起居中，滚动时粘在底部 */
  .status-bar {
    position: sticky;
    bottom: 0;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    height: var(--status-h);
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 56px;
    background: var(--r-content);
    border-left: 1px solid var(--r-border);
    border-right: 1px solid var(--r-border);
    border-top: 1px solid var(--r-border);
    color: var(--r-sub);
    font-size: 11px;
    line-height: 1;
    z-index: 55;
  }

  /* 可选进度条：贴在状态栏上沿，默认由设置关闭 */
  .progress {
    position: absolute;
    top: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: color-mix(in srgb, var(--r-text) 12%, transparent);
  }

  .fill {
    height: 100%;
    background: var(--accent);
  }

  .status-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .status-title {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--r-text);
  }

  .status-progress {
    flex: 0 0 auto;
    color: var(--r-text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .status-progress::before {
    content: '本章 ';
    color: var(--r-sub);
    font-weight: 400;
  }

  /* 窄屏才出现的小把手；桌面端保持左侧常驻竖排 */
  .tools-handle {
    display: none;
  }

  .tools.left {
    position: fixed;
    left: 18px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 6px;
    border-radius: 14px;
    background: var(--r-content);
    border: 1px solid var(--r-border);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.07);
    z-index: 50;
  }

  .tools button {
    width: 52px;
    padding: 7px 0 5px;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    color: var(--r-sub);
    transition:
      background 0.16s ease,
      color 0.16s ease;
  }

  .tools button span {
    font-size: 10px;
    letter-spacing: 0.5px;
  }

  .tools button:hover {
    background: color-mix(in srgb, var(--r-text) 8%, transparent);
    color: var(--r-text);
  }

  .tools button.on {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  /* 正文区：状态栏在流内 sticky 占一行，左右保留纸张色块与边框 */
  .scroller {
    height: 100%;
    overflow-y: auto;
    padding: 0;
    background: var(--r-body);
  }

  .paper {
    margin: 0 auto;
    min-height: calc(100% - var(--status-h));
    background: var(--r-content);
    border-left: 1px solid var(--r-border);
    border-right: 1px solid var(--r-border);
    padding: 40px 56px 64px;
  }

  .chapter-head {
    text-align: center;
    margin-bottom: 40px;
  }

  .book-name {
    display: block;
    font-size: 11px;
    letter-spacing: 1.4px;
    color: var(--r-sub);
    margin-bottom: 12px;
    text-transform: uppercase;
  }

  .chapter-head h2 {
    margin: 0;
    font-size: 1.32em;
    font-weight: 600;
    line-height: 1.5;
    letter-spacing: 0.5px;
  }

  .chapter-no {
    display: inline-block;
    margin-top: 12px;
    font-size: 11px;
    color: var(--r-sub);
    letter-spacing: 1px;
  }

  /* 字距只作用于正文，标题和按钮保持原样 */
  .content {
    letter-spacing: var(--letter-gap, 0);
  }

  .content p {
    margin: 0 0 var(--para-gap, 0.95em);
    text-indent: 2em;
    word-break: break-word;
    hyphens: auto;
  }

  .content p:last-child {
    margin-bottom: 0;
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 6px 0;
  }

  .line {
    height: 12px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--r-text) 9%, transparent);
    animation: shimmer 1.2s ease-in-out infinite;
  }

  @keyframes shimmer {
    50% {
      opacity: 0.45;
    }
  }

  .chapter-foot {
    margin-top: 48px;
    padding-top: 20px;
    border-top: 1px solid var(--r-border);
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  /* 加载时只有几行骨架占位，撑不满一屏；改用弹性布局把翻章/目录按钮沉到纸张底部 */
  .paper.loading {
    display: flex;
    flex-direction: column;
  }

  .paper.loading .skeleton {
    margin-bottom: 28px;
  }

  .paper.loading .chapter-foot {
    margin-top: auto;
  }

  .nav-btn {
    background: transparent;
    border-color: var(--r-border);
    color: var(--r-sub);
  }

  .night .nav-btn:hover {
    color: #fff;
  }

  @media (max-width: 860px) {
    .scroller {
      padding: 0;
    }

    /* 侧栏很窄：状态栏跟随纸张铺满，省去「本章」字样 */
    .status-bar {
      max-width: 100% !important;
      padding: 0 18px;
      gap: 8px;
      font-size: 10px;
      border-left: none;
      border-right: none;
    }

    .status-progress::before {
      content: '';
    }

    .paper {
      padding: 22px 18px 104px;
      max-width: 100% !important;
      border-left: none;
      border-right: none;
    }

    /* 收起态：只在右下角留一个小把手，dock 不占位也不挡字 */
    .tools-handle {
      display: flex;
      position: fixed;
      right: 12px;
      bottom: calc(12px + var(--status-h));
      width: 34px;
      height: 34px;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      /* 实心底：半透明会透出正文笔画，反而糊字 */
      background: var(--r-content);
      border: 1px solid var(--r-border);
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.07);
      color: var(--r-sub);
      z-index: 52;
      transition:
        opacity 0.18s ease,
        transform 0.18s ease,
        color 0.18s ease,
        border-color 0.18s ease;
    }

    .tools-handle:hover {
      color: var(--r-text);
      border-color: color-mix(in srgb, var(--r-sub) 55%, transparent);
    }

    /* 自动滚屏时这是唯一的暂停入口，给一点强调色 */
    .tools-handle.pausing {
      color: var(--accent);
      border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    }

    .tools-handle.on {
      opacity: 0;
      pointer-events: none;
      transform: scale(0.7);
    }

    /* 向下滚动时连把手一起隐去，往回看或停下后淡入 */
    .tools-handle.hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px);
    }

    .tools.left {
      left: 50%;
      top: auto;
      bottom: calc(14px + var(--status-h));
      transform: translateX(-50%) translateY(10px);
      flex-direction: row;
      padding: 6px 8px;
      border-radius: 18px;
      /* 窄屏放不下时可以横向滚动，不换行也不溢出 */
      max-width: calc(100vw - 12px);
      overflow-x: auto;
      scrollbar-width: none;
      opacity: 0;
      pointer-events: none;
      transition:
        opacity 0.18s ease,
        transform 0.18s ease;
    }

    .tools.left.open {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(-50%) translateY(0);
    }

    .tools.left::-webkit-scrollbar {
      display: none;
    }

    .tools button {
      width: 54px;
    }

    .chapter-head {
      margin-bottom: 26px;
    }

    .chapter-foot {
      margin-top: 32px;
    }
  }

  /* 浏览器侧栏最窄约 300px：底部工具栏 6 个按钮要能放下 */
  @media (max-width: 340px) {
    .tools.left {
      gap: 2px;
      padding: 5px 6px;
    }

    .tools button {
      width: 46px;
      font-size: 10px;
    }

    .paper {
      padding-left: 14px;
      padding-right: 14px;
    }
  }

  /* ---------- 摸鱼模式：伪装成 DeepSeek 对话页 ---------- */
  .stealth {
    position: fixed;
    inset: 0;
    z-index: 999;
    display: flex;
    color: #1f2328;
    background: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .ds-app {
    flex: 1;
    min-width: 0;
    display: flex;
  }

  .ds-side {
    width: 232px;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 10px;
    background: #f9f9f9;
    border-right: 1px solid #ececec;
    font-size: 12.5px;
    color: #3d3d3d;
  }

  .ds-brand {
    padding: 0 8px 10px;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.2px;
    color: #4d6bfe;
  }

  .ds-new {
    padding: 9px 10px;
    border-radius: 8px;
    background: #eef1ff;
    color: #4d6bfe;
    font-weight: 600;
  }

  .ds-group {
    margin: 12px 8px 2px;
    font-size: 10.5px;
    color: #9a9a9a;
  }

  .ds-item {
    padding: 7px 10px;
    border-radius: 8px;
    color: #4a4a4a;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .ds-item.on {
    background: #ececec;
    color: #1f2328;
  }

  .ds-foot {
    margin-top: auto;
    padding: 8px 10px;
    border-top: 1px solid #ececec;
    color: #6b6b6b;
  }

  .ds-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .ds-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 46px;
    padding: 0 20px;
    border-bottom: 1px solid #f0f0f0;
    font-size: 13px;
    color: #333;
  }

  .ds-model {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-weight: 600;
  }

  .ds-model i {
    font-style: normal;
    font-size: 10px;
    color: #9a9a9a;
  }

  .ds-top-actions {
    font-size: 11.5px;
    color: #9a9a9a;
  }

  .ds-chat {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 22px 20px 10px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .ds-msg {
    display: flex;
    gap: 10px;
  }

  .ds-msg.user {
    justify-content: flex-end;
  }

  .ds-msg.user .ds-bubble {
    max-width: 78%;
    padding: 10px 13px;
    border-radius: 12px;
    background: #eef1ff;
    color: #1f2328;
    font-size: 13px;
    line-height: 1.75;
  }

  .ds-avatar {
    flex: 0 0 26px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: #4d6bfe;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
  }

  .ds-msg.ai .ds-bubble {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    line-height: 1.85;
    color: #2b2b2b;
  }

  .ds-bubble p {
    margin: 0 0 7px;
  }

  .ds-bubble b {
    font-weight: 600;
    color: #1f2328;
  }

  .ds-composer {
    padding: 10px 20px 18px;
  }

  .ds-input {
    padding: 12px 14px;
    border: 1px solid #e2e2e2;
    border-radius: 14px;
    background: #fff;
    color: #b0b0b0;
    font-size: 13px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03);
  }

  .ds-tools {
    display: flex;
    gap: 12px;
    margin-top: 8px;
    font-size: 11px;
    color: #9a9a9a;
  }

  @media (max-width: 860px) {
    .ds-side {
      display: none;
    }

    .ds-top {
      padding: 0 12px;
    }

    .ds-chat {
      padding: 16px 12px 8px;
      gap: 14px;
    }

    .ds-composer {
      padding: 8px 12px 14px;
    }

    .ds-msg.user .ds-bubble {
      max-width: 88%;
    }
  }
</style>
