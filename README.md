# 💬 OffChat

**OffChat is a website that runs AI models entirely locally — with power matched to your device. Chat with AI in full privacy, right in your browser!**

A lightweight, static chat with a Small Language Model running 100% client-side. Zero backend, zero paid APIs, zero telemetry. The first model download needs the internet — every later launch works **fully offline**.

> 🎯 Project goal: **even a weak phone with 3 GB RAM can run some model** — the page probes the hardware itself and suggests safe models.

---

## ✨ Features

- 🧠 **In-browser AI** — main engine **WebLLM (WebGPU)**, emergency fallback **Transformers.js (WASM/CPU)**
- 📱 **Mobile-first** — tiny (~70 KB of own code), no frameworks, inference in a Web Worker
- 🔍 **Automatic model matching** — hardware probe (WebGPU, F16, RAM, cores, free space) + a memory budget with a safety margin
- 🛡️ **Safe Mode** — auto-detects weak GPUs and simplifies visuals, caps memory, warns before risky models and helps recover from GPU crashes
- ⚡ **Speed estimates** — every model card shows its expected generation speed in tokens/sec, plus filters and sorting (fastest / smallest / best quality)
- 📦 **Offline** — weights in Cache API (or OPFS), app-shell + libraries in the Service Worker
- 💾 **Persistence** — threads in IndexedDB, settings in localStorage, JSON export/import
- 🎨 **Deep customization** — 5 accent colors, 3 backgrounds, glass on/off, bubble shapes, font size, avatars, light/dark theme, PWA
- 📊 **Live status & telemetry** — "Downloading model", "Loading into memory", speed (MB/s), ETA, downloaded MB and tok/s
- 🚀 **Instant start & filters** — ultra-light models (< 150 MB), preconnects to CDN servers, size filters and persistent storage
- 🎮 **Download hub & mini-game** — minimize the download into a floating dock, browse chats and history, play neon NeuroPong or read AI facts
- ✍️ **Prompt queueing** — type your question while downloading; the answer generates automatically once loaded!

## 🗂️ File structure

```
OffChat/
├── index.html              # app (PWA, mobile-first, EN)
├── 404.html                # GitHub Pages fallback
├── .nojekyll               # Pages Jekyll disabler
├── manifest.webmanifest    # PWA
├── sw.js                   # Service Worker (app-shell + CDN; does NOT touch model weights)
├── LICENSE                 # MIT
├── css/
│   └── style.css           # glassy, responsive UI
├── js/
│   ├── app.js              # orchestration: boot, onboarding, chat, threads, settings
│   ├── config.js           # engine versions, model catalog, default settings
│   ├── download-hub.js     # download telemetry, floating dock, NeuroPong mini-game, AI facts, templates
│   ├── hardware.js         # hardware probe + recommendations + memory budget
│   ├── storage.js          # localStorage + IndexedDB + export/import + model cache
│   ├── engine.js           # inference engine (WebLLM + Transformers.js, loaded lazily)
│   ├── llm-worker.js       # Web Worker shielding the UI from compute
│   ├── engine-proxy.js     # facade: worker with a main-thread fallback
│   ├── markdown.js         # tiny dependency-free Markdown renderer (anti-XSS)
│   └── ui.js               # toasts, modals, formatting
├── icons/                  # PWA icons (192/512/maskable/apple/favicon/SVG)
```

## 🚀 Deploying to GitHub Pages

The repo is ready to deploy **with no build step** — pure static files.

**Option A — from a branch (simplest):**
1. Push the code to `main`.
2. GitHub → *Settings → Pages → Source: Deploy from a branch* → pick `main` and `/ (root)`.
3. Done: `https://<user>.github.io/OffChat/`.

**Option B — via GitHub Actions (optional):**
1. GitHub → *Settings → Pages → Source: GitHub Actions*.
2. Manually create `.github/workflows/pages.yml` (standard static deployment):

```yaml
name: Deploy to GitHub Pages
on:
  push: { branches: ["main"] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: "pages", cancel-in-progress: false }
jobs:
  deploy:
    environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: "." }
      - id: deployment
        uses: actions/deploy-pages@v4
```

3. Every push to `main` deploys automatically.

> All paths are relative (`./`), so it works under both `/OffChat/` and a custom domain.

**Local testing:** any static server is enough, e.g. `python3 -m http.server 8080` and `http://localhost:8080`.

## 🧠 Engines & models

