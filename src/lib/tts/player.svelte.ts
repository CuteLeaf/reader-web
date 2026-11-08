import { splitSentences } from './segment';

export type TtsState = 'idle' | 'playing' | 'paused';

/**
 * 朗读播放器：分句队列 + 顺序播放。
 *
 * 暂停用「cancel + 记住游标」实现，而不是 speechSynthesis.pause()：
 * 各浏览器对 pause/resume 的行为不一致（有的恢复后会从头念，有的直接卡死），
 * 统一成「重新念当前句」听感最稳，状态也最好维护。
 */
class TtsPlayer {
  state = $state<TtsState>('idle');
  /** 当前待读的句子列表 */
  chunks = $state<string[]>([]);
  /** 当前句索引 */
  index = $state(0);
  /** 语速 0.5 ~ 2 */
  rate = $state(1);

  private utter: SpeechSynthesisUtterance | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  get total(): number {
    return this.chunks.length;
  }

  get current(): string {
    return this.chunks[this.index] ?? '';
  }

  /** 从一段文字开始朗读（会先停掉上一段） */
  play(text: string): boolean {
    return this.playChunks(splitSentences(text));
  }

  /** 直接给句子列表：调用方已经断好句时可以省一次切分，保持下标与自身一致 */
  playChunks(chunks: string[]): boolean {
    if (!this.supported) return false;
    const list = chunks.filter((chunk) => chunk.trim());
    if (!list.length) return false;
    this.stop();
    this.chunks = list;
    this.index = 0;
    this.state = 'playing';
    this.speakCurrent();
    return true;
  }

  toggle(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.silence();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.speakCurrent();
  }

  stop(): void {
    this.state = 'idle';
    this.chunks = [];
    this.index = 0;
    this.silence();
  }

  next(): void {
    if (this.state === 'idle') return;
    this.index = Math.min(this.index + 1, this.chunks.length - 1);
    this.state = 'playing';
    this.speakCurrent();
  }

  prev(): void {
    if (this.state === 'idle') return;
    this.index = Math.max(this.index - 1, 0);
    this.state = 'playing';
    this.speakCurrent();
  }

  setRate(value: number): void {
    const next = Math.min(2, Math.max(0.5, Number(value) || 1));
    if (next === this.rate) return;
    this.rate = next;
    // 语音引擎不支持中途变速，重念当前句才能立刻听到变化
    if (this.state === 'playing') this.speakCurrent();
  }

  /* ------------------------------ 内部实现 ------------------------------ */

  private silence(): void {
    this.stopWatchdog();
    // 解绑回调再丢弃引用：cancel() 之后某些浏览器仍会补发 onend
    if (this.utter) {
      this.utter.onend = null;
      this.utter.onerror = null;
      this.utter = null;
    }
    if (this.supported) window.speechSynthesis.cancel();
  }

  private speakCurrent(): void {
    if (!this.supported) return;
    const synth = window.speechSynthesis;
    // 每次只推一句，避免队列里堆着过期的句子
    synth.cancel();

    const text = this.current;
    if (!text) {
      this.finish();
      return;
    }

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en-US';
    utter.rate = this.rate;
    utter.pitch = 1;
    utter.volume = 1;
    const voice = this.pickVoice(utter.lang);
    if (voice) utter.voice = voice;

    let done = false;
    const advance = () => {
      if (done) return;
      done = true;
      this.advance();
    };

    utter.onend = advance;
    utter.onerror = (event) => {
      // cancel() 会把上一句的 onerror 打成 canceled/interrupted，属于正常流程
      const reason = String((event as SpeechSynthesisErrorEvent).error ?? '');
      if (reason === 'canceled' || reason === 'interrupted') return;
      advance();
    };

    this.utter = utter;
    synth.speak(utter);
    this.startWatchdog(advance);
  }

  private advance(): void {
    if (this.state === 'idle') return;
    this.stopWatchdog();
    if (this.index >= this.chunks.length - 1) {
      this.finish();
      return;
    }
    this.index += 1;
    if (this.state === 'paused') return;
    this.speakCurrent();
  }

  private finish(): void {
    this.stopWatchdog();
    this.state = 'idle';
    this.chunks = [];
    this.index = 0;
    this.utter = null;
  }

  /**
   * 兜底：个别环境里引擎会静默停止且不触发 onend。
   * 只检查「既没在说、也没有排队」这一种情况，避免把正在朗读的句子误判成结束。
   */
  private startWatchdog(onStall: () => void): void {
    this.stopWatchdog();
    const startedAt = performance.now();
    this.watchdog = setInterval(() => {
      if (this.state !== 'playing') return;
      if (performance.now() - startedAt < 800) return;
      const synth = window.speechSynthesis;
      if (synth.speaking || synth.pending) return;
      onStall();
    }, 1000);
  }

  private stopWatchdog(): void {
    if (this.watchdog === null) return;
    clearInterval(this.watchdog);
    this.watchdog = null;
  }

  private pickVoice(lang: string): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const target = lang.toLowerCase();
    const exact = voices.find((v) => v.lang.replace('_', '-').toLowerCase() === target);
    if (exact) return exact;
    const prefix = target.slice(0, 2);
    return voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ?? null;
  }
}

export const tts = new TtsPlayer();
