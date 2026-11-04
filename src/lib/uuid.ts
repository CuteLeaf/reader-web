/**
 * 生成 RFC 4122 v4 形式的唯一 ID。
 *
 * crypto.randomUUID() 只在安全上下文（HTTPS、localhost、127.0.0.1）可用。
 * 用 HTTP 自定义域名部署时它并不存在，
 * 直接调用会抛 "crypto.randomUUID is not a function"，让导入字体 / 本地书籍整个失败。
 *
 * crypto.getRandomValues() 不要求安全上下文，所以优先降级到它；
 * 最后再退到 Math.random（只用于生成非安全用途的本地 ID，不用于加密）。
 */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // version 4 + RFC 4122 variant
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
