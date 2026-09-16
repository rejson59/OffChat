# 💬 OffChat

**OffChat is a website that runs AI models entirely locally — with power matched to your device. Chat with AI in full privacy, right in your browser!**

A lightweight, static chat with a Small Language Model running 100% client-side. Zero backend, zero paid APIs, zero telemetry. The first model download needs the internet — every later launch works **fully offline**.

> 🎯 Project goal: **even a weak phone with 3 GB RAM can run some model** — the page probes the hardware itself and suggests safe models.

---

## ✨ Features

- 🧠 **In-browser AI** — main engine **WebLLM (WebGPU)**, emergency fallback **Transformers.js (WASM/CPU)**
- 📱 **Mobile-first** — no frameworks or bundler, ~90 KB gzipped of own code (heavy parts are code-split), inference in a Web Worker
- 🔍 **Automatic model matching** — hardware probe (WebGPU, F16, RAM, cores, free space) + a memory budget with a safety margin
- 🛡️ **Safe Mode** — auto-detects weak GPUs and simplifies visuals, caps memory, warns before risky models and helps recover from GPU crashes
- ⚡ **Speed estimates** — every model card shows its expected generation speed in tokens/sec, plus filters and sorting (fastest / smallest / best quality)
- 📦 **Offline** — weights in Cache API (or OPFS), app-shell + libraries in the Service Worker
- 💾 **Persistence** — threads in IndexedDB, settings in localStorage, JSON export/import
- 🎚️ **Tunable performance** — Safe Mode, context-window cap, message font, effects and the idle memory release are all in Settings
- 🎨 **Deep customization** — 5 accent colors, 3 backgrounds, glass on/off, bubble shapes, font size, avatars, light/dark theme, PWA
- 📊 **Live status & telemetry** — "Downloading model", "Loading into memory", speed (MB/s), ETA, downloaded MB and tok/s
- 🚀 **Instant start & filters** — ultra-light models (< 150 MB), preconnects to CDN servers, size filters and persistent storage
- 🎮 **Download hub & mini-game** — minimize the download into a floating dock, browse chats and history, play neon NeuroPong or read AI facts
- ✍️ **Prompt queueing** — type your question while downloading; the answer generates automatically once loaded!
- ▶️ **Continue on cut-off** — answers clipped by the token limit grow a Continue button that resumes in the same bubble
- 🕒 **Timestamps & counters** — subtle message times, live token stats, and a composer character counter
- 📝 **Markdown export** — save any chat as a clean `.md` file with one click
- 📤 **Share target & shortcuts** — share text from any app straight into OffChat; long-press the icon for New chat / Choose model
- 🔆 **Wake lock** — the screen stays on during long downloads and generation (mobile)
- ⚡ **Built for weak devices** — incremental streaming renderer, batched token streaming, message cache, deferred boot, lazy modules (see below)
- 🧠 **Idle memory release** — the model frees GPU/RAM memory when you stop using it (auto: 6 min on phones, 30 min on desktop), which prevents the OOM kills that make mobile browsers drop tabs
- 💾 **Crash-proof work** — the unsent draft and every streaming answer are mirrored to storage, so a crash/reload never loses what you typed or waited for; interrupted answers come back with a **Continue** button
- 🐢 **Potato mode** — one switch for ancient phones: lightest model, 1024-token context, no blur, no animations, quick memory release (offered automatically on weak devices)
- 🔎 **Model preflight** — before downloading a single byte OffChat checks the model really exists on Hugging Face, repairs renamed repositories (`-ONNX`) and picks a weight variant that is actually published
- 🐢 **Slow-model tips** — when an answer crawls (under ~3 tok/s) OffChat suggests a lighter model that will feel faster on that device
- 🛠️ **Self-healing engine** — if the Worker or the GPU dies mid-answer, the app rebuilds the engine, reloads the model from cache and retries the message instead of failing

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
│   ├── model-check.js      # Hugging Face preflight, error translation, potato profile
│   ├── resilience.js       # crash guard: draft, interrupted answers, idle release
│   ├── stream-render.js    # incremental Markdown renderer for streamed answers
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
| SmolLM2 360M (f16-free) | ~300 MB | 580 MB | 30–80 tok/s | ★★☆☆☆ | ultra — works without shader-f16 |
| TinyLlama 1.1B | ~700 MB | 697 MB | 25–70 tok/s | ★★☆☆☆ | mini — a tiny classic |
| Llama 3.2 1B | ~800 MB | 879 MB | 20–60 tok/s | ★★★★☆ | mini — favorite for weak phones |
| Qwen 2.5 0.5B | ~460 MB | 944 MB | 30–80 tok/s | ★★★☆☆ | mini |
| Qwen Coder 0.5B 💻 | ~460 MB | 945 MB | 30–80 tok/s | ★★★☆☆ | mini — pocket coding helper |
| Qwen 3 0.6B 🧪 | ~600 MB | 1403 MB | 25–70 tok/s | ★★★☆☆ | smart |
| Gemma 2 2B (1k) | ~1.5 GB | 1583 MB | 12–35 tok/s | ★★★★☆ | smart |
| Gemma 3 1B | ~820 MB | 711 MB | 20–55 tok/s | ★★★★☆ | mini — no f16 needed, great answers |
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

