// ─────────────────────────────────────────────────────────────
// OffChat · config.js — central app configuration.
// Engine versions, model catalog, default settings, prompts.
// ─────────────────────────────────────────────────────────────

export const APP_NAME = "OffChat";
export const APP_VERSION = "1.3.0";

/**
 * Pinned AI engine versions (immutable CDN builds).
 * WebLLM 0.2.84 ↔ modelVersion v0_2_84 (compatible model .wasm files).
 * Transformers.js 3.8.1 — v3 branch with WebGPU + WASM backends.
 */
export const WEBLLM_VERSION = "0.2.84";
export const TRANSFORMERS_VERSION = "3.8.1";
// Onnxruntime engine .wasm files (ort-wasm-simd-threaded.jsep.*).
// Transformers.js 3.x fetches them from its own dist/ by default —
// we pin the same directory (onnxruntime-web version consistency).
export const ORT_WASM_CDN =
  `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/`;

/**
 * Engine import attempt order (resilience against a single CDN outage).
 * Engines load LAZILY — only after the user picks a model.
 *
 * NOTE (verified in builds):
 * - WebLLM 0.2.84 `lib/index.js` is a fully self-contained ESM module
 *   (no bare imports) → the safest first choice.
 * - `dist/transformers.web.js` in 3.x has BARE onnxruntime-web/common
 *   imports (does NOT work in browsers!) → we use ESM-service URLs
 *   that resolve them to full addresses (jsdelivr +esm / esm.sh).
 */
export const ENGINE_CDN = {
  webllm: [
    `https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@${WEBLLM_VERSION}/lib/index.js`,
    `https://esm.sh/@mlc-ai/web-llm@${WEBLLM_VERSION}`,
    `https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@${WEBLLM_VERSION}/+esm`,
  ],
  transformers: [
    `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/+esm`,
    `https://esm.sh/@huggingface/transformers@${TRANSFORMERS_VERSION}`,
  ],
};

/**
 * Default system prompt. Deliberately does NOT force any language —
 * the model simply mirrors whatever language the user writes in,
 * so every model can answer in the language it handles best.
 */
export const SYSTEM_PROMPT =
  "You are OffChat — a helpful, accurate AI assistant running 100% locally in the user's browser. " +
  "Match the user's language: always reply in the same language the user writes in. " +
  "Use clean Markdown formatting (headings, lists, bold, code blocks) when it helps readability. " +
  "If you don't know the answer, say so honestly. Be concise but thorough.";

export const TIERS = {
  ultra: { label: "Ultra light", desc: "Runs on any phone, even with 3 GB RAM" },
  mini: { label: "Light", desc: "Great balance for mid-range phones" },
  smart: { label: "Balanced", desc: "Good quality with moderate memory" },
  pro: { label: "Powerful", desc: "Excellent quality — stronger phones & computers" },
  max: { label: "Desktop", desc: "Top quality — a computer is recommended" },
  wasm: { label: "Compatibility (WASM)", desc: "Fallback CPU engine when WebGPU is missing" },
};

export const ACCENTS = {
  violet: { label: "Violet", swatch: "#7c3aed" },
  ocean: { label: "Ocean", swatch: "#0ea5e9" },
  rose: { label: "Rose", swatch: "#f43f5e" },
  mint: { label: "Mint", swatch: "#10b981" },
  amber: { label: "Amber", swatch: "#f59e0b" },
};

export const BG_STYLES = {
  aurora: { label: "Aurora" },
  tide: { label: "Tide" },
  solid: { label: "Solid" },
};

export const BUBBLE_STYLES = {
  soft: { label: "Soft" },
  round: { label: "Round" },
  sharp: { label: "Sharp" },
};

/**
 * WebLLM model catalog (WebGPU).
 * - modelId: identifier from WebLLM's prebuiltAppConfig (verified at runtime)
 * - sizeMB: approximate download size (q4 weights + tokenizer + wasm)
 * - vramMB: official VRAM/memory requirements from the MLC config
 * - quality: subjective general answer-quality score, 1–5
 * - tps: estimated generation speed range [min, max] in tokens/sec
 *        on typical hardware (phones land near the low end, desktop
 *        GPUs near the high end). Shown as an estimate in the UI.
 * - needsF16: requires shader-f16 (missing → auto-switch to q4f32 build)
 * - stable: false = base/experimental model (never the default pick)
 * - tag: optional specialty badge ("code" | "reasoning")
 */
