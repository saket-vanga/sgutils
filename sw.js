// Keeps the app shell (and the bus stop list) on the phone so SG Utils opens instantly.
// Network first, so a new version shows up the next time it's opened online.
const CACHE = "sgutils-v1792396782";
const SHELL = ["./", "index.html", "style.css", "app.js", "data.js", "map.js", "vendor/preact-htm.js", "vendor/leaflet.js",
  "vendor/leaflet.css", "vendor/qrcode.js", "manifest.webmanifest", "icons/apple-touch-icon.png", "icons/icon-192.png"];
const KEEP = ["https://data.busrouter.sg/v1/stops.min.json"];  // big and rarely changes: fall back to the cached copy

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== location.origin && !KEEP.includes(url.origin + url.pathname)) return;  // live data goes straight to the network
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
