// ─────────────────────────────────────────────────────────────
// OffChat · engine.js — silnik wnioskowania (inference) 100% lokalnie.
// Działa w Web Workerze (płynny UI) z awaryjnym fallbackiem do wątku głównego.
// Wspiera dwa backendy:
//   1) WebLLM (WebGPU) — szybki, domyślny na większości urządzeń.
//   2) Transformers.js (WASM/CPU) — tryb zgodności bez WebGPU.
// Biblioteki silników ładowane są LENIWIE z CDN (z listą fallbacków).
// ─────────────────────────────────────────────────────────────
import { ENGINE_CDN, ORT_WASM_CDN } from "./config.js";

async function importFirst(urls) {
  let lastErr = null;
  for (const url of urls) {
    try {
      return await import(/* @vite-ignore */ url);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Nie udało się pobrać silnika AI z żadnego CDN.");
}

function mapWebLLMProgress(rep) {
  const text = String(rep?.text || "");
  const p = Math.max(0, Math.min(1, Number(rep?.progress ?? 0)));
  let phase = "download";
  if (/load|init|compil|warm|warming|create.*pipeline/i.test(text)) phase = "load";
  if (p >= 1) phase = "ready";
  return { phase, progress: p, text };
}

function mapTFProgress(p, dtype) {
  if (!p || typeof p !== "object") {
    return { phase: "download", progress: 0, text: `Wariant ${dtype}…` };
  }
  const file = String(p.file || "model");
  const short = file.split("/").pop();
  if (p.status === "initiate") {
    return { phase: "download", progress: 0, text: `Start: ${short}` };
  }
  if (p.status === "download" || p.status === "progress") {
    const pct = Math.round(Number(p.progress || 0));
    const extra =
      p.loaded && p.total
        ? ` · ${Math.round(p.loaded / 1048576)}/${Math.round(p.total / 1048576)} MB`
        : "";
    return { phase: "download", progress: Math.min(0.99, pct / 100), text: `${short} — ${pct}%${extra}` };
  }
  if (p.status === "done") {
    return { phase: "load", progress: 1, text: `Gotowe: ${short}` };
  }
  return { phase: "load", progress: 0.5, text: `${p.status || "ładowanie"}: ${short}` };
}

export class Engine {
  constructor() {
    this.kind = null;       // 'webllm' | 'transformers' | null
    this.modelId = null;
    this.webllm = null;     // moduł WebLLM
    this.wEngine = null;    // instancja MLCEngine
    this.tf = null;         // moduł transformers
    this.pipe = null;       // pipeline text-generation
    this.tok = null;
    this.gen = 0;           // licznik generacji (przerwania)
    this.aborted = false;
  }

  get loaded() {
    return this.kind !== null && (this.wEngine !== null || this.pipe !== null);
  }

  abort() {
    this.gen++;
    this.aborted = true;
    if (this.kind === "webllm" && this.wEngine) {
      try { this.wEngine.interruptGenerate(); } catch { /* ignoruj */ }
    }
  }

  // ── WebLLM (WebGPU) ──────────────────────────────────────────
  async loadWebLLM({ modelId, cacheBackend = "cache", contextWindow = 0, hasF16 = true, onProgress }) {
    this.abort();
    onProgress?.({ phase: "download", progress: 0, text: "Ładowanie silnika WebLLM…" });
    const webllm = (this.webllm ||= await importFirst(ENGINE_CDN.webllm));

    const list = [...(webllm.prebuiltAppConfig?.model_list || [])];
    let rec = list.find((r) => r.model_id === modelId);
    if (!rec) {
      throw new Error(
        `Model ${modelId} nie występuje w tej wersji silnika WebLLM. Wybierz inny model z listy.`
      );
    }
    // Automatyczna podmiana wariantu, gdy GPU nie ma shader-f16.
    if (rec.required_features?.includes("shader-f16") && !hasF16) {
      const sibId = modelId.replace("q4f16_1", "q4f32_1");
      const sib = list.find((r) => r.model_id === sibId);
      if (sib) {
        rec = sib;
        modelId = sibId;
      } else {
        throw new Error(
          "Twoje GPU nie wspiera shader-f16, a model nie ma wariantu zastępczego. Wybierz inny model."
        );
      }
    }

    if (this.wEngine) {
      try { await this.wEngine.unload(); } catch { /* ignoruj */ }
      this.wEngine = null;
    }
    if (this.pipe) {
      try { await this.pipe.dispose?.(); } catch { /* ignoruj */ }
      this.pipe = null;
      this.tok = null;
    }

    const overrides = { ...(rec.overrides || {}) };
    if (contextWindow > 0) {
      const base = rec.overrides?.context_window_size || contextWindow;
      overrides.context_window_size = Math.min(contextWindow, base);
    }
    const appConfig = {
      ...webllm.prebuiltAppConfig,
      cacheBackend,
      model_list: [{ ...rec, overrides }],
    };

    onProgress?.({ phase: "download", progress: 0, text: "Nawiązywanie… (pierwsze pobranie waży setki MB)" });
    this.wEngine = await webllm.CreateMLCEngine(modelId, {
      appConfig,
      logLevel: "WARN",
      initProgressCallback: (rep) => onProgress?.(mapWebLLMProgress(rep)),
    });
    this.kind = "webllm";
    this.modelId = modelId;
    onProgress?.({ phase: "ready", progress: 1, text: "Model gotowy" });
    return { modelId, engine: "webllm" };
  }

  async generateWebLLM(messages, { onToken, temperature = 0.7, maxTokens = 512, topP = 0.9 } = {}) {
    if (!this.wEngine) throw new Error("Silnik WebLLM nie jest załadowany.");
    const myGen = ++this.gen;
    this.aborted = false;
    const t0 = performance.now();
    let text = "";
    let count = 0;
    let ttft = 0;
    let first = true;

    const stream = await this.wEngine.chat.completions.create({
      messages,
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    let usage = null;
    for await (const chunk of stream) {
      if (this.aborted || myGen !== this.gen) {
        try { await this.wEngine.interruptGenerate(); } catch { /* ignoruj */ }
        break;
      }
      if (chunk?.usage) usage = chunk.usage;
      const delta = chunk?.choices?.[0]?.delta?.content || "";
      if (delta) {
        if (first) { ttft = performance.now() - t0; first = false; }
        text += delta;
        count++;
        onToken?.(delta, text);
      }
    }
    const secs = Math.max(0.001, (performance.now() - t0) / 1000);
    const outTokens = usage?.completion_tokens ?? count;
    return {
      text,
      aborted: this.aborted || myGen !== this.gen,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: outTokens,
      ttftMs: Math.round(ttft),
      tokPerSec: Math.round((outTokens / secs) * 10) / 10,
    };
  }

  // ── Transformers.js (WASM/CPU) ───────────────────────────────
  async loadTransformers({ modelId, dtypes = ["q4f16", "q4", "q8"], device = "wasm", threads = 1, onProgress }) {
    this.abort();
    onProgress?.({ phase: "download", progress: 0, text: "Ładowanie silnika Transformers.js (WASM)…" });
    const tf = (this.tf ||= await importFirst(ENGINE_CDN.transformers));

    try {
      if (tf.env) {
        tf.env.allowRemoteModels = true;
        tf.env.allowLocalModels = false;
        const onnx = tf.env.backends?.onnx;
        if (onnx?.wasm) {
          onnx.wasm.wasmPaths = ORT_WASM_CDN;
          onnx.wasm.numThreads = Math.max(1, threads);
          onnx.wasm.simd = true;
        }
        if (onnx) onnx.logLevel = "error";
        if (tf.env.backends?.onnx?.wasm && typeof Proxy === "undefined") {
          onnx.wasm.proxy = false;
        }
      }
    } catch { /* best-effort */ }

    if (this.wEngine) {
      try { await this.wEngine.unload(); } catch { /* ignoruj */ }
      this.wEngine = null;
    }
    if (this.pipe) {
      try { await this.pipe.dispose?.(); } catch { /* ignoruj */ }
      this.pipe = null;
      this.tok = null;
    }

    let lastErr = null;
    for (const dtype of dtypes) {
      try {
        onProgress?.({ phase: "download", progress: 0, text: `Wariant ${dtype} — łączenie…` });
        this.pipe = await tf.pipeline("text-generation", modelId, {
          device,
          dtype,
          progress_callback: (p) => onProgress?.(mapTFProgress(p, dtype)),
        });
        this.tok = this.pipe.tokenizer;
        this.kind = "transformers";
        this.modelId = modelId;
        onProgress?.({ phase: "ready", progress: 1, text: "Model gotowy" });
        return { modelId, engine: "transformers", dtype };
      } catch (e) {
        lastErr = e;
        this.pipe = null;
        this.tok = null;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`Nie udało się załadować modelu ${modelId} w żadnym wariancie.`);
  }

  buildTFPrompt(messages) {
    // 1) oficjalny chat template tokenizera
    try {
      if (this.tok?.apply_chat_template) {
        return this.tok.apply_chat_template(messages, {
          tokenize: false,
          add_generation_prompt: true,
        });
      }
    } catch { /* fallback poniżej */ }
    // 2) ręczny, uniwersalny format
    return messages
      .map((m) => {
        if (m.role === "system") return `System: ${m.content}`;
        if (m.role === "user") return `Użytkownik: ${m.content}`;
        return `Asystent: ${m.content}`;
      })
      .join("\n\n") + "\n\nAsystent:";
  }

  async generateTransformers(messages, { onToken, temperature = 0.7, maxTokens = 512, topP = 0.9 } = {}) {
    if (!this.pipe || !this.tok) throw new Error("Silnik WASM nie jest załadowany.");
    const tf = this.tf;
    const myGen = ++this.gen;
    this.aborted = false;
    const t0 = performance.now();
    let full = "";
    let ttft = 0;
    let first = true;

    const streamer = new tf.TextStreamer(this.tok, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunkText) => {
        if (this.aborted || myGen !== this.gen) return;
        // TextStreamer potrafi wołać z pełnym tekstem lub przyrostem — obsłuż oba.
        let piece = String(chunkText ?? "");
        if (piece.startsWith(full) && full.length > 0) piece = piece.slice(full.length);
        else if (full.endsWith(piece) && piece.length > 0) piece = "";
        if (!piece) return;
        if (first) { ttft = performance.now() - t0; first = false; }
        full += piece;
        onToken?.(piece, full);
      },
    });

    const prompt = this.buildTFPrompt(messages);
    let out;
    try {
      out = await this.pipe(prompt, {
        max_new_tokens: maxTokens,
        temperature: Math.max(0.01, temperature),
        top_p: topP,
        repetition_penalty: 1.1,
        do_sample: temperature > 0,
        streamer,
        return_full_text: false,
      });
    } catch (e) {
      if (this.aborted || myGen !== this.gen) {
        return { text: full, aborted: true, ttftMs: Math.round(ttft), tokPerSec: 0 };
      }
      throw e;
    }
    // Autorytatywny pełny tekst (streamer mógł gubić ogony na niektórych modelach).
    const finalText = String(out?.[0]?.generated_text ?? full);
    if (finalText.length > full.length && !(this.aborted || myGen !== this.gen)) {
      const rest = finalText.slice(full.length);
      full = finalText;
      onToken?.(rest, full);
    } else {
      full = finalText;
    }
    const secs = Math.max(0.001, (performance.now() - t0) / 1000);
    const approxTokens = Math.max(1, Math.ceil(full.length / 4));
    return {
      text: full,
      aborted: this.aborted || myGen !== this.gen,
      ttftMs: Math.round(ttft),
      tokPerSec: Math.round((approxTokens / secs) * 10) / 10,
    };
  }

  // ── Wspólne ──────────────────────────────────────────────────
  async unload() {
    this.abort();
    if (this.wEngine) {
      try { await this.wEngine.unload(); } catch { /* ignoruj */ }
      this.wEngine = null;
    }
    if (this.pipe) {
      try { await this.pipe.dispose?.(); } catch { /* ignoruj */ }
      this.pipe = null;
      this.tok = null;
    }
    this.kind = null;
    this.modelId = null;
  }

  state() {
    return { kind: this.kind, modelId: this.modelId, loaded: this.loaded };
  }
}