export const MODEL_CATALOG = [
  {
    // Note: in WebLLM 0.2.84 the 135M only exists as q0f16/q0f32
    // (there is no q4f16_1 build of this model in prebuiltAppConfig).
    key: "smol135", engine: "webllm",
    modelId: "SmolLM2-135M-Instruct-q0f16-MLC",
    name: "SmolLM2 135M", family: "SmolLM2", params: "0.14B",
    sizeMB: 60, vramMB: 360, ctx: 4096, quality: 2, tier: "ultra",
    needsF16: true, stable: true, tps: [60, 150],
    estDl: "~3–8 s",
    blurb: "Instant start — just ~60 MB. Downloads in seconds and runs on the weakest phones.",
  },
  {
    key: "smol360", engine: "webllm",
    modelId: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    name: "SmolLM2 360M", family: "SmolLM2", params: "0.36B",
    sizeMB: 260, vramMB: 376, ctx: 4096, quality: 2, tier: "ultra",
    needsF16: true, stable: true, tps: [40, 100],
    estDl: "~12–20 s",
    blurb: "Tiny and super fast. Basic quality, but runs literally everywhere.",
  },
  {
    // f16-free variant: needs NO shader-f16, which is exactly what old
    // phones/tablets lack — bundled with the 1B+ models by request only.
    key: "smol360f32", engine: "webllm",
    modelId: "SmolLM2-360M-Instruct-q4f32_1-MLC",
    name: "SmolLM2 360M (f16-free)", family: "SmolLM2", params: "0.36B",
    sizeMB: 300, vramMB: 580, ctx: 4096, quality: 2, tier: "ultra",
    needsF16: false, stable: true, tps: [30, 80],
    estDl: "~12–20 s",
    blurb: "No shader-f16 required — the most compatible WebGPU model for very old GPUs.",
  },
  {
    key: "gemma3-1b", engine: "webllm",
    modelId: "gemma3-1b-it-q4f16_1-MLC",
    name: "Gemma 3 1B", family: "Gemma", params: "1B",
    sizeMB: 820, vramMB: 711, ctx: 4096, quality: 4, tier: "mini",
    needsF16: false, stable: true, tps: [20, 55],
    estDl: "~35–60 s",
    blurb: "Google's 1B model: no f16 requirement and better answers than most 1B rivals.",
  },
  {
    key: "tinyllama", engine: "webllm",
    modelId: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
    name: "TinyLlama 1.1B", family: "TinyLlama", params: "1.1B",
    sizeMB: 700, vramMB: 697, ctx: 2048, quality: 2, tier: "mini",
    needsF16: true, stable: true, tps: [25, 70],
    estDl: "~30–45 s",
    blurb: "A legendary tiny chatterbox. Fast on old phones, best for short English chats.",
  },
  {
    key: "llama1b", engine: "webllm",
    modelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    name: "Llama 3.2 1B", family: "Llama", params: "1B",
    sizeMB: 800, vramMB: 879, ctx: 4096, quality: 4, tier: "mini",
    needsF16: false, stable: true, tps: [20, 60],
    estDl: "~35–55 s",
    blurb: "Surprisingly capable for 1B parameters. A favorite for weaker phones.",
  },
  {
    key: "qwen05", engine: "webllm",
    modelId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    name: "Qwen 2.5 0.5B", family: "Qwen", params: "0.5B",
    sizeMB: 460, vramMB: 944, ctx: 4096, quality: 3, tier: "mini",
    needsF16: false, stable: true, tps: [30, 80],
    estDl: "~20–30 s",
    blurb: "Tiny but fluent and smart. Great quality for its size.",
  },
  {
    key: "coder05", engine: "webllm",
    modelId: "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC",
    name: "Qwen Coder 0.5B", family: "Qwen", params: "0.5B",
    sizeMB: 460, vramMB: 945, ctx: 4096, quality: 3, tier: "mini",
    needsF16: false, stable: true, tps: [30, 80], tag: "code",
    estDl: "~20–30 s",
    blurb: "A pocket-sized coding helper: snippets, debugging and code explanations.",
  },
  {
    key: "qwen3-06", engine: "webllm",
    modelId: "Qwen3-0.6B-q4f16_1-MLC",
    name: "Qwen 3 0.6B", family: "Qwen", params: "0.6B",
    sizeMB: 600, vramMB: 1403, ctx: 4096, quality: 3, tier: "smart",
    needsF16: false, stable: false, tps: [25, 70],
    estDl: "~25–40 s",
    blurb: "Newer Qwen generation (base variant). Experimental — sometimes needs a nudge.",
  },
  {
    key: "gemma2b-1k", engine: "webllm",
    modelId: "gemma-2-2b-it-q4f16_1-MLC-1k",
    name: "Gemma 2 2B (1k)", family: "Gemma", params: "2B",
    sizeMB: 1500, vramMB: 1583, ctx: 1024, quality: 4, tier: "smart",
    needsF16: true, stable: true, tps: [12, 35],
    estDl: "~1–1.5 min",
    blurb: "Google's model with short 1k context — less memory, still polished answers.",
  },
  {
    key: "qwen15", engine: "webllm",
    modelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "Qwen 2.5 1.5B", family: "Qwen", params: "1.5B",
    sizeMB: 1000, vramMB: 1629, ctx: 4096, quality: 4, tier: "smart",
    needsF16: false, stable: true, tps: [15, 45],
    estDl: "~45–70 s",
    blurb: "The mid-weight king: natural answers, summaries, instructions and code.",
  },
  {
    key: "coder15", engine: "webllm",
    modelId: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
    name: "Qwen Coder 1.5B", family: "Qwen", params: "1.5B",
    sizeMB: 1000, vramMB: 1630, ctx: 4096, quality: 4, tier: "smart",
    needsF16: false, stable: true, tps: [15, 40], tag: "code",
    estDl: "~45–70 s",
    blurb: "Specialized in code: writes, explains and fixes programs in many languages.",
  },
  {
    key: "smol17", engine: "webllm",
    modelId: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    name: "SmolLM2 1.7B", family: "SmolLM2", params: "1.7B",
    sizeMB: 1100, vramMB: 1774, ctx: 4096, quality: 3, tier: "smart",
    needsF16: true, stable: true, tps: [15, 45],
    estDl: "~50–80 s",
    blurb: "Very fast with strong reasoning. A great all-rounder for its size.",
  },
  {
    key: "gemma2b", engine: "webllm",
    modelId: "gemma-2-2b-it-q4f16_1-MLC",
    name: "Gemma 2 2B", family: "Gemma", params: "2B",
    sizeMB: 1500, vramMB: 1895, ctx: 4096, quality: 4, tier: "pro",
    needsF16: true, stable: true, tps: [12, 35],
    estDl: "~1–1.5 min",
    blurb: "Full 4k context. Polite, coherent, solid general knowledge.",
  },
  {
    key: "qwen3-17", engine: "webllm",
    modelId: "Qwen3-1.7B-q4f16_1-MLC",
    name: "Qwen 3 1.7B", family: "Qwen", params: "1.7B",
    sizeMB: 1300, vramMB: 2036, ctx: 4096, quality: 4, tier: "pro",
    needsF16: false, stable: false, tps: [14, 40],
    estDl: "~1–1.5 min",
    blurb: "New generation, base variant. Experimental, can impress with quality.",
  },
  {
    key: "llama3b", engine: "webllm",
    modelId: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    name: "Llama 3.2 3B", family: "Llama", params: "3B",
    sizeMB: 2000, vramMB: 2263, ctx: 4096, quality: 5, tier: "pro",
    needsF16: false, stable: true, tps: [10, 30],
    estDl: "~1.5–2.5 min",
    blurb: "The sweet spot: fluent, logical, great for longer texts.",
  },
  {
    key: "hermes3-3b", engine: "webllm",
    modelId: "Hermes-3-Llama-3.2-3B-q4f16_1-MLC",
    name: "Hermes 3 3B", family: "Hermes", params: "3B",
    sizeMB: 2000, vramMB: 2264, ctx: 4096, quality: 5, tier: "pro",
    needsF16: false, stable: true, tps: [10, 30],
    estDl: "~1.5–2.5 min",
    blurb: "Hermes-tuned Llama 3B: sharper instruction following and role-play.",
  },
  {
    key: "qwen25-3b", engine: "webllm",
    modelId: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    name: "Qwen 2.5 3B", family: "Qwen", params: "3B",
    sizeMB: 1900, vramMB: 2505, ctx: 4096, quality: 5, tier: "pro",
    needsF16: false, stable: true, tps: [9, 28],
    estDl: "~1.5–2.5 min",
    blurb: "Bigger Qwen 2.5: noticeably smarter, still phone-friendly on strong devices.",
  },
  {
    key: "coder3b", engine: "webllm",
    modelId: "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC",
    name: "Qwen Coder 3B", family: "Qwen", params: "3B",
    sizeMB: 1900, vramMB: 2505, ctx: 4096, quality: 5, tier: "pro",
    needsF16: false, stable: true, tps: [9, 25], tag: "code",
    estDl: "~1.5–2.5 min",
    blurb: "A serious little coding assistant for real-world programming tasks.",
  },
  {
    key: "phi35-1k", engine: "webllm",
    modelId: "Phi-3.5-mini-instruct-q4f16_1-MLC-1k",
    name: "Phi 3.5 mini (1k)", family: "Phi", params: "3.8B",
    sizeMB: 2300, vramMB: 2520, ctx: 1024, quality: 4, tier: "pro",
    needsF16: false, stable: true, tps: [8, 22],
    estDl: "~2–3 min",
    blurb: "Brilliant at logic and code, mostly English-trained. Short 1k context.",
  },
  {
    key: "qwen3-4b", engine: "webllm",
    modelId: "Qwen3-4B-q4f16_1-MLC",
    name: "Qwen 3 4B", family: "Qwen", params: "4B",
    sizeMB: 2600, vramMB: 3431, ctx: 4096, quality: 4, tier: "max",
    needsF16: false, stable: false, tps: [6, 18],
    estDl: "~2–3.5 min",
    blurb: "Big and bright (experimental base variant). For powerful computers.",
  },
  {
    key: "phi4-mini", engine: "webllm",
    modelId: "Phi-4-mini-instruct-q4f16_1-MLC",
    name: "Phi 4 mini", family: "Phi", params: "3.8B",
    sizeMB: 2400, vramMB: 3438, ctx: 4096, quality: 5, tier: "max",
    needsF16: false, stable: true, tps: [6, 18],
    estDl: "~2–3 min",
    blurb: "Microsoft's compact reasoner: strong math, logic and coding skills.",
  },
  {
    key: "mistral7b", engine: "webllm",
    modelId: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC",
    name: "Mistral 7B v0.3", family: "Mistral", params: "7B",
    sizeMB: 4300, vramMB: 4573, ctx: 4096, quality: 5, tier: "max",
    needsF16: true, stable: true, tps: [4, 12],
    estDl: "~3.5–5 min",
    blurb: "The classic 7B: elegant writing and strong instruction following. Desktop recommended.",
  },
  {
    key: "llama8b-1k", engine: "webllm",
    modelId: "Llama-3.1-8B-Instruct-q4f16_1-MLC-1k",
    name: "Llama 3.1 8B (1k)", family: "Llama", params: "8B",
    sizeMB: 4900, vramMB: 4598, ctx: 1024, quality: 5, tier: "max",
    needsF16: false, stable: true, tps: [4, 11],
    estDl: "~4–6 min",
    blurb: "Short-context 8B: flagship quality with a smaller memory footprint. PC only.",
  },
  {
    key: "hermes3-8b", engine: "webllm",
    modelId: "Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
    name: "Hermes 3 8B", family: "Hermes", params: "8B",
    sizeMB: 4900, vramMB: 4876, ctx: 4096, quality: 5, tier: "max",
    needsF16: false, stable: true, tps: [4, 11],
    estDl: "~4–6 min",
    blurb: "Hermes-tuned Llama 8B: one of the best open 8B chat models. Desktop.",
  },
  {
    key: "llama8b", engine: "webllm",
    modelId: "Llama-3.1-8B-Instruct-q4f16_1-MLC",
    name: "Llama 3.1 8B", family: "Llama", params: "8B",
    sizeMB: 4900, vramMB: 5001, ctx: 4096, quality: 5, tier: "max",
    needsF16: false, stable: true, tps: [4, 10],
    estDl: "~4–6 min",
    blurb: "Full-context 8B Llama: deep, coherent, great for long work. Desktop.",
  },
  {
    key: "deepseek-llama8b", engine: "webllm",
    modelId: "DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC",
    name: "DeepSeek R1 8B", family: "DeepSeek", params: "8B",
    sizeMB: 4900, vramMB: 5001, ctx: 4096, quality: 5, tier: "max",
    needsF16: false, stable: true, tps: [3, 10], tag: "reasoning",
    estDl: "~4–6 min",
    blurb: "Thinks step-by-step before answering. Superb logic, slower output. Desktop.",
  },
  {
    key: "qwen25-7b", engine: "webllm",
    modelId: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
    name: "Qwen 2.5 7B", family: "Qwen", params: "7B",
    sizeMB: 4400, vramMB: 5107, ctx: 4096, quality: 5, tier: "max",
    needsF16: false, stable: true, tps: [4, 12],
    estDl: "~3.5–5 min",
    blurb: "Flagship Qwen 2.5: excellent all-round intelligence. Desktop.",
  },
  {
    key: "deepseek-7b", engine: "webllm",
    modelId: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC",
    name: "DeepSeek R1 7B", family: "DeepSeek", params: "7B",
    sizeMB: 4400, vramMB: 5107, ctx: 4096, quality: 5, tier: "max",
    needsF16: false, stable: true, tps: [3, 10], tag: "reasoning",
    estDl: "~3.5–5 min",
    blurb: "Reasoning model: shows its thinking, solves hard problems. Desktop.",
  },
  {
    key: "qwen3-8b", engine: "webllm",
    modelId: "Qwen3-8B-q4f16_1-MLC",
    name: "Qwen 3 8B", family: "Qwen", params: "8B",
    sizeMB: 5200, vramMB: 5696, ctx: 4096, quality: 4, tier: "max",
    needsF16: false, stable: false, tps: [3, 10],
    estDl: "~4–7 min",
    blurb: "New-gen 8B (experimental base). Very capable on strong desktops.",
  },
  {
    key: "gemma9b", engine: "webllm",
    modelId: "gemma-2-9b-it-q4f16_1-MLC",
    name: "Gemma 2 9B", family: "Gemma", params: "9B",
    sizeMB: 5400, vramMB: 6422, ctx: 4096, quality: 5, tier: "max",
    needsF16: true, stable: true, tps: [2, 8],
    estDl: "~4–7 min",
    blurb: "Google's 9B powerhouse: top-tier quality if your PC can hold it.",
  },
];

