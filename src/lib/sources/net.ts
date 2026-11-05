/**
 * 本地网络访问（Local Network Access）相关判断。
 *
 * Chrome 142 起默认启用 LNA：公网页面访问局域网设备（192.168.x.x、10.x.x.x、
 * 127.0.0.1、.local 等）需要用户授权，而这个权限**只在安全上下文**（HTTPS /
 * localhost）里才能申请。HTTP 页面里的申请一律是 denied，fetch 会直接抛
 * TypeError —— 表现和 CORS 失败一模一样，很容易误判成后端没放开跨域。
 *
 * 另外私有 IP 字面值本身免于混合内容检查，所以 HTTPS 页面仍然可以连
 * http://192.168.x.x 的后端，只是首次连接会弹一次授权。
 */

/** RFC1918 / 链路本地 / 环回 / .local 都属于本地地址空间 */
export function isLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1') return true;

  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** 当前页面本身处于「HTTP + 公网域名」状态：此时浏览器不允许访问本地网络 */
export function pageCannotUseLocalNetwork(): boolean {
  if (typeof window === 'undefined') return false;
  return !window.isSecureContext && !isLocalHost(location.hostname);
}

/** 这次请求是否会被 LNA 拦掉（页面是 HTTP 公网地址，目标又是局域网设备） */
export function isLocalNetworkBlocked(targetUrl: string): boolean {
  if (!pageCannotUseLocalNetwork()) return false;
  try {
    return isLocalHost(new URL(targetUrl).hostname);
  } catch {
    return false;
  }
}
