// ─────────────────────────────────────────────────────────────
// OffChat · sw.js — Service Worker: app-shell + CDN offline.
// IMPORTANT: model weights are NOT cached here — the engines
// (WebLLM / Transformers.js) keep them in their own Cache API stores.
// Double-caching would waste hundreds of MB on weak phones.
// ─────────────────────────────────────────────────────────────
const APP_CACHE = "offchat-shell-v6";
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
  "./js/stream-render.js",
  "./js/resilience.js",
  "./js/ui.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

// Model weight + model library hosts — passed through WITHOUT caching,
// so the engines manage them on their own (and we never duplicate GBs).
const MODEL_HOSTS = [
  "huggingface.co",
  "cdn-lfs.hf.co",
  "raw.githubusercontent.com",
];
const isModelHost = (host) =>
  MODEL_HOSTS.includes(host) || host.endsWith(".hf.co") || host.endsWith(".huggingface.co");

// Engine JS library hosts — cached aggressively (pinned versions).
const CDN_HOSTS = ["esm.sh", "cdn.jsdelivr.net", "unpkg.com"];

// Engine caches — NEVER deleted by the SW.
const ENGINE_CACHE_RE = /webllm|mlc|transformers|onnx|hf-/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      // Add file by file: a single missing file (or one flaky request on a
      // weak connection) must not break the whole offline shell.
      await Promise.all(
        SHELL.map((u) =>
          cache.add(new Request(u, { cache: "reload" })).catch(() => null)
        )
      );
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
          if (ENGINE_CACHE_RE.test(n)) return null; // model weights — sacred
          if (n.startsWith("offchat-")) return caches.delete(n); // old app versions
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
  } catch { /* ignore */ }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 1) Model weights → straight to the network (the engine has its own cache).
  if (isModelHost(url.hostname)) {
    event.respondWith(fetch(req));
    return;
  }

  // 2) Navigation → network-first, shell fallback (offline works!).
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

  // 3) Engine CDNs → stale-while-revalidate.
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

  // 4) Own files (same-origin) → cache-first with background refresh.
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

  // 5) The rest (e.g. onnxruntime from other CDNs) → network-first + cache.
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

// Messages from the app (e.g. forcing an update).
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
