// ─────────────────────────────────────────────────────────────
// OffChat · sw.js — Service Worker: app-shell + CDN offline.
// WAŻNE: wag modeli NIE cache'ujemy tutaj — robią to silniki
// (WebLLM / Transformers.js) we własnych magazynach Cache API.
// Podwójne cache'owanie marnowałoby setki MB na słabych telefonach.
// ─────────────────────────────────────────────────────────────
const APP_CACHE = "offchat-shell-v3";
const CDN_CACHE = "offchat-cdn-v1";

const SHELL = [
  "./",
  "./index.html",
  "./404.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/app.js",
  "./js/config.js",
  "./js/download-hub.js",
  "./js/hardware.js",
  "./js/storage.js",
  "./js/engine.js",
  "./js/engine-proxy.js",
  "./js/llm-worker.js",
  "./js/markdown.js",
  "./js/ui.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

// Hosty wag modeli i bibliotek modeli — przepuszczamy BEZ cache'owania,
// żeby silniki zarządzały nimi samodzielnie (i nie dublować GB danych).
const MODEL_HOSTS = [
  "huggingface.co",
  "cdn-lfs.hf.co",
  "raw.githubusercontent.com",
];
const isModelHost = (host) =>
  MODEL_HOSTS.includes(host) || host.endsWith(".hf.co") || host.endsWith(".huggingface.co");

// Hosty bibliotek JS silników — cache'ujemy agresywnie (wersje przypięte).
const CDN_HOSTS = ["esm.sh", "cdn.jsdelivr.net", "unpkg.com"];

// Cache'e silników — NIGDY nie usuwane przez SW.
const ENGINE_CACHE_RE = /webllm|mlc|transformers|onnx|hf-/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      await cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map((n) => {
          if (n === APP_CACHE || n === CDN_CACHE) return null;
          if (ENGINE_CACHE_RE.test(n)) return null; // wagi modeli — święte
          if (n.startsWith("offchat-")) return caches.delete(n); // stare wersje app
          return null;
        })
      );
      await self.clients.claim();
    })()
  );
});

async function trimCache(name, maxEntries) {
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)));
    }
  } catch { /* ignoruj */ }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 1) Wagi modeli → prosto do sieci (silnik ma własny cache).
  if (isModelHost(url.hostname)) {
    event.respondWith(fetch(req));
    return;
  }

  // 2) Nawigacja → network-first, fallback do shell (offline działa!).
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(APP_CACHE);
          cache.put("./index.html", fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cache = await caches.open(APP_CACHE);
          return (await cache.match("./index.html")) || Response.error();
        }
      })()
    );
    return;
  }

  // 3) CDN silników → stale-while-revalidate.
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CDN_CACHE);
        const hit = await cache.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res && (res.status === 200 || res.type === "opaque")) {
              cache.put(req, res.clone()).catch(() => {});
              trimCache(CDN_CACHE, 120);
            }
            return res;
          })
          .catch(() => null);
        return hit || (await net) || Response.error();
      })()
    );
    return;
  }

  // 4) Pliki własne (same-origin) → cache-first z odświeżeniem w tle.
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(APP_CACHE);
        const hit = await cache.match(req, { ignoreSearch: false });
        const net = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => null);
        return hit || (await net) || Response.error();
      })()
    );
    return;
  }

  // 5) Reszta (np. onnxruntime z innych CDN) → network-first + cache.
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res && (res.status === 200 || res.type === "opaque")) {
          const cache = await caches.open(CDN_CACHE);
          cache.put(req, res.clone()).catch(() => {});
          trimCache(CDN_CACHE, 120);
        }
        return res;
      } catch {
        return (await caches.match(req)) || Response.error();
      }
    })()
  );
});

// Komunikaty z aplikacji (np. wymuszenie aktualizacji).
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
