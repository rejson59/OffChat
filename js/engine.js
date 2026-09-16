// ─────────────────────────────────────────────────────────────
// OffChat · engine.js — 100% local inference engine.
// Runs in a Web Worker (smooth UI) with an emergency fallback
// to the main thread. Supports two backends:
//   1) WebLLM (WebGPU) — fast, default on most devices.
//   2) Transformers.js (WASM/CPU) — compatibility mode without WebGPU.
// Engine libraries load LAZILY from a CDN (with a fallback list).
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
    : new Error("Could not download the AI engine from any CDN.");
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
    return { phase: "download", progress: 0, text: `Variant ${dtype}…` };
  }
  const file = String(p.file || "model");
  const short = file.split("/").pop();
  if (p.status === "initiate") {
    return { phase: "download", progress: 0, text: `Starting: ${short}` };
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
    return { phase: "load", progress: 1, text: `Done: ${short}` };
  }
  return { phase: "load", progress: 0.5, text: `${p.status || "loading"}: ${short}` };
}

/**
 * Find the f32 sibling of a model (when the GPU lacks shader-f16).
 * E.g. "Llama-3.2-1B-Instruct-q4f16_1-MLC" → "…-q4f32_1-MLC",
 *      "SmolLM2-135M-Instruct-q0f16-MLC"   → "…-q0f32-MLC".
 * The suffix (-MLC / -MLC-1k) is preserved exactly, so a 1k model
 * never turns into a 4k variant (and vice versa).
 */
function findF32Sibling(list, modelId) {
  // Fast path: the classic q4f16_1 → q4f32_1 swap.
  const quickId = modelId.replace("q4f16_1", "q4f32_1");
  if (quickId !== modelId) {
    const quick = list.find((r) => r.model_id === quickId);
    if (quick) return quick;
  }
  // Generic path: same name base + same suffix + any f32 variant.
  const m = modelId.match(/^(.*?)(?:q\d?f\d+(?:_\d+)?)(-MLC.*)?$/);
  if (!m || !m[1]) return null;
  const base = m[1];
  const suffix = m[2] || "";
  const sibs = list.filter(
    (r) =>
      r.model_id !== modelId &&
      r.model_id.startsWith(base + "q") &&
      r.model_id.endsWith(suffix) &&
      /f32/.test(r.model_id)
  );
  if (!sibs.length) return null;
  // Prefer the q4f32 variant (usually smaller than q0f32), then anything.
  return sibs.find((r) => /q4f32/.test(r.model_id)) || sibs[0];
}

export class Engine {
  constructor() {
    this.kind = null;       // 'webllm' | 'transformers' | null
    this.modelId = null;
    this.webllm = null;     // WebLLM module
    this.wEngine = null;    // MLCEngine instance
    this.tf = null;         // transformers module
    this.pipe = null;       // text-generation pipeline
    this.tok = null;
    this.gen = 0;           // generation counter (interruptions)
    this.aborted = false;
  }

  get loaded() {
    return this.kind !== null && (this.wEngine !== null || this.pipe !== null);
  }

  abort() {
    this.gen++;
    this.aborted = true;
    if (this.kind === "webllm" && this.wEngine) {
      try { this.wEngine.interruptGenerate(); } catch { /* ignore */ }
    }
  }