/**
 * Fallback Transformers.js catalog (WASM/CPU) — when the browser has no WebGPU.
 * dtypes: ONNX quantization variants to try, in order.
 * q4 first on purpose: int4 weights with fp32 math are the fastest thing
 * ONNX Runtime Web has for the CPU engine (q4f16 needs expensive fp16
 * emulation without a GPU), and the fallbacks cover repos that lack it.
 */
/**
 * Compatibility (WASM/CPU) catalog — Transformers.js.
 *
 * Every entry here is VERIFIED against the Hugging Face Hub
 * (`/api/models/<repo>/tree/main/onnx`, 2026-09-16): the repository
 * exists, is public, and the weight files listed in `files` are really
 * published. `files` = download size per variant in MB (weights only),
 * `externalData: true` = weights live in `…onnx_data` shards beside a
 * tiny graph file (the engine must be told via `use_external_data_format`).
 *
 * WHY THIS MATTERS: Hugging Face answers **401 Unauthorized** for a
 * repository that does not exist (or is private) — it does NOT return
 * 404 — and Transformers.js reports that as
 * `Unauthorized access to file: "https://huggingface.co/…"`, which
 * looks like an account problem. A single wrong repository id (e.g. a
 * model whose canonical name ends in `-ONNX`) therefore broke whole
 * families of models. `js/model-check.js` re-checks every model at
 * runtime, repairs renamed repos and picks a variant that exists.
 *
 * `dtypes` order: **q8 first** — it is ONNX Runtime's native WASM
 * integer path and, for most of these repositories, also the smallest
 * file; q4 second (`_q4`), q4f16 last (fp16 kernels are emulated on
 * CPU, so that variant is the slowest despite being small).
 */
