// ─────────────────────────────────────────────────────────────
// OffChat · engine-proxy.js — fasada silnika.
// Próbuje Web Workera (płynność UI); gdy worker niedostępny
// (stara przeglądarka, CSP, file://), przechodzi na tryb bezpośredni.
// API identyczne w obu trybach.
// ─────────────────────────────────────────────────────────────
import { Engine } from "./engine.js";

export class EngineProxy {
  constructor() {
    this.mode = null; // 'worker' | 'direct'
    this.worker = null;
    this.direct = null;
    this.reqSeq = 0;
    this.pending = new Map();
    this.initPromise = null;
    this.workerBroken = false;
  }

  init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }

  async _init() {
    // 1) próba workera
    if (!this.workerBroken && typeof Worker !== "undefined") {
      try {
        const worker = new Worker(new URL("./llm-worker.js", import.meta.url), {
          type: "module",
        });
        this.worker = worker;
        worker.onmessage = (e) => this._onMessage(e.data);
        worker.onerror = () => this._breakWorker();
        worker.onmessageerror = () => this._breakWorker();
        await this._workerCall("ping", {}, { timeoutMs: 8000 });
        this.mode = "worker";
        return "worker";
      } catch {
        this._breakWorker();
      }
    }
    // 2) fallback: wątek główny
    this.direct = new Engine();
    this.mode = "direct";
    return "direct";
  }

  _breakWorker() {
    this.workerBroken = true;
    try { this.worker?.terminate(); } catch { /* ignoruj */ }
    this.worker = null;
    for (const [, p] of this.pending) {
      p.reject(new Error("Worker silnika AI niedostępny."));
    }
    this.pending.clear();
  }

  _onMessage(msg) {
    if (!msg || msg.reqId == null) return;
    const p = this.pending.get(msg.reqId);
    if (!p) return;
    if (msg.event === "progress") p.onProgress?.(msg.data);
    else if (msg.event === "token") p.onToken?.(msg.data?.delta || "", msg.data);
    else if (msg.event === "done") {
      this.pending.delete(msg.reqId);
      clearTimeout(p.timer);
      p.resolve(msg.data);
    } else if (msg.event === "error") {
      this.pending.delete(msg.reqId);
      clearTimeout(p.timer);
      p.reject(new Error(msg.data?.message || "Błąd silnika AI"));
    }
  }

  _workerCall(cmd, payload, { onProgress, onToken, timeoutMs = 0 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker silnika AI niedostępny."));
        return;
      }
      const reqId = ++this.reqSeq;
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(reqId);
          reject(new Error("TIMEOUT"));
        }, timeoutMs);
      }
      this.pending.set(reqId, { resolve, reject, onProgress, onToken, timer });
      try {
        this.worker.postMessage({ reqId, cmd, payload });
      } catch (e) {
        this.pending.delete(reqId);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  /** Wykonaj z automatycznym fallbackiem worker → direct. */
  async _run(cmd, payload, handlers, directFn) {
    await this.init();
    if (this.mode === "worker" && !this.workerBroken) {
      try {
        return await this._workerCall(cmd, payload, handlers);
      } catch (e) {
        // Twardy błąd workera (nie błąd modelu!) → przełącz na direct i ponów raz.
        const msg = String(e?.message || "");
        if (msg === "TIMEOUT" || msg.includes("niedostępny") || this.workerBroken) {
          this._breakWorker();
          this.direct = new Engine();
          this.mode = "direct";
        } else {
          throw e;
        }
      }
    }
    return directFn(this.direct);
  }

  loadWebLLM(args) {
    const { onProgress, ...rest } = args;
    return this._run(
      "loadWebLLM", rest, { onProgress },
      (eng) => eng.loadWebLLM({ ...rest, onProgress })
    );
  }

  loadTransformers(args) {
    const { onProgress, ...rest } = args;
    return this._run(
      "loadTransformers", rest, { onProgress },
      (eng) => eng.loadTransformers({ ...rest, onProgress })
    );
  }

  chat(messages, options = {}) {
    const { onToken, ...rest } = options;
    return this._run(
      "chat", { messages, options: rest }, { onToken },
      (eng) =>
        eng.kind === "webllm"
          ? eng.generateWebLLM(messages, { ...rest, onToken })
          : eng.generateTransformers(messages, { ...rest, onToken })
    );
  }

  async abort() {
    if (this.mode === "worker" && this.worker && !this.workerBroken) {
      try { await this._workerCall("abort", {}, { timeoutMs: 3000 }); } catch { /* ignoruj */ }
    }
    this.direct?.abort();
  }

  async unload() {
    if (this.mode === "worker" && this.worker && !this.workerBroken) {
      try { await this._workerCall("unload", {}, { timeoutMs: 10000 }); } catch { /* ignoruj */ }
    }
    await this.direct?.unload?.().catch(() => {});
  }

  async state() {
    await this.init();
    if (this.mode === "worker" && this.worker && !this.workerBroken) {
      try {
        return await this._workerCall("state", {}, { timeoutMs: 5000 });
      } catch { /* spadnij do direct */ }
    }
    return this.direct?.state?.() || { kind: null, modelId: null, loaded: false };
  }
}
