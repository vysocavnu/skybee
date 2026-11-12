// Skybee service worker: keeps the app shell available offline and shows notification clicks the way.
// Network first — a new deploy is picked up at once; the cache is only a fallback without a connection.
const CACHE = "skybee-shell-v11";
const SHELL = ["./", "css/style.css", "js/app.js", "js/api.js", "js/ui.js", "js/views.js", "js/compose.js", "js/more.js", "js/settings.js", "js/notify.js", "js/flair.js", "js/sources.js", "js/deck.js", "js/splash.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon.svg", "icons/favicon.svg", "favicon.ico", "offline.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // API, images, video: straight to the network
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || (e.request.mode === "navigate" && (await caches.match("./") || await caches.match("offline.html"))) || Response.error()));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const hash = e.notification.data?.hash || "#/notifications";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (tabs) => {
    const tab = tabs.find(t => t.url.startsWith(self.registration.scope));
    if (tab) { await tab.focus(); tab.postMessage({ type: "skybee:open", hash }); }
    else await self.clients.openWindow(self.registration.scope + hash);
  }));
});