| Engine | Backend | When | Library (CDN, pinned version) |
|---|---|---|---|
| **WebLLM** | WebGPU | default (Chrome/Edge 113+, Opera, Safari 26+) | `@mlc-ai/web-llm@0.2.84` (esm.sh → jsDelivr fallback) |
| **Transformers.js** | WASM/CPU | no WebGPU (Firefox, older Safari, weak GPUs) | `@huggingface/transformers@3.8.1` |

Libraries load **lazily** — only after a model is picked. Imports try several CDNs in order (outage resilience).

### WebLLM catalog (editable in `js/config.js`)

Speeds are estimates in tokens/sec: phones land near the low end, desktop GPUs near the high end.

| Model | Size | Memory | Speed (est.) | Quality | Tier |
|---|---|---|---|---|---|
| SmolLM2 135M | ~60 MB | 360 MB | 60–150 tok/s | ★★☆☆☆ | ultra — runs everywhere |
| SmolLM2 360M | ~260 MB | 376 MB | 40–100 tok/s | ★★☆☆☆ | ultra |
| TinyLlama 1.1B | ~700 MB | 697 MB | 25–70 tok/s | ★★☆☆☆ | mini — a tiny classic |
| Llama 3.2 1B | ~800 MB | 879 MB | 20–60 tok/s | ★★★★☆ | mini — favorite for weak phones |
| Qwen 2.5 0.5B | ~460 MB | 944 MB | 30–80 tok/s | ★★★☆☆ | mini |
| Qwen Coder 0.5B 💻 | ~460 MB | 945 MB | 30–80 tok/s | ★★★☆☆ | mini — pocket coding helper |
| Qwen 3 0.6B 🧪 | ~600 MB | 1403 MB | 25–70 tok/s | ★★★☆☆ | smart |
| Gemma 2 2B (1k) | ~1.5 GB | 1583 MB | 12–35 tok/s | ★★★★☆ | smart |
| **Qwen 2.5 1.5B** | ~1 GB | 1629 MB | 15–45 tok/s | ★★★★☆ | smart — mid-weight king |
| Qwen Coder 1.5B 💻 | ~1 GB | 1630 MB | 15–40 tok/s | ★★★★☆ | smart — code specialist |
| SmolLM2 1.7B | ~1.1 GB | 1774 MB | 15–45 tok/s | ★★★☆☆ | smart |
| Gemma 2 2B | ~1.5 GB | 1895 MB | 12–35 tok/s | ★★★★☆ | pro |
| Qwen 3 1.7B 🧪 | ~1.3 GB | 2036 MB | 14–40 tok/s | ★★★★☆ | pro |
| **Llama 3.2 3B** | ~2 GB | 2263 MB | 10–30 tok/s | ★★★★★ | pro — the sweet spot |
| Hermes 3 3B | ~2 GB | 2264 MB | 10–30 tok/s | ★★★★★ | pro |
| Qwen 2.5 3B | ~1.9 GB | 2505 MB | 9–28 tok/s | ★★★★★ | pro |
| Qwen Coder 3B 💻 | ~1.9 GB | 2505 MB | 9–25 tok/s | ★★★★★ | pro — serious coding |
| Phi 3.5 mini (1k) | ~2.3 GB | 2520 MB | 8–22 tok/s | ★★★★☆ | pro — logic genius |
| Qwen 3 4B 🧪 | ~2.6 GB | 3431 MB | 6–18 tok/s | ★★★★☆ | max (desktop) |
| Phi 4 mini | ~2.4 GB | 3438 MB | 6–18 tok/s | ★★★★★ | max — compact reasoner |
| Mistral 7B v0.3 | ~4.3 GB | 4573 MB | 4–12 tok/s | ★★★★★ | max (desktop) |
| Llama 3.1 8B (1k) | ~4.9 GB | 4598 MB | 4–11 tok/s | ★★★★★ | max (desktop) |
| Hermes 3 8B | ~4.9 GB | 4876 MB | 4–11 tok/s | ★★★★★ | max (desktop) |
| Llama 3.1 8B | ~4.9 GB | 5001 MB | 4–10 tok/s | ★★★★★ | max (desktop) |
| DeepSeek R1 8B 🧠 | ~4.9 GB | 5001 MB | 3–10 tok/s | ★★★★★ | max — thinks step by step |
| Qwen 2.5 7B | ~4.4 GB | 5107 MB | 4–12 tok/s | ★★★★★ | max (desktop) |
| DeepSeek R1 7B 🧠 | ~4.4 GB | 5107 MB | 3–10 tok/s | ★★★★★ | max — reasoning model |
| Qwen 3 8B 🧪 | ~5.2 GB | 5696 MB | 3–10 tok/s | ★★★★☆ | max (desktop) |
| Gemma 2 9B | ~5.4 GB | 6422 MB | 2–8 tok/s | ★★★★★ | max — the powerhouse |