### WASM compatibility mode (Transformers.js, ONNX)

Every id below was verified against the Hugging Face tree API — the repository exists, is public and really publishes the listed quantisations. OffChat prefers **q8** (ONNX Runtime's native int8 path, usually the smallest file too), then q4, then q4f16.

| Model | Repository | q8 / q4 / q4f16 | Speed (est.) |
|---|---|---|---|
| SmolLM2 135M | `HuggingFaceTB/SmolLM2-135M-Instruct` | 137 / 182 / 118 MB | 4–12 tok/s |
| SmolLM2 360M | `HuggingFaceTB/SmolLM2-360M-Instruct` | 365 / 388 / 273 MB | 2–7 tok/s |
| Gemma 3 270M | `onnx-community/gemma-3-270m-it-ONNX` | 545 / 323 / 273 MB | 2–6 tok/s |
| Qwen 2.5 0.5B | `onnx-community/Qwen2.5-0.5B-Instruct` | 512 / 786 / 483 MB | 1–5 tok/s |
| Qwen 3 0.6B | `onnx-community/Qwen3-0.6B-ONNX` | 618 / 919 / 570 MB | 1–4 tok/s |
| TinyLlama 1.1B | `onnx-community/TinyLlama-1.1B-Chat-v1.0-ONNX` | 1101 / 910 / 714 MB | 1–4 tok/s |
| Llama 3.2 1B | `onnx-community/Llama-3.2-1B-Instruct-ONNX` | 1237 / 1693 / 1090 MB | 0.5–3 tok/s |
| SmolLM2 1.7B | `HuggingFaceTB/SmolLM2-1.7B-Instruct` | 1714 / 1412 / 1109 MB | 0.5–2 tok/s |
| Qwen 2.5 1.5B | `onnx-community/Qwen2.5-1.5B-Instruct` | 1578 / 1787 / 1221 MB | 0.5–2 tok/s |

Gemma 3 270M and Llama 3.2 1B ship their weights in `*_data` shards — OffChat detects that and passes `use_external_data_format` to the engine.

## 🥔 Potato mode (for ancient phones)

One switch in **Settings → Slow devices** (or the automatic prompt when the device looks weak):

- the smallest verified model is selected for you,
- context window capped at 1024 tokens, answers at 192 tokens,
- blur, animations and avatars off, plain background,
- the model is released from memory after ~5 minutes idle.

The point is not beauty — it is that a 2018 phone with 2–3 GB RAM finishes an answer instead of being killed by the browser.

## 🔎 Why a model sometimes refuses to install

Hugging Face answers **401 Unauthorized** for a repository that *does not exist*, is private, or was renamed — never 404. Transformers.js then reports `Unauthorized access to file: "…"`, which reads like an account problem even though a browser-only app never sends credentials.

OffChat handles this before any download:

1. **Preflight** (`model-check.js`) asks the Hub tree API for the model's `onnx/` folder (24 h cache).
2. **Rename repair** — if an id 401s, canonical candidates (`-ONNX` suffix, as used by `onnx-community`) are tried.
3. **Variant check** — only quantisations that really exist are used, and external-data shards are counted.
4. **Honest errors** — 401/403/404/5xx are translated into plain language with a next step, and OffChat suggests a verified model instead.

Gated repositories (downloads behind a licence acceptance) cannot be used from a plain browser page, because no token can be attached to the request — OffChat says so instead of blaming your connection.

## ⚡ How OffChat stays fast on slow hardware

| Trick | Why it matters on a weak phone |
|---|---|
| **Incremental streaming render** (`stream-render.js`) | Finished Markdown blocks are parsed and inserted **once**; only the small "tail" being typed is re-rendered. The naive approach re-parses the whole answer on every repaint (O(n²)) — here the DOM work stays a fraction of that. |
| **Batched token streaming** (`llm-worker.js`) | Tokens are coalesced for ~70 ms before crossing the thread boundary: same visuals, far fewer `postMessage` round trips. |
| **Adaptive repaint rate** | Longer answers repaint less often (70 → 240 ms), and the rate is slower still in Safe Mode/low-end profile. |
| **Message cache** | Chats are read from IndexedDB once; sending no longer re-reads the history twice per message. |
| **Deferred boot** | HTML/CSS paint first, then IndexedDB, the GPU probe and the Service Worker run while the browser is idle. |
| **Lazy modules** | The download hub (mini-game, facts, templates) is code-split and imported only when a download actually starts. `engine.js` is imported only when inference is needed. |
| **Trimmed first paint** | Messages longer than 12k characters render the beginning and expand on demand (tap *Show all*). |
| **Cheap composer** | Auto-growing the textarea is coalesced to one layout pass per frame and skipped for short single-line input. |
| **No smooth-scroll storm** | The message list scrolls instantly while streaming (smooth scrolling is used only for explicit "jump to bottom"). |
| **Visual budget** | Safe Mode drops the 90px-blurred background layers for one static gradient, blur is reduced on mobile, and animations/layers are turned off when not needed. |
| **No wasted downloads** | The model preflight is a few kB of JSON: a wrong or removed model is rejected in milliseconds instead of after hundreds of MB. |
| **Variant ordering** | q8 is tried first — ONNX Runtime's native int8 kernels are the cheapest path on CPUs, and the file is often the smallest of the three. |

## 🧯 How we handle crashes (so you see fewer of them)

1. **Idle release** — after a while without use the model is dropped from GPU/RAM (also when the tab sat in the background). Loading it again from the local cache takes seconds; keeping it forever is what makes mobile browsers kill tabs.
2. **Don't warm up on weak devices** — a phone that ran the model yesterday may be killed at startup while other apps are open, so low-end devices load the model on the first message instead.
3. **Draft guard** — the composer text is mirrored to `localStorage` (debounced) and restored after a reload or crash.
4. **Partial answers are saved while streaming** (every ~3 s) — a crash leaves a resumable message with a **Continue** button rather than an empty chat.
5. **Self-healing worker** — a watchdog notices a silently dead Worker, rebuilds the engine on the main thread, reloads the model and retries the operation; the UI is told to restart the bubble so no text is duplicated.
6. **Engine health check** — before sending (and when the tab wakes up) the app verifies the engine is still alive and reloads it transparently if it died in the background.
7. **Crash marking** — device-lost/OOM errors mark the engine as dead immediately (no half-broken "Ready" state), and the recovery dialog offers Safe Mode or a CPU model.
8. **Network blips** — a failed download is retried once with a clear message; the free-space check runs before a download starts.
9. **Rare GPU adapter quirks** — the probe falls back to the default adapter when `high-performance` is refused, so a capable phone is not wrongly sent to the CPU engine.

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
10. **Release when idle** — see above; configurable in *Settings → Memory & offline* (Auto / 5 min / 15 min / 1 h / Never).

## 📴 Offline work — what lives where

| Data | Store | Managed by |
|---|---|---|
| App-shell (HTML/CSS/JS/icons) | Cache API `offchat-shell-v5` | Service Worker |
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
- Quality gate: `node tests/check.mjs` — syntax, catalog integrity, Polish-text sweep, id wiring, module smoke test, streaming-renderer equivalence (incremental == one-shot HTML, with a DOM-work budget), crash-guard helpers and Service-Worker precache completeness.
- Or serve with `python3 -m http.server` and click around.

## 📄 License

MIT — do whatever you want with it. Happy offline chatting! 💜
