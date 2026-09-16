// ─────────────────────────────────────────────────────────────
// OffChat · config.js — centralna konfiguracja aplikacji
// Wersje silników, katalog modeli, domyślne ustawienia, prompty.
// ─────────────────────────────────────────────────────────────

export const APP_NAME = "OffChat";
export const APP_VERSION = "1.0.0";

/**
 * Przypięte wersje silników AI (immutable buildy na CDN).
 * WebLLM 0.2.84 ↔ modelVersion v0_2_84 (kompatybilne pliki .wasm modeli).
 * Transformers.js 3.8.1 — gałąź v3 z backendami WebGPU + WASM.
 */
export const WEBLLM_VERSION = "0.2.84";
export const TRANSFORMERS_VERSION = "3.8.1";
// Wersja onnxruntime-web używana przez Transformers.js 3.8.1 (do jawnych ścieżek WASM).
export const ORT_WASM_CDN =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/";

/**
 * Kolejność prób importu silników (odporność na awarię pojedynczego CDN).
 * Silniki są ładowane LENIWIE — dopiero gdy użytkownik wybierze model.
 */
export const ENGINE_CDN = {
  webllm: [
    `https://esm.sh/@mlc-ai/web-llm@${WEBLLM_VERSION}`,
    `https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@${WEBLLM_VERSION}/+esm`,
    `https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@${WEBLLM_VERSION}/lib/index.js`,
  ],
  transformers: [
    `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/transformers.web.js`,
    `https://esm.sh/@huggingface/transformers@${TRANSFORMERS_VERSION}`,
    `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/+esm`,
  ],
};

export const SYSTEM_PROMPT_PL =
  "Jesteś OffChat — pomocnym, rzeczowym asystentem AI działającym w 100% lokalnie w przeglądarce użytkownika. " +
  "Zawsze odpowiadaj w języku polskim (chyba że użytkownik poprosi o inny język). " +
  "Używaj poprawnej polszczyzny, naturalnego stylu i formatowania Markdown (nagłówki, listy, pogrubienia, bloki kodu). " +
  "Jeśli nie znasz odpowiedzi, powiedz to wprost. Odpowiadaj zwięźle, ale wyczerpująco.";

export const TIERS = {
  ultra: { label: "Ultra lekki", desc: "Działa na każdym telefonie, nawet z 3 GB RAM" },
  mini: { label: "Lekki", desc: "Świetny balans na telefony ze średniej półki" },
  smart: { label: "Zbalansowany", desc: "Dobra jakość polskiego przy umiarkowanej pamięci" },
  pro: { label: "Mocny", desc: "Bardzo dobry polski — na mocniejsze telefony i komputery" },
  max: { label: "Desktop", desc: "Najwyższa jakość — zalecany komputer" },
  wasm: { label: "Tryb zgodności (WASM)", desc: "Awaryjny silnik CPU, gdy brak WebGPU" },
};

/**
 * Katalog modeli WebLLM (WebGPU).
 * - modelId: identyfikator z prebuiltAppConfig WebLLM (weryfikowany w runtime)
 * - sizeMB: przybliżony rozmiar pobierania (wagi q4 + tokenizer + wasm)
 * - vramMB: oficjalne wymagania VRAM/pamięci z konfiguracji MLC
 * - pl: subiektywna ocena jakości języka polskiego 1–5
 * - needsF16: wymaga shader-f16 (brak → automatyczne przełączenie na wariant q4f32)
 * - stable: false = model bazowy/eksperymentalny (nie jest domyślną rekomendacją)
 */