export const WASM_CATALOG = [
  {
    key: "w-smol135", engine: "transformers",
    modelId: "HuggingFaceTB/SmolLM2-135M-Instruct",
    name: "SmolLM2 135M", family: "SmolLM2", params: "135M",
    sizeMB: 137, vramMB: 350, ctx: 2048, quality: 2, tier: "wasm",
    dtypes: ["q8", "q4", "q4f16"], files: { q4: 182, q8: 137, q4f16: 118 },
    stable: true, tps: [4, 12], estDl: "~4–8 s",
    blurb: "The lightest mode we have. Simple answers, runs on anything that can run a browser.",
  },
  {
    key: "w-smol360", engine: "transformers",
    modelId: "HuggingFaceTB/SmolLM2-360M-Instruct",
    name: "SmolLM2 360M", family: "SmolLM2", params: "360M",
    sizeMB: 370, vramMB: 600, ctx: 2048, quality: 2, tier: "wasm",
    dtypes: ["q8", "q4", "q4f16"], files: { q4: 388, q8: 365, q4f16: 273 },
    stable: true, tps: [2, 7], estDl: "~10–18 s",
    blurb: "Balanced CPU mode: noticeably better answers, still light on memory.",
  },
  {
    key: "w-gemma270m", engine: "transformers",
    modelId: "onnx-community/gemma-3-270m-it-ONNX",
    name: "Gemma 3 270M", family: "Gemma", params: "270M",
    sizeMB: 545, vramMB: 650, ctx: 2048, quality: 3, tier: "wasm",
    dtypes: ["q8", "q4", "q4f16"], files: { q4: 323, q8: 545, q4f16: 273 },
    externalData: true,
    stable: true, tps: [3, 8], estDl: "~10–18 s",
    blurb: "Google's newest tiny model — surprisingly coherent for its size.",
  },
  {
    key: "w-qwen05", engine: "transformers",
    modelId: "onnx-community/Qwen2.5-0.5B-Instruct",
    name: "Qwen 2.5 0.5B", family: "Qwen", params: "0.5B",
    sizeMB: 520, vramMB: 900, ctx: 2048, quality: 3, tier: "wasm",
    dtypes: ["q8", "q4", "q4f16"], files: { q4: 786, q8: 512, q4f16: 483 },
    stable: true, tps: [1, 4], estDl: "~15–25 s",
    blurb: "Best quality-per-megabyte in CPU mode. Slower, but speaks beautifully.",
  },
  {
    key: "w-qwen3-06", engine: "transformers",
    modelId: "onnx-community/Qwen3-0.6B-ONNX",
    name: "Qwen 3 0.6B", family: "Qwen", params: "0.6B",
    sizeMB: 620, vramMB: 1100, ctx: 2048, quality: 3, tier: "wasm",
    dtypes: ["q8", "q4", "q4f16"], files: { q4: 919, q8: 618, q4f16: 570 },
    stable: true, tps: [1, 4], estDl: "~20–30 s",
    blurb: "Newer Qwen generation in CPU mode: better reasoning, a bit heavier.",
  },
  {
    key: "w-tinyllama", engine: "transformers",
    modelId: "onnx-community/TinyLlama-1.1B-Chat-v1.0-ONNX",
    name: "TinyLlama 1.1B", family: "TinyLlama", params: "1.1B",
    sizeMB: 1100, vramMB: 1350, ctx: 2048, quality: 2, tier: "wasm",
    dtypes: ["q8", "q4", "q4f16"], files: { q4: 910, q8: 1101, q4f16: 714 },
    stable: true, tps: [1, 4], estDl: "~30–45 s",
    blurb: "Tiny and quick on CPU. Good for short chats without a GPU.",
  },
  {
    key: "w-llama1b", engine: "transformers",
    modelId: "onnx-community/Llama-3.2-1B-Instruct-ONNX",
    name: "Llama 3.2 1B", family: "Llama", params: "1B",
    sizeMB: 1240, vramMB: 1300, ctx: 2048, quality: 4, tier: "wasm",
    dtypes: ["q8", "q4", "q4f16"], files: { q4: 1693, q8: 1237, q4f16: 1090 },
    externalData: true,
    stable: true, tps: [0.5, 3], estDl: "~1–1.5 min",
    blurb: "Strongest CPU mode for patient users with a decent processor.",
  },
  {
    key: "w-smol17", engine: "transformers",
    modelId: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
    name: "SmolLM2 1.7B", family: "SmolLM2", params: "1.7B",
    sizeMB: 1710, vramMB: 1900, ctx: 2048, quality: 3, tier: "wasm",
    dtypes: ["q8", "q4", "q4f16"], files: { q4: 1412, q8: 1714, q4f16: 1109 },
    stable: true, tps: [0.5, 2], estDl: "~1–1.5 min",
    blurb: "Bigger brain for CPU mode — slow, but surprisingly clever.",
  },
  {
    key: "w-qwen15", engine: "transformers",
    modelId: "onnx-community/Qwen2.5-1.5B-Instruct",
    name: "Qwen 2.5 1.5B", family: "Qwen", params: "1.5B",
    sizeMB: 1590, vramMB: 1700, ctx: 2048, quality: 4, tier: "wasm",
    dtypes: ["q8", "q4", "q4f16"], files: { q4: 1787, q8: 1578, q4f16: 1221 },
    stable: true, tps: [0.5, 2], estDl: "~1–1.5 min",
    blurb: "Strong CPU option for patient users with faster processors.",
  },
];

