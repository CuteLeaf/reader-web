/**
 * 离线缓存：静态站点用「产物哈希 + 网络优先」的组合，
 * 局域网后端的接口请求（跨域）一律直连，绝不缓存，避免读到过期书架。
 */
// 与 package.json 的 version 保持一致；改动会清空旧缓存，用于发版时强制刷新资源
const VERSION = 'v1.0.2';
const CACHE = `reader-web-${VERSION}`;
const scope = self.registration.scope;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([scope, `${scope}manifest.webmanifest`]))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 后端 API 直连

  const isAsset =
    url.pathname.includes('/_assets/') ||
    /\.(css|js|woff2?|svg|png|jpe?g|webp)$/.test(url.pathname);

  if (isAsset) {
    // 产物文件名带哈希，可放心缓存优先
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // 文档：网络优先，失败回退缓存
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match(scope))),
  );
});