export const MODEL_CATALOG = [
  {
    key: "smol360", engine: "webllm",
    modelId: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    name: "SmolLM2 360M", family: "SmolLM2", params: "0,36 mld",
    sizeMB: 260, vramMB: 376, ctx: 4096, pl: 2, tier: "ultra",
    needsF16: true, stable: true,
    blurb: "Ekspresowy i mikroskopijny. Polski podstawowy, ale ruszy dosłownie wszędzie.",
  },
  {
    key: "llama1b", engine: "webllm",
    modelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    name: "Llama 3.2 1B", family: "Llama", params: "1 mld",
    sizeMB: 800, vramMB: 879, ctx: 4096, pl: 4, tier: "mini",
    needsF16: false, stable: true,
    blurb: "Zaskakująco dobry polski jak na 1 mld parametrów. Faworyt na słabsze telefony.",
  },
  {
    key: "qwen05", engine: "webllm",
    modelId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    name: "Qwen 2.5 0.5B", family: "Qwen", params: "0,5 mld",
    sizeMB: 460, vramMB: 944, ctx: 4096, pl: 4, tier: "mini",
    needsF16: false, stable: true,
    blurb: "Malutki, a mówi po polsku płynnie. Świetny stosunek jakości do rozmiaru.",
  },
  {
    key: "qwen3-06", engine: "webllm",
    modelId: "Qwen3-0.6B-q4f16_1-MLC",
    name: "Qwen 3 0.6B", family: "Qwen", params: "0,6 mld",
    sizeMB: 600, vramMB: 1403, ctx: 4096, pl: 4, tier: "smart",
    needsF16: false, stable: false,
    blurb: "Nowsza generacja Qwen (wariant bazowy). Eksperymentalny — czasem wymaga doprecyzowania.",
  },
  {
    key: "gemma2b-1k", engine: "webllm",
    modelId: "gemma-2-2b-it-q4f16_1-MLC-1k",
    name: "Gemma 2 2B (1k)", family: "Gemma", params: "2 mld",
    sizeMB: 1500, vramMB: 1583, ctx: 1024, pl: 4, tier: "smart",
    needsF16: true, stable: true,
    blurb: "Model Google o skróconym kontekście 1k — mniej pamięci, wciąż ładny polski.",
  },
  {
    key: "qwen15", engine: "webllm",
    modelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "Qwen 2.5 1.5B", family: "Qwen", params: "1,5 mld",
    sizeMB: 1000, vramMB: 1629, ctx: 4096, pl: 5, tier: "smart",
    needsF16: false, stable: true,
    blurb: "Król średniej wagi: piękny, naturalny polski, instrukcje, streszczenia, kod.",
  },
  {
    key: "smol17", engine: "webllm",
    modelId: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    name: "SmolLM2 1.7B", family: "SmolLM2", params: "1,7 mld",
    sizeMB: 1100, vramMB: 1774, ctx: 4096, pl: 3, tier: "smart",
    needsF16: true, stable: true,
    blurb: "Bardzo szybki i sprawny w rozumowaniu. Polski dobry, choć nie idealny.",
  },
  {
    key: "gemma2b", engine: "webllm",
    modelId: "gemma-2-2b-it-q4f16_1-MLC",
    name: "Gemma 2 2B", family: "Gemma", params: "2 mld",
    sizeMB: 1500, vramMB: 1895, ctx: 4096, pl: 4, tier: "pro",
    needsF16: true, stable: true,
    blurb: "Pełny kontekst 4k. Kulturalny, spójny polski, dobra wiedza ogólna.",
  },
  {
    key: "qwen3-17", engine: "webllm",
    modelId: "Qwen3-1.7B-q4f16_1-MLC",
    name: "Qwen 3 1.7B", family: "Qwen", params: "1,7 mld",
    sizeMB: 1300, vramMB: 2036, ctx: 4096, pl: 5, tier: "pro",
    needsF16: false, stable: false,
    blurb: "Nowa generacja, wariant bazowy. Eksperymentalny, potrafi zachwycić jakością.",
  },
  {
    key: "llama3b", engine: "webllm",
    modelId: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    name: "Llama 3.2 3B", family: "Llama", params: "3 mld",
    sizeMB: 2000, vramMB: 2263, ctx: 4096, pl: 5, tier: "pro",
    needsF16: false, stable: true,
    blurb: "Złoty środek dla polskiego: płynny, logiczny, świetny do dłuższych tekstów.",
  },
  {
    key: "phi35-1k", engine: "webllm",
    modelId: "Phi-3.5-mini-instruct-q4f16_1-MLC-1k",
    name: "Phi 3.5 mini (1k)", family: "Phi", params: "3,8 mld",
    sizeMB: 2300, vramMB: 2520, ctx: 1024, pl: 3, tier: "pro",
    needsF16: false, stable: true,
    blurb: "Genialny w logice i kodzie, trening głównie angielski — polski poprawny.",
  },
  {
    key: "qwen3-4b", engine: "webllm",
    modelId: "Qwen3-4B-q4f16_1-MLC",
    name: "Qwen 3 4B", family: "Qwen", params: "4 mld",
    sizeMB: 2600, vramMB: 3431, ctx: 4096, pl: 5, tier: "max",
    needsF16: false, stable: false,
    blurb: "Duży i bystry (wariant bazowy, eksperymentalny). Na mocne komputery.",
  },
  {
    key: "llama8b-1k", engine: "webllm",
    modelId: "Llama-3.1-8B-Instruct-q4f16_1-MLC-1k",
    name: "Llama 3.1 8B (1k)", family: "Llama", params: "8 mld",
    sizeMB: 4900, vramMB: 4598, ctx: 1024, pl: 5, tier: "max",
    needsF16: false, stable: true,
    blurb: "Największy w ofercie. Poziom prawie desktopowego asystenta — tylko na PC.",
  },
];