export const ALL_MODELS = [...MODEL_CATALOG, ...WASM_CATALOG];

export function getModel(key) {
  return ALL_MODELS.find((m) => m.key === key) || null;
}

/** Human-readable speed range, e.g. "20–60 tok/s". */
export function formatTps(model) {
  const t = model?.tps;
  if (!Array.isArray(t) || t.length < 2) return "";
  return `${t[0]}–${t[1]} tok/s`;
}

export const DEFAULT_SETTINGS = {
  theme: "auto",            // auto | light | dark
  accent: "violet",         // violet | ocean | rose | mint | amber
  bgStyle: "aurora",        // aurora | tide | solid
  glass: true,              // glassmorphism (blur) — off saves weak GPUs
  safeMode: "auto",         // auto | on | off — protects weak GPUs from crashes
  potato: false,            // 🐢 Potato mode — one-click profile for ancient phones
  potatoAsked: false,       // has the Potato-mode suggestion been shown already?
  fontSize: 15,             // chat font size in px (13–18)
  bubbleStyle: "round",     // soft | round | sharp
  avatars: true,            // show message avatars
  ctxCap: "auto",           // auto | 1024 | 2048 | 4096 | full
  modelKey: null,           // selected model
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 512,
  systemPrompt: SYSTEM_PROMPT,
  animations: true,
  sendOnEnter: true,
  cacheBackend: "cache",    // cache (Cache API) | opfs (experimental)
  idleUnload: "auto",       // auto | off | 5 | 15 | 60 — release the model when idle (minutes)
  downloaded: {},           // { modelKey: { ts, bytes } }
  onboarded: false,
  lastThreadId: null,
};

export const LIMITS = {
  maxThreads: 60,
  maxMessagesPerThread: 300,
  maxInputChars: 4000,
  renderWindow: 60, // how many recent messages to render (perf on weak phones)
  renderWindowSafe: 30, // same, when Safe Mode is active
  maxRenderChars: 12000, // longer messages render on demand (keeps the DOM light)
  draftSaveMs: 600, // debounce for the composer crash-guard draft
  partialSaveMs: 3000, // how often a streaming answer is persisted (crash safety)
};

/**
 * Idle-unload timeouts in milliseconds ("auto" resolves per device class).
 * Releasing the model frees GPU/RAM — the main defence against OOM kills
 * on phones — at the cost of a fast reload from the local cache.
 */
export const IDLE_UNLOAD_MS = {
  autoWeak: 6 * 60000,   // phones / weak GPUs: be aggressive
  autoStrong: 30 * 60000, // desktop: barely noticeable
  fixed: { "5": 5 * 60000, "15": 15 * 60000, "60": 60 * 60000 },
};
