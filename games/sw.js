const CACHE_NAME = "neon-apex-offline-v3";
const GAME_URL = new URL("./neon-apex.html", self.registration.scope).href;
const APP_FILES = [
  "./neon-apex.html",
  "./neon-apex-input.mjs",
  "./neon-apex-tracks.mjs",
  "./neon-apex-race.mjs",
  "./neon-apex-drive.mjs",
  "./vendor/three.module.js",
  "./manifest.webmanifest",
  "./icons/neon-apex-180.png",
  "./icons/neon-apex-192.png",
  "./icons/neon-apex-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("neon-apex-offline-") && key !== CACHE_NAME).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(new URL("./", self.registration.scope).pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(GAME_URL, copy)));
      }
      return response;
    }).catch(() => caches.match(GAME_URL)));
    return;
  }

  event.respondWith(caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)));
});