  // ── WebLLM (WebGPU) ──────────────────────────────────────────
  async loadWebLLM({ modelId, cacheBackend = "cache", contextWindow = 0, hasF16 = true, onProgress }) {
    this.abort();
    onProgress?.({ phase: "download", progress: 0, text: "Loading the WebLLM engine…" });
    const webllm = (this.webllm ||= await importFirst(ENGINE_CDN.webllm));

    const list = [...(webllm.prebuiltAppConfig?.model_list || [])];
    let rec = list.find((r) => r.model_id === modelId);
    if (!rec) {
      throw new Error(
        `MODEL_NOT_FOUND: ${modelId} is not shipped with this WebLLM build. Pick another model from the list.`
      );
    }
    // Automatic variant swap when the GPU lacks shader-f16.
    // Handles every naming scheme: q4f16_1→q4f32_1, q4f16→q4f32, q0f16→q0f32.
    if (rec.required_features?.includes("shader-f16") && !hasF16) {
      const sib = findF32Sibling(list, modelId);
      if (sib) {
        rec = sib;
        modelId = sib.model_id;
      } else {
        throw new Error(
          "Your GPU has no shader-f16 support and this model has no fallback build. Pick another model."
        );
      }
    }

    if (this.wEngine) {
      try { await this.wEngine.unload(); } catch { /* ignore */ }
      this.wEngine = null;
    }
    if (this.pipe) {
      try { await this.pipe.dispose?.(); } catch { /* ignore */ }
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

    onProgress?.({ phase: "download", progress: 0, text: "Connecting… (first download weighs hundreds of MB)" });
    this.wEngine = await webllm.CreateMLCEngine(modelId, {
      appConfig,
      logLevel: "WARN",
      initProgressCallback: (rep) => onProgress?.(mapWebLLMProgress(rep)),
    });
    this.kind = "webllm";
    this.modelId = modelId;
    onProgress?.({ phase: "ready", progress: 1, text: "Model ready" });
    return { modelId, engine: "webllm" };
  }

  async generateWebLLM(messages, { onToken, temperature = 0.7, maxTokens = 512, topP = 0.9 } = {}) {
    if (!this.wEngine) throw new Error("The WebLLM engine is not loaded.");
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
        try { await this.wEngine.interruptGenerate(); } catch { /* ignore */ }
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
    onProgress?.({ phase: "download", progress: 0, text: "Loading the Transformers.js engine (WASM)…" });
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
      try { await this.wEngine.unload(); } catch { /* ignore */ }
      this.wEngine = null;
    }
    if (this.pipe) {
      try { await this.pipe.dispose?.(); } catch { /* ignore */ }
      this.pipe = null;
      this.tok = null;
    }

    let lastErr = null;
    for (const dtype of dtypes) {
      try {
        onProgress?.({ phase: "download", progress: 0, text: `Variant ${dtype} — connecting…` });
        this.pipe = await tf.pipeline("text-generation", modelId, {
          device,
          dtype,
          progress_callback: (p) => onProgress?.(mapTFProgress(p, dtype)),
        });
        this.tok = this.pipe.tokenizer;
        this.kind = "transformers";
        this.modelId = modelId;
        onProgress?.({ phase: "ready", progress: 1, text: "Model ready" });
        return { modelId, engine: "transformers", dtype };
      } catch (e) {
        lastErr = e;
        this.pipe = null;
        this.tok = null;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`Could not load model ${modelId} in any variant.`);
  }

  buildTFPrompt(messages) {
    // 1) the tokenizer's official chat template
    try {
      if (this.tok?.apply_chat_template) {
        return this.tok.apply_chat_template(messages, {
          tokenize: false,
          add_generation_prompt: true,
        });
      }
    } catch { /* fallback below */ }
    // 2) manual, universal format
    return messages
      .map((m) => {
        if (m.role === "system") return `System: ${m.content}`;
        if (m.role === "user") return `User: ${m.content}`;
        return `Assistant: ${m.content}`;
      })
      .join("\n\n") + "\n\nAssistant:";
  }

  async generateTransformers(messages, { onToken, temperature = 0.7, maxTokens = 512, topP = 0.9 } = {}) {
    if (!this.pipe || !this.tok) throw new Error("The WASM engine is not loaded.");
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
        // TextStreamer may call with the full text or a delta — handle both.
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
    // Authoritative full text (the streamer may drop tails on some models).
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

  // ── Shared ───────────────────────────────────────────────────
  async unload() {
    this.abort();
    if (this.wEngine) {
      try { await this.wEngine.unload(); } catch { /* ignore */ }
      this.wEngine = null;
    }
    if (this.pipe) {
      try { await this.pipe.dispose?.(); } catch { /* ignore */ }
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
