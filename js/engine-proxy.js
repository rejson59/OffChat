// ─────────────────────────────────────────────────────────────
// OffChat · engine-proxy.js — engine facade.
// Tries a Web Worker (smooth UI); when the worker is unavailable
// (old browser, CSP, file://), falls back to the main thread.
// The API is identical in both modes.
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
    this._wdTimer = null;
    this._wdFails = 0;
  }

  init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }

  async _init() {
    // 1) try the worker
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
    // 2) fallback: main thread
    this.direct = new Engine();
    this.mode = "direct";
    return "direct";
  }

  _breakWorker() {
    this.workerBroken = true;
    this._stopWatchdog();
    try { this.worker?.terminate(); } catch { /* ignoruj */ }
    this.worker = null;
    for (const [, p] of this.pending) {
      p.reject(new Error("AI engine worker is unavailable."));
    }
    this.pending.clear();
  }

  /**
   * Watchdog: senses a silent worker death (crash/OOM without onerror),
   * so long operations (download, compile) never hang "forever" —
   * after 2 failed pings we switch to direct mode and retry
   * the operation (weights sit in the cache anyway).
   */
  _startWatchdog() {
    this._stopWatchdog();
    if (!this.worker || this.workerBroken) return;
    this._wdFails = 0;
    this._wdTimer = setInterval(() => {
      if (!this.worker || this.workerBroken) {
        this._stopWatchdog();
        return;
      }
      this._workerCall("ping", {}, { timeoutMs: 12000 }).catch(() => {
        this._wdFails++;
        if (this._wdFails >= 2) this._breakWorker();
      });
    }, 20000);
  }

  _stopWatchdog() {
    if (this._wdTimer) {
      clearInterval(this._wdTimer);
      this._wdTimer = null;
    }
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
      p.reject(new Error(msg.data?.message || "AI engine error"));
    }
  }

  _workerCall(cmd, payload, { onProgress, onToken, timeoutMs = 0 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("AI engine worker is unavailable."));
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

  /** Run with automatic worker → direct fallback. */
  async _run(cmd, payload, handlers, directFn) {
    await this.init();
    if (this.mode === "worker" && !this.workerBroken) {
      this._startWatchdog();
      try {
        return await this._workerCall(cmd, payload, handlers);
      } catch (e) {
        // Hard worker failure (not a model error!) → switch to direct and retry once.
        const msg = String(e?.message || "");
        if (msg === "TIMEOUT" || msg.includes("unavailable") || this.workerBroken) {
          this._breakWorker();
          this.direct = new Engine();
          this.mode = "direct";
        } else {
          throw e;
        }
      } finally {
        if (!this.workerBroken) this._stopWatchdog();
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