/**
 * Katalog awaryjny Transformers.js (WASM/CPU) — gdy przeglądarka nie ma WebGPU.
 * dtypes: kolejność prób wariantów kwantyzacji ONNX.
 */
export const WASM_CATALOG = [
  {
    key: "w-smol135", engine: "transformers",
    modelId: "HuggingFaceTB/SmolLM2-135M-Instruct",
    name: "SmolLM2 135M", family: "SmolLM2", params: "135 mln",
    sizeMB: 90, vramMB: 350, ctx: 2048, pl: 2, tier: "wasm",
    dtypes: ["q4f16", "q4", "q8"], stable: true,
    blurb: "Najlżejszy tryb awaryjny. Proste odpowiedzi, minimalne wymagania.",
  },
  {
    key: "w-smol360", engine: "transformers",
    modelId: "HuggingFaceTB/SmolLM2-360M-Instruct",
    name: "SmolLM2 360M", family: "SmolLM2", params: "360 mln",
    sizeMB: 230, vramMB: 600, ctx: 2048, pl: 2, tier: "wasm",
    dtypes: ["q4f16", "q4", "q8"], stable: true,
    blurb: "Zbalansowany tryb CPU: rozsądna szybkość i jakość na słabym sprzęcie.",
  },
  {
    key: "w-qwen05", engine: "transformers",
    modelId: "onnx-community/Qwen2.5-0.5B-Instruct",
    name: "Qwen 2.5 0.5B", family: "Qwen", params: "0,5 mld",
    sizeMB: 450, vramMB: 900, ctx: 2048, pl: 4, tier: "wasm",
    dtypes: ["q4f16", "q4", "q8"], stable: true,
    blurb: "Najlepszy polski w trybie CPU. Wolniejszy, ale mówi pięknie.",
  },
  {
    key: "w-llama1b", engine: "transformers",
    modelId: "onnx-community/Llama-3.2-1B-Instruct",
    name: "Llama 3.2 1B", family: "Llama", params: "1 mld",
    sizeMB: 750, vramMB: 1300, ctx: 2048, pl: 4, tier: "wasm",
    dtypes: ["q4f16", "q4", "q8"], stable: true,
    blurb: "Najmocniejszy tryb CPU — tylko dla cierpliwych i mocniejszych procesorów.",
  },
];

export const ALL_MODELS = [...MODEL_CATALOG, ...WASM_CATALOG];

export function getModel(key) {
  return ALL_MODELS.find((m) => m.key === key) || null;
}

export const DEFAULT_SETTINGS = {
  theme: "auto",            // auto | light | dark
  modelKey: null,           // wybrany model
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 512,
  systemPrompt: SYSTEM_PROMPT_PL,
  memorySaver: true,        // obcięcie kontekstu na słabych urządzeniach
  animations: true,
  sendOnEnter: true,
  cacheBackend: "cache",    // cache (Cache API) | opfs (eksperymentalne)
  downloaded: {},           // { modelKey: { ts, bytes } }
  onboarded: false,
  lastThreadId: null,
};

export const SUGGESTED_PROMPTS = [
  "Wyjaśnij mi prosto, jak działa sztuczna inteligencja w przeglądarce",
  "Napisz krótkie haiku o polskim Bałtyku",
  "Pomóż mi napisać uprzejmego maila z prośbą o podwyżkę",
  "Ułóż plan nauki języka angielskiego na 30 dni",
  "Opowiedz ciekawostkę o historii Polski, której mało kto zna",
  "Popraw stylistykę tego zdania: „Z uwagi na fakt iż pada, zostaniemy w domu”",
];

export const LIMITS = {
  maxThreads: 60,
  maxMessagesPerThread: 300,
  maxInputChars: 4000,
  renderWindow: 60, // ile ostatnich wiadomości renderować (wydajność na słabych tel.)
};