🧪 = base/experimental variant (never the default recommendation). 💻 = code specialist. 🧠 = reasoning model (thinks before answering, slower output).

### WASM compatibility mode (Transformers.js, ONNX q4)

SmolLM2 135M (~90 MB, 4–12 tok/s) · SmolLM2 360M (~230 MB, 2–7 tok/s) · TinyLlama 1.1B (~680 MB, 1–4 tok/s) · Qwen 2.5 0.5B (~450 MB, 1–4 tok/s) · Qwen 2.5 1.5B (~950 MB, 0.5–2 tok/s) · SmolLM2 1.7B (~1 GB, 0.5–2 tok/s) · Llama 3.2 1B (~750 MB, 0.5–3 tok/s).

## 🛡️ How we treat memory (the "3 GB RAM" philosophy)

1. **Conservative budget** — a mobile GPU usually gets ≤1.75 GB; a model must fit with a 12% reserve.
2. **Recommendations, not guessing** — sorting: answer quality → stability → size within budget.
3. **Safe Mode** (automatic on weak phones) — simplified visuals, capped context, fewer rendered messages, oversize-load warnings.
4. **Oversize guard** — picking a model above your budget shows an explicit crash warning first.
5. **GPU-crash recovery** — after a device-lost / out-of-memory error the app offers Safe Mode or a CPU model in one click.
6. **Auto F16→F32 swap** — no `shader-f16`? The engine takes a `q4f32` build by itself.
7. **History limits** — max 60 threads / 300 messages, renders the most recent 60 (30 in Safe Mode, more on demand).
8. **Background GPU truce** — animated background pauses while the GPU runs inference; the mini-game drops to cheap 30 fps rendering in Safe Mode.
9. **Weigh once** — the Service Worker deliberately does **not** cache weights (the engines do), to avoid duplicating gigabytes.

## 📴 Offline work — what lives where

| Data | Store | Managed by |
|---|---|---|
| App-shell (HTML/CSS/JS/icons) | Cache API `offchat-shell-v4` | Service Worker |
| Engine libraries (esm.sh/jsDelivr) | Cache API `offchat-cdn-v1` | Service Worker |
| WebLLM model weights | Cache API (`webllm/…`) or OPFS | WebLLM (`cacheBackend` in settings) |
| ONNX model weights | Cache API (`transformers-cache`) | Transformers.js |
| Threads and messages | IndexedDB (+ RAM fallback) | `storage.js` |
| Settings | localStorage | `storage.js` |

## 🌐 Browser support

| Browser | Engine | Notes |
|---|---|---|
| Chrome / Edge 113+ (desktop & Android) | WebGPU ✅ | full experience |
| Opera 99+ | WebGPU ✅ | full experience |
| Safari 26+ | WebGPU ✅ / WASM | depends on the device |
| Firefox | WASM ✅ | no WebGPU — CPU compatibility mode |
| Older / iOS < 26 | WASM ✅ | slower, but works |

> GitHub Pages doesn't send COOP/COEP headers, so WASM runs single-threaded — intentional and fully supported.

## 🌍 Language

The interface is in English. The default system prompt doesn't force any language — every model simply answers in the same language you write in, so each one can use whatever it handles best. You can still set a fixed language via a custom system prompt in Settings.

## 🔒 Privacy

Everything happens locally. The only network traffic is: downloading app files, libraries (CDN) and model weights (Hugging Face) — **conversation content never leaves the device**. No accounts, no telemetry, no cookies.

## 🛠️ Development

- The code is vanilla JS (ES2022, modules) — no bundler, no `npm install`.
- New WebLLM model? Add an entry to `MODEL_CATALOG` in `js/config.js` (the id must exist in that WebLLM version's `prebuiltAppConfig`), including a `tps: [min, max]` estimate.
- Syntax test: `node --check js/*.js` — or serve with `python3 -m http.server` and click around.

## 📄 License

MIT — do whatever you want with it. Happy offline chatting! 💜
