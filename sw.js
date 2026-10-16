// Service worker: keeps the app working offline.
// Bump VERSION whenever the app's files change so phones pick up the update.
const VERSION = "foodtracker-v3";
const APP_FILES = [
  "./", "index.html", "style.css", "logic.js", "store.js", "app.js", "manifest.webmanifest",
  "icon-180.png", "icon-192.png", "icon-512.png",
];
// Photo-reading and scanner libraries are saved the first time they're used.
const LIBRARY_HOSTS = ["cdn.jsdelivr.net", "tessdata.projectnaptha.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "libraries").map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  if (url.origin === location.origin) {
    // App files: use the network when online so updates show up, else the saved copy.
    e.respondWith(fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else if (LIBRARY_HOSTS.includes(url.hostname)) {
    // Libraries never change at a fixed version, so the saved copy is always fine.
    e.respondWith(caches.open("libraries").then((c) => c.match(e.request).then((hit) => hit ||
      fetch(e.request).then((res) => {
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }))));
  }
  // Everything else (the barcode database) goes straight to the network.
});
