const CACHE_NAME = "aivolution-static-v40";
const PRECACHE_URLS = [
  "/",
  "/style.css?v=34",
  "/addons.css?v=1",
  "/IMG_1713.png?v=19",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Tuyệt đối không cache /api/* để dữ liệu AI, Voucher và Thời tiết luôn mới nhất
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Chỉ cache tài nguyên tĩnh cùng origin (JS/CSS/ảnh) theo chiến lược Stale-While-Revalidate
  if (url.origin === self.location.origin && /\.(js|css|png|jpg|jpeg|svg|webp|json)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          const networkPromise = fetch(req)
            .then((res) => {
              if (res && res.status === 200) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || networkPromise;
        })
      )
    );
  }
});
