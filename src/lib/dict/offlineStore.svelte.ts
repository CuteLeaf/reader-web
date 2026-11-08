import { SHARD_COUNT, clearOffline, downloadOffline, offlineMeta } from './offline.ts';

/**
 * 离线词库的界面状态：设置面板里的下载进度、词典渠道的可用性都读这里。
 * 词库本体存在 IndexedDB，不随构建产物分发。
 */
class OfflineStore {
  /** 是否已下载（决定「离线词典」渠道是否出现在列表里） */
  ready = $state(false);
  count = $state(0);
  updatedAt = $state(0);
  downloading = $state(false);
  done = $state(0);
  total = $state(SHARD_COUNT);
  error = $state('');

  async refresh(): Promise<void> {
    const meta = await offlineMeta();
    this.count = meta.count;
    this.updatedAt = meta.updatedAt;
    // 只有完整下载过（有完成时间戳）才算可用，避免中途中断的半成品被当成词库
    this.ready = meta.count > 0 && meta.updatedAt > 0;
  }

  async download(): Promise<void> {
    if (this.downloading) return;
    this.downloading = true;
    this.done = 0;
    this.error = '';
    try {
      const written = await downloadOffline({
        onProgress: (done, total) => {
          this.done = done;
          this.total = total;
        },
      });
      this.count = written;
      this.updatedAt = Date.now();
      this.ready = written > 0;
    } catch (e) {
      this.error = (e as Error)?.message || '下载失败';
      await this.refresh();
    } finally {
      this.downloading = false;
    }
  }

  async remove(): Promise<void> {
    this.error = '';
    await clearOffline();
    this.count = 0;
    this.updatedAt = 0;
    this.done = 0;
    this.ready = false;
  }
}

export const offline = new OfflineStore();
